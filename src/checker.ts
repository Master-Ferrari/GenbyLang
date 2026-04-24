import type {
  BinaryExpr,
  BlockExpr,
  CallExpr,
  Expression,
  Program,
  SourceSpan,
  Statement,
  StringLiteral,
  UnaryExpr,
  UserFunDefStatement,
} from './ast.js';
import type { ArgSpec, GenbyError, Type } from './types.js';
import { STR, NUM, BUL, ENUM, ANY } from './types.js';
import {
  RETURN,
  describeArg,
  isBuiltinType,
  isReservedName,
  type LangConfig,
} from './config.js';

/** Lightweight resolved-type descriptor used during checking / interpretation. */
export type ResolvedType =
  | { kind: typeof STR }
  | { kind: typeof NUM }
  | { kind: typeof BUL }
  | { kind: typeof ENUM; enumKey: string }
  | { kind: typeof ANY } // wildcard for user-fn params / coercion results
  | { kind: 'CUSTOM'; name: string }
  | { kind: 'VOID' };

export interface CheckOutput {
  errors: GenbyError[];
  /** Inferred type of RETURN expression, if any. */
  returnType: ResolvedType | null;
  /** Type map for local variables (name -> type). */
  locals: Map<string, ResolvedType>;
  /** For each CallExpr, the checked arg count / resolution (used by interpreter). */
  callInfo: WeakMap<CallExpr, CallInfo>;
  /** For each Ident span (by span.start), resolution kind — used by highlighter. */
  identInfo: Map<number, IdentCategory>;
  /** User function definitions, collected from the program (hoisted). */
  userFunctions: Map<string, UserFunDefStatement>;
  /**
   * For each interpolated expression inside a string literal (keyed by its
   * expr span.start), the statically-inferred ResolvedType. Lets the
   * interpreter pick the right `TypeDef.stringify` hook for custom types.
   */
  interpTypes: Map<number, ResolvedType>;
}

export type IdentCategory =
  | 'local_var'
  | 'external_var'
  | 'enum_value'
  | 'function_name'
  | 'user_function'
  | 'directive_name'
  | 'unknown';

export interface CallInfo {
  kind: 'function' | 'user_function' | 'return' | 'unknown';
  /** When kind === 'function' | 'user_function'. */
  functionName?: string;
  /** Resolved expected types per argument position (after rest expansion). */
  expectedArgs?: ResolvedType[];
}

export function check(program: Program, config: LangConfig): CheckOutput {
  const checker = new Checker(config);
  checker.checkProgram(program);
  return {
    errors: checker.errors,
    returnType: checker.returnType,
    locals: checker.locals,
    callInfo: checker.callInfo,
    identInfo: checker.identInfo,
    userFunctions: checker.userFunctions,
    interpTypes: checker.interpTypes,
  };
}

class Checker {
  readonly errors: GenbyError[] = [];
  readonly locals = new Map<string, ResolvedType>();
  readonly callInfo = new WeakMap<CallExpr, CallInfo>();
  readonly identInfo = new Map<number, IdentCategory>();
  readonly userFunctions = new Map<string, UserFunDefStatement>();
  readonly interpTypes = new Map<number, ResolvedType>();
  returnType: ResolvedType | null = null;

  constructor(private readonly config: LangConfig) {}

