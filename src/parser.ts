import type { GenbyError } from './types.js';
import type { Token, TokenKind } from './lexer.js';
import type {
  AssignStatement,
  BinaryExpr,
  BinaryOp,
  CallExpr,
  Directive,
  ExprStatement,
  Expression,
  Identifier,
  NumberLiteral,
  Program,
  ReturnStatement,
  SourceSpan,
  Statement,
  StringLiteral,
  StringPart,
  UnaryExpr,
} from './ast.js';

export interface ParseResult {
  program: Program;
  errors: GenbyError[];
}

const COMPARISON_OPS: Record<string, BinaryOp> = {
  LT: '<',
  GT: '>',
  LE: '<=',
  GE: '>=',
};

const EQUALITY_OPS: Record<string, BinaryOp> = {
  EQEQ: '==',
  NEQ: '!=',
};

class ParseError extends Error {
  constructor(
    message: string,
    public token: Token,
  ) {
    super(message);
  }
}

class Parser {
  private pos = 0;
  readonly errors: GenbyError[] = [];

  constructor(private readonly tokens: Token[]) {}

  parseProgram(): Program {
    const startTok = this.peek();
    const directives: Directive[] = [];
    const statements: Statement[] = [];
    let returnStmt: ReturnStatement | null = null;

    // Skip leading blank lines / comments.
    this.skipLineBreaks();

    // Parse directives first.
    while (this.check('AT')) {
      try {
        directives.push(this.parseDirective());
      } catch (err) {
        this.recoverToNextLine();
      }
      this.skipLineBreaks();
    }

    // Parse statements. `@` here is an error.
    while (!this.check('EOF')) {
      this.skipLineBreaks();
      if (this.check('EOF')) break;
      if (this.check('AT')) {
        const t = this.peek();
        this.addError(
          t,
          'Directives must appear before any regular statement',
          'syntax',
        );
        this.recoverToNextLine();
        continue;
      }
      try {
        const stmt = this.parseStatement();
        if (stmt.kind === 'Return') {
          if (returnStmt !== null) {
            this.addErrorAtSpan(
              stmt.keywordSpan,
              'RETURN must appear only once as the last statement',
              'syntax',
            );
          }
          returnStmt = stmt;
        } else {
          if (returnStmt !== null) {
            this.addErrorAtSpan(
              stmt.span,
              'No statements are allowed after RETURN',
              'syntax',
            );
          }
          statements.push(stmt);
        }
      } catch (err) {
        this.recoverToNextLine();
      }
      // Require newline or EOF after a statement.
      if (!this.check('EOF') && !this.check('NEWLINE')) {
        const t = this.peek();
        this.addError(t, `Expected end of line, got '${t.text}'`, 'syntax');
        this.recoverToNextLine();
      }
    }

    const endTok = this.tokens[this.tokens.length - 1]!;
    const span: SourceSpan = {
      start: startTok.start,
      end: endTok.end,
      line: startTok.line,
      column: startTok.column,
      length: endTok.end - startTok.start,
    };

    return {
      kind: 'Program',
      directives,
      statements,
      returnStmt,
      span,
    };
  }

  // ------- Statements -------

  private parseDirective(): Directive {
    const at = this.expect('AT');
    const nameTok = this.expect('IDENT', `Expected directive name after '@'`);
    this.expect('LPAREN', `Expected '(' after directive name`);
    const args: Expression[] = [];
    this.skipLineBreaks();
    if (!this.check('RPAREN')) {
      args.push(this.parseExpression());
      this.skipLineBreaks();
      while (this.match('COMMA')) {
        this.skipLineBreaks();
        args.push(this.parseExpression());
        this.skipLineBreaks();
      }
    }
    this.skipLineBreaks();
    const closeTok = this.expect('RPAREN', `Expected ')'`);
    return {
      kind: 'Directive',
      name: nameTok.value,
      nameSpan: tokenSpan(nameTok),
      args,
      span: {
        start: at.start,
        end: closeTok.end,
        line: at.line,
        column: at.column,
        length: closeTok.end - at.start,
      },
    };
  }

