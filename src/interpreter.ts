import type {
  BinaryExpr,
  BlockExpr,
  BlockStatement,
  CallExpr,
  Expression,
  Program,
  SourceSpan,
  StringLiteral,
  UnaryExpr,
  UserFunDefStatement,
} from './ast.js';
import type { Arg, EnumValue, GenbyError, Value } from './types.js';
import { isEnumValue, makeEnumValue } from './types.js';
import { RETURN, type LangConfig } from './config.js';
import type { ResolvedType } from './checker.js';

export class GenbyRuntimeError extends Error {
  constructor(
    message: string,
    public readonly span: SourceSpan,
    public readonly kind: GenbyError['kind'] = 'runtime',
  ) {
    super(message);
  }

  toGenbyError(): GenbyError {
    return {
      line: this.span.line,
      column: this.span.column,
      length: Math.max(1, this.span.length),
      message: this.message,
      kind: this.kind,
    };
  }
}

/** Execute directives (side effects only). Throws on handler error. */
export async function runDirectives(
  program: Program,
  config: LangConfig,
): Promise<void> {
  for (const dir of program.directives) {
    const spec = config.directives.get(dir.name);
    if (!spec) continue;
    const handles = buildDirectiveArgs(dir.args, spec.args, config, dir.span);
    try {
      // spec.handler is typed against the declared arg tuple; at runtime we
      // pass the same-shape array with Arg<Value> handles. The handler only
      // reads through `.calc()`, which honours the declared TS types.
      await (
        spec.handler as (args: readonly unknown[]) => void | Promise<void>
      )(handles);
    } catch (err) {
      throw new GenbyRuntimeError(
        `Directive '@${dir.name}' failed: ${errMessage(err)}`,
        dir.span,
      );
    }
  }
}

export interface RunOptions {
  /**
   * Statically-inferred types of interpolated expressions (keyed by expr
   * span.start). When present, the interpreter uses the matching
   * `TypeDef.stringify` hook for custom-typed values.
   */
  interpTypes?: Map<number, ResolvedType>;
}

export async function runProgram(
  program: Program,
  config: LangConfig,
  inputs: Record<string, Value>,
  options: RunOptions = {},
): Promise<Value> {
  await runDirectives(program, config);

  const env = new Map<string, Value>();
  // Seed external variable values.
  for (const [name, _spec] of config.variables) {
    if (name in inputs) {
      env.set(name, inputs[name]!);
    }
  }

  // Hoist user function defs (available to all top-level statements from the start).
  const userFunctions = new Map<string, UserFunDefStatement>();
  for (const stmt of program.statements) {
    if (stmt.kind === 'UserFunDef') userFunctions.set(stmt.name, stmt);
  }

  const ctx: EvalContext = {
    config,
    inputs,
    userFns: userFunctions,
    interpTypes: options.interpTypes ?? new Map(),
  };

  for (const stmt of program.statements) {
    if (stmt.kind === 'Assign') {
      const v = await evalExpr(stmt.value, env, ctx);
      env.set(stmt.name, v);
    } else if (stmt.kind === 'ExprStmt') {
      await evalExpr(stmt.expr, env, ctx);
    }
    // UserFunDef: nothing to execute — already hoisted.
  }

  if (!program.returnStmt) {
    throw new GenbyRuntimeError(`Missing RETURN(...)`, program.span, 'missing_return');
  }
  return evalExpr(program.returnStmt.expr, env, ctx);
}

type UserFnMap = Map<string, UserFunDefStatement>;

interface EvalContext {
  config: LangConfig;
  inputs: Record<string, Value>;
  userFns: UserFnMap;
  interpTypes: Map<number, ResolvedType>;
}

/**
 * Sentinel for user-fn parameters bound as lazy thunks inside `env`. Reading
 * the parameter identifier calls the thunk, which re-evaluates the caller's
 * argument expression in the caller's scope. Every read re-runs the thunk —
 * side effects duplicate per read (documented feature). Assigning to the
 * parameter name overwrites the binding with a concrete value, shadowing
 * the thunk for the rest of the body.
 */
const PARAM_THUNK = Symbol.for('genby.paramThunk');

interface ParamThunk {
  readonly [PARAM_THUNK]: true;
  run(): Promise<Value>;
}

function makeParamThunk(run: () => Promise<Value>): ParamThunk {
  return { [PARAM_THUNK]: true, run };
}

