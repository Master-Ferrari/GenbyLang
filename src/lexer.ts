import type { GenbyError } from './types.js';

export type TokenKind =
  | 'AT'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'EQ'
  | 'EQEQ'
  | 'NEQ'
  | 'LT'
  | 'GT'
  | 'LE'
  | 'GE'
  | 'PLUS'
  | 'MINUS'
  | 'STAR'
  | 'SLASH'
  | 'IDENT'
  | 'NUMBER'
  | 'STRING_START'
  | 'STRING_TEXT'
  | 'STRING_ESCAPE'
  | 'INTERP_OPEN'
  | 'INTERP_CLOSE'
  | 'STRING_END'
  | 'NEWLINE'
  | 'COMMENT'
  | 'EOF'
  | 'ERROR';

export interface Token {
  kind: TokenKind;
  /** Raw source text of the token. */
  text: string;
  /** For STRING_TEXT: decoded value (after unescaping). For NUMBER: numeric value as string. Otherwise same as text. */
  value: string;
  /** 0-based absolute offset in source. */
  start: number;
  /** 0-based absolute offset (exclusive). */
  end: number;
  /** 1-based line. */
  line: number;
  /** 1-based column of the start. */
  column: number;
}

export interface LexResult {
  tokens: Token[];
  errors: GenbyError[];
}

const RE_IDENT_START = /[a-zA-Z_]/;
const RE_IDENT_CONT = /[a-zA-Z0-9_]/;
const RE_DIGIT = /[0-9]/;

