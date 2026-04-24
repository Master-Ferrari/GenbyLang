## Overview

Genby is an embeddable scripting language shipped as a zero-dependency
TypeScript library. The typical use case is building strings — LLM prompts,
notification templates, shell fragments — from host-provided values and a
small, host-defined function vocabulary.

The library provides:

- A declarative language builder — register directives, functions,
  variables, enums, and custom types on a `Genby` instance.
- A single parser/checker/interpreter — the grammar is fixed; only the
  vocabulary changes between host configurations.
- A DOM input component with syntax highlighting, inline diagnostics,
  signature hints, and vocabulary-aware autocomplete.

The runtime is asynchronous: all calls are implicitly `await`ed, and every
argument is a lazy `Arg<T>` handle that the handler may evaluate zero, one,
or many times via `await arg.calc()`. There is no implicit memoisation.

## TypeScript API

### Builder

```ts
import { Genby, STR, NUM, BUL, ENUM, ANY } from 'genby';

const genby = new Genby();
genby.addDirective({ name, args, required?, handler, describe? });
genby.addEnum(enumKey, values);              // values: string[] | EnumValueSpec[]
genby.addVariable({ name, type, enumKey?, describe? });
genby.addFunction({ name, args, returns, handler, returnsEnumKey?, describe? });
genby.addType(name, { describe?, stringify? });
genby.addPreset(presetName);                 // see Presets below
genby.setReturnType(type, { enumKey? });     // optional: lock RETURN type

const machine = genby.build();
```

Every add method is chainable (returns the same `Genby` instance). Ordering
is free: validation that every referenced type / enum / variable name
actually exists runs inside `build()`.

`addType(name, options?)` registers a custom value type. Names must be
valid identifiers and must not collide with the built-in tags (`STR`,
`NUM`, `BUL`, `ENUM`, `ANY`, `VOID`). After registration the name is a
legal value for `ArgSpec.type`, `VariableSpec.type`, and
`FunctionSpec.returns`. Custom values are opaque to the language: they
appear only as function results and flow through assignments, calls, and
string interpolation (the optional `stringify` hook drives the latter).

`setReturnType(type, { enumKey? })` makes the program's final
`RETURN(expression)` part of the host contract. The checker rejects any
other type with `RETURN expects <T>, got <U>`; `ANY` on either side
disables the check. Setting `VOID` is not allowed (RETURN must always
produce a value). Calling `setReturnType` a second time on the same
builder throws. When a return type is set, the TypeScript return type of
`machine.execute(...)` narrows to `Promise<ValueOfType<T>>` via generics.

### Arg specs

```ts
interface ArgSpec {
    name: string;
    type: 'STR' | 'NUM' | 'BUL' | 'ENUM' | 'ANY' | CustomTypeName;
    enumKey?: string;         // required when type === 'ENUM'
    optional?: boolean;
    rest?: boolean;           // variadic; only valid on the last arg
    describe?: string;
}
```

Handlers receive a tuple of `Arg<T>` handles, one per declared position:

- plain arg → `Arg<T>`
- `optional: true` → `Arg<T> | undefined`
- `rest: true` → `Arg<T>[]` (single slot holding all tail values)

`Arg.calc()` returns a promise that re-evaluates the caller-side
expression (including its side effects) on every call. If you need the
value more than once, cache it: `const v = await arg.calc();`.

The tuple typing is type-safe via the `HandlerArgs<DS>` mapping. To make
`await arg.calc()` return your own TS type for a custom tag, augment
`TypeValueMap` via declaration merging:

```ts
declare module 'genby' {
    interface TypeValueMap {
        Verdict: { level: string; icon: string; message: string };
    }
}
```

### Presets

`addPreset(name)` registers one prebuilt function (plus any supporting
type or directive) under its canonical name. The full list of preset
names is exported as `PRESET_NAMES` (TS type `PresetName`):

