import { lex } from './lexer.js';
import { parse } from './parser.js';
import { check } from './checker.js';
import { runProgram, GenbyRuntimeError } from './interpreter.js';
import type { EnumDef, LangConfig } from './config.js';
import { BUILTIN_TYPE_NAMES, isBuiltinType } from './config.js';
import { createInputDom, type GenbyInput } from './input-dom/index.js';
import { generateMarkdownDocs, type DocsOptions } from './docs.js';
import type {
  ArgSpec,
  CheckResult,
  DirectiveSpec,
  EnumValueSpec,
  FunctionSpec,
  GenbyError,
  TypeDef,
  TypeOptions,
  Value,
  VariableSpec,
} from './types.js';

export interface AddEnumOptions {
  describe?: string;
}

export type AddTypeOptions = TypeOptions;

export type EnumValueInput = string | EnumValueSpec;

export class Genby {
  private readonly directives = new Map<string, DirectiveSpec>();
  private readonly functions = new Map<string, FunctionSpec>();
  private readonly variables = new Map<string, VariableSpec>();
  private readonly enums = new Map<string, EnumDef>();
  private readonly types = new Map<string, TypeDef>();
  private readonly enumValueIndex = new Map<string, string>();

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

  addEnum(
    enumKey: string,
    values: EnumValueInput[],
    options: AddEnumOptions = {},
  ): this {
    if (this.enums.has(enumKey)) {
      throw new Error(`Enum '${enumKey}' is already registered`);
    }
    if (values.length === 0) {
      throw new Error(`Enum '${enumKey}' must have at least one value`);
    }
    const normalized: EnumValueSpec[] = [];
    for (const entry of values) {
      const spec: EnumValueSpec =
        typeof entry === 'string' ? { name: entry } : { ...entry };
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(spec.name)) {
        throw new Error(
          `Enum '${enumKey}' value '${spec.name}' is not a valid identifier`,
        );
      }
      if (this.enumValueIndex.has(spec.name)) {
        throw new Error(`Enum value '${spec.name}' is already registered`);
      }
      this.enumValueIndex.set(spec.name, enumKey);
      normalized.push(spec);
    }
    const def: EnumDef = { key: enumKey, values: normalized };
    if (options.describe !== undefined) def.describe = options.describe;
    this.enums.set(enumKey, def);
    return this;
  }

  /**
   * Register a custom type. The name becomes usable in `ArgSpec.type`,
   * `VariableSpec.type`, and `FunctionSpec.returns`. Built-in names
   * (`STR`, `NUM`, `BUL`, `ENUM`, `ANY`, `VOID`) are reserved.
   */
  addType(name: string, options: AddTypeOptions = {}): this {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid type name '${name}'`);
    }
    if (name === 'VOID') {
      throw new Error(`'VOID' is reserved as a return-only type`);
    }
    if (isBuiltinType(name)) {
      throw new Error(`Type '${name}' is a built-in and cannot be redefined`);
    }
    if (this.types.has(name)) {
      throw new Error(`Type '${name}' is already registered`);
    }
    const def: TypeDef = { name };
    if (options.describe !== undefined) def.describe = options.describe;
    if (options.stringify !== undefined) def.stringify = options.stringify;
    this.types.set(name, def);
    return this;
  }

  build(): LangMachine {
    this.validateAllTypeReferences();
    const config: LangConfig = {
      directives: new Map(this.directives),
      functions: new Map(this.functions),
      variables: new Map(this.variables),
      enums: new Map(this.enums),
      types: new Map(this.types),
      enumValueIndex: new Map(this.enumValueIndex),
    };
    return new LangMachine(config);
  }

  private validateAllTypeReferences(): void {
    const check = (
      type: string,
      context: string,
    ): void => {
      if (type === 'VOID') return;
      if (isBuiltinType(type)) return;
      if (this.types.has(type)) return;
      throw new Error(
        `${context} references unknown type '${type}'. ` +
          `Register it first via genby.addType('${type}', ...) or use one of: ` +
          `${[...BUILTIN_TYPE_NAMES].join(', ')}.`,
      );
    };
    const checkArg = (arg: ArgSpec, context: string): void => {
      check(arg.type, `${context} arg '${arg.name}'`);
      if (arg.type === 'ENUM') {
        if (!arg.enumKey) {
          throw new Error(`${context} arg '${arg.name}' is ENUM but no enumKey was provided`);
        }
        if (!this.enums.has(arg.enumKey)) {
          throw new Error(
            `${context} arg '${arg.name}' references unknown enum '${arg.enumKey}'`,
          );
        }
      }
    };
    for (const fn of this.functions.values()) {
      for (const a of fn.args) checkArg(a, `Function '${fn.name}'`);
      check(fn.returns, `Function '${fn.name}' return`);
      if (fn.returns === 'ENUM' && fn.returnsEnumKey && !this.enums.has(fn.returnsEnumKey)) {
        throw new Error(
          `Function '${fn.name}' returns ENUM<${fn.returnsEnumKey}> but that enum is not registered`,
        );
      }
    }
    for (const dir of this.directives.values()) {
      for (const a of dir.args) checkArg(a, `Directive '@${dir.name}'`);
    }
    for (const v of this.variables.values()) {
      check(v.type, `Variable '${v.name}'`);
      if (v.type === 'ENUM' && v.enumKey && !this.enums.has(v.enumKey)) {
        throw new Error(
          `Variable '${v.name}' references unknown enum '${v.enumKey}'`,
        );
      }
    }
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
      return await runProgram(ast, this.config, inputs, {
        interpTypes: checkResult.interpTypes,
      });
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

  /** Generate a single-page Markdown reference for this language config. */
  docs(options: DocsOptions = {}): string {
    return generateMarkdownDocs(this, options);
  }

  /** Internal: re-run static analysis and return flat error list. */
  collectStaticErrors(program: string): GenbyError[] {
    const { tokens, errors: lexErrs } = lex(program);
    const { program: ast, errors: parseErrs } = parse(tokens);
    const { errors: checkErrs } = check(ast, this.config);
    return [...lexErrs, ...parseErrs, ...checkErrs];
  }
}
