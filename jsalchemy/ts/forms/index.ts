/* ------------------------------------------------------------------ */
/*  @jsalchemy/forms-core — public API                                */
/* ------------------------------------------------------------------ */
/**
 * # @jsalchemy/forms-core
 *
 * Framework-agnostic, JSA-independent forms engine.
 *
 * ## Entry points
 *
 * | Export | Description |
 * |--------|-------------|
 * | `FormEngine` | Form state machine (values, errors, validation, submit) |
 * | `WidgetResolver` | Resolves `AttributeDescriptor` → `FormField` |
 * | `Validators` | Built-in validator factories (`required`, `email`, …) |
 * | `runValidators` | Run an array of validators against a value |
 *
 * ## Types
 *
 * All TypeScript interfaces and types (`AttributeDescriptor`, `FormField`,
 * `FormState`, `FormConfig`, …) are exported for use in adapter packages.
 *
 * @example
 * ```ts
 * import { FormEngine } from '@jsalchemy/forms-core'
 *
 * const engine = new FormEngine({
 *   attributeTypes: [
 *     { attribute: 'email', type: 'String', required: true },
 *   ],
 *   onSubmit: async (values) => { /* … * / },
 * })
 * ```
 */

export { FormEngine } from './FormEngine.js'
export { WidgetResolver } from './WidgetResolver.js'
export { Validators, runValidators } from './ValidatorEngine.js'

export type {
  AttributeDescriptor,
  FormField,
  FormState,
  FormConfig,
  FormEvent,
  FormStatus,
  TypeCategory,
  ReferenceType,
  ValidatorFn,
  TypeMapping,
  ResolveOptions,
} from './types.js'