| Group   | Presets                                                                                                                                 | Notes                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| control | `IF`, `WHEN`, `UNLESS`, `AND`, `OR`, `NOT`, `EQ`, `NEQ`, `COALESCE`, `CHOOSE`, `CASE`                                                   | —                                                                     |
| loops   | `FOR`, `TIMES`, `WHILE`                                                                                                                 | —                                                                     |
| arrays  | `ARR`, `RANGE`, `SIZE`, `AT`, `FIRST`, `LAST`, `SLICE`, `CONCAT`, `REVERSE`, `PUSH`, `CONTAINS`, `INDEX_OF`, `SPLIT`, `JOIN`             | any array preset auto-registers the `ARR` type if not already present |
| cast    | `STR`, `NUM`, `BUL`, `INT`                                                                                                              | —                                                                     |
| math    | `ADD`, `MUL`, `POW`, `SQRT`                                                                                                             | —                                                                     |
| strings | `UPPER`, `LOWER`, `REPEAT`, `REPLACE`, `LEN`                                                                                            | —                                                                     |
| async   | `FETCH_JSON`, `SHA256`, `SHORT`                                                                                                         | `FETCH_JSON` also registers the `@API_BASE` directive                 |

Nothing is enabled by default — Genby stays a minimal core and the host
opts into what it needs. Re-registering a name that already exists
(preset-vs-preset, preset-vs-`addFunction`, etc.) throws via the normal
`assertNameFree` mechanism, so presets can be mixed in any order as long
as the names are free.

### Runtime

```ts
machine.check(program: string): CheckResult;
machine.execute(program: string, inputs?: Record<string, Value>): Promise<Value>;
machine.docs(options?: { title?: string; intro?: string }): string;
machine.inputDom(): GenbyInput;
```

`execute` runs the program and returns the value produced by
`RETURN(...)`. `inputs` are values for the host-provided variables
registered via `addVariable`; extra keys are ignored, missing keys show
up as `undefined` inside the program (which the checker flags if the
variable is referenced).

`docs()` returns Markdown for the current configuration: functions, directives, variables, enums, and types, plus a **Syntax reference** section that uses the same rules as a standalone `## Syntax reference` in this document.

### DOM component

```ts
const input = machine.inputDom();
input.element;                                      // attach to the DOM yourself
input.getValue(): string;
input.setValue(text: string): void;
input.onChange(cb: (text: string) => void): Unsubscribe;
input.check(): CheckResult;
input.prettify(opts?: PrettifyOptions): void;
input.destroy(): void;
```

The component is a plain DOM element — no framework attachment. Features:

- syntax highlighting (strings, numbers, identifiers by category,
  operators, comments, directives);
- inline error underlines with a hover popup showing the error kind and
  message;
- a completion popup that is context-aware (enum arguments surface that
  enum's values first; identifiers inside strings are ignored, …);
- a signature hint for the current call, including the signature for
  `RETURN(...)` when `setReturnType` is configured.

## Types

Built-in tags: `STR`, `NUM`, `BUL`, `ENUM`, `ANY`. `VOID` is reserved for
function return types (a `VOID` function is a standalone action; its
result cannot be assigned or interpolated). `ANY` on either side of a
type check disables the check.

Custom types are registered via `addType(name, options?)`. Their runtime
representation is arbitrary JS — arrays, plain objects, `null`, class
instances — and the language treats them as opaque handles. Values of a
custom type appear in the program only as function return values; there
is no literal syntax for them. String interpolation uses the registered
`stringify` hook, falling back to `String(value)`.

## Errors

All errors are `{ line, column, length, message, kind }` objects.
`kind` is one of:

- `syntax`
- `type`
- `unknown_identifier`
- `runtime`
- `reserved_name`
- `missing_return`

Messages are English. How they are surfaced to the end user (inline
squiggles, a diagnostics panel, a console dump, …) is up to the host.

## Exports

```ts
export { Genby, LangMachine, GenbyInput, PRESET_NAMES };
export { STR, NUM, BUL, ENUM, ANY, makeEnumValue, isEnumValue };
export type {
    Value, EnumValue, Type, BuiltinType,
    ArgSpec, FunctionSpec, DirectiveSpec, VariableSpec,
    EnumValueSpec, EnumSpec, TypeDef, TypeOptions,
    CheckResult, GenbyError, ErrorKind,
    ReturnTypeSpec, SetReturnTypeOptions,
    Arg, HandlerArgs, TypeValueMap, ValueOfType, PresetName,
};
```
