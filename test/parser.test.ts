import { describe, it, expect } from 'vitest';
import { lex } from '../src/lexer.js';
import { parse } from '../src/parser.js';

function parseSrc(src: string) {
  const { tokens, errors: lexErrs } = lex(src);
  const { program, errors } = parse(tokens);
  return { program, errors: [...lexErrs, ...errors] };
}

describe('parser', () => {
  it('parses assignment and RETURN', () => {
    const { program, errors } = parseSrc('x = 1\nRETURN(x)');
    expect(errors).toEqual([]);
    expect(program.statements.length).toBe(1);
    expect(program.statements[0]!.kind).toBe('Assign');
    expect(program.returnStmt).not.toBeNull();
  });

  it('rejects program without RETURN at parse layer only when missing args', () => {
    const { errors } = parseSrc('RETURN()');
    // RETURN with 0 args is a syntax error
    expect(errors.some((e) => /RETURN/.test(e.message))).toBe(true);
  });

  it('respects operator precedence', () => {
    const { program, errors } = parseSrc('x = 1 + 2 * 3\nRETURN(x)');
    expect(errors).toEqual([]);
    const assign = program.statements[0]!;
    if (assign.kind !== 'Assign') throw new Error('expected assign');
    expect(assign.value.kind).toBe('Binary');
    if (assign.value.kind !== 'Binary') throw new Error();
    expect(assign.value.op).toBe('+');
    expect(assign.value.right.kind).toBe('Binary');
  });

  it('parses directives before statements', () => {
    const src = '@NAME("hi")\nx = 1\nRETURN(x)';
    const { program, errors } = parseSrc(src);
    expect(errors).toEqual([]);
    expect(program.directives.length).toBe(1);
    expect(program.directives[0]!.name).toBe('NAME');
  });

  it('errors on directive after statement', () => {
    const { errors } = parseSrc('x = 1\n@NAME("hi")\nRETURN(x)');
    expect(errors.some((e) => /Directive/.test(e.message))).toBe(true);
  });

  it('supports multiline calls', () => {
    const src = 'x = IF_THEN_ELSE(\n  1 < 2\n  , "a"\n  , "b")\nRETURN(x)';
    const { errors } = parseSrc(src);
    expect(errors).toEqual([]);
  });

  it('parses string interpolation', () => {
    const src = 'x = "hello {who}"\nRETURN(x)';
    const { program, errors } = parseSrc(src);
    expect(errors).toEqual([]);
    const assign = program.statements[0]!;
    if (assign.kind !== 'Assign') throw new Error();
    if (assign.value.kind !== 'StringLit') throw new Error();
    expect(assign.value.parts.length).toBe(2);
    expect(assign.value.parts[0]!.kind).toBe('text');
    expect(assign.value.parts[1]!.kind).toBe('expr');
  });
});
