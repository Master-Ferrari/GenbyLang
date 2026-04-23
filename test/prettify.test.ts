import { describe, it, expect } from 'vitest';
import { prettify } from '../src/input-dom/prettify.js';

describe('prettify', () => {
  it('keeps short programs on single lines', () => {
    const src = 'x=1+2\nRETURN(x)';
    expect(prettify(src)).toBe('x = 1 + 2\nRETURN(x)\n');
  });

  it('normalises indentation in nested calls', () => {
    const src = `x=LLM(SONNET,PICK(cond,"a","b"))\nRETURN(x)`;
    expect(prettify(src)).toBe(
      'x = LLM(SONNET, PICK(cond, "a", "b"))\nRETURN(x)\n',
    );
  });

  it('breaks long calls across lines with nested args also broken', () => {
    const src = [
      'x=LLM(SONNET_46, "analyze this input carefully step by step" + "and give a thorough response")',
      'RETURN(x)',
    ].join('\n');
    const out = prettify(src, { maxWidth: 40 });
    // The outer LLM(...) must break; the long string concat stays as one
    // arg (strings can't be further broken).
    expect(out.split('\n')[0]).toBe('x = LLM(');
    expect(out).toMatch(/^  SONNET_46,$/m);
    expect(out.trim().endsWith(')')).toBe(true);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('recursively breaks nested calls when they overflow', () => {
    const src = [
      'x=FOO(ARG1, ARG2, BAR(LONGARGNAME1, LONGARGNAME2, LONGARGNAME3))',
      'RETURN(x)',
    ].join('\n');
    const out = prettify(src, { maxWidth: 30 });
    // Outer FOO broken.
    expect(out).toMatch(/^x = FOO\($/m);
    // Inner BAR also broken because it still doesn't fit on a line at
    // 2-space indent.
    expect(out).toMatch(/^\s{2}BAR\($/m);
    expect(out).toMatch(/^\s{4}LONGARGNAME1,$/m);
  });

  it('keeps directives directly above statements when source had no gap', () => {
    const src = `@NAME("demo") x=1 RETURN(x)`;
    expect(prettify(src)).toBe('@NAME("demo")\nx = 1\nRETURN(x)\n');
  });

  it('preserves a blank line the user put between directive and body', () => {
    const src = `@NAME("demo")\n\nx=1\nRETURN(x)`;
    expect(prettify(src)).toBe('@NAME("demo")\n\nx = 1\nRETURN(x)\n');
  });

  it('preserves blank lines between top-level statements', () => {
    const src = 'x = 1\n\n\ny = 2\nRETURN(x + y)';
    expect(prettify(src)).toBe('x = 1\n\n\ny = 2\nRETURN(x + y)\n');
  });

  it('preserves own-line comments between top-level statements', () => {
    const src = '// greeting\nx = "hi"\n// and a farewell\ny = "bye"\nRETURN(x + y)';
    expect(prettify(src)).toBe(
      '// greeting\nx = "hi"\n// and a farewell\ny = "bye"\nRETURN(x + y)\n',
    );
  });

  it('preserves trailing comments on the same line as a statement', () => {
    const src = 'x = 1 // inline note\nRETURN(x)';
    expect(prettify(src)).toBe('x = 1  // inline note\nRETURN(x)\n');
  });

  it('preserves comments and blank lines inside a block', () => {
    const src = [
      'foo(x) = (',
      '  // step 1',
      '  a = x + 1',
      '',
      '  // step 2',
      '  a * 2',
      ')',
      'RETURN(foo(5))',
    ].join('\n');
    const out = prettify(src);
    expect(out).toMatch(/^  \/\/ step 1$/m);
    expect(out).toMatch(/^  a = x \+ 1$/m);
    expect(out).toMatch(/^  \/\/ step 2$/m);
    expect(out).toMatch(/^  a \* 2$/m);
    // The blank line between the two steps must survive.
    expect(out).toContain('  a = x + 1\n\n  // step 2');
  });

  it('preserves comments between call arguments in a multi-line call', () => {
    const src = [
      'x = LLM(',
      '  SONNET_46,',
      '  // the actual prompt',
      '  "do a thing"',
      ')',
      'RETURN(x)',
    ].join('\n');
    const out = prettify(src);
    expect(out).toMatch(/^  \/\/ the actual prompt$/m);
    expect(out).toMatch(/^  SONNET_46,$/m);
    expect(out).toMatch(/^  "do a thing"$/m);
  });

  it('keeps a trailing comment on a call argument attached to that argument', () => {
    const src = [
      'x = LLM(',
      '  SONNET_46, // which model',
      '  "prompt"',
      ')',
      'RETURN(x)',
    ].join('\n');
    const out = prettify(src);
    expect(out).toMatch(/^  SONNET_46,  \/\/ which model$/m);
  });

  it('forces multi-line form when a short call has an internal comment', () => {
    const src = [
      'x = FOO(',
      '  // pick carefully',
      '  a, b, c',
      ')',
      'RETURN(x)',
    ].join('\n');
    const out = prettify(src);
    // Must not collapse into `FOO(a, b, c)` — the comment would be lost.
    expect(out).toMatch(/^x = FOO\($/m);
    expect(out).toMatch(/^  \/\/ pick carefully$/m);
  });

  it('keeps a leading comment above the first statement', () => {
    const src = '// top-level note\n\nx = 1\nRETURN(x)';
    expect(prettify(src)).toBe('// top-level note\n\nx = 1\nRETURN(x)\n');
  });

  it('preserves operator precedence when re-printing binary expressions', () => {
    const src = 'x = (1 + 2) * 3\nRETURN(x)';
    expect(prettify(src)).toBe('x = (1 + 2) * 3\nRETURN(x)\n');
  });

  it('drops redundant parens around single expressions', () => {
    // Parser already unwraps `(expr)` so prettifier won't re-add parens.
    const src = 'x = (1 + 2)\nRETURN(x)';
    expect(prettify(src)).toBe('x = 1 + 2\nRETURN(x)\n');
  });

  it('formats user-defined function bodies as blocks', () => {
    const src = `foo(a,b)=(t=a+b t*2) x=foo(1,2) RETURN(x)`;
    const out = prettify(src);
    expect(out).toContain('foo(a, b) = (');
    expect(out).toMatch(/^  t = a \+ b$/m);
    expect(out).toMatch(/^  t \* 2$/m);
    expect(out).toMatch(/^\)$/m);
    expect(out).toContain('x = foo(1, 2)');
    expect(out.endsWith('\nRETURN(x)\n')).toBe(true);
  });

  it('keeps small blocks inline when they fit', () => {
    const src = 'foo(x) = (x + 1)\nRETURN(foo(5))';
    expect(prettify(src)).toBe('foo(x) = (x + 1)\nRETURN(foo(5))\n');
  });

  it('returns source untouched when there are syntax errors', () => {
    const src = 'x = \nRETURN(';
    expect(prettify(src)).toBe(src);
  });

  it('preserves string literals verbatim including escapes and newlines', () => {
    const src = 'x = "hello {name}\\n"\nRETURN(x)';
    expect(prettify(src)).toBe('x = "hello {name}\\n"\nRETURN(x)\n');
  });

  it('handles multi-line strings inside call args', () => {
    const src = [
      'x = LLM(SONNET, "line one',
      'line two")',
      'RETURN(x)',
    ].join('\n');
    const out = prettify(src);
    // The multi-line string arg forces a multi-line call layout.
    expect(out).toMatch(/^x = LLM\($/m);
    expect(out).toContain('"line one\nline two"');
  });

  it('breaks at statement boundaries when separated only by spaces', () => {
    // Exercises the relaxed grammar: top-level statements on one line.
    const src = 'x = 1 y = 2 RETURN(x + y)';
    expect(prettify(src)).toBe('x = 1\ny = 2\nRETURN(x + y)\n');
  });

  it('handles unary minus with a parenthesised binary operand', () => {
    const src = 'x = -(1 + 2)\nRETURN(x)';
    expect(prettify(src)).toBe('x = -(1 + 2)\nRETURN(x)\n');
  });

  it('emits empty program as empty output', () => {
    expect(prettify('')).toBe('');
  });
});
