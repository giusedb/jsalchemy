/* ------------------------------------------------------------------ */
/*  @jsalchemy/forms-core                                              */
/*  FormEngine — form state, validation, submit lifecycle              */
/* ------------------------------------------------------------------ */
/**
 * Zero-dependency, framework-agnostic form engine.
 *
 * `FormEngine` manages form state (values, errors, dirty flag), runs
 * client-side validation, handles the submit lifecycle, and notifies
 * subscribers on every change.  It uses a simple subscriber pattern
 * so **any** UI framework (Vue, React, Angular, Svelte, vanilla JS)
 * can plug into it.
 *
 * **Minimal usage:**
 * ```ts
 * const engine = new FormEngine({
 *   attributeTypes: [
 *     { attribute: 'email', type: 'String', required: true },
 *     { attribute: 'age',   type: 'Integer' },
 *   ],
 *   onSubmit: async (values) => { await api.save(values) },
 * })
 *
 * // Reactivity bridge (any framework):
 * engine.subscribe((state) => console.log(state.values, state.errors))
 *
 * // User interaction:
 * engine.setValue('email', 'alice@example.com')
 * await engine.submit()  // validates, then calls onSubmit
 * ```
 *
 * @remarks
 * - `$attributeTypes` from a JSA-generated class can be passed directly
 *   as `attributeTypes`.
 * - The engine does **not** depend on any UI framework, DOM API, or
 *   CSS library.
 */

import type {
  AttributeDescriptor,
  FormConfig,
  FormEvent,
  FormField,
  FormState,
  FormStatus,
  ValidatorFn,
} from './types.js'

import { WidgetResolver } from './WidgetResolver.js'
import { runValidators } from './ValidatorEngine.js'

// ------------------------------------------------------------------ //
//  Helpers                                                           //
// ------------------------------------------------------------------ //

/**
 * Shallow-equality check for two flat records.
 * Used internally to compute the `dirty` flag.
 */
function shallowEqual(a: Record<string, any>, b: Record<string, any>): boolean {
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  for (const k of keysA) {
    if (a[k] !== b[k]) return false
  }
  return true
}

/**
 * Build the initial values record.
 * Every field defaults to `null` unless an explicit `initialValues`
 * entry exists.
 */
function initValues(
  fields: FormField[],
  initialValues?: Record<string, any>,
): Record<string, any> {
  const vals: Record<string, any> = {}
  for (const f of fields) {
    vals[f.name] = initialValues?.[f.name] ?? null
  }
  return vals
}

// ------------------------------------------------------------------ //
//  FormEngine                                                        //
// ------------------------------------------------------------------ //

export class FormEngine {
  // ---- configuration (immutable after construction) -------------- //

  /**
   * Resolved field definitions.
   * This array is computed once from `attributeTypes` at construction
   * and never changes for the lifetime of the engine.
   */
  readonly fields: FormField[]

  /** Optional model name for debugging / labelling. */
  readonly modelName?: string

  /** Whether server widget hints are honoured (default: true). */
  readonly respectServerWidget: boolean

  /**
   * User-provided submit handler.
   * Called by {@link submit} after client-side validation passes.
   * Throwing from this handler sets status to `'error'`.
   */
  readonly onSubmit?: (
    values: Record<string, any>,
    engine: FormEngine,
  ) => Promise<void>

  // ---- mutable state --------------------------------------------- //
  #values: Record<string, any>
  #initialValues: Record<string, any>
  #errors: Record<string, string[]> = {}
  #status: FormStatus = 'idle'

  // ---- subscriber / event infrastructure ------------------------- //
  #subscribers = new Set<(state: Readonly<FormState>) => void>()
  #eventHandlers = new Map<string, Set<(...args: any[]) => void>>()

  // ---- extra validators (per-field, from config) ----------------- //
  #extraValidators: Record<string, ValidatorFn[]>