  checkProgram(program: Program): void {
    // Directives
    for (const dir of program.directives) {
      const spec = this.config.directives.get(dir.name);
      if (!spec) {
        this.err(
          dir.nameSpan,
          `Unknown directive '${dir.name}'`,
          'unknown_identifier',
        );
        continue;
      }
      this.checkCallArgs(
        dir.args,
        spec.args,
        spec.name,
        dir.nameSpan,
        { constOnly: true },
      );
    }

    // Required directives present?
    for (const spec of this.config.directives.values()) {
      if (spec.required) {
        const found = program.directives.some((d) => d.name === spec.name);
        if (!found) {
          this.err(
            program.span,
            `Required directive '@${spec.name}' is missing`,
            'syntax',
          );
        }
      }
    }

    // Hoist user function defs so their names are resolvable anywhere in
    // the program (including in each other's bodies).
    for (const stmt of program.statements) {
      if (stmt.kind === 'UserFunDef') this.registerUserFunDef(stmt);
    }

    // Top-level statements first (populate `locals` with variable types).
    for (const stmt of program.statements) {
      if (stmt.kind === 'UserFunDef') continue; // handled below
      this.checkStatement(stmt);
    }

    // Then check user function bodies against the final `locals` snapshot.
    // This is intentionally optimistic — the checker doesn't track scope
    // growth line-by-line; calling a user fn before an outer variable is
    // assigned becomes a runtime "used before assigned" error.
    for (const fn of this.userFunctions.values()) {
      this.checkUserFunDefBody(fn);
    }

    // RETURN
    if (program.returnStmt === null) {
      this.err(
        program.span,
        `Missing RETURN(...) as the last statement`,
        'missing_return',
      );
    } else {
      this.returnType = this.inferExpr(program.returnStmt.expr);
      const expectedSpec = this.config.returnType;
      if (expectedSpec) {
        const expected = typeSpecToResolved(expectedSpec.type, expectedSpec.enumKey);
        if (!matchesExpected(expected, this.returnType)) {
          this.err(
            program.returnStmt.expr.span,
            `RETURN expects ${formatType(expected)}, got ${formatType(this.returnType)}`,
            'type',
          );
        }
      }
    }
  }

  private registerUserFunDef(stmt: UserFunDefStatement): void {
    const name = stmt.name;
    if (this.userFunctions.has(name)) {
      this.err(
        stmt.nameSpan,
        `User function '${name}' is already defined`,
        'reserved_name',
      );
      return;
    }
    if (isReservedName(this.config, name) || name === RETURN) {
      this.err(
        stmt.nameSpan,
        `Name '${name}' is reserved — pick a different function name`,
        'reserved_name',
      );
      return;
    }
    // Duplicate param names.
    const seen = new Set<string>();
    for (const p of stmt.params) {
      if (seen.has(p.name)) {
        this.err(
          p.span,
          `Duplicate parameter name '${p.name}'`,
          'syntax',
        );
      }
      seen.add(p.name);
    }
    this.userFunctions.set(name, stmt);
    this.identInfo.set(stmt.nameSpan.start, 'user_function');
  }

  private checkUserFunDefBody(fn: UserFunDefStatement): void {
    // Params shadow outer locals for the duration of body checking.
    const saved: Array<[string, ResolvedType | undefined]> = [];
    for (const p of fn.params) {
      saved.push([p.name, this.locals.get(p.name)]);
      this.locals.set(p.name, { kind: ANY });
      this.identInfo.set(p.span.start, 'local_var');
    }
    // Check each statement in the body block.
    for (const bs of fn.body.statements) {
      this.checkStatement(bs);
    }
    // Restore.
    for (const [name, prev] of saved) {
      if (prev === undefined) this.locals.delete(name);
      else this.locals.set(name, prev);
    }
  }

  private checkStatement(stmt: Statement): void {
    switch (stmt.kind) {
      case 'UserFunDef': {
        // Nested defs are caught at parse-time; this branch is reachable only
        // via the top-level pre-pass, which is already handled. No-op here.
        return;
      }
      case 'Assign': {
        if (
          isReservedName(this.config, stmt.name) ||
          this.userFunctions.has(stmt.name)
        ) {
          this.err(
            stmt.nameSpan,
            `Cannot assign to reserved name '${stmt.name}'`,
            'reserved_name',
          );
          // Still infer the RHS to catch other errors.
          this.inferExpr(stmt.value);
          return;
        }
        const rhsType = this.inferExpr(stmt.value);
        const existing = this.locals.get(stmt.name);
        if (existing) {
          if (!sameType(existing, rhsType) && rhsType.kind !== 'ANY') {
            this.err(
              stmt.nameSpan,
              `Cannot reassign '${stmt.name}' from ${formatType(existing)} to ${formatType(rhsType)}`,
              'type',
            );
          }
        } else {
          if (rhsType.kind !== 'ANY' && rhsType.kind !== 'VOID') {
            this.locals.set(stmt.name, rhsType);
          } else if (rhsType.kind === 'VOID') {
            this.err(
              stmt.nameSpan,
              `Cannot assign the result of a VOID expression`,
              'type',
            );
          }
        }
        return;
      }
      case 'ExprStmt': {
        const t = this.inferExpr(stmt.expr);
        // Allow calls, blocks (whose internals are already validated), and
        // anything typed ANY. Discard other pure expressions (`5`, `x`).
        if (
          stmt.expr.kind !== 'Call' &&
          stmt.expr.kind !== 'Block' &&
          t.kind !== 'ANY'
        ) {
          this.err(
            stmt.span,
            `Expression statement must be a function call`,
            'syntax',
          );
        }
        return;
      }
      case 'Return': {
        // RETURN handled in checkProgram. Shouldn't appear here.
        this.returnType = this.inferExpr(stmt.expr);
        return;
      }
    }
  }

