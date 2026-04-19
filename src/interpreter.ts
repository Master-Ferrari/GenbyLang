import type {
  BinaryExpr,
  CallExpr,
  Expression,
  Program,
  SourceSpan,
  StringLiteral,
  UnaryExpr,
} from './ast.js';
import type { EnumValue, GenbyError, Value } from './types.js';
import { isEnumValue, makeEnumValue } from './types.js';
import { IF_THEN_ELSE, RETURN, type LangConfig } from './config.js';

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

  for (const stmt of program.statements) {
    if (stmt.kind === 'Assign') {
      const v = await evalExpr(stmt.value, config, env, inputs);
      env.set(stmt.name, v);
    } else if (stmt.kind === 'ExprStmt') {
      await evalExpr(stmt.expr, config, env, inputs);
    }
  }

  if (!program.returnStmt) {
    throw new GenbyRuntimeError(`Missing RETURN(...)`, program.span, 'missing_return');
  }
  return evalExpr(program.returnStmt.expr, config, env, inputs);
}

async function evalExpr(
  expr: Expression,
  config: LangConfig,
  env: Map<string, Value>,
  inputs: Record<string, Value>,
): Promise<Value> {
  switch (expr.kind) {
    case 'NumberLit':
      return expr.value;
    case 'StringLit':
      return evalString(expr, config, env, inputs);
    case 'Ident':
      return evalIdent(expr.name, expr.span, config, env, inputs);
    case 'Unary':
      return evalUnary(expr, config, env, inputs);
    case 'Binary':
      return evalBinary(expr, config, env, inputs);
    case 'Call':
      return evalCall(expr, config, env, inputs);
  }
}

async function evalString(
  s: StringLiteral,
  config: LangConfig,
  env: Map<string, Value>,
  inputs: Record<string, Value>,
): Promise<string> {
  const out: string[] = [];
  for (const part of s.parts) {
    if (part.kind === 'text') {
      out.push(part.value);
    } else {
      const v = await evalExpr(part.expr, config, env, inputs);
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
): Promise<Value> {
  const v = await evalExpr(expr.operand, config, env, inputs);
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
): Promise<Value> {
  const l = await evalExpr(expr.left, config, env, inputs);
  const r = await evalExpr(expr.right, config, env, inputs);
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
): Promise<Value> {
  const name = expr.callee;

  if (name === RETURN) {
    throw new GenbyRuntimeError(
      `RETURN can only be used as the last statement`,
      expr.span,
      'syntax',
    );
  }

  if (config.builtinIfThenElse && name === IF_THEN_ELSE) {
    if (expr.args.length !== 3) {
      throw new GenbyRuntimeError(
        `IF_THEN_ELSE expects 3 arguments`,
        expr.calleeSpan,
        'type',
      );
    }
    const cond = await evalExpr(expr.args[0]!, config, env, inputs);
    if (typeof cond !== 'boolean') {
      throw new GenbyRuntimeError(
        `IF_THEN_ELSE condition must be a boolean`,
        expr.args[0]!.span,
        'type',
      );
    }
    const branch = cond ? expr.args[1]! : expr.args[2]!;
    return evalExpr(branch, config, env, inputs);
  }

  const spec = config.functions.get(name);
  if (!spec) {
    throw new GenbyRuntimeError(`Unknown function '${name}'`, expr.calleeSpan);
  }

  const argValues: Value[] = [];
  for (const a of expr.args) {
    argValues.push(await evalExpr(a, config, env, inputs));
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
      throw new GenbyRuntimeError(
        `Directive arguments must be constants`,
        expr.span,
        'syntax',
      );
  }
}
