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
import type { EnumValue, GenbyError, HandlerArg, Value } from './types.js';
import { isEnumValue, makeEnumValue } from './types.js';
import { RETURN, type LangConfig } from './config.js';

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
    const args = dir.args.map((a) => evalConst(a, config, dir.span));
    try {
      await spec.handler(args);
    } catch (err) {
      throw new GenbyRuntimeError(
        `Directive '@${dir.name}' failed: ${errMessage(err)}`,
        dir.span,
      );
    }
  }
}

export async function runProgram(
  program: Program,
  config: LangConfig,
  inputs: Record<string, Value>,
): Promise<Value> {
  await runDirectives(program, config);

  const env = new Map<string, Value>();
  // Seed external variable values.
  for (const [name, spec] of config.variables) {
    if (name in inputs) {
      env.set(name, inputs[name]!);
    } else {
      // Missing input — leave undefined; will be caught when referenced.
    }
  }

  // Hoist user function defs (available to all top-level statements from the start).
  const userFunctions = new Map<string, UserFunDefStatement>();
  for (const stmt of program.statements) {
    if (stmt.kind === 'UserFunDef') userFunctions.set(stmt.name, stmt);
  }

  for (const stmt of program.statements) {
    if (stmt.kind === 'Assign') {
      const v = await evalExpr(stmt.value, config, env, inputs, userFunctions);
      env.set(stmt.name, v);
    } else if (stmt.kind === 'ExprStmt') {
      await evalExpr(stmt.expr, config, env, inputs, userFunctions);
    }
    // UserFunDef: nothing to execute — already hoisted.
  }

  if (!program.returnStmt) {
    throw new GenbyRuntimeError(`Missing RETURN(...)`, program.span, 'missing_return');
  }
  return evalExpr(
    program.returnStmt.expr,
    config,
    env,
    inputs,
    userFunctions,
  );
}

type UserFnMap = Map<string, UserFunDefStatement>;

async function evalExpr(
  expr: Expression,
  config: LangConfig,
  env: Map<string, Value>,
  inputs: Record<string, Value>,
  userFns: UserFnMap,
): Promise<Value> {
  switch (expr.kind) {
    case 'NumberLit':
      return expr.value;
    case 'StringLit':
      return evalString(expr, config, env, inputs, userFns);
    case 'Ident':
      return evalIdent(expr.name, expr.span, config, env, inputs);
    case 'Unary':
      return evalUnary(expr, config, env, inputs, userFns);
    case 'Binary':
      return evalBinary(expr, config, env, inputs, userFns);
    case 'Call':
      return evalCall(expr, config, env, inputs, userFns);
    case 'Block':
      return evalBlock(expr, config, env, inputs, userFns);
  }
}

async function evalBlock(
  block: BlockExpr,
  config: LangConfig,
  env: Map<string, Value>,
  inputs: Record<string, Value>,
  userFns: UserFnMap,
): Promise<Value> {
  let last: Value = undefined;
  for (const s of block.statements) {
    last = await execBlockStatement(s, config, env, inputs, userFns);
  }
  return last;
}

async function execBlockStatement(
  stmt: BlockStatement,
  config: LangConfig,
  env: Map<string, Value>,
  inputs: Record<string, Value>,
  userFns: UserFnMap,
): Promise<Value> {
  if (stmt.kind === 'Assign') {
    const v = await evalExpr(stmt.value, config, env, inputs, userFns);
    env.set(stmt.name, v);
    return undefined;
  }
  // ExprStmt
  return evalExpr(stmt.expr, config, env, inputs, userFns);
}

async function evalString(
  s: StringLiteral,
  config: LangConfig,
  env: Map<string, Value>,
  inputs: Record<string, Value>,
  userFns: UserFnMap,
): Promise<string> {
  const out: string[] = [];
  for (const part of s.parts) {
    if (part.kind === 'text') {
      out.push(part.value);
    } else {
      const v = await evalExpr(part.expr, config, env, inputs, userFns);
      out.push(stringify(v, part.span));
    }
  }
  return out.join('');
}

