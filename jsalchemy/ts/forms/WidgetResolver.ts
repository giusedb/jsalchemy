/* ------------------------------------------------------------------ */
/*  @jsalchemy/forms-core                                             */
/*  WidgetResolver — type → widget name resolution                    */
/* ------------------------------------------------------------------ */
/**
 * Resolves raw `AttributeDescriptor` entries (from `$attributeTypes` or
 * hand-authored) into `FormField` objects with a concrete `widget` name.
 *
 * **Resolution priority (1 = highest):**
 *   1. **Server widget override** — if the descriptor has an explicit
 *      `widget` property AND `respectServerWidget` is true (default).
 *   2. **Reference type** — if the descriptor has a `resource` property,
 *      looks up `one`/`m2m`/`many` in the reference-type mapping.
 *   3. **Scalar type** — looks up the `type` property (e.g. `"String"`,
 *      `"Integer"`) in the type mapping.
 *   4. **Fallback** — `StringField`.
 *
 * Both the type mapping and the reference mapping are fully extensible
 * via the constructor and the `set*Mapping` methods.
 */

import type {
  AttributeDescriptor,
  FormField,
  ResolveOptions,
  TypeCategory,
  ReferenceType,
} from './types.js'

// ------------------------------------------------------------------ //
//  Default mappings                                                  //
// ------------------------------------------------------------------ //

/**
 * Default mapping from server-side type strings to widget names.
 * Covers all types produced by the JSAlchemy server (`classgen.ts`
 * JS_TYPES map) plus common SQLAlchemy type names.
 */
const DEFAULT_TYPE_MAPPING: Record<string, string> = {
  // String family
  String: 'StringField',
  Text: 'RichTextField',
  Char: 'StringField',
  Unicode: 'StringField',
  UnicodeText: 'RichTextField',

  // Number family
  Integer: 'IntegerField',
  BigInteger: 'IntegerField',
  SmallInteger: 'IntegerField',
  Float: 'FloatField',
  Decimal: 'FloatField',
  Numeric: 'FloatField',
  Double: 'FloatField',

  // Boolean family
  Boolean: 'BooleanField',
  Bool: 'BooleanField',

  // Date / time family
  Date: 'DateField',
  DateTime: 'DateTimeField',
  Time: 'TimeField',
  Interval: 'IntervalField',

  // Complex types
  JSON: 'ObjectField',
  Json: 'ObjectField',
  ARRAY: 'ArrayField',
  Array: 'ArrayField',

  // Enum / choice
  Enum: 'ChoiceField',
  Choice: 'ChoiceField',
}

/**
 * Default mapping from reference type strings to widget names.
 * - `one` → single foreign-key relationship (N→1)
 * - `m2m` → many-to-many relationship
 * - `many` → one-to-many relationship (1→N)
 */
const DEFAULT_REFERENCE_MAPPING: Record<string, string> = {
  one: 'ReferenceField',
  m2m: 'MultiReferenceField',
  many: 'ReferenceSetField',
}

// ------------------------------------------------------------------ //
//  Internal helpers                                                   //
// ------------------------------------------------------------------ //

/**
 * Map a server type string to a normalised `TypeCategory`.
 *
 * Categories are coarser than server types — they group related types
 * so that adapters can apply fallback rendering when they don't have a
 * widget for an exact type.
 *
 * @param type - Server type string (case-insensitive).
 * @returns The normalised category, or `'unknown'` if unrecognised.
 */
function getTypeCategory(type: string): TypeCategory {
  const upper = type.toUpperCase()
  if (
    ['STRING', 'TEXT', 'CHAR', 'UNICODE', 'UNICODETEXT', 'ENUM', 'CHOICE'].includes(
      upper,
    )
  )
    return 'string'
  if (
    ['INTEGER', 'BIGINTEGER', 'SMALLINTEGER', 'FLOAT', 'DECIMAL', 'NUMERIC', 'DOUBLE'].includes(
      upper,
    )
  )
    return 'number'
  if (['BOOLEAN', 'BOOL'].includes(upper)) return 'boolean'
  if (['DATE'].includes(upper)) return 'date'
  if (['DATETIME', 'TIME'].includes(upper)) return 'datetime'
  if (['JSON', 'JSONB'].includes(upper)) return 'object'
  if (['ARRAY'].includes(upper)) return 'array'
  if (['INTERVAL'].includes(upper)) return 'interval'
  return 'unknown'
}

/**
 * Derive a human-readable label for a field.
 *
 * Priority: explicit `labels` override > `attr.label` > humanised
 * attribute name (`"total_amount"` → `"Total amount"`).
 *
 * @param attr   - The raw attribute descriptor.
 * @param labels - Optional per-field label overrides from config.
 * @returns The label string.
 */
