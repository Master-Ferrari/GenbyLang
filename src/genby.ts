import { lex } from './lexer.js';
import { parse } from './parser.js';
import { check } from './checker.js';
import { runProgram, GenbyRuntimeError } from './interpreter.js';
import type { LangConfig } from './config.js';
import { createInputDom, type GenbyInput } from './input-dom/index.js';
import type {
  CheckResult,
  DirectiveSpec,
  FunctionSpec,
  GenbyError,
  Value,
  VariableSpec,
} from './types.js';

export interface GenbyOptions {
  /** Treat IF_THEN_ELSE as a built-in special form (default true). */
  builtinIfThenElse?: boolean;
}

export class Genby {
  private readonly directives = new Map<string, DirectiveSpec>();
  private readonly functions = new Map<string, FunctionSpec>();
  private readonly variables = new Map<string, VariableSpec>();
  private readonly enums = new Map<string, { key: string; values: string[] }>();
  private readonly enumValueIndex = new Map<string, string>();
  private readonly builtinIfThenElse: boolean;

  constructor(options: GenbyOptions = {}) {
    this.builtinIfThenElse = options.builtinIfThenElse ?? true;
  }

  addDirective(spec: DirectiveSpec): this {
    this.assertNameFree(spec.name, 'directive');
    this.directives.set(spec.name, spec);
    return this;
  }

  addFunction(spec: FunctionSpec): this {
    this.assertNameFree(spec.name, 'function');
    if (spec.returns === 'ENUM' && !spec.returnsEnumKey) {
      throw new Error(
        `Function '${spec.name}' returns ENUM but no returnsEnumKey was provided`,
      );
    }
    this.functions.set(spec.name, spec);
    return this;
  }

  addVariable(spec: VariableSpec): this {
    this.assertNameFree(spec.name, 'variable');
    if (spec.type === 'ENUM' && !spec.enumKey) {
      throw new Error(
        `Variable '${spec.name}' is ENUM but no enumKey was provided`,
      );
    }
    this.variables.set(spec.name, spec);
    return this;
  }

  addEnum(enumKey: string, values: string[]): this {
    if (this.enums.has(enumKey)) {
      throw new Error(`Enum '${enumKey}' is already registered`);
    }
    if (values.length === 0) {
      throw new Error(`Enum '${enumKey}' must have at least one value`);
    }
    for (const v of values) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v)) {
        throw new Error(
          `Enum '${enumKey}' value '${v}' is not a valid identifier`,
        );
      }
      if (this.enumValueIndex.has(v)) {
        throw new Error(`Enum value '${v}' is already registered`);
      }
      this.enumValueIndex.set(v, enumKey);
    }
    this.enums.set(enumKey, { key: enumKey, values: [...values] });
    return this;
  }

  build(): LangMachine {
    const config: LangConfig = {
      directives: new Map(this.directives),
      functions: new Map(this.functions),
      variables: new Map(this.variables),
      enums: new Map(this.enums),
      enumValueIndex: new Map(this.enumValueIndex),
      builtinIfThenElse: this.builtinIfThenElse,
    };
    return new LangMachine(config);
  }

  private assertNameFree(name: string, kind: string): void {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid ${kind} name '${name}'`);
    }
    if (
      this.directives.has(name) ||
      this.functions.has(name) ||
      this.variables.has(name) ||
      this.enumValueIndex.has(name)
    ) {
      throw new Error(`Name '${name}' is already registered`);
    }
    if (name === 'RETURN') {
      throw new Error(`'RETURN' is reserved`);
    }
    if (this.builtinIfThenElse && name === 'IF_THEN_ELSE') {
      throw new Error(`'IF_THEN_ELSE' is reserved as a built-in special form`);
    }
  }
}

export class LangMachine {
  constructor(readonly config: LangConfig) {}

  check(program: string): CheckResult {
    const errors = this.collectStaticErrors(program);
    return { ok: errors.length === 0, errors };
  }

  async execute(
    program: string,
    inputs: Record<string, Value> = {},
  ): Promise<Value> {
    const { tokens, errors: lexErrs } = lex(program);
    const { program: ast, errors: parseErrs } = parse(tokens);
    const checkResult = check(ast, this.config);
    const allErrors: GenbyError[] = [
      ...lexErrs,
      ...parseErrs,
      ...checkResult.errors,
    ];
    if (allErrors.length > 0) {
      const first = allErrors[0]!;
      throw Object.assign(
        new Error(`${first.message} (line ${first.line}, column ${first.column})`),
        { genbyErrors: allErrors },
      );
    }
    try {
      return await runProgram(ast, this.config, inputs);
    } catch (err) {
      if (err instanceof GenbyRuntimeError) {
        throw Object.assign(new Error(err.message), {
          genbyErrors: [err.toGenbyError()],
        });
      }
      throw err;
    }
  }

  inputDom(): GenbyInput {
    return createInputDom(this);
  }

  /** Internal: re-run static analysis and return flat error list. */
  collectStaticErrors(program: string): GenbyError[] {
    const { tokens, errors: lexErrs } = lex(program);
    const { program: ast, errors: parseErrs } = parse(tokens);
    const { errors: checkErrs } = check(ast, this.config);
    return [...lexErrs, ...parseErrs, ...checkErrs];
  }
}