function evalIdent(
  name: string,
  span: SourceSpan,
  config: LangConfig,
  env: Map<string, Value>,
  inputs: Record<string, Value>,
): Value {
  if (env.has(name)) {
    const v = env.get(name);
    if (v === undefined) {
      throw new GenbyRuntimeError(
        `Variable '${name}' is used before being assigned`,
        span,
      );
    }
    return v;
  }
  if (config.variables.has(name)) {
    if (!(name in inputs)) {
      throw new GenbyRuntimeError(
        `Missing input value for variable '${name}'`,
        span,
      );
    }
    return inputs[name]!;
  }
  if (config.enumValueIndex.has(name)) {
    const enumKey = config.enumValueIndex.get(name)!;
    return makeEnumValue(enumKey, name);
  }
  throw new GenbyRuntimeError(`Unknown identifier '${name}'`, span);
}

async function evalUnary(
  expr: UnaryExpr,
  config: LangConfig,
  env: Map<string, Value>,
  inputs: Record<string, Value>,
  userFns: UserFnMap,
): Promise<Value> {
  const v = await evalExpr(expr.operand, config, env, inputs, userFns);
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
  config: LangConfig,
  env: Map<string, Value>,
  inputs: Record<string, Value>,
  userFns: UserFnMap,
): Promise<Value> {
  const l = await evalExpr(expr.left, config, env, inputs, userFns);
  const r = await evalExpr(expr.right, config, env, inputs, userFns);
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
  config: LangConfig,
  env: Map<string, Value>,
  inputs: Record<string, Value>,
  userFns: UserFnMap,
): Promise<Value> {
  const name = expr.callee;

  if (name === RETURN) {
    throw new GenbyRuntimeError(
      `RETURN can only be used as the last statement`,
      expr.span,
      'syntax',
    );
  }

  // User-defined function? Save/overlay params in the shared env; body runs
  // against the same environment so outer-variable mutations are visible.
  const userFn = userFns.get(name);
  if (userFn) {
    if (expr.args.length !== userFn.params.length) {
      throw new GenbyRuntimeError(
        `'${name}' expects ${userFn.params.length} argument(s), got ${expr.args.length}`,
        expr.calleeSpan,
        'type',
      );
    }
    // Eagerly evaluate caller args (user fns don't support laziness on params).
    const argValues: Value[] = [];
    for (const a of expr.args) {
      argValues.push(await evalExpr(a, config, env, inputs, userFns));
    }
    const saved: Array<[string, Value | undefined, boolean]> = [];
    for (let i = 0; i < userFn.params.length; i++) {
      const p = userFn.params[i]!;
      const had = env.has(p.name);
      saved.push([p.name, env.get(p.name), had]);
      env.set(p.name, argValues[i]!);
    }
    try {
      return await evalBlock(userFn.body, config, env, inputs, userFns);
    } finally {
      for (const [pname, prev, had] of saved) {
        if (had) env.set(pname, prev as Value);
        else env.delete(pname);
      }
    }
  }

  const spec = config.functions.get(name);
  if (!spec) {
    throw new GenbyRuntimeError(`Unknown function '${name}'`, expr.calleeSpan);
  }

  const argValues: HandlerArg[] = [];
  for (let i = 0; i < expr.args.length; i++) {
    const a = expr.args[i]!;
    const argSpec =
      i < spec.args.length
        ? spec.args[i]
        : spec.args.length > 0
          ? spec.args[spec.args.length - 1]
          : undefined;
    if (argSpec?.lazy) {
      const thunk = async () => evalExpr(a, config, env, inputs, userFns);
      argValues.push(thunk);
    } else {
      argValues.push(await evalExpr(a, config, env, inputs, userFns));
    }
  }

  try {
    return await spec.handler(argValues);
  } catch (err) {
    if (err instanceof GenbyRuntimeError) throw err;
    throw new GenbyRuntimeError(
      `Function '${name}' failed: ${errMessage(err)}`,
      expr.calleeSpan,
    );
  }
}

function valueEquals(a: Value, b: Value): boolean {
  if (isEnumValue(a) && isEnumValue(b)) {
    return a.enumKey === b.enumKey && a.name === b.name;
  }
  return a === b;
}

function stringify(v: Value, span: SourceSpan): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (isEnumValue(v)) return (v as EnumValue).name;
  throw new GenbyRuntimeError(
    `Cannot interpolate a VOID value`,
    span,
    'type',
  );
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