  private inferExpr(expr: Expression): ResolvedType {
    switch (expr.kind) {
      case 'NumberLit':
        return { kind: NUM };
      case 'StringLit':
        return this.inferString(expr);
      case 'Ident':
        return this.inferIdent(expr.name, expr.span);
      case 'Unary':
        return this.inferUnary(expr);
      case 'Binary':
        return this.inferBinary(expr);
      case 'Call':
        return this.inferCall(expr);
      case 'Block':
        return this.inferBlock(expr);
    }
  }

  private inferBlock(block: BlockExpr): ResolvedType {
    let last: ResolvedType = { kind: 'VOID' };
    for (const s of block.statements) {
      if (s.kind === 'Assign') {
        this.checkStatement(s);
        last = { kind: 'VOID' };
      } else {
        // ExprStmt
        last = this.inferExpr(s.expr);
      }
    }
    return last;
  }

  private inferString(s: StringLiteral): ResolvedType {
    for (const part of s.parts) {
      if (part.kind === 'expr') {
        const t = this.inferExpr(part.expr);
        this.interpTypes.set(part.expr.span.start, t);
        if (t.kind === 'VOID') {
          this.err(
            part.span,
            `Cannot interpolate a VOID expression`,
            'type',
          );
        }
      }
    }
    return { kind: STR };
  }

  private inferIdent(name: string, span: SourceSpan): ResolvedType {
    // Local first
    const local = this.locals.get(name);
    if (local) {
      this.identInfo.set(span.start, 'local_var');
      return local;
    }
    const extVar = this.config.variables.get(name);
    if (extVar) {
      this.identInfo.set(span.start, 'external_var');
      return typeSpecToResolved(extVar.type, extVar.enumKey);
    }
    const enumKey = this.config.enumValueIndex.get(name);
    if (enumKey) {
      this.identInfo.set(span.start, 'enum_value');
      return { kind: ENUM, enumKey };
    }
    if (this.userFunctions.has(name)) {
      this.identInfo.set(span.start, 'user_function');
      this.err(
        span,
        `'${name}' is a function — add '(...)' to call it`,
        'syntax',
      );
      return { kind: ANY };
    }
    if (this.config.functions.has(name) || name === RETURN) {
      this.identInfo.set(span.start, 'function_name');
      this.err(
        span,
        `'${name}' is a function — add '(...)' to call it`,
        'syntax',
      );
      return { kind: ANY };
    }
    if (this.config.directives.has(name)) {
      this.identInfo.set(span.start, 'directive_name');
      this.err(
        span,
        `'${name}' is a directive — use '@${name}(...)' at the top of the program`,
        'syntax',
      );
      return { kind: ANY };
    }
    this.identInfo.set(span.start, 'unknown');
    this.err(span, `Unknown identifier '${name}'`, 'unknown_identifier');
    return { kind: ANY };
  }

  private inferUnary(expr: UnaryExpr): ResolvedType {
    const t = this.inferExpr(expr.operand);
    if (t.kind === 'ANY') return { kind: 'ANY' };
    if (t.kind !== NUM) {
      this.err(
        expr.opSpan,
        `Unary '-' requires NUM, got ${formatType(t)}`,
        'type',
      );
      return { kind: 'ANY' };
    }
    return { kind: NUM };
  }