  /**
   * @param config - Form configuration (attribute descriptors, options,
   *                 submit handler, etc.).
   */
  constructor(config: FormConfig) {
    // Resolve attribute descriptors → FormField[]
    const resolver =
      config.widgetResolver ?? new WidgetResolver()
    this.fields = resolver.resolveAll(config.attributeTypes, {
      respectServerWidget: config.respectServerWidget ?? true,
      labels: config.labels,
      validators: config.validators,
    })

    // Apply include / exclude filters
    if (config.include && config.include.length > 0) {
      const inc = new Set(config.include)
      let keep = this.fields.filter((f) => inc.has(f.name))
      // Preserve the order specified in include
      this.fields = config.include
        .map((name) => this.fields.find((f) => f.name === name))
        .filter(Boolean) as FormField[]
    }
    if (config.exclude && config.exclude.length > 0) {
      const exc = new Set(config.exclude)
      this.fields = this.fields.filter((f) => !exc.has(f.name))
    }

    this.modelName = config.modelName
    this.respectServerWidget = config.respectServerWidget ?? true
    this.onSubmit = config.onSubmit
    this.#extraValidators = config.validators ?? {}

    this.#initialValues = initValues(this.fields, config.initialValues)
    this.#values = { ...this.#initialValues }
  }

  // ---- state access ---------------------------------------------- //

  /**
   * Get a frozen snapshot of the current form state.
   *
   * Every call returns a new frozen object so the consumer (adapter) can
   * safely diff it with a previous snapshot.
   */
  get state(): Readonly<FormState> {
    return Object.freeze({
      fields: this.fields,
      values: this.#values,
      errors: this.#errors,
      status: this.#status,
      dirty: this.dirty,
    })
  }

