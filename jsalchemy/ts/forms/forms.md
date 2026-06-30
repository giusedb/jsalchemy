# @jsalchemy/forms-core — Why & How

> *"I'm a lazy developer who got sick and tired of writing the same form boilerplate for every
> model, every API endpoint, every UI framework. Forms are 80% plumbing and 20% actual UX.
> I decided to automate the plumbing."*

## Why

Every web application has forms. And every form follows the same pattern:

1. Define fields (name, type, validation rules)
2. Render inputs (text, number, select, date picker, …)
3. Manage state (values, errors, dirty tracking)
4. Validate client-side
5. Submit to an API
6. Handle server errors

**@jsalchemy/forms-core** takes care of **steps 1–4 and 6** so you only write step 5
(the actual business logic). It is:

- **Framework-agnostic** — works with Vue, React, Angular, Svelte, or vanilla JS
- **JSA-independent** — works with or without the JSAlchemy ecosystem
- **Type-driven** — field types determine widget selection automatically
- **Server-friendly** — the backend can suggest which widget to use for each field
- **Tiny** — zero UI dependencies, just TypeScript

---

## Key concepts

| Concept | What it is |
|---|---|
| **AttributeDescriptor** | A plain object describing one field: `{ attribute: "email", type: "String" }` |
| **FormField** | A resolved descriptor: the core has picked a widget, normalised the type, etc. |
| **WidgetResolver** | The engine that turns `AttributeDescriptor` → `FormField` |
| **FormEngine** | The form state machine: holds values, runs validation, handles submit |
| **ValidatorFn** | A pure function `(value, allValues) => errorString | null` |

---

## Quick start

### Standalone (no JSA)

```ts
import { FormEngine } from '@jsalchemy/forms-core'

const engine = new FormEngine({
  attributeTypes: [
    { attribute: 'email',      type: 'String',  required: true },
    { attribute: 'age',        type: 'Integer'                   },
    { attribute: 'newsletter', type: 'Boolean'                   },
  ],
  onSubmit: async (values) => {
    const res = await fetch('/api/signup', {
      method: 'POST',
      body: JSON.stringify(values),
    })
    if (!res.ok) throw new Error('Server error')
  },
})

// Subscribe to state changes
engine.subscribe((state) => {
  console.log(state.values, state.errors, state.dirty)
})

// User types in the email field
engine.setValue('email', 'alice@example.com')

// User clicks "Save"
await engine.submit()  // will validate, then call onSubmit
```

### With JSA

```ts
import { Invoice } from './generated'   // from makeResourceClass()
import { FormEngine } from '@jsalchemy/forms-core'

const engine = new FormEngine({
  attributeTypes: Invoice.$attributeTypes,
  modelName: 'Invoice',
  onSubmit: async (values) => {
    const resource = new Invoice(values)
    await resource.$save()
  },
})
```

### With server widget override

If your backend wants a `description` field rendered as a rich-text editor instead
of a plain textarea, it can say so:

```json
{
  "attribute": "description",
  "type": "Text",
  "widget": "RichTextField"
}
```

The core honours this by default (`respectServerWidget: true`).

---

## Working with adapters

The core only produces data — it never renders a single `<input>`. To turn a
`FormEngine` into a visual form you need a **framework adapter**:

| Package | Status |
|---|---|
| `@jsalchemy/forms-vue` | *coming soon* |
| `@jsalchemy/forms-react` | *community* |
| `@jsalchemy/forms-angular` | *community* |

Each adapter reads the `FormEngine.fields` array and renders the appropriate
widget for each `FormField`. The widget name in `FormField.widget` tells
the adapter which component to instantiate:

| widget name | typical UI component |
|---|---|
| `StringField` | `<input type="text">` |
| `RichTextField` | `<textarea>` / rich-text editor |
| `IntegerField` | `<input type="number">` with integer step |
| `FloatField` | `<input type="number">` with decimal step |
| `BooleanField` | checkbox / toggle switch |
| `DateField` | date picker |
| `DateTimeField` | date + time picker |
| `ChoiceField` | `<select>` / radio group |
| `ReferenceField` | `<select>` loading related resources |
| `MultiReferenceField` | multi-select / tag picker |

---

## Validation

Built-in validators are provided at `Validators.*`:

```ts
import { Validators } from '@jsalchemy/forms-core'

const engine = new FormEngine({
  attributeTypes: [
    { attribute: 'email', type: 'String', required: true },
  ],
  validators: {
    email: [Validators.email('Enter a valid email address')],
  },
  onSubmit: async (values) => { /* … */ },
})
```

Custom validators are trivial:

```ts
Validators.custom((value, allValues) => {
  return value === allValues.password ? null : 'Passwords must match'
})
```

All validators are pure functions — testable without any UI setup.

---

## API at a glance

```ts
// Create
const engine = new FormEngine(config)

// Read
engine.state          // { fields, values, errors, status, dirty }
engine.fields         // FormField[] (read-only)
engine.getField('x')  // FormField | undefined
engine.dirty          // boolean

// Write
engine.setValue('field', value)
engine.setValues({ field1: v1, field2: v2 })

// Validate & submit
engine.validate()              // → boolean
await engine.submit()          // validates, then calls onSubmit

// Lifecycle
engine.reset()

// Reactivity (any framework)
engine.subscribe(state => /* re-render */)
engine.on('submit',  ({ values }) => /* … */)
engine.on('error',   (err)      => /* … */)
engine.on('reset',   ()         => /* … */)