  private parseStatement(): Statement {
    // Lookahead: IDENT EQ => Assign. IDENT ( => Call stmt or Return. Otherwise Expression stmt.
    if (this.check('IDENT') && this.checkAt(1, 'EQ')) {
      return this.parseAssign();
    }
    // RETURN(...) looks like a call; we detect by name after parsing.
    const expr = this.parseExpression();
    if (
      expr.kind === 'Call' &&
      expr.callee === 'RETURN' &&
      expr.args.length === 1
    ) {
      const retStmt: ReturnStatement = {
        kind: 'Return',
        expr: expr.args[0]!,
        span: expr.span,
        keywordSpan: expr.calleeSpan,
      };
      return retStmt;
    }
    if (
      expr.kind === 'Call' &&
      expr.callee === 'RETURN' &&
      expr.args.length !== 1
    ) {
      this.addErrorAtSpan(
        expr.span,
        'RETURN expects exactly one argument',
        'syntax',
      );
      const fallbackExpr: Expression =
        expr.args[0] ??
        ({
          kind: 'StringLit',
          parts: [],
          span: expr.span,
        } satisfies StringLiteral);
      return {
        kind: 'Return',
        expr: fallbackExpr,
        span: expr.span,
        keywordSpan: expr.calleeSpan,
      };
    }
    const stmt: ExprStatement = {
      kind: 'ExprStmt',
      expr,
      span: expr.span,
    };
    return stmt;
  }

  private parseAssign(): AssignStatement {
    const nameTok = this.expect('IDENT');
    this.expect('EQ');
    const value = this.parseExpression();
    return {
      kind: 'Assign',
      name: nameTok.value,
      nameSpan: tokenSpan(nameTok),
      value,
      span: {
        start: nameTok.start,
        end: value.span.end,
        line: nameTok.line,
        column: nameTok.column,
        length: value.span.end - nameTok.start,
      },
    };
  }

  // ------- Expressions -------

  private parseExpression(): Expression {
    return this.parseEquality();
  }

  private parseEquality(): Expression {
    let left = this.parseComparison();
    while (true) {
      const opKind = this.peek().kind;
      const op = EQUALITY_OPS[opKind];
      if (!op) break;
      const opTok = this.advance();
      this.skipLineBreaks();
      const right = this.parseComparison();
      left = makeBinary(op, left, right, opTok);
    }
    return left;
  }

  private parseComparison(): Expression {
    let left = this.parseAdditive();
    while (true) {
      const opKind = this.peek().kind;
      const op = COMPARISON_OPS[opKind];
      if (!op) break;
      const opTok = this.advance();
      this.skipLineBreaks();
      const right = this.parseAdditive();
      left = makeBinary(op, left, right, opTok);
    }
    return left;
  }

  private parseAdditive(): Expression {
    let left = this.parseMultiplicative();
    while (this.check('PLUS') || this.check('MINUS')) {
      const opTok = this.advance();
      const op: BinaryOp = opTok.kind === 'PLUS' ? '+' : '-';
      this.skipLineBreaks();
      const right = this.parseMultiplicative();
      left = makeBinary(op, left, right, opTok);
    }
    return left;
  }

  private parseMultiplicative(): Expression {
    let left = this.parseUnary();
    while (this.check('STAR') || this.check('SLASH')) {
      const opTok = this.advance();
      const op: BinaryOp = opTok.kind === 'STAR' ? '*' : '/';
      this.skipLineBreaks();
      const right = this.parseUnary();
      left = makeBinary(op, left, right, opTok);
    }
    return left;
  }

