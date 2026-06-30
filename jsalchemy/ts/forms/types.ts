/* ------------------------------------------------------------------ */
/*  @jsalchemy/forms-core — type definitions                          */
/* ------------------------------------------------------------------ */
/**
 * Core type definitions for `@jsalchemy/forms-core`.
 *
 * This module defines every type, interface, and type alias that the
 * forms engine, its resolvers, validators, and framework adapters rely
 * on.  The two most important types are:
 *
 * - {@link AttributeDescriptor} — the **input** format (what the engine
 *   receives from `$attributeTypes` or hand-authored).
 * - {@link FormField} — the **output** format (what every framework adapter
 *   reads to decide which component to render).
 *
 * @packageDocumentation
 */

/**
 * Input format: a single attribute descriptor, matching the shape of
 * `$attributeTypes` entries produced by `makeResourceClass()` in
 * `classgen.ts`.  Developers using JSA get these for free from
 * `ModelClass.$attributeTypes`; developers outside JSA provide the
 * same shape manually.
 */
export interface AttributeDescriptor {
  /** Field / relation name (same as the property on the model instance). */
  attribute: string

  /**
   * Server-side type — e.g. "String", "Integer", "Float", "Boolean",
   * "Date", "DateTime", "Text", "JSON", etc.
   * Omitted (or undefined) for reference entries.
   */
  type?: string

  /** For references only: the target resource name (e.g. "Provider"). */
  resource?: string

  /** For references only: the column on the *target* side (e.g. "id"). */
  foreign_attribute?: string

  /** For references only: the column on the *local* side (e.g. "provider_id"). */
  local_attribute?: string

  /**
   * Optional server-side widget override.
   * When present, WidgetResolver uses this value instead of the
   * type→widget mapping.
   */
  widget?: string

  /** Human-readable description of the field. */
  description?: string | null

  /** Explicit label (falls back to attribute name when missing). */
  label?: string

  required?: boolean
  readonly?: boolean
  is_pk?: boolean

  /** Any other metadata the server sends (pass-through). */
  [key: string]: any
}

// ------------------------------------------------------------------ //
//  Resolved form-field descriptor (what adapters consume)            //
// ------------------------------------------------------------------ //

/**
 * Normalised category for a field's data type.
 *
 * Groups the many server-side type strings (e.g. `"String"`, `"Text"`,
 * `"Char"`) into a smaller set of abstract categories.  Framework
 * adapters can use this as a fallback when they don't have a widget
 * for the exact type.
 */
export type TypeCategory =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'object'
  | 'array'
  | 'interval'
  | 'reference'
  | 'unknown'

/**
 * Type of a model relationship.
 * - `'one'`  — Foreign-key relationship (N→1).
 * - `'m2m'`  — Many-to-many relationship.
 * - `'many'` — One-to-many relationship (1→N).
 */
export type ReferenceType = 'one' | 'm2m' | 'many'

/**
 * A fully resolved field descriptor.  Every field in the form ends up
 * as a `FormField` — framework adapters read this to decide which
 * component to render and with what props.
 */
export interface FormField {
  /** Normalised field name (copied from `AttributeDescriptor.attribute`). */
  name: string

  /** Original server-side type string. */
  type: string

  /** Normalised category — groups related server types together. */
  typeCategory: TypeCategory

  /** Resolved widget name (e.g. "StringField", "DateField"). */
  widget: string

  /** Human-readable label. */
  label: string

  required: boolean
  readonly: boolean
  placeholder?: string
  description?: string

  /** Client-side or merged validators. */
  validators: ValidatorFn[]

  // ---- reference-specific fields (only for reference-type fields) -- //

  resource?: string
  referenceType?: ReferenceType
  foreignAttribute?: string
  localAttribute?: string

  /**
   * The original server-side widget hint (if the server sent one).
   * This lets adapters know that the widget was explicitly chosen by
   * the backend rather than inferred from the type.
   */
  serverWidget?: string

  /** Catch-all for any extra metadata. */
  extras: Record<string, any>
}