  private inferBinary(expr: BinaryExpr): ResolvedType {
    const l = this.inferExpr(expr.left);
    const r = this.inferExpr(expr.right);
    if (l.kind === 'ANY' || r.kind === 'ANY') return { kind: 'ANY' };
    const op = expr.op;
    switch (op) {
      case '+': {
        if (l.kind === STR && r.kind === STR) return { kind: STR };
        if (l.kind === NUM && r.kind === NUM) return { kind: NUM };
        this.err(
          expr.opSpan,
          `Operator '+' requires STR+STR or NUM+NUM, got ${formatType(l)}+${formatType(r)}`,
          'type',
        );
        return { kind: 'ANY' };
      }
      case '-':
      case '*':
      case '/': {
        if (l.kind === NUM && r.kind === NUM) return { kind: NUM };
        this.err(
          expr.opSpan,
          `Operator '${op}' requires NUM${op}NUM, got ${formatType(l)}${op}${formatType(r)}`,
          'type',
        );
        return { kind: 'ANY' };
      }
      case '==':
      case '!=': {
        if (!sameType(l, r)) {
          this.err(
            expr.opSpan,
            `Operator '${op}' requires operands of the same type, got ${formatType(l)} and ${formatType(r)}`,
            'type',
          );
          return { kind: 'ANY' };
        }
        return { kind: BUL };
      }
      case '<':
      case '>':
      case '<=':
      case '>=': {
        if (l.kind === NUM && r.kind === NUM) return { kind: BUL };
        this.err(
          expr.opSpan,
          `Operator '${op}' requires NUM${op}NUM, got ${formatType(l)}${op}${formatType(r)}`,
          'type',
        );
        return { kind: 'ANY' };
      }
    }
  }

  private inferCall(expr: CallExpr): ResolvedType {
    const name = expr.callee;
    // RETURN handled by parser — if we see a call to RETURN here, it wasn't extracted (mid-expression).
    if (name === RETURN) {
      this.callInfo.set(expr, { kind: 'return' });
      this.err(
        expr.calleeSpan,
        `RETURN can only be used as the last statement`,
        'syntax',
      );
      return { kind: ANY };
    }

    // User-defined function?
    const userFn = this.userFunctions.get(name);
    if (userFn) {
      this.identInfo.set(expr.calleeSpan.start, 'user_function');
      if (expr.args.length !== userFn.params.length) {
        this.err(
          expr.calleeSpan,
          `'${name}' expects ${userFn.params.length} argument(s), got ${expr.args.length}`,
          'type',
        );
      }
      // Args evaluated in caller scope — infer types (for error surfacing)
      // but don't constrain (params are ANY).
      for (const a of expr.args) this.inferExpr(a);
      this.callInfo.set(expr, {
        kind: 'user_function',
        functionName: name,
        expectedArgs: expr.args.map(() => ({ kind: ANY })),
      });
      return { kind: ANY };
    }

    const spec = this.config.functions.get(name);
    if (!spec) {
      this.identInfo.set(expr.calleeSpan.start, 'unknown');
      this.err(
        expr.calleeSpan,
        `Unknown function '${name}'`,
        'unknown_identifier',
      );
      this.callInfo.set(expr, { kind: 'unknown' });
      for (const a of expr.args) this.inferExpr(a);
      return { kind: ANY };
    }
    this.identInfo.set(expr.calleeSpan.start, 'function_name');
    const expected = this.checkCallArgs(
      expr.args,
      spec.args,
      spec.name,
      expr.calleeSpan,
      { constOnly: false },
    );
    this.callInfo.set(expr, {
      kind: 'function',
      functionName: spec.name,
      expectedArgs: expected,
    });
    if (spec.returns === 'VOID') return { kind: 'VOID' };
    return typeSpecToResolved(spec.returns, spec.returnsEnumKey);
  }