function getLabel(
  attr: AttributeDescriptor,
  labels?: Record<string, string>,
): string {
  if (labels?.[attr.attribute]) return labels[attr.attribute]
  if (attr.label) return attr.label
  // humanise — "total_amount" → "Total amount"
  return attr.attribute
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// ------------------------------------------------------------------ //
//  WidgetResolver class                                              //
// ------------------------------------------------------------------ //

/**
 * Resolves `AttributeDescriptor` entries to `FormField` objects by
 * applying configurable type→widget and reference-type→widget mappings.
 *
 * **Usage:**
 * ```ts
 * const resolver = new WidgetResolver()
 * const field = resolver.resolve({ attribute: 'email', type: 'String' })
 * // → { name: 'email', widget: 'StringField', typeCategory: 'string', ... }
 *
 * // With custom mappings:
 * const custom = new WidgetResolver({ Email: 'EmailField' })
 * ```
 */
export class WidgetResolver {
  /** Current type→widget mapping (merged with defaults at construction). */
  private typeMapping: Record<string, string>

  /** Current reference-type→widget mapping. */
  private referenceMapping: Record<string, string>

  /** Set of recognised reference type strings. */
  private readonly refTypes = new Set(['one', 'm2m', 'many'])

  /**
   * @param typeMapping        Additional or overriding type→widget entries.
   * @param referenceMapping   Additional or overriding reference→widget entries.
   */
  constructor(
    typeMapping?: Record<string, string>,
    referenceMapping?: Record<string, string>,
  ) {
    this.typeMapping = { ...DEFAULT_TYPE_MAPPING, ...typeMapping }
    this.referenceMapping = {
      ...DEFAULT_REFERENCE_MAPPING,
      ...referenceMapping,
    }
  }

  // ---- registration helpers ------------------------------------- //

  /**
   * Register or override the widget for a given server type.
   *
   * @example
   * ```ts
   * resolver.setTypeMapping('Email', 'EmailField')
   * ```
   *
   * @param type   - Server type string (e.g. `"String"`, `"MyCustomType"`).
   * @param widget - Widget name to associate (e.g. `"EmailField"`).
   */
  setTypeMapping(type: string, widget: string): void {
    this.typeMapping[type] = widget
  }

  /**
   * Register or override the widget for a given reference type.
   *
   * @example
   * ```ts
   * resolver.setReferenceMapping('one', 'MyCustomReferencePicker')
   * ```
   *
   * @param refType - Reference type: `"one"`, `"m2m"`, or `"many"`.
   * @param widget  - Widget name to associate.
   */
  setReferenceMapping(refType: string, widget: string): void {
    this.referenceMapping[refType] = widget
  }

  // ---- resolution ----------------------------------------------- //

  /**
   * Resolve a single `AttributeDescriptor` to a fully-qualified `FormField`.
   *
   * The resolution follows this priority:
   * 1. **Server override** — if `respectServerWidget` is true (default) and
   *    `attr.widget` is set, use it directly.
   * 2. **Reference** — if `attr.resource` exists and the type is a known
   *    reference type (`one`, `m2m`, `many`), use the reference mapping.
   * 3. **Scalar type** — look up `attr.type` in the type mapping.
   * 4. **Fallback** — `"StringField"`.
   *
   * Any properties on `attr` not in the known set are passed through to
   * `FormField.extras` for custom adapter use.
   *
   * @param attr    - Raw attribute descriptor from `$attributeTypes` or
   *                  hand-authored.
   * @param options - Optional resolution overrides.
   * @returns A fully resolved `FormField`.
   */
  resolve(
    attr: AttributeDescriptor,
    options?: ResolveOptions,
  ): FormField {
    const respectServerWidget =
      options?.respectServerWidget ?? true

    let widget: string
    let type = attr.type || ''
    let typeCategory: TypeCategory = 'unknown'

    // Priority 1: server-side widget override
    if (respectServerWidget && attr.widget) {
      widget = attr.widget
    }
    // Priority 2: reference field
    else if (attr.resource && this.refTypes.has(type.toLowerCase())) {
      const refType = type.toLowerCase() as ReferenceType
      widget = this.referenceMapping[refType] || 'ReferenceField'
      typeCategory = 'reference'
    }
    // Priority 3: type mapping
    else if (type) {
      widget = this.typeMapping[type] || 'StringField'
      typeCategory = getTypeCategory(type)
    }
    // Priority 4: fallback
    else {
      widget = 'StringField'
    }

    // Second pass: if resource was present but the first pass didn't
    // classify as reference (e.g. type was missing), infer it now.
    if (attr.resource && typeCategory === 'unknown') {
      const refType =
        attr.foreign_attribute && attr.local_attribute ? 'one' : 'many'
      widget = this.referenceMapping[refType] || 'ReferenceField'
      typeCategory = 'reference'
    }

    const label = getLabel(attr, options?.labels)

    const field: FormField = {
      name: attr.attribute,
      type,
      typeCategory,
      widget,
      label,
      required: attr.required || false,
      readonly: attr.readonly || false,
      description: attr.description || undefined,
      validators: options?.validators?.[attr.attribute] || [],
      resource: attr.resource,
      referenceType:
        typeCategory === 'reference'
          ? (attr.resource && (type.toLowerCase() as ReferenceType)) || 'one'
          : undefined,
      foreignAttribute: attr.foreign_attribute,
      localAttribute: attr.local_attribute,
      serverWidget: attr.widget,
      extras: {},
    }

    // Pass through any unrecognised properties to extras
    const knownKeys = new Set([
      'attribute',
      'type',
      'resource',
      'foreign_attribute',
      'local_attribute',
      'widget',
      'description',
      'label',
      'required',
      'readonly',
      'is_pk',
    ])
    for (const key of Object.keys(attr)) {
      if (!knownKeys.has(key)) {
        field.extras[key] = attr[key]
      }
    }

    return field
  }

  /**
   * Resolve an array of `AttributeDescriptor` entries in one call.
   *
   * Convenience wrapper around {@link resolve}.  Each entry is resolved
   * independently with the same `options`.
   *
   * @param attrs   - Array of raw attribute descriptors.
   * @param options - Optional resolution overrides (applied to all).
   * @returns An array of resolved `FormField` objects, in the same order.
   */
  resolveAll(
    attrs: AttributeDescriptor[],
    options?: ResolveOptions,
  ): FormField[] {
    return attrs.map((attr) => this.resolve(attr, options))
  }
}