function isParamThunk(v: unknown): v is ParamThunk {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { [PARAM_THUNK]?: true })[PARAM_THUNK] === true
  );
}

async function evalExpr(
  expr: Expression,
  env: Map<string, Value>,
  ctx: EvalContext,
): Promise<Value> {
  switch (expr.kind) {
    case 'NumberLit':
      return expr.value;
    case 'StringLit':
      return evalString(expr, env, ctx);
    case 'Ident':
      return evalIdent(expr.name, expr.span, env, ctx);
    case 'Unary':
      return evalUnary(expr, env, ctx);
    case 'Binary':
      return evalBinary(expr, env, ctx);
    case 'Call':
      return evalCall(expr, env, ctx);
    case 'Block':
      return evalBlock(expr, env, ctx);
  }
}

async function evalBlock(
  block: BlockExpr,
  env: Map<string, Value>,
  ctx: EvalContext,
): Promise<Value> {
  let last: Value = undefined;
  for (const s of block.statements) {
    last = await execBlockStatement(s, env, ctx);
  }
  return last;
}

async function execBlockStatement(
  stmt: BlockStatement,
  env: Map<string, Value>,
  ctx: EvalContext,
): Promise<Value> {
  if (stmt.kind === 'Assign') {
    const v = await evalExpr(stmt.value, env, ctx);
    env.set(stmt.name, v);
    return undefined;
  }
  return evalExpr(stmt.expr, env, ctx);
}

async function evalString(
  s: StringLiteral,
  env: Map<string, Value>,
  ctx: EvalContext,
): Promise<string> {
  const out: string[] = [];
  for (const part of s.parts) {
    if (part.kind === 'text') {
      out.push(part.value);
    } else {
      const v = await evalExpr(part.expr, env, ctx);
      const declared = ctx.interpTypes.get(part.expr.span.start);
      out.push(stringify(v, part.span, ctx.config, declared));
    }
  }
  return out.join('');
}

async function evalIdent(
  name: string,
  span: SourceSpan,
  env: Map<string, Value>,
  ctx: EvalContext,
): Promise<Value> {
  if (env.has(name)) {
    const raw = env.get(name);
    if (isParamThunk(raw)) return raw.run();
    if (raw === undefined) {
      throw new GenbyRuntimeError(
        `Variable '${name}' is used before being assigned`,
        span,
      );
    }
    return raw;
  }
  if (ctx.config.variables.has(name)) {
    if (!(name in ctx.inputs)) {
      throw new GenbyRuntimeError(
        `Missing input value for variable '${name}'`,
        span,
      );
    }
    return ctx.inputs[name]!;
  }
  if (ctx.config.enumValueIndex.has(name)) {
    const enumKey = ctx.config.enumValueIndex.get(name)!;
    return makeEnumValue(enumKey, name);
  }
  throw new GenbyRuntimeError(`Unknown identifier '${name}'`, span);
}

async function evalUnary(
  expr: UnaryExpr,
  env: Map<string, Value>,
  ctx: EvalContext,
): Promise<Value> {
  const v = await evalExpr(expr.operand, env, ctx);
  if (expr.op === '-') {
    if (typeof v !== 'number') {
      throw new GenbyRuntimeError(
        `Unary '-' requires a number`,
        expr.opSpan,
        'type',
      );
    }
    return -v;
  }
  throw new GenbyRuntimeError(`Unknown unary operator`, expr.opSpan);
}

async function evalBinary(
  expr: BinaryExpr,
  env: Map<string, Value>,
  ctx: EvalContext,
): Promise<Value> {
  const l = await evalExpr(expr.left, env, ctx);
  const r = await evalExpr(expr.right, env, ctx);
  switch (expr.op) {
    case '+': {
      if (typeof l === 'string' && typeof r === 'string') return l + r;
      if (typeof l === 'number' && typeof r === 'number') return l + r;
      throw new GenbyRuntimeError(
        `'+' requires STR+STR or NUM+NUM`,
        expr.opSpan,
        'type',
      );
    }
    case '-':
    case '*':
    case '/': {
      if (typeof l !== 'number' || typeof r !== 'number') {
        throw new GenbyRuntimeError(
          `'${expr.op}' requires numbers`,
          expr.opSpan,
          'type',
        );
      }
      if (expr.op === '-') return l - r;
      if (expr.op === '*') return l * r;
      if (r === 0) {
        throw new GenbyRuntimeError(`Division by zero`, expr.opSpan);
      }
      return l / r;
    }
    case '==':
      return valueEquals(l, r);
    case '!=':
      return !valueEquals(l, r);
    case '<':
    case '>':
    case '<=':
    case '>=': {
      if (typeof l !== 'number' || typeof r !== 'number') {
        throw new GenbyRuntimeError(
          `'${expr.op}' requires numbers`,
          expr.opSpan,
          'type',
        );
      }
      if (expr.op === '<') return l < r;
      if (expr.op === '>') return l > r;
      if (expr.op === '<=') return l <= r;
      return l >= r;
    }
  }
}