// ------------------------------------------------------------------ //
//  Validation                                                        //
// ------------------------------------------------------------------ //

/**
 * A validator function.
 * @param value     The current value of the field.
 * @param allValues All current form values (useful for cross-field rules).
 * @returns An error string, or `null` / `undefined` if the value is valid.
 */
export type ValidatorFn = (
  value: any,
  allValues: Record<string, any>,
) => string | null | undefined

// ------------------------------------------------------------------ //
//  Form state & lifecycle                                            //

/**
 * The current status of the form lifecycle.
 * - `'idle'` — Waiting for user input.
 * - `'validating'` — {@link FormEngine.validate} is running.
 * - `'submitting'` — {@link FormEngine.submit} is running (prevents
 *   double-submit).
 * - `'submitted'` — `onSubmit` completed without throwing.
 * - `'error'` — Validation failed or `onSubmit` threw an error.
 */
export type FormStatus =
  | 'idle'
  | 'validating'
  | 'submitting'
  | 'submitted'
  | 'error'

/**
 * A snapshot of the form at a given moment.
 * @property fields — Resolved field definitions (immutable reference).
 * @property values — Current field values `{ fieldName: value }`.
 * @property errors — Per-field error arrays `{ fieldName: ["msg"] }`.
 * @property status — Current lifecycle status.
 * @property dirty  — `true` when any value differs from initial values.
 */
export interface FormState {
  fields: FormField[]
  values: Record<string, any>
  errors: Record<string, string[]>
  status: FormStatus
  dirty: boolean
}

/**
 * Lifecycle event names emitted by {@link FormEngine}.
 * - `'submit'` — after `onSubmit` completes successfully.
 * - `'error'` — when `onSubmit` throws.
 * - `'validation'` — after every validation run.
 * - `'change'` — after any `setValue` / `setValues` call.
 * - `'reset'` — after {@link FormEngine.reset}.
 */
export type FormEvent =
  | 'submit'
  | 'error'
  | 'validation'
  | 'change'
  | 'reset'

// ------------------------------------------------------------------ //
//  Configuration                                                     //
// ------------------------------------------------------------------ //

export interface FormConfig {
  /** Array of attribute descriptors (from $attributeTypes or manual). */
  attributeTypes: AttributeDescriptor[]

  /** Optional model name for debugging / labelling. */
  modelName?: string

  /**
   * When `true` (default), the resolver honours a server-provided
   * `widget` hint on each attribute descriptor.
   */
  respectServerWidget?: boolean

  /** Per-field label overrides. */
  labels?: Record<string, string>

  /** Initial form values. */
  initialValues?: Record<string, any>

  /** Extra per-field validators (merged with any inferred validators). */
  validators?: Record<string, ValidatorFn[]>

  /** Submit handler — called after validation passes. */
  onSubmit?: (
    values: Record<string, any>,
    engine: any,
  ) => Promise<void>

  /** Custom widget resolver (defaults to `WidgetResolver`). */
  widgetResolver?: any

  /** Explicit field list (if omitted, all fields from `attributeTypes` are used). */
  include?: string[]

  /** Fields to exclude from the form. */
  exclude?: string[]
}

// ------------------------------------------------------------------ //
//  Widget resolver                                                   //
// ------------------------------------------------------------------ //

/**
 * Type → widget mapping table.
 * Keys are server-side type strings (e.g. `"String"`, `"Integer"`),
 * values are widget names (e.g. `"StringField"`, `"IntegerField"`).
 * Passed to the {@link WidgetResolver} constructor to override defaults.
 */
export interface TypeMapping {
  [serverType: string]: string
}

/**
 * Options for a single widget-resolution pass.
 * @property respectServerWidget — Honour server-provided `widget` hints.
 * @property labels — Per-field label overrides.
 * @property validators — Extra per-field validators.
 */
export interface ResolveOptions {
  respectServerWidget?: boolean
  labels?: Record<string, string>
  validators?: Record<string, ValidatorFn[]>
}