  /**
   * Whether any field value differs from the initial values.
   *
   * Comparison is shallow (`===`) on each value.
   */
  get dirty(): boolean {
    return !shallowEqual(this.#values, this.#initialValues)
  }

  /**
   * Look up a `FormField` definition by name.
   *
   * @param name - The field name (matches `AttributeDescriptor.attribute`).
   * @returns The field descriptor, or `undefined` if not found.
   */
  getField(name: string): FormField | undefined {
    return this.fields.find((f) => f.name === name)
  }

  // ---- value mutation -------------------------------------------- //

  /**
   * Update a single field value.
   *
   * Triggers a subscriber notification and emits a `'change'` event.
   *
   * @param name  - The field name.
   * @param value - The new value (any type).
   */
  setValue(name: string, value: any): void {
    this.#values[name] = value
    this.#notify()
    this.#emit('change', { name, value })
  }

  /**
   * Update multiple field values at once.
   *
   * Only keys that match known field names are applied.  Triggers a
   * single subscriber notification and a single `'change'` event.
   *
   * @param values - A map of field names to values.
   */
  setValues(values: Record<string, any>): void {
    for (const [k, v] of Object.entries(values)) {
      if (k in this.#values) {
        this.#values[k] = v
      }
    }
    this.#notify()
    this.#emit('change', values)
  }

  // ---- validation ------------------------------------------------ //

  /**
   * Validate all fields against their registered validators.
   *
   * Each field is checked against:
   * 1. An inferred `required` validator if `field.required === true`.
   * 2. All validators in `field.validators` (from the type mapping).
   * 3. All validators in `config.validators[field.name]` (user extras).
   *
   * Errors are stored in `this.#errors` and exposed via `state.errors`.
   * Status is set to `'error'` when any errors are found, `'idle'`
   * otherwise.
   *
   * @returns `true` if all fields are valid, `false` otherwise.
   */
  validate(): boolean {
    this.#status = 'validating'
    const newErrors: Record<string, string[]> = {}

    for (const field of this.fields) {
      const value = this.#values[field.name]
      const fns: ValidatorFn[] = [
        // Inferred required validation from field metadata
        ...(field.required
          ? [
              (v: any) =>
                v == null || (typeof v === 'string' && v.trim() === '')
                  ? 'This field is required'
                  : null,
            ] as ValidatorFn[]
          : []),
        // Validators from the type mapping / server metadata
        ...field.validators,
        // User-supplied extra validators from config
        ...(this.#extraValidators[field.name] ?? []),
      ]
      const errs = runValidators(fns, value, this.#values)
      if (errs.length > 0) newErrors[field.name] = errs
    }

    this.#errors = newErrors
    this.#status = Object.keys(newErrors).length === 0 ? 'idle' : 'error'
    this.#emit('validation', this.#errors)
    this.#notify()
    return Object.keys(newErrors).length === 0
  }

  // ---- submit ---------------------------------------------------- //

  /**
   * Validate and submit the form.
   *
   * 1. Runs {@link validate}. If validation fails, the method returns
   *    early (`status` stays `'error'`).
   * 2. Sets `status` to `'submitting'`.
   * 3. Calls the `onSubmit` handler (if provided).
   * 4. On success: `status` → `'submitted'`, emits `'submit'`.
   * 5. On error (throw): `status` → `'error'`, emits `'error'`.
   *
   * Double-submit is prevented — calling `submit()` while status is
   * `'submitting'` is a no-op.
   */
  async submit(): Promise<void> {
    if (this.#status === 'submitting') return

    const isValid = this.validate()
    if (!isValid) return

    this.#status = 'submitting'
    this.#notify()

    try {
      if (this.onSubmit) {
        await this.onSubmit({ ...this.#values }, this)
      }
      this.#status = 'submitted'
      this.#emit('submit', { values: this.#values })
    } catch (err: any) {
      this.#status = 'error'
      this.#emit('error', err)
    }

    this.#notify()
  }

  // ---- reset ----------------------------------------------------- //

  /**
   * Reset the form to its initial values.
   *
   * Clears all errors, resets status to `'idle'`, and restores every
   * field to the value it had when the engine was constructed
   * (`config.initialValues` or `null`).
   */
  reset(): void {
    this.#values = { ...this.#initialValues }
    this.#errors = {}
    this.#status = 'idle'
    this.#emit('reset')
    this.#notify()
  }

  // ---- subscriber pattern ---------------------------------------- //

  /**
   * Subscribe to every state change.
   *
   * The listener receives a frozen copy of the current state on every
   * mutation (`setValue`, `setValues`, `validate`, `submit`, `reset`).
   * Use this to bridge into your framework's reactivity system.
   *
   * @param listener - Callback invoked with the new state on each change.
   * @returns An unsubscribe function (call it to stop listening).
   *
   * @example
   * ```ts
   * const unsub = engine.subscribe((state) => {
   *   myRenderFunction(state)
   * })
   * // later:
   * unsub()
   * ```
   */
  subscribe(
    listener: (state: Readonly<FormState>) => void,
  ): () => void {
    this.#subscribers.add(listener)
    return () => {
      this.#subscribers.delete(listener)
    }
  }

  /**
   * Listen to named lifecycle events.
   *
   * Supported events: `'submit'`, `'error'`, `'validation'`,
   * `'change'`, `'reset'`.
   *
   * Unlike {@link subscribe}, which fires on **every** state change,
   * `on()` fires only for the specific event, with a contextual payload.
   *
   * @param event   - The event name.
   * @param handler - Handler function (payload varies by event).
   * @returns An unsubscribe function.
   *
   * @example
   * ```ts
   * const unsub = engine.on('submit', ({ values }) => {
   *   console.log('Submitted:', values)
   * })
   * ```
   */
  on(event: FormEvent, handler: (...args: any[]) => void): () => void {
    if (!this.#eventHandlers.has(event)) {
      this.#eventHandlers.set(event, new Set())
    }
    this.#eventHandlers.get(event)!.add(handler)
    return () => {
      this.#eventHandlers.get(event)?.delete(handler)
    }
  }

  // ---- internal helpers ------------------------------------------ //

  /**
   * Notify all subscribers with the current state.
   * Called after every mutation.
   */
  #notify(): void {
    const state = this.state
    for (const fn of this.#subscribers) {
      fn(state)
    }
  }

  /**
   * Emit a named lifecycle event to registered handlers.
   *
   * @param event - The event name.
   * @param args  - Payload to pass to handlers.
   */
  #emit(event: FormEvent, ...args: any[]): void {
    const handlers = this.#eventHandlers.get(event)
    if (handlers) {
      for (const fn of handlers) {
        fn(...args)
      }
    }
  }
}