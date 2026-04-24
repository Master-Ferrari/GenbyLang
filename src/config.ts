import type {
  ArgSpec,
  DirectiveSpec,
  EnumValueSpec,
  FunctionSpec,
  Type,
  TypeDef,
  VariableSpec,
} from './types.js';
import { ANY, BUL, ENUM, NUM, STR } from './types.js';

export interface EnumDef {
  key: string;
  values: EnumValueSpec[];
  describe?: string;
}

/** Snapshot of the language configuration used by parser/checker/interpreter. */
export interface LangConfig {
  directives: Map<string, DirectiveSpec>;
  functions: Map<string, FunctionSpec>;
  variables: Map<string, VariableSpec>;
  enums: Map<string, EnumDef>;
  /** User-registered custom types (by name). Built-ins are not listed here. */
  types: Map<string, TypeDef>;
  /** enumValueName -> enumKey. Used for identifier resolution and reserved-name checks. */
  enumValueIndex: Map<string, string>;
  /**
   * Optional contract for the program's `RETURN(expression)`. When set, the
   * checker requires the inferred type of the return expression to match
   * `type` (with `enumKey` when `type === 'ENUM'`). `ANY` disables the check
   * on either side (expected or actual). Left `undefined` means any type is
   * accepted, preserving the default Genby 1.0 behaviour.
   */
  returnType?: ReturnTypeSpec;
}

/** Contract for the program's `RETURN` expression — see {@link LangConfig.returnType}. */
export interface ReturnTypeSpec {
  type: Type;
  enumKey?: string;
}

export const RETURN = 'RETURN';

export const BUILTIN_TYPE_NAMES = new Set<string>([STR, NUM, BUL, ENUM, ANY]);

export function isBuiltinType(name: string): boolean {
  return BUILTIN_TYPE_NAMES.has(name);
}

export type IdentResolution =
  | { kind: 'local'; type: Type; enumKey?: string }
  | { kind: 'external'; type: Type; enumKey?: string }
  | { kind: 'enumValue'; enumKey: string; name: string }
  | { kind: 'function'; spec: FunctionSpec }
  | { kind: 'directive'; spec: DirectiveSpec }
  | { kind: 'unknown' };

export function isReservedName(config: LangConfig, name: string): boolean {
  if (name === RETURN) return true;
  if (config.functions.has(name)) return true;
  if (config.directives.has(name)) return true;
  if (config.variables.has(name)) return true;
  if (config.enumValueIndex.has(name)) return true;
  return false;
}

/** Human-readable rendering of an arg's type, including rest/optional decorations. */
export function describeArg(arg: ArgSpec): string {
  const base = formatArgType(arg.type, arg.enumKey);
  return arg.rest ? `${base}...` : arg.optional ? `${base}?` : base;
}

function formatArgType(type: Type, enumKey?: string): string {
  if (type === ENUM) return `ENUM<${enumKey ?? '?'}>`;
  return type;
}
