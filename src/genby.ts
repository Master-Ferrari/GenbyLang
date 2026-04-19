import { lex } from './lexer.js';
import { parse } from './parser.js';
import { check } from './checker.js';
import { runProgram, GenbyRuntimeError } from './interpreter.js';
import type { EnumDef, LangConfig } from './config.js';
import { createInputDom, type GenbyInput } from './input-dom/index.js';
import { generateMarkdownDocs, type DocsOptions } from './docs.js';
import type {
  CheckResult,
  DirectiveSpec,
  EnumValueSpec,
  FunctionSpec,
  GenbyError,
  Value,
  VariableSpec,
} from './types.js';

export interface AddEnumOptions {
  describe?: string;
}

export type EnumValueInput = string | EnumValueSpec;

export class Genby {
  private readonly directives = new Map<string, DirectiveSpec>();
  private readonly functions = new Map<string, FunctionSpec>();
  private readonly variables = new Map<string, VariableSpec>();
  private readonly enums = new Map<string, EnumDef>();
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

  build(): LangMachine {
    const config: LangConfig = {
      directives: new Map(this.directives),
      functions: new Map(this.functions),
      variables: new Map(this.variables),
      enums: new Map(this.enums),
      enumValueIndex: new Map(this.enumValueIndex),
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
