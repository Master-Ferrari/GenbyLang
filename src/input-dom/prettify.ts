import { lex, type Token } from '../lexer.js';
import { parse } from '../parser.js';
import type {
  AssignStatement,
  BinaryExpr,
  BinaryOp,
  BlockExpr,
  BlockStatement,
  Directive,
  Expression,
  Program,
  ReturnStatement,
  SourceSpan,
  Statement,
  UserFunDefStatement,
} from '../ast.js';

/**
 * Re-format a Genby source string with canonical indentation and line breaks.
 *
 * Strategy:
 *   - Parse the program. If there are any lex or parse errors, return the
 *     source untouched — we refuse to reformat broken code to avoid losing
 *     meaning.
 *   - For each call / block we try the compact single-line form first and
 *     fall back to multi-line with one argument or block-statement per line
 *     when the flat form would overflow `maxWidth`. The algorithm recurses
 *     into nested calls so functions passed as arguments are themselves
 *     prettified.
 *
 * Trivia preservation:
 *   - The parser discards comments and blank lines. To keep them we walk the
 *     token stream alongside the AST and record per-source-line metadata:
 *     "does this line have code?", "is there a comment on it?". Between two
 *     consecutive top-level nodes (or block statements, or call arguments)
 *     we emit any comment-only or blank lines that originally appeared
 *     there; trailing end-of-line comments are appended to the last emitted
 *     line of the node they belong to.
 *   - String-literal content lines are tracked so blank lines inside a
 *     multi-line string are not mistaken for separators.
 */
export interface PrettifyOptions {
  /** Soft line width for deciding when to break call args across lines. */
  maxWidth?: number;
}

export function prettify(source: string, opts: PrettifyOptions = {}): string {
  const { tokens, errors: lexErrs } = lex(source);
  const { program, errors: parseErrs } = parse(tokens);
  if (lexErrs.length > 0 || parseErrs.length > 0) {
    return source;
  }
  const printer = new Printer(source, tokens, opts.maxWidth ?? 80);
  return printer.printProgram(program);
}

const IND = '  ';

function prec(op: BinaryOp): number {
  if (op === '*' || op === '/') return 4;
  if (op === '+' || op === '-') return 3;
  if (op === '<' || op === '>' || op === '<=' || op === '>=') return 2;
  return 1; // == !=
}

interface LineInfo {
  hasCode: boolean;
  commentText: string | null;
}

class Printer {
  private readonly totalLines: number;
  private readonly lineInfo = new Map<number, LineInfo>();
  private readonly stringLines = new Set<number>();

  constructor(
    private readonly source: string,
    tokens: Token[],
    private readonly maxWidth: number,
  ) {
    this.totalLines = Math.max(1, source.split('\n').length);
    this.collectTrivia(tokens);
  }

  private collectTrivia(tokens: Token[]): void {
    let stringStart: Token | null = null;
    for (const tok of tokens) {
      if (tok.kind === 'STRING_START') {
        stringStart = tok;
      } else if (tok.kind === 'STRING_END' && stringStart) {
        for (let l = stringStart.line; l <= tok.line; l++) {
          this.stringLines.add(l);
        }
        stringStart = null;
      }
      if (tok.kind === 'NEWLINE' || tok.kind === 'EOF') continue;
      let info = this.lineInfo.get(tok.line);
      if (!info) {
        info = { hasCode: false, commentText: null };
        this.lineInfo.set(tok.line, info);
      }
      if (tok.kind === 'COMMENT') {
        // Strip trailing whitespace so we don't carry it into the new layout.
        info.commentText = tok.text.replace(/\s+$/, '');
      } else {
        info.hasCode = true;
      }
    }
  }

  private pad(n: number): string {
    return IND.repeat(n);
  }

