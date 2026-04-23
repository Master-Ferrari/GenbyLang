export const STR = 'STR' as const;
export const NUM = 'NUM' as const;
export const BUL = 'BUL' as const;
export const ENUM = 'ENUM' as const;
export const ANY = 'ANY' as const;
export const VOID = 'VOID' as const;

/**
 * A type tag. Built-in tags are `STR`, `NUM`, `BUL`, `ENUM`, `ANY`; any other
 * string is treated as a user-registered type name (see `Genby.addType`).
 * Built-in names cannot be redefined by the library user.
 */
export type Type = string;

/** The 5 built-in type tags, exposed as a union for discrimination helpers. */
export type BuiltinType =
  | typeof STR
  | typeof NUM
  | typeof BUL
  | typeof ENUM
  | typeof ANY;

export type EnumValue = { readonly __enum: true; enumKey: string; name: string };

/**
 * A runtime value. Built-in types are `string`, `number`, `boolean`, `EnumValue`;
 * `void`/`undefined` represents VOID functions. Custom-typed values can be any
 * JS value (arrays, plain objects, `null`, class instances, …) — the language
 * treats them opaquely and only shuttles them through calls / assignments /
 * interpolation. Hence the loose `unknown`.
 */
export type Value = unknown;

/**
 * Static mapping from a type tag (string literal) to the TS value type a
 * handler sees after calling `arg.calc()`. Built-ins are declared here;
 * user-registered custom types extend this map via declaration merging:
 *
 * ```ts
 * declare module 'genby' {
 *   interface TypeValueMap { ARR: readonly unknown[] }
 * }
 * ```
 */
export interface TypeValueMap {
  STR: string;
  NUM: number;
  BUL: boolean;
  ENUM: EnumValue;
  ANY: Value;
  VOID: void;
}

/**
 * Lookup helper: maps a type tag string to its TS value type, falling back
 * to `Value` (unknown) when the tag isn't known to `TypeValueMap`. Custom
 * types default to `Value` until the user augments `TypeValueMap`.
 */
export type ValueOfType<T extends string> = T extends keyof TypeValueMap
  ? TypeValueMap[T]
  : Value;

/**
 * Runtime handle for a single positional argument of a function / directive
 * call. Every argument is a handle — the handler decides when (and whether)
 * to evaluate it by calling `calc()`.
 *
 * Semantics of `calc()`:
 *  - Evaluates the caller's expression in the caller's scope.
 *  - Is NOT memoized. Two calls = two evaluations (including side effects).
 *    If you need the value multiple times, cache it manually: `const v = await arg.calc()`.
 *  - Returns a `Promise<T>` matching the declared type tag (via `TypeValueMap`).
 */
export interface Arg<T = Value> {
  readonly name: string;
  readonly type: string;
  readonly enumKey?: string;
  calc(): Promise<T>;
}

export interface ArgSpec<T extends string = string> {
  name: string;
  type: T;
  enumKey?: string;
  optional?: boolean;
  rest?: boolean;
  describe?: string;
}

/**
 * Tuple of `Arg<T>` handles produced from a tuple of `ArgSpec` declarations.
 * Used as the handler's parameter type — preserves per-position typing so
 * `await args[i].calc()` gets the right TS type without casts.
 *
 * - plain arg  →  `Arg<T>`
 * - optional   →  `Arg<T> | undefined`
 * - rest       →  `Arg<T>[]`  (one slot, array of handles for all extras)
 */
export type HandlerArgs<DS extends readonly ArgSpec[]> = {
  [K in keyof DS]: DS[K] extends { rest: true }
    ? DS[K] extends ArgSpec<infer T>
      ? Arg<ValueOfType<T>>[]
      : never
    : DS[K] extends { optional: true }
      ? DS[K] extends ArgSpec<infer T>
        ? Arg<ValueOfType<T>> | undefined
        : never
      : DS[K] extends ArgSpec<infer T>
        ? Arg<ValueOfType<T>>
        : never;
};

export interface DirectiveSpec<DS extends readonly ArgSpec[] = readonly ArgSpec[]> {
  name: string;
  args: DS;
  required?: boolean;
  describe?: string;
  handler: (args: HandlerArgs<DS>) => void | Promise<void>;
}

export interface FunctionSpec<
  DS extends readonly ArgSpec[] = readonly ArgSpec[],
  R extends string = string,
> {
  name: string;
  args: DS;
  returns: R;
  returnsEnumKey?: string;
  describe?: string;
  handler: (args: HandlerArgs<DS>) => ValueOfType<R> | Promise<ValueOfType<R>>;
}

export interface VariableSpec<T extends string = string> {
  name: string;
  type: T;
  enumKey?: string;
  describe?: string;
}

export interface EnumValueSpec {
  name: string;
  describe?: string;
}

export interface EnumSpec {
  describe?: string;
  values: EnumValueSpec[];
}

/** User-registered type. Produced by `Genby.addType(name, options?)`. */
export interface TypeDef {
  name: string;
  describe?: string;
  /**
   * Converts a runtime value of this type to a string for interpolation.
   * Defaults to `String(value)` if omitted.
   */
  stringify?: (value: Value) => string;
}

export type TypeOptions = Omit<TypeDef, 'name'>;

export type ErrorKind =
  | 'syntax'
  | 'type'
  | 'unknown_identifier'
  | 'runtime'
  | 'reserved_name'
  | 'missing_return';

export interface GenbyError {
  line: number;
  column: number;
  length: number;
  message: string;
  kind: ErrorKind;
}

export interface CheckResult {
  ok: boolean;
  errors: GenbyError[];
}

export function makeEnumValue(enumKey: string, name: string): EnumValue {
  return { __enum: true, enumKey, name };
}

export function isEnumValue(v: unknown): v is EnumValue {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { __enum?: boolean }).__enum === true
  );
}

/**
 * Narrow a runtime value to one of the built-in type tags. Returns `null` for
 * anything that isn't a built-in (arrays, plain objects, `null`, …) — those are
 * custom-typed and can't be classified by their JS shape alone.
 */
export function valueType(v: Value): BuiltinType | 'VOID' | null {
  if (v === undefined) return 'VOID';
  if (typeof v === 'string') return STR;
  if (typeof v === 'number') return NUM;
  if (typeof v === 'boolean') return BUL;
  if (isEnumValue(v)) return ENUM;
  return null;
}