  private parseUnary(): Expression {
    if (this.check('MINUS')) {
      const opTok = this.advance();
      const operand = this.parseUnary();
      const unary: UnaryExpr = {
        kind: 'Unary',
        op: '-',
        operand,
        opSpan: tokenSpan(opTok),
        span: {
          start: opTok.start,
          end: operand.span.end,
          line: opTok.line,
          column: opTok.column,
          length: operand.span.end - opTok.start,
        },
      };
      return unary;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expression {
    const tok = this.peek();
    switch (tok.kind) {
      case 'NUMBER': {
        this.advance();
        const num = Number(tok.value);
        const lit: NumberLiteral = {
          kind: 'NumberLit',
          value: num,
          span: tokenSpan(tok),
        };
        return lit;
      }
      case 'STRING_START':
        return this.parseString();
      case 'IDENT': {
        this.advance();
        if (this.check('LPAREN')) {
          return this.parseCall(tok);
        }
        const id: Identifier = {
          kind: 'Ident',
          name: tok.value,
          span: tokenSpan(tok),
        };
        return id;
      }
      case 'LPAREN': {
        this.advance();
        this.skipLineBreaks();
        const inner = this.parseExpression();
        this.skipLineBreaks();
        this.expect('RPAREN', `Expected ')'`);
        return inner;
      }
      default: {
        this.addError(tok, `Unexpected token '${tok.text}'`, 'syntax');
        this.advance();
        throw new ParseError('unexpected token', tok);
      }
    }
  }

  private parseCall(nameTok: Token): CallExpr {
    this.expect('LPAREN');
    const args: Expression[] = [];
    this.skipLineBreaks();
    if (!this.check('RPAREN')) {
      args.push(this.parseExpression());
      this.skipLineBreaks();
      while (this.match('COMMA')) {
        this.skipLineBreaks();
        args.push(this.parseExpression());
        this.skipLineBreaks();
      }
    }
    this.skipLineBreaks();
    const closeTok = this.expect('RPAREN', `Expected ')'`);
    return {
      kind: 'Call',
      callee: nameTok.value,
      calleeSpan: tokenSpan(nameTok),
      args,
      span: {
        start: nameTok.start,
        end: closeTok.end,
        line: nameTok.line,
        column: nameTok.column,
        length: closeTok.end - nameTok.start,
      },
    };
  }

  private parseString(): StringLiteral {
    const startTok = this.expect('STRING_START');
    const parts: StringPart[] = [];
    while (!this.check('STRING_END') && !this.check('EOF')) {
      const t = this.peek();
      if (t.kind === 'STRING_TEXT') {
        this.advance();
        parts.push({ kind: 'text', value: t.value, span: tokenSpan(t) });
      } else if (t.kind === 'INTERP_OPEN') {
        this.advance();
        this.skipLineBreaks();
        const expr = this.parseExpression();
        this.skipLineBreaks();
        const closeTok = this.expect(
          'INTERP_CLOSE',
          `Expected '}' to close interpolation`,
        );
        parts.push({
          kind: 'expr',
          expr,
          span: {
            start: t.start,
            end: closeTok.end,
            line: t.line,
            column: t.column,
            length: closeTok.end - t.start,
          },
        });
      } else {
        this.addError(t, `Unexpected token in string: '${t.text}'`, 'syntax');
        this.advance();
      }
    }
    const endTok = this.match('STRING_END') ?? this.peek();
    return {
      kind: 'StringLit',
      parts,
      span: {
        start: startTok.start,
        end: endTok.end,
        line: startTok.line,
        column: startTok.column,
        length: endTok.end - startTok.start,
      },
    };
  }

  // ------- Token helpers -------

  private peek(offset = 0): Token {
    const idx = this.pos + offset;
    return this.tokens[idx] ?? this.tokens[this.tokens.length - 1]!;
  }

  private advance(): Token {
    const tok = this.tokens[this.pos]!;
    if (tok.kind !== 'EOF') this.pos += 1;
    return tok;
  }

  private check(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private checkAt(offset: number, kind: TokenKind): boolean {
    return this.peek(offset).kind === kind;
  }

  private match(kind: TokenKind): Token | null {
    if (this.check(kind)) return this.advance();
    return null;
  }

  private expect(kind: TokenKind, message?: string): Token {
    if (this.check(kind)) return this.advance();
    const tok = this.peek();
    const msg = message ?? `Expected ${kind}, got '${tok.text}'`;
    this.addError(tok, msg, 'syntax');
    throw new ParseError(msg, tok);
  }

  private skipLineBreaks(): void {
    while (this.check('NEWLINE') || this.check('COMMENT')) this.advance();
  }

  private recoverToNextLine(): void {
    while (!this.check('NEWLINE') && !this.check('EOF')) this.advance();
    if (this.check('NEWLINE')) this.advance();
  }

  private addError(
    tok: Token,
    message: string,
    kind: GenbyError['kind'],
  ): void {
    this.errors.push({
      line: tok.line,
      column: tok.column,
      length: Math.max(1, tok.end - tok.start),
      message,
      kind,
    });
  }

  private addErrorAtSpan(
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

function makeBinary(
  op: BinaryOp,
  left: Expression,
  right: Expression,
  opTok: Token,
): BinaryExpr {
  return {
    kind: 'Binary',
    op,
    left,
    right,
    opSpan: tokenSpan(opTok),
    span: {
      start: left.span.start,
      end: right.span.end,
      line: left.span.line,
      column: left.span.column,
      length: right.span.end - left.span.start,
    },
  };
}

function tokenSpan(tok: Token): SourceSpan {
  return {
    start: tok.start,
    end: tok.end,
    line: tok.line,
    column: tok.column,
    length: Math.max(0, tok.end - tok.start),
  };
}

export function parse(tokens: Token[]): ParseResult {
  const p = new Parser(tokens);
  const program = p.parseProgram();
  return { program, errors: p.errors };
}