export function lex(source: string): LexResult {
  const tokens: Token[] = [];
  const errors: GenbyError[] = [];

  let pos = 0;
  let line = 1;
  let col = 1;

  const startOf = () => ({ start: pos, line, col });

  const pushToken = (
    kind: TokenKind,
    text: string,
    value: string,
    s: { start: number; line: number; col: number },
  ) => {
    tokens.push({
      kind,
      text,
      value,
      start: s.start,
      end: pos,
      line: s.line,
      column: s.col,
    });
  };

  const pushError = (
    message: string,
    s: { start: number; line: number; col: number },
  ) => {
    errors.push({
      line: s.line,
      column: s.col,
      length: Math.max(1, pos - s.start),
      message,
      kind: 'syntax',
    });
  };

  const advance = (): string => {
    const ch = source[pos++]!;
    if (ch === '\n') {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
    return ch;
  };

  const peek = (offset = 0): string | undefined => source[pos + offset];

  while (pos < source.length) {
    const ch = peek()!;

    // Whitespace (except newline)
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      advance();
      continue;
    }

    // Newline
    if (ch === '\n') {
      const s = startOf();
      advance();
      pushToken('NEWLINE', '\n', '\n', s);
      continue;
    }

    // Comment `// ...`
    if (ch === '/' && peek(1) === '/') {
      const s = startOf();
      while (pos < source.length && peek() !== '\n') advance();
      const text = source.slice(s.start, pos);
      pushToken('COMMENT', text, text, s);
      continue;
    }

    // String
    if (ch === '"') {
      lexString();
      continue;
    }

    // Number
    if (RE_DIGIT.test(ch)) {
      lexNumber();
      continue;
    }

    // Identifier / keyword
    if (RE_IDENT_START.test(ch)) {
      lexIdent();
      continue;
    }

    // Single / double-char tokens
    const s = startOf();
    switch (ch) {
      case '@':
        advance();
        pushToken('AT', '@', '@', s);
        continue;
      case '(':
        advance();
        pushToken('LPAREN', '(', '(', s);
        continue;
      case ')':
        advance();
        pushToken('RPAREN', ')', ')', s);
        continue;
      case ',':
        advance();
        pushToken('COMMA', ',', ',', s);
        continue;
      case '+':
        advance();
        pushToken('PLUS', '+', '+', s);
        continue;
      case '-':
        advance();
        pushToken('MINUS', '-', '-', s);
        continue;
      case '*':
        advance();
        pushToken('STAR', '*', '*', s);
        continue;
      case '/':
        advance();
        pushToken('SLASH', '/', '/', s);
        continue;
      case '=':
        advance();
        if (peek() === '=') {
          advance();
          pushToken('EQEQ', '==', '==', s);
        } else {
          pushToken('EQ', '=', '=', s);
        }
        continue;
      case '!':
        advance();
        if (peek() === '=') {
          advance();
          pushToken('NEQ', '!=', '!=', s);
        } else {
          pushError(`Unexpected character '!'`, s);
          pushToken('ERROR', '!', '!', s);
        }
        continue;
      case '<':
        advance();
        if (peek() === '=') {
          advance();
          pushToken('LE', '<=', '<=', s);
        } else {
          pushToken('LT', '<', '<', s);
        }
        continue;
      case '>':
        advance();
        if (peek() === '=') {
          advance();
          pushToken('GE', '>=', '>=', s);
        } else {
          pushToken('GT', '>', '>', s);
        }
        continue;
      default: {
        advance();
        pushError(`Unexpected character '${ch}'`, s);
        pushToken('ERROR', ch, ch, s);
        continue;
      }
    }
  }

  // EOF token
  tokens.push({
    kind: 'EOF',
    text: '',
    value: '',
    start: pos,
    end: pos,
    line,
    column: col,
  });

  return { tokens, errors };

  function lexNumber(): void {
    const s = startOf();
    while (pos < source.length && RE_DIGIT.test(peek()!)) advance();
    if (peek() === '.' && peek(1) !== undefined && RE_DIGIT.test(peek(1)!)) {
      advance(); // .
      while (pos < source.length && RE_DIGIT.test(peek()!)) advance();
    }
    const text = source.slice(s.start, pos);
    pushToken('NUMBER', text, text, s);
  }

  function lexIdent(): void {
    const s = startOf();
    while (pos < source.length && RE_IDENT_CONT.test(peek()!)) advance();
    const text = source.slice(s.start, pos);
    pushToken('IDENT', text, text, s);
  }

  function lexString(): void {
    // Opening quote
    const openStart = startOf();
    advance(); // consume "
    pushToken('STRING_START', '"', '"', openStart);

    let chunkStart = startOf();
    let chunkText = '';
    let chunkDecoded = '';

    const flushChunk = () => {
      if (chunkText.length === 0) return;
      pushToken('STRING_TEXT', chunkText, chunkDecoded, chunkStart);
      chunkText = '';
      chunkDecoded = '';
    };

    while (pos < source.length) {
      const ch = peek()!;

      if (ch === '"') {
        flushChunk();
        const s = startOf();
        advance();
        pushToken('STRING_END', '"', '"', s);
        return;
      }

      if (ch === '\\') {
        // Escape sequence — emit as part of the current chunk in text,
        // but also as a separate token for highlighting? For simplicity,
        // bake into the chunk but validate the escape.
        const escStart = startOf();
        advance(); // consume backslash
        const next = peek();
        if (next === undefined) {
          pushError('Unterminated escape at end of input', escStart);
          flushChunk();
          // emit synthetic STRING_END so parser recovers
          tokens.push({
            kind: 'STRING_END',
            text: '',
            value: '"',
            start: pos,
            end: pos,
            line,
            column: col,
          });
          return;
        }
        let decoded: string | null = null;
        switch (next) {
          case '"':
            decoded = '"';
            break;
          case '\\':
            decoded = '\\';
            break;
          case '{':
            decoded = '{';
            break;
          case 'n':
            decoded = '\n';
            break;
          case 't':
            decoded = '\t';
            break;
          default:
            decoded = null;
        }
        advance(); // consume the escape character
        if (decoded === null) {
          pushError(`Invalid escape sequence '\\${next}'`, escStart);
          // Still continue; treat as literal pair to not lose data
          chunkText += source.slice(escStart.start, pos);
          chunkDecoded += next;
        } else {
          chunkText += source.slice(escStart.start, pos);
          chunkDecoded += decoded;
        }
        if (chunkText.length && chunkDecoded.length === 0) {
          // keep start of the chunk at first escape
        }
        if (chunkStart.start === pos - (pos - chunkStart.start)) {
          // no-op; chunkStart is correct
        }
        continue;
      }

      if (ch === '{') {
        flushChunk();
        const s = startOf();
        advance();
        pushToken('INTERP_OPEN', '{', '{', s);
        lexInterpExpr();
        chunkStart = startOf();
        continue;
      }

      // Normal char (including newlines — strings are multiline)
      if (chunkText.length === 0) {
        chunkStart = startOf();
      }
      chunkText += ch;
      chunkDecoded += ch;
      advance();
    }

    // Unterminated string
    flushChunk();
    pushError('Unterminated string', openStart);
    tokens.push({
      kind: 'STRING_END',
      text: '',
      value: '"',
      start: pos,
      end: pos,
      line,
      column: col,
    });
  }

  function lexInterpExpr(): void {
    // Emit normal tokens until matching '}' (not inside nested strings — we allow strings inside interp).
    // Track paren depth to be forgiving. Stop at '}' at depth 0.
    let parenDepth = 0;
    while (pos < source.length) {
      const ch = peek()!;
      if (ch === '}' && parenDepth === 0) {
        const s = startOf();
        advance();
        pushToken('INTERP_CLOSE', '}', '}', s);
        return;
      }
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        advance();
        continue;
      }
      if (ch === '\n') {
        const s = startOf();
        advance();
        pushToken('NEWLINE', '\n', '\n', s);
        continue;
      }
      if (ch === '"') {
        lexString();
        continue;
      }
      if (ch === '(') {
        const s = startOf();
        advance();
        pushToken('LPAREN', '(', '(', s);
        parenDepth += 1;
        continue;
      }
      if (ch === ')') {
        const s = startOf();
        advance();
        pushToken('RPAREN', ')', ')', s);
        if (parenDepth > 0) parenDepth -= 1;
        continue;
      }
      if (ch === ',') {
        const s = startOf();
        advance();
        pushToken('COMMA', ',', ',', s);
        continue;
      }
      if (RE_DIGIT.test(ch)) {
        lexNumber();
        continue;
      }
      if (RE_IDENT_START.test(ch)) {
        lexIdent();
        continue;
      }
      // operators (+,-,*,/,==,!=,<,>,<=,>=) — reuse parent loop via inline switch
      const s = startOf();
      switch (ch) {
        case '+':
          advance();
          pushToken('PLUS', '+', '+', s);
          continue;
        case '-':
          advance();
          pushToken('MINUS', '-', '-', s);
          continue;
        case '*':
          advance();
          pushToken('STAR', '*', '*', s);
          continue;
        case '/':
          advance();
          pushToken('SLASH', '/', '/', s);
          continue;
        case '=':
          advance();
          if (peek() === '=') {
            advance();
            pushToken('EQEQ', '==', '==', s);
          } else {
            pushError(`Unexpected '=' inside interpolation`, s);
            pushToken('ERROR', '=', '=', s);
          }
          continue;
        case '!':
          advance();
          if (peek() === '=') {
            advance();
            pushToken('NEQ', '!=', '!=', s);
          } else {
            pushError(`Unexpected '!' inside interpolation`, s);
            pushToken('ERROR', '!', '!', s);
          }
          continue;
        case '<':
          advance();
          if (peek() === '=') {
            advance();
            pushToken('LE', '<=', '<=', s);
          } else {
            pushToken('LT', '<', '<', s);
          }
          continue;
        case '>':
          advance();
          if (peek() === '=') {
            advance();
            pushToken('GE', '>=', '>=', s);
          } else {
            pushToken('GT', '>', '>', s);
          }
          continue;
        default:
          advance();
          pushError(`Unexpected character '${ch}' inside interpolation`, s);
          pushToken('ERROR', ch, ch, s);
          continue;
      }
    }
    // Reached EOF without closing interp
    pushError('Unterminated interpolation', { start: pos, line, col });
  }
}
