export const STR = 'STR' as const;
export const NUM = 'NUM' as const;
export const BUL = 'BUL' as const;
export const ENUM = 'ENUM' as const;
export const ANY = 'ANY' as const;

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

export interface ArgSpec {
  name: string;
  type: Type;
  enumKey?: string;
  optional?: boolean;
  rest?: boolean;
  /**
   * If true, the handler receives a zero-arg thunk `() => Promise<Value>` for
   * this slot instead of an evaluated value, and calling the thunk (re-)runs
   * the corresponding argument expression in the caller's environment.
   */
  lazy?: boolean;
  describe?: string;
}

export type Thunk = () => Promise<Value>;
export type HandlerArg = Value | Thunk;

export interface DirectiveSpec {
  name: string;
  args: ArgSpec[];
  required?: boolean;
  describe?: string;
  handler: (args: Value[]) => void | Promise<void>;
}

export interface FunctionSpec {
  name: string;
  args: ArgSpec[];
  returns: Type | 'VOID';
  returnsEnumKey?: string;
  describe?: string;
  handler: (args: HandlerArg[]) => Value | Promise<Value>;
}

export interface VariableSpec {
  name: string;
  type: Type;
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

/** True for the value part of HandlerArg (not a thunk). */
export function isThunk(v: HandlerArg): v is Thunk {
  return typeof v === 'function';
}
