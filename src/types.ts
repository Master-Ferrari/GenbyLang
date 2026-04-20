export const STR = 'STR' as const;
export const NUM = 'NUM' as const;
export const BUL = 'BUL' as const;
export const ENUM = 'ENUM' as const;
export const ANY = 'ANY' as const;

export type Type =
  | typeof STR
  | typeof NUM
  | typeof BUL
  | typeof ENUM
  | typeof ANY;

export type EnumValue = { readonly __enum: true; enumKey: string; name: string };

export type Value = string | number | boolean | EnumValue | void;

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

export function valueType(v: Value): Type | 'VOID' {
  if (v === undefined || v === null) return 'VOID';
  if (typeof v === 'string') return STR;
  if (typeof v === 'number') return NUM;
  if (typeof v === 'boolean') return BUL;
  if (isEnumValue(v)) return ENUM;
  return 'VOID';
}

/** True for the value part of HandlerArg (not a thunk). */
export function isThunk(v: HandlerArg): v is Thunk {
  return typeof v === 'function';
}
