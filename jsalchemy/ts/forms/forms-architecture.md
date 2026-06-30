# @jsalchemy/forms-core — Architecture & Extension Guide

This document describes the internal architecture of the forms core and specifies
**how to build a framework adapter** (Vue, React, Angular, Svelte, …) on top of it.

---

## Table of Contents

1. [Architecture overview](#1-architecture-overview)
2. [Core internals](#2-core-internals)
3. [Contract: core → adapter](#3-contract-core--adapter)
4. [Building a framework adapter](#4-building-a-framework-adapter)
5. [Theme layer (CSS)](#5-theme-layer-css)
6. [Widget naming conventions](#6-widget-naming-conventions)
7. [Publishing](#7-publishing)

---

## 1. Architecture overview

```
                    ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ - ┐
                    │          Development flow               │
                    │                                         │
                    │   AttributeDescriptor[]                 │
                    │         (from $attributeTypes           │
                    │          or hand-authored)              │
                    └──────────────────┬──────────────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────────┐
                    │      @jsalchemy/forms-core           │
                    │                                      │
                    │  WidgetResolver  ──→  FormField[]    │
                    │  FormEngine     ──→  state machine   │
                    │  Validators     ──→  validation      │
                    └──────────────────┬───────────────────┘
                                       │
                    ┌──────────────────▼───────────────────┐
                    │       Framework adapter              │
                    │                                      │
                    │  Reads FormField[] and FormEngine    │
                    │  state, renders native components    │
                    │                                      │
                    │  @jsalchemy/forms-vue                │
                    │  @jsalchemy/forms-react              │
                    │  @jsalchemy/forms-angular            │
                    └──────────────────┬───────────────────┘
                                       │
                    ┌──────────────────▼───────────────────┐
                    │       Theme / CSS layer              │
                    │                                      │
                    │  Applies class names, styles, layout │
                    │                                      │
                    │  Tailwind  │  Bootstrap  │  Semantic │
                    └──────────────────────────────────────┘
```

**Three independent layers:**

| Layer | Responsibility | Dependencies |
|---|---|---|
| **Core** | Field resolution, state, validation, lifecycle | zero |
| **Adapter** | Maps FormField[] → framework components | core + framework |
| **Theme** | CSS classes, icons, layout | adapter package |

---

## 2. Core internals

### 2.1 Data flow

```
AttributeDescriptor[]
        │
        ▼
WidgetResolver.resolveAll()
        │
        ├── honour server `widget` override  (if respectServerWidget)
        ├── detect reference entries         (has `resource`)
        │     └── map reference type → widget  (one→ReferenceField, m2m→MultiReferenceField, …)
        ├── detect scalar types               (has `type`)
        │     └── map type → widget           (String→StringField, Integer→IntegerField, …)
        └── fallback → StringField
        │
        ▼
FormField[]   ← stored on FormEngine.fields
        │
        ▼
FormEngine manages:
  ┌─ values:     Record<string, any>
  ├─ errors:     Record<string, string[]>
  ├─ status:     'idle' | 'validating' | 'submitting' | 'submitted' | 'error'
  ├─ dirty:      computed from values vs initialValues
  ├─ subscribe() pushes frozen FormState to all listeners
  └─ on/emit:    named lifecycle events
```

### 2.2 `AttributeDescriptor` (input)

```ts
interface AttributeDescriptor {
  attribute: string
  type?: string                    // "String", "Integer", "Boolean", "Date", …
  resource?: string               // target model for references
  foreign_attribute?: string
  local_attribute?: string
  widget?: string                 // server-side widget override
  description?: string | null
  label?: string
  required?: boolean
  readonly?: boolean
  is_pk?: boolean
  [key: string]: any              // pass-through
}
```

### 2.3 `FormField` (resolved output)

```ts
interface FormField {
  name: string
  type: string                     // original server type
  typeCategory: TypeCategory       // normalised: 'string' | 'number' | 'boolean' | 'date' | …
  widget: string                   // resolved widget name, e.g. "StringField"
  label: string
  required: boolean
  readonly: boolean
  placeholder?: string
  description?: string
  validators: ValidatorFn[]

  // reference-only:
  resource?: string
  referenceType?: 'one' | 'm2m' | 'many'
  foreignAttribute?: string
  localAttribute?: string
  serverWidget?: string

  extras: Record<string, any>      // any unrecognised properties from the descriptor
}
```

### 2.4 `FormEngine` — public surface

```ts
class FormEngine {
  // Read-only field definitions (set at construction time)
  readonly fields: FormField[]

  constructor(config: FormConfig)

  // State access
  get state(): Readonly<FormState>
  get dirty(): boolean
  getField(name: string): FormField | undefined

  // Mutations
  setValue(name: string, value: any): void
  setValues(values: Record<string, any>): void

  // Validation & submit
  validate(): boolean
  submit(): Promise<void>

  // Reset
  reset(): void

  // Reactivity
  subscribe(listener: (state: FormState) => void): () => void
  on(event: FormEvent, handler: (...args: any[]) => void): () => void
}
```

### 2.5 Event system

| Event | Payload | When |
|---|---|---|
| `'change'` | `{ name, value }` | Any `setValue` / `setValues` call |
| `'validation'` | `Record<string, string[]>` | After `validate()` or failing submit |
| `'submit'` | `{ values }` | After successful submit |
| `'error'` | `Error` | When `onSubmit` throws |
| `'reset'` | — | After `reset()` |

### 2.6 Subscriber system

`subscribe()` receives a frozen `FormState` snapshot after every mutation.
The adapter uses this to bridge into the framework's reactivity system.

```ts
type FormState = {
  fields: FormField[]
  values: Record<string, any>
  errors: Record<string, string[]>
  status: FormStatus
  dirty: boolean
}
```

---

## 3. Contract: core → adapter

### 3.1 What the core provides

1. **`FormField[]`** — an ordered list of resolved field descriptors, each telling the
   adapter what widget to use (`field.widget`), what label to show, whether it's
   required/readonly, and any reference metadata.

2. **`FormEngine` state** — the current values, errors, status, and dirty flag,
   pushed to subscribers on every change.

3. **Mutation methods** — `setValue()`, `setValues()`, `validate()`, `submit()`,
   `reset()`. The adapter calls these in response to user interaction.

4. **Validation** — client-side validators are run by `FormEngine.validate()` and
   `FormEngine.submit()`. Errors are available at `state.errors`.

### 3.2 What the adapter must provide

1. **Widget component registry** — a mapping from `FormField.widget` string to an
   actual renderable component.

   ```ts
   // The adapter maintains something like:
   const widgetComponents: Record<string, ComponentType> = {
     StringField:         MyTextInput,
     IntegerField:        MyNumberInput,
     FloatField:          MyDecimalInput,
     BooleanField:        MyCheckbox,
     DateField:           MyDatePicker,
     DateTimeField:       MyDateTimePicker,
     ChoiceField:         MySelect,
     ReferenceField:      MyReferenceSelect,
     MultiReferenceField: MyMultiSelect,
     RichTextField:       MyRichTextEditor,
     ObjectField:         MyObjectEditor,
     ArrayField:          MyArrayEditor,
     IntervalField:       MyIntervalInput,
   }
   ```

2. **Form layout component** — renders the fields in order, wrapping each with
   a label and error display, and providing a submit button.

3. **Reactivity bridge** — subscribes to `engine.subscribe()` and translates
   state changes into the framework's reactive system (refs, signals, state, …).

### 3.3 Minimal adapter contract

```
┌─────────────────────────────────────────┐
│              Adapter package             │
│                                          │
│  Props (required):                       │
│    engine: FormEngine                    │
│                                          │
│  Renders:                                │
│    For each field in engine.fields:      │
│      <label>{field.label}</label>        │
│      <widget-component                   │
│        value={engine.state.values[f.name]}│
│        onChange={(v) => engine.setValue(..)}│
│        errors={engine.state.errors[f.name]}│
│        field={field}                     │
│      />                                  │
│    <submit-button                        │
│      onClick={() => engine.submit()}     │
│      disabled={engine.state.status==='submitting'}│
│    />                                    │
└─────────────────────────────────────────┘
```

---

## 4. Building a framework adapter

### 4.1 Vue adapter (conceptual)

```vue
<!-- @jsalchemy/forms-vue → JsForm.vue -->
<script setup>
const props = defineProps({ engine: Object })
const state = reactive(props.engine.state)

onMounted(() => {
  props.engine.subscribe((s) => {
    // Copy frozen state into reactive object
    Object.assign(state, s)
  })
})

const widgetMap = {
  StringField:         StringWidget,
  IntegerField:        NumberWidget,
  BooleanField:        BooleanWidget,
  // … register all widget components
}
</script>

<template>
  <form @submit.prevent="engine.submit()">
    <div v-for="field in state.fields" :key="field.name">
      <label>{{ field.label }}</label>
      <component
        :is="widgetMap[field.widget]"
        :field="field"
        :value="state.values[field.name]"
        :errors="state.errors[field.name]"
        @update:value="engine.setValue(field.name, $event)"
      />
      <p v-if="state.errors[field.name]" class="error">
        {{ state.errors[field.name].join(', ') }}
      </p>
    </div>
    <button type="submit" :disabled="state.status === 'submitting'">
      {{ state.status === 'submitting' ? 'Saving…' : 'Save' }}
    </button>
  </form>
</template>
```

### 4.2 React adapter (conceptual)

```tsx
// @jsalchemy/forms-react → useForm.ts + JsForm.tsx
function useForm(engine: FormEngine) {
  const [state, setState] = useState(engine.state)

  useEffect(() => {
    return engine.subscribe((s) => setState({ ...s }))
  }, [engine])

  return state
}

function JsForm({ engine }: { engine: FormEngine }) {
  const state = useForm(engine)

  return (
    <form onSubmit={(e) => { e.preventDefault(); engine.submit() }}>
      {state.fields.map((field) => {
        const Widget = widgetMap[field.widget]
        return (
          <div key={field.name}>
            <label>{field.label}</label>
            <Widget
              field={field}
              value={state.values[field.name]}
              onChange={(v) => engine.setValue(field.name, v)}
            />
            {state.errors[field.name]?.map((e) => (
              <p key={e} className="error">{e}</p>
            ))}
          </div>
        )
      })}
      <button type="submit" disabled={state.status === 'submitting'}>
        {state.status === 'submitting' ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
```

### 4.3 Angular adapter (conceptual)

```typescript
// @jsalchemy/forms-angular → FormEngineService + js-form.component.ts
@Injectable()
class FormEngineService {
  private engine: FormEngine
  state$ = new BehaviorSubject<FormState>(/* … */)

  init(config: FormConfig) {
    this.engine = new FormEngine(config)
    this.engine.subscribe((s) => this.state$.next(s))
  }

  setValue(name: string, value: any) { this.engine.setValue(name, value) }
  submit() { return this.engine.submit() }
}
```

---

## 5. Theme layer (CSS)

A framework adapter ships with **no CSS** by default. Theme packages apply
styling by providing **wrapped versions** of the adapter's widget components.

```
@jsalchemy/forms-vue
├── src/
│   ├── JsForm.vue
│   ├── widgets/
│   │   ├── StringField.vue     ← unstyled, just HTML + props
│   │   ├── IntegerField.vue
│   │   └── …
│   └── index.ts

@jsalchemy/forms-vue-tailwind
├── src/
│   ├── widgets/
│   │   ├── StringField.vue     ← wraps core widget + Tailwind classes
│   │   └── …
│   └── index.ts                ← re-registers the widget map
```

This separation means:

- Core adapter = logic only (minimal visual)
- Theme packages = visual only (depends on adapter)
- A developer can write their own theme without touching the adapter

---

## 6. Widget naming conventions

Every adapter must map these widget names. Unknown names fall back to
`StringField` or a configurable fallback widget.

| Widget name | Semantic meaning | Expected UI |
|---|---|---|
| `StringField` | Single-line text | `<input type="text">` |
| `RichTextField` | Multi-line / formatted text | `<textarea>` / editor |
| `CharField` | Short text (alias) | `<input type="text">` |
| `IntegerField` | Whole numbers | `<input type="number">` (step=1) |
| `FloatField` | Decimal numbers | `<input type="number">` (step=any) |
| `BooleanField` | True/false/null | checkbox / toggle |
| `DateField` | Calendar date | date picker |
| `DateTimeField` | Date + time | datetime picker |
| `TimeField` | Time only | time picker |
| `IntervalField` | Time interval | custom interval input |
| `ChoiceField` | Enum / fixed choices | `<select>` / radio group |
| `ReferenceField` | FK to another model | `<select>` with search |
| `MultiReferenceField` | Many-to-many | tag picker / multi-select |
| `ReferenceSetField` | One-to-many inline list | inline sub-form list |
| `ObjectField` | JSON / nested object | JSON editor / sub-form |
| `ArrayField` | Array of values | list input |

---

## 7. Publishing

### Recommended NPM package structure

```
@jsalchemy/forms-core
├── package.json
│   {
│     "name": "@jsalchemy/forms-core",
│     "type": "module",
│     "main": "./dist/index.js",
│     "types": "./dist/index.d.ts",
│     "files": ["dist/"]
│   }
├── tsconfig.json
└── src/
    └── index.ts           ← re-exports from ts/forms/index.ts
```

### Naming

| Package | Content |
|---|---|
| `@jsalchemy/forms-core` | This core library |
| `@jsalchemy/forms-vue` | Vue 3 adapter |
| `@jsalchemy/forms-react` | React adapter |
| `@jsalchemy/forms-angular` | Angular adapter |
| `@jsalchemy/forms-vue-tailwind` | Vue + Tailwind theme |
| `@jsalchemy/forms-vue-bootstrap` | Vue + Bootstrap theme |
| `@jsalchemy/forms-react-tailwind` | React + Tailwind theme |
| *(community)* | Any other combination |