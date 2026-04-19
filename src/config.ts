import type {
  ArgSpec,
  DirectiveSpec,
  EnumValueSpec,
  FunctionSpec,
  Type,
  VariableSpec,
} from './types.js';

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
  /** enumValueName -> enumKey. Used for identifier resolution and reserved-name checks. */
  enumValueIndex: Map<string, string>;
}

export const RETURN = 'RETURN';

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

export function describeArg(arg: ArgSpec): string {
  const base = arg.type === 'ENUM' ? `ENUM<${arg.enumKey ?? '?'}>` : arg.type;
  return arg.rest ? `${base}...` : arg.optional ? `${base}?` : base;
}
