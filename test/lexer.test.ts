import { describe, it, expect } from 'vitest';
import { lex } from '../src/lexer.js';

describe('lexer', () => {
  it('tokenizes numbers, operators, identifiers', () => {
    const { tokens, errors } = lex('x = 42 + 3.14');
    expect(errors).toEqual([]);
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).toEqual(['IDENT', 'EQ', 'NUMBER', 'PLUS', 'NUMBER', 'EOF']);
  });

  it('handles comments', () => {
    const { tokens } = lex('// hello\nx = 1');
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).toEqual(['COMMENT', 'NEWLINE', 'IDENT', 'EQ', 'NUMBER', 'EOF']);
  });

  it('lexes strings with interpolation and escapes', () => {
    const { tokens, errors } = lex('"hello {name}\\n\\\"end\\\""');
    expect(errors).toEqual([]);
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).toContain('STRING_START');
    expect(kinds).toContain('STRING_TEXT');
    expect(kinds).toContain('INTERP_OPEN');
    expect(kinds).toContain('INTERP_CLOSE');
    expect(kinds).toContain('STRING_END');
    const text = tokens.find((t) => t.kind === 'STRING_TEXT' && t.value.startsWith('hello '));
    expect(text?.value).toBe('hello ');
  });

  it('rejects bad escape', () => {
    const { errors } = lex('"bad \\q"');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toMatch(/escape/);
  });

  it('supports multi-line strings', () => {
    const { tokens, errors } = lex('"line1\nline2"');
    expect(errors).toEqual([]);
    const text = tokens.find((t) => t.kind === 'STRING_TEXT');
    expect(text?.value).toBe('line1\nline2');
  });

  it('reports unterminated string', () => {
    const { errors } = lex('"oops');
    expect(errors.some((e) => /nterminated/.test(e.message))).toBe(true);
  });

  it('emits two-char operators', () => {
    const { tokens } = lex('a == b != c <= d >= e');
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).toContain('EQEQ');
    expect(kinds).toContain('NEQ');
    expect(kinds).toContain('LE');
    expect(kinds).toContain('GE');
  });
});