  /** 1-based line index of the last source line covered by `span`. */
  private endLine(span: SourceSpan): number {
    const text = this.source.slice(span.start, span.end);
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) count++;
    }
    return span.line + count;
  }

  /**
   * Emit preserved trivia (blank lines + own-line comments) for inclusive
   * source-line range [from..to], indented at `indent` levels.
   */
  private emitTrivia(from: number, to: number, indent: number): string[] {
    if (from > to) return [];
    const pad = this.pad(indent);
    const out: string[] = [];
    for (let l = from; l <= to; l++) {
      if (this.stringLines.has(l)) continue;
      const info = this.lineInfo.get(l);
      if (!info) {
        out.push('');
        continue;
      }
      if (info.commentText && !info.hasCode) {
        out.push(pad + info.commentText);
      }
      // Lines with code belong to some node's body; they're consumed by the
      // node's own printing and must not be duplicated here.
    }
    return out;
  }

  /** Trailing end-of-line comment on `line`, if any. */
  private trailingCommentOn(line: number): string | null {
    const info = this.lineInfo.get(line);
    return info && info.hasCode && info.commentText ? info.commentText : null;
  }

  /** True if any source line in [from..to] has a comment or is blank. */
  private rangeHasTrivia(from: number, to: number): boolean {
    if (from > to) return false;
    for (let l = from; l <= to; l++) {
      if (this.stringLines.has(l)) continue;
      const info = this.lineInfo.get(l);
      if (!info) return true;
      if (info.commentText) return true;
    }
    return false;
  }

  /** Append a trailing comment to the last line of `text`. */
  private appendTrailing(text: string, comment: string | null): string {
    if (!comment) return text;
    const parts = text.split('\n');
    parts[parts.length - 1] += '  ' + comment;
    return parts.join('\n');
  }

  // ---- top-level ----

  printProgram(p: Program): string {
    type Node = Directive | Statement;
    const nodes: Node[] = [
      ...p.directives,
      ...p.statements,
      ...(p.returnStmt ? [p.returnStmt] : []),
    ];

    const out: string[] = [];
    let prevEnd = 0;
    for (const node of nodes) {
      const startLine = node.span.line;
      const endLine = this.endLine(node.span);
      out.push(...this.emitTrivia(prevEnd + 1, startLine - 1, 0));
      const printed = this.printTopLevel(node);
      const withTrailing = this.appendTrailing(
        printed,
        this.trailingCommentOn(endLine),
      );
      out.push(...withTrailing.split('\n'));
      prevEnd = endLine;
    }
    out.push(...this.emitTrivia(prevEnd + 1, this.totalLines, 0));
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    return out.length > 0 ? out.join('\n') + '\n' : '';
  }

  private printTopLevel(n: Directive | Statement): string {
    if (n.kind === 'Directive') return this.printDirective(n, 0);
    return this.printStatement(n, 0);
  }

  private printDirective(d: Directive, indent: number): string {
    const pad = this.pad(indent);
    return (
      pad +
      this.printCallLike('@' + d.name, d.args, d.span, indent, pad.length)
    );
  }

  private printStatement(s: Statement, indent: number): string {
    const pad = this.pad(indent);
    switch (s.kind) {
      case 'Assign':
        return pad + this.printAssignBody(s, indent);
      case 'ExprStmt':
        return pad + this.printExpr(s.expr, indent, pad.length);
      case 'Return':
        return this.printReturn(s, indent);
      case 'UserFunDef':
        return this.printUserFunDef(s, indent);
    }
  }

  private printAssignBody(a: AssignStatement, indent: number): string {
    const head = `${a.name} = `;
    const startCol = this.pad(indent).length + head.length;
    return head + this.printExpr(a.value, indent, startCol);
  }

  private printReturn(s: ReturnStatement, indent: number): string {
    const pad = this.pad(indent);
    return (
      pad + this.printCallLike('RETURN', [s.expr], s.span, indent, pad.length)
    );
  }

  private printUserFunDef(s: UserFunDefStatement, indent: number): string {
    const pad = this.pad(indent);
    const params = s.params.map((p) => p.name).join(', ');
    const head = `${pad}${s.name}(${params}) = `;
    return head + this.printBlock(s.body, indent, head.length);
  }

  // ---- expressions ----

  private printExpr(e: Expression, indent: number, col: number): string {
    const flat = this.tryInline(e);
    if (flat !== null && col + flat.length <= this.maxWidth) return flat;
    return this.printMulti(e, indent, col);
  }

  private printMulti(e: Expression, indent: number, col: number): string {
    switch (e.kind) {
      case 'StringLit':
      case 'NumberLit':
      case 'Ident':
        return this.source.slice(e.span.start, e.span.end);
      case 'Unary': {
        const inner = this.printExpr(e.operand, indent, col + 1);
        return e.operand.kind === 'Binary' ? `-(${inner})` : '-' + inner;
      }
      case 'Binary':
        return this.printBinary(e, indent, col);
      case 'Call':
        return this.printCallLike(e.callee, e.args, e.span, indent, col);
      case 'Block':
        return this.printBlock(e, indent, col);
    }
  }

  private printBinary(e: BinaryExpr, indent: number, col: number): string {
    const lWrap = needsParen(e.left, e.op, false);
    const rWrap = needsParen(e.right, e.op, true);
    const lStart = col + (lWrap ? 1 : 0);
    const leftStr = this.printExpr(e.left, indent, lStart);
    const leftOut = lWrap ? `(${leftStr})` : leftStr;
    const lastLeftLine = leftOut.split('\n').pop() ?? '';
    const afterLeftCol = leftOut.includes('\n')
      ? lastLeftLine.length
      : col + leftOut.length;
    const rStart = afterLeftCol + 1 + e.op.length + 1 + (rWrap ? 1 : 0);
    const rightStr = this.printExpr(e.right, indent, rStart);
    const rightOut = rWrap ? `(${rightStr})` : rightStr;
    return `${leftOut} ${e.op} ${rightOut}`;
  }

  /**
   * Print a call-like node (CallExpr, directive, or RETURN) with `callee`
   * as the visible head. `span` covers the whole call including parens —
   * used to detect trivia between args and the closing paren.
   */
  private printCallLike(
    callee: string,
    args: Expression[],
    span: SourceSpan,
    indent: number,
    col: number,
  ): string {
    const hasInternalTrivia = this.callHasInternalTrivia(args, span);
    if (!hasInternalTrivia) {
      const inlineParts: (string | null)[] = args.map((a) => this.tryInline(a));
      if (inlineParts.every((s): s is string => s !== null)) {
        const inline = `${callee}(${inlineParts.join(', ')})`;
        if (col + inline.length <= this.maxWidth) return inline;
      }
    }
    if (args.length === 0) return `${callee}()`;
    const innerIndent = indent + 1;
    const innerPad = this.pad(innerIndent);
    const lines: string[] = [];
    const openLine = span.line; // line where '(' lives (callee is on span.line)
    const closeLine = this.endLine(span);
    let prevEnd = openLine;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      const aStart = arg.span.line;
      const aEnd = this.endLine(arg.span);
      lines.push(...this.emitTrivia(prevEnd + 1, aStart - 1, innerIndent));
      let body = innerPad + this.printExpr(arg, innerIndent, innerPad.length);
      const isLast = i === args.length - 1;
      if (!isLast) {
        const parts = body.split('\n');
        parts[parts.length - 1] += ',';
        body = parts.join('\n');
      }
      const trailing = this.trailingCommentOn(aEnd);
      body = this.appendTrailing(body, trailing);
      lines.push(...body.split('\n'));
      prevEnd = aEnd;
    }
    lines.push(...this.emitTrivia(prevEnd + 1, closeLine - 1, innerIndent));
    return `${callee}(\n${lines.join('\n')}\n${this.pad(indent)})`;
  }

  private callHasInternalTrivia(
    args: Expression[],
    span: SourceSpan,
  ): boolean {
    if (args.length === 0) {
      // An empty arg list can still carry a stray comment between the parens.
      return this.rangeHasTrivia(span.line + 1, this.endLine(span) - 1);
    }
    const openLine = span.line; // '(' lives on the same line as the callee
    const closeLine = this.endLine(span);
    // Gap between '(' and the first argument.
    if (this.rangeHasTrivia(openLine + 1, args[0]!.span.line - 1)) return true;
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      const aEnd = this.endLine(a.span);
      if (this.trailingCommentOn(aEnd)) return true;
      if (i < args.length - 1) {
        const next = args[i + 1]!;
        if (this.rangeHasTrivia(aEnd + 1, next.span.line - 1)) return true;
      } else {
        if (this.rangeHasTrivia(aEnd + 1, closeLine - 1)) return true;
      }
    }
    return false;
  }

  private printBlock(b: BlockExpr, indent: number, col: number): string {
    if (b.statements.length === 0) return '()';
    const openLine = b.span.line;
    const closeLine = this.endLine(b.span);

    const internalHasTrivia = this.blockHasInternalTrivia(b, openLine, closeLine);

    if (b.statements.length === 1 && !internalHasTrivia) {
      const flat = this.tryInlineBlockStmt(b.statements[0]!);
      if (flat !== null && col + flat.length + 2 <= this.maxWidth) {
        return `(${flat})`;
      }
    }
    const innerIndent = indent + 1;
    const innerPad = this.pad(innerIndent);
    const lines: string[] = [];
    let prevEnd = openLine;
    for (const s of b.statements) {
      const sStart = s.span.line;
      const sEnd = this.endLine(s.span);
      lines.push(...this.emitTrivia(prevEnd + 1, sStart - 1, innerIndent));
      let body = innerPad + this.printBlockStmt(s, innerIndent);
      body = this.appendTrailing(body, this.trailingCommentOn(sEnd));
      lines.push(...body.split('\n'));
      prevEnd = sEnd;
    }
    lines.push(...this.emitTrivia(prevEnd + 1, closeLine - 1, innerIndent));
    return `(\n${lines.join('\n')}\n${this.pad(indent)})`;
  }

  private blockHasInternalTrivia(
    b: BlockExpr,
    openLine: number,
    closeLine: number,
  ): boolean {
    let prevEnd = openLine;
    for (const s of b.statements) {
      const sStart = s.span.line;
      const sEnd = this.endLine(s.span);
      if (this.rangeHasTrivia(prevEnd + 1, sStart - 1)) return true;
      if (this.trailingCommentOn(sEnd)) return true;
      prevEnd = sEnd;
    }
    return this.rangeHasTrivia(prevEnd + 1, closeLine - 1);
  }

  private printBlockStmt(s: BlockStatement, indent: number): string {
    switch (s.kind) {
      case 'Assign':
        return this.printAssignBody(s, indent);
      case 'ExprStmt':
        return this.printExpr(s.expr, indent, this.pad(indent).length);
    }
  }

  /**
   * Produce a single-line rendering of `e`, or return null if the node must
   * span multiple lines (multi-line string, block with ≥2 statements, or
   * anything with internal comments/blank lines). No width check here.
   */
  private tryInline(e: Expression): string | null {
    switch (e.kind) {
      case 'NumberLit':
      case 'Ident':
        return this.source.slice(e.span.start, e.span.end);
      case 'StringLit': {
        const text = this.source.slice(e.span.start, e.span.end);
        return text.includes('\n') ? null : text;
      }
      case 'Unary': {
        const o = this.tryInline(e.operand);
        if (o === null) return null;
        return e.operand.kind === 'Binary' ? `-(${o})` : '-' + o;
      }
      case 'Binary': {
        const l = this.tryInline(e.left);
        const r = this.tryInline(e.right);
        if (l === null || r === null) return null;
        const L = needsParen(e.left, e.op, false) ? `(${l})` : l;
        const R = needsParen(e.right, e.op, true) ? `(${r})` : r;
        return `${L} ${e.op} ${R}`;
      }
      case 'Call': {
        if (this.callHasInternalTrivia(e.args, e.span)) return null;
        const parts = e.args.map((a) => this.tryInline(a));
        if (parts.some((s) => s === null)) return null;
        return `${e.callee}(${parts.join(', ')})`;
      }
      case 'Block': {
        if (e.statements.length === 0) return '()';
        if (e.statements.length !== 1) return null;
        const openLine = e.span.line;
        const closeLine = this.endLine(e.span);
        if (this.blockHasInternalTrivia(e, openLine, closeLine)) return null;
        const inner = this.tryInlineBlockStmt(e.statements[0]!);
        return inner === null ? null : `(${inner})`;
      }
    }
  }

  private tryInlineBlockStmt(s: BlockStatement): string | null {
    switch (s.kind) {
      case 'Assign': {
        const v = this.tryInline(s.value);
        return v === null ? null : `${s.name} = ${v}`;
      }
      case 'ExprStmt':
        return this.tryInline(s.expr);
    }
  }
}

function needsParen(
  child: Expression,
  parentOp: BinaryOp,
  isRight: boolean,
): boolean {
  if (child.kind !== 'Binary') return false;
  const cp = prec(child.op);
  const pp = prec(parentOp);
  if (cp < pp) return true;
  // Binary operators in this grammar are left-associative; a right-hand
  // child with equal precedence must be parenthesised to preserve meaning.
  if (cp === pp && isRight) return true;
  return false;
}
