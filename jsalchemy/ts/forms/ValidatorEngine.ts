/* ------------------------------------------------------------------ */
/*  @jsalchemy/forms-core                                              */
/*  ValidatorEngine — built-in validator factories                     */
/* ------------------------------------------------------------------ */
/**
 * Framework-agnostic validator factories.
 *
 * Every function in this module **returns** a `ValidatorFn` — a pure
 * function `(value, allValues) => errorString | null`.
 *
 * **Usage:**
 * ```ts
 * import { Validators, runValidators } from './ValidatorEngine.js'
 *
 * const checks = [Validators.required(), Validators.email()]
 * const errors = runValidators(checks, 'not-an-email', {})
 * // → ['Invalid email address']
 * ```
 */

import type { ValidatorFn } from './types.js'

// ------------------------------------------------------------------ //
//  Pre-built validator factories                                     //
// ------------------------------------------------------------------ //

/**
 * Returns a validator that rejects `null`, `undefined`, empty strings,
 * and empty arrays.
 *
 * @param msg - Optional custom error message.
 * @returns A `ValidatorFn`.
 */
function required(msg?: string): ValidatorFn {
  const message = msg || 'This field is required'
  return (value) => {
    if (value === null || value === undefined) return message
    if (typeof value === 'string' && value.trim() === '') return message
    if (Array.isArray(value) && value.length === 0) return message
    return null
  }
}

/**
 * Returns a validator that rejects values shorter than `min` characters.
 *
 * @param min - Minimum length (inclusive).
 * @param msg - Optional custom error message.
 * @returns A `ValidatorFn`.
 */
function minLength(min: number, msg?: string): ValidatorFn {
  const message = msg || `Minimum length is ${min} characters`
  return (value) => {
    if (value == null) return null
    const str = String(value)
    return str.length < min ? message : null
  }
}

/**
 * Returns a validator that rejects values longer than `max` characters.
 *
 * @param max - Maximum length (inclusive).
 * @param msg - Optional custom error message.
 * @returns A `ValidatorFn`.
 */
function maxLength(max: number, msg?: string): ValidatorFn {
  const message = msg || `Maximum length is ${max} characters`
  return (value) => {
    if (value == null) return null
    const str = String(value)
    return str.length > max ? message : null
  }
}

/**
 * Returns a validator that rejects numeric values below `minVal`.
 *
 * @param minVal - Minimum value (inclusive).
 * @param msg    - Optional custom error message.
 * @returns A `ValidatorFn`.
 */
function min(minVal: number, msg?: string): ValidatorFn {
  const message = msg || `Value must be at least ${minVal}`
  return (value) => {
    if (value == null) return null
    const num = Number(value)
    return isNaN(num) || num < minVal ? message : null
  }
}

/**
 * Returns a validator that rejects numeric values above `maxVal`.
 *
 * @param maxVal - Maximum value (inclusive).
 * @param msg    - Optional custom error message.
 * @returns A `ValidatorFn`.
 */
function max(maxVal: number, msg?: string): ValidatorFn {
  const message = msg || `Value must be at most ${maxVal}`
  return (value) => {
    if (value == null) return null
    const num = Number(value)
    return isNaN(num) || num > maxVal ? message : null
  }
}

/**
 * Returns a validator that rejects values not matching `regex`.
 *
 * @param regex - Regular expression the value must match.
 * @param msg   - Optional custom error message.
 * @returns A `ValidatorFn`.
 */
function pattern(regex: RegExp, msg?: string): ValidatorFn {
  const message = msg || 'Value does not match the required pattern'
  return (value) => {
    if (value == null) return null
    return regex.test(String(value)) ? null : message
  }
}

/**
 * Returns a validator that rejects invalid email addresses.
 *
 * Uses a standard regex: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`.
 *
 * @param msg - Optional custom error message.
 * @returns A `ValidatorFn`.
 */
function email(msg?: string): ValidatorFn {
  const message = msg || 'Invalid email address'
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return (value) => {
    if (value == null) return null
    return EMAIL_RE.test(String(value)) ? null : message
  }
}

/**
 * Wraps an arbitrary function as a `ValidatorFn`.
 *
 * Use this when the built-in validators are not enough:
 * ```ts
 * Validators.custom((value, allValues) =>
 *   value === allValues.password ? null : 'Passwords must match',
 * )
 * ```
 *
 * @param fn - A function `(value, allValues) => errorString | null`.
 * @returns A `ValidatorFn`.
 */
function custom(
  fn: (value: any, allValues: Record<string, any>) => string | null,
): ValidatorFn {
  return (value, allValues) => fn(value, allValues)
}

// ------------------------------------------------------------------ //
//  Public API                                                        //
// ------------------------------------------------------------------ //

/**
 * Collection of built-in validator factories.
 *
 * Each factory returns a `ValidatorFn` — a pure function that takes
 * `(value, allValues)` and returns an error string or `null`.
 *
 * @example
 * ```ts
 * const checks = [
 *   Validators.required('Email is required'),
 *   Validators.email('Enter a real email'),
 * ]
 * ```
 */
export const Validators = {
  required,
  minLength,
  maxLength,
  min,
  max,
  pattern,
  email,
  custom,
}

/**
 * Run an array of validators against a value and collect all error
 * messages.
 *
 * Validators are run in order and every error is collected (fail-fast
 * is not used here — the caller gets a complete picture).
 *
 * @param validators - Array of validator functions to run.
 * @param value      - The current value of the field.
 * @param allValues  - All current form values (for cross-field rules).
 * @returns An array of error message strings (empty = valid).
 */
export function runValidators(
  validators: ValidatorFn[],
  value: any,
  allValues: Record<string, any>,
): string[] {
  const errors: string[] = []
  for (const fn of validators) {
    const result = fn(value, allValues)
    if (result) errors.push(result)
  }
  return errors
}

export type { ValidatorFn }