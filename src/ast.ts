export interface SourceSpan {
  start: number;
  end: number;
  line: number;
  column: number;
  length: number;
}

export interface Program {
  kind: 'Program';
  directives: Directive[];
  statements: Statement[];
  returnStmt: ReturnStatement | null;
  span: SourceSpan;
}

export interface Directive {
  kind: 'Directive';
  name: string;
  nameSpan: SourceSpan;
  args: Expression[];
  span: SourceSpan;
}

export type Statement = AssignStatement | ExprStatement | ReturnStatement;

export interface AssignStatement {
  kind: 'Assign';
  name: string;
  nameSpan: SourceSpan;
  value: Expression;
  span: SourceSpan;
}

export interface ExprStatement {
  kind: 'ExprStmt';
  expr: Expression;
  span: SourceSpan;
}

export interface ReturnStatement {
  kind: 'Return';
  expr: Expression;
  span: SourceSpan;
  /** 'RETURN' identifier span. */
  keywordSpan: SourceSpan;
}

export type Expression =
  | StringLiteral
  | NumberLiteral
  | Identifier
  | UnaryExpr
  | BinaryExpr
  | CallExpr;

export interface StringPartText {
  kind: 'text';
  value: string;
  span: SourceSpan;
}
export interface StringPartExpr {
  kind: 'expr';
  expr: Expression;
  span: SourceSpan;
}
export type StringPart = StringPartText | StringPartExpr;

export interface StringLiteral {
  kind: 'StringLit';
  parts: StringPart[];
  span: SourceSpan;
}

export interface NumberLiteral {
  kind: 'NumberLit';
  value: number;
  span: SourceSpan;
}

export interface Identifier {
  kind: 'Ident';
  name: string;
  span: SourceSpan;
}

export type UnaryOp = '-';
export interface UnaryExpr {
  kind: 'Unary';
  op: UnaryOp;
  operand: Expression;
  opSpan: SourceSpan;
  span: SourceSpan;
}

export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '=='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>=';

export interface BinaryExpr {
  kind: 'Binary';
  op: BinaryOp;
  left: Expression;
  right: Expression;
  opSpan: SourceSpan;
  span: SourceSpan;
}

export interface CallExpr {
  kind: 'Call';
  callee: string;
  calleeSpan: SourceSpan;
  args: Expression[];
  span: SourceSpan;
}

export function spanFromTo(
  start: { start: number; line: number; column: number },
  end: { end: number },
): SourceSpan {
  return {
    start: start.start,
    end: end.end,
    line: start.line,
    column: start.column,
    length: Math.max(0, end.end - start.start),
  };
}