async function evalCall(
  expr: CallExpr,
  env: Map<string, Value>,
  ctx: EvalContext,
): Promise<Value> {
  const name = expr.callee;

  if (name === RETURN) {
    throw new GenbyRuntimeError(
      `RETURN can only be used as the last statement`,
      expr.span,
      'syntax',
    );
  }

  // User-defined function: install each param as a lazy thunk binding in
  // the shared env. Every read in the body re-evaluates the caller's arg
  // expression; side effects duplicate by design. Assigning to the param
  // name replaces the thunk with a concrete value for the rest of the body.
  const userFn = ctx.userFns.get(name);
  if (userFn) {
    if (expr.args.length !== userFn.params.length) {
      throw new GenbyRuntimeError(
        `'${name}' expects ${userFn.params.length} argument(s), got ${expr.args.length}`,
        expr.calleeSpan,
        'type',
      );
    }
    // Snapshot the caller's scope so each param thunk resolves its own free
    // variables against the call-site state, even after the body mutates
    // bindings with the same names.
    const callerSnapshot = new Map(env);
    const saved: Array<{ name: string; prev: Value | undefined; had: boolean }> = [];
    for (let i = 0; i < userFn.params.length; i++) {
      const p = userFn.params[i]!;
      const argExpr = expr.args[i]!;
      saved.push({ name: p.name, prev: env.get(p.name), had: env.has(p.name) });
      env.set(
        p.name,
        makeParamThunk(() => evalExpr(argExpr, callerSnapshot, ctx)),
      );
    }
    try {
      return await evalBlock(userFn.body, env, ctx);
    } finally {
      for (const s of saved) {
        if (s.had) env.set(s.name, s.prev as Value);
        else env.delete(s.name);
      }
    }
  }

  const spec = ctx.config.functions.get(name);
  if (!spec) {
    throw new GenbyRuntimeError(`Unknown function '${name}'`, expr.calleeSpan);
  }

  const handlerArgs = buildCallArgs(expr.args, spec.args, env, ctx);

  try {
    return await (
      spec.handler as (args: readonly unknown[]) => Value | Promise<Value>
    )(handlerArgs);
  } catch (err) {
    if (err instanceof GenbyRuntimeError) throw err;
    throw new GenbyRuntimeError(
      `Function '${name}' failed: ${errMessage(err)}`,
      expr.calleeSpan,
    );
  }
}

/**
 * Build the handler-arg tuple for a function call. Each declared arg maps to
 * one slot:
 *  - plain      →  a single `Arg<T>` handle
 *  - optional   →  `Arg<T>` if caller provided the expression, else `undefined`
 *  - rest       →  array of `Arg<T>` handles, one per extra positional arg
 *
 * Arity is validated by the checker; this builder is forgiving at runtime so
 * a runtime error can surface through a clearer message if it slips through.
 */
function buildCallArgs(
  callerArgs: Expression[],
  specs: readonly { name: string; type: string; enumKey?: string; optional?: boolean; rest?: boolean }[],
  env: Map<string, Value>,
  ctx: EvalContext,
): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    if (spec.rest) {
      const rest: Arg[] = [];
      for (let j = i; j < callerArgs.length; j++) {
        rest.push(makeCallArg(spec, callerArgs[j]!, env, ctx));
      }
      out.push(rest);
      return out;
    }
    const callerExpr = callerArgs[i];
    if (callerExpr === undefined) {
      if (spec.optional) {
        out.push(undefined);
        continue;
      }
      // Unreachable under the current checker but we keep the branch for
      // safety: handlers will see `undefined` and can no-op accordingly.
      out.push(undefined);
      continue;
    }
    out.push(makeCallArg(spec, callerExpr, env, ctx));
  }
  return out;
}