  private checkCallArgs(
    args: Expression[],
    specs: readonly ArgSpec[],
    name: string,
    nameSpan: SourceSpan,
    opts: { constOnly: boolean },
  ): ResolvedType[] {
    const expected: ResolvedType[] = [];
    const hasRest = specs.length > 0 && specs[specs.length - 1]!.rest === true;
    const requiredCount = specs.filter((s) => !s.optional && !s.rest).length;
    const nonRestCount = specs.filter((s) => !s.rest).length;

    if (hasRest) {
      if (args.length < requiredCount) {
        this.err(
          nameSpan,
          `'${name}' expects at least ${requiredCount} argument(s), got ${args.length}`,
          'type',
        );
      }
    } else {
      if (args.length < requiredCount || args.length > nonRestCount) {
        this.err(
          nameSpan,
          `'${name}' expects ${requiredCount === nonRestCount ? requiredCount : `${requiredCount}..${nonRestCount}`} argument(s), got ${args.length}`,
          'type',
        );
      }
    }

    for (let i = 0; i < args.length; i++) {
      const argNode = args[i]!;
      let spec: ArgSpec | undefined;
      if (i < specs.length) spec = specs[i];
      else if (hasRest) spec = specs[specs.length - 1];
      if (opts.constOnly) {
        assertConstExpr(argNode, (span, message) =>
          this.err(span, message, 'syntax'),
        );
      }
      const actual = this.inferExpr(argNode);
      if (!spec) {
        expected.push({ kind: ANY });
        continue;
      }
      const expectedType = typeSpecToResolved(spec.type, spec.enumKey);
      expected.push(expectedType);
      if (actual.kind === 'ANY') continue;
      if (!matchesExpected(expectedType, actual)) {
        this.err(
          argNode.span,
          `'${name}' argument '${spec.name}': expected ${describeArg(spec)}, got ${formatType(actual)}`,
          'type',
        );
      }
    }
    return expected;
  }

  private err(
    span: SourceSpan,
    message: string,
    kind: GenbyError['kind'],
  ): void {
    this.errors.push({
      line: span.line,
      column: span.column,
      length: Math.max(1, span.length),
      message,
      kind,
    });
  }
}

function typeSpecToResolved(type: Type, enumKey?: string): ResolvedType {
  if (type === ENUM) return { kind: ENUM, enumKey: enumKey ?? '' };
  if (isBuiltinType(type)) {
    return { kind: type as typeof STR | typeof NUM | typeof BUL | typeof ANY };
  }
  return { kind: 'CUSTOM', name: type };
}

function sameType(a: ResolvedType, b: ResolvedType): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === ENUM && b.kind === ENUM) return a.enumKey === b.enumKey;
  if (a.kind === 'CUSTOM' && b.kind === 'CUSTOM') return a.name === b.name;
  return true;
}

function matchesExpected(expected: ResolvedType, actual: ResolvedType): boolean {
  if (expected.kind === 'ANY' || actual.kind === 'ANY') return true;
  return sameType(expected, actual);
}

function formatType(t: ResolvedType): string {
  if (t.kind === ENUM) return `ENUM<${t.enumKey}>`;
  if (t.kind === 'CUSTOM') return t.name;
  return t.kind;
}

function assertConstExpr(
  expr: Expression,
  report: (span: SourceSpan, message: string) => void,
): void {
  switch (expr.kind) {
    case 'NumberLit':
      return;
    case 'StringLit':
      for (const part of expr.parts) {
        if (part.kind === 'expr') {
          report(
            part.span,
            `Directive arguments cannot contain interpolated expressions`,
          );
        }
      }
      return;
    case 'Ident':
      // Allowed if it's an enum value — checked later in inferIdent, and we
      // still run inferExpr on the arg, which will report other identifiers
      // as unknown. So accept here.
      return;
    case 'Unary':
      assertConstExpr(expr.operand, report);
      return;
    case 'Binary':
      report(expr.span, `Directive arguments must be constant`);
      return;
    case 'Call':
      report(expr.span, `Directive arguments cannot contain function calls`);
      return;
    case 'Block':
      report(expr.span, `Directive arguments cannot contain block expressions`);
      return;
  }
}