function makeCallArg(
  spec: { name: string; type: string; enumKey?: string },
  expr: Expression,
  env: Map<string, Value>,
  ctx: EvalContext,
): Arg {
  const handle: Arg = {
    name: spec.name,
    type: spec.type,
    calc: () => evalExpr(expr, env, ctx),
  };
  if (spec.enumKey !== undefined) {
    (handle as { enumKey?: string }).enumKey = spec.enumKey;
  }
  return handle;
}

function buildDirectiveArgs(
  callerArgs: Expression[],
  specs: readonly { name: string; type: string; enumKey?: string; optional?: boolean; rest?: boolean }[],
  config: LangConfig,
  fallbackSpan: SourceSpan,
): unknown[] {
  // Directives require constant expressions (enforced by the checker), so
  // there is no caller env to thread through. We evaluate constants once up
  // front and wrap each in an `Arg` whose `calc()` returns the stored value,
  // keeping parity with the function-handler API.
  const out: unknown[] = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    if (spec.rest) {
      const rest: Arg[] = [];
      for (let j = i; j < callerArgs.length; j++) {
        const value = evalConst(callerArgs[j]!, config, fallbackSpan);
        rest.push(wrapConstArg(spec, value));
      }
      out.push(rest);
      return out;
    }
    const expr = callerArgs[i];
    if (expr === undefined) {
      if (spec.optional) {
        out.push(undefined);
        continue;
      }
      out.push(undefined);
      continue;
    }
    const value = evalConst(expr, config, fallbackSpan);
    out.push(wrapConstArg(spec, value));
  }
  return out;
}

function wrapConstArg(
  spec: { name: string; type: string; enumKey?: string },
  value: Value,
): Arg {
  const handle: Arg = {
    name: spec.name,
    type: spec.type,
    calc: async () => value,
  };
  if (spec.enumKey !== undefined) {
    (handle as { enumKey?: string }).enumKey = spec.enumKey;
  }
  return handle;
}

function valueEquals(a: Value, b: Value): boolean {
  if (isEnumValue(a) && isEnumValue(b)) {
    return a.enumKey === b.enumKey && a.name === b.name;
  }
  // For custom-typed values (arrays, objects, etc.) we use reference equality.
  // Deep equality is intentionally not built in — users can wrap values or
  // register coercion helpers if they need value-based comparison.
  return a === b;
}

function stringify(
  v: Value,
  span: SourceSpan,
  config: LangConfig,
  declared: ResolvedType | undefined,
): string {
  if (v === undefined) {
    throw new GenbyRuntimeError(
      `Cannot interpolate a VOID value`,
      span,
      'type',
    );
  }
  // Custom types first — their stringify hook wins over JS-type heuristics.
  if (declared && declared.kind === 'CUSTOM') {
    const def = config.types.get(declared.name);
    if (def?.stringify) return def.stringify(v);
    return String(v);
  }
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (isEnumValue(v)) return (v as EnumValue).name;
  // Unknown shape and no declared custom type — fall back to String().
  return String(v);
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Evaluate a constant expression for directive args (no env, no functions). */
function evalConst(
  expr: Expression,
  config: LangConfig,
  _fallbackSpan: SourceSpan,
): Value {
  switch (expr.kind) {
    case 'NumberLit':
      return expr.value;
    case 'StringLit': {
      const out: string[] = [];
      for (const part of expr.parts) {
        if (part.kind === 'text') out.push(part.value);
        else
          throw new GenbyRuntimeError(
            `Directive arguments cannot contain interpolation`,
            part.span,
            'syntax',
          );
      }
      return out.join('');
    }
    case 'Ident': {
      const ek = config.enumValueIndex.get(expr.name);
      if (ek) return makeEnumValue(ek, expr.name);
      throw new GenbyRuntimeError(
        `Directive argument '${expr.name}' is not a known enum value or constant`,
        expr.span,
        'unknown_identifier',
      );
    }
    case 'Unary': {
      const v = evalConst(expr.operand, config, _fallbackSpan);
      if (typeof v !== 'number') {
        throw new GenbyRuntimeError(
          `Unary '-' requires a number`,
          expr.opSpan,
          'type',
        );
      }
      return -v;
    }
    case 'Binary':
    case 'Call':
    case 'Block':
      throw new GenbyRuntimeError(
        `Directive arguments must be constants`,
        expr.span,
        'syntax',
      );
  }
}
