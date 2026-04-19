import { describe, it, expect } from 'vitest';
import { Genby, STR, NUM, BUL, ENUM } from '../src/index.js';

function buildMachine() {
  const g = new Genby();
  g.addEnum('MODEL', ['HAIKU_45', 'SONNET_46']);
  g.addEnum('LANGUAGE', ['auto', 'en', 'ru']);
  g.addEnum('KEY', ['CTRL', 'SHIFT', 'ALT', 'F2']);

  g.addDirective({
    name: 'NAME',
    args: [{ name: 'title', type: STR }],
    handler: () => {},
  });
  g.addDirective({
    name: 'HOTKEY',
    args: [
      { name: 'key', type: ENUM, enumKey: 'KEY', rest: true },
    ],
    handler: () => {},
  });

  g.addVariable({ name: 'INPUTTEXT', type: STR });
  g.addVariable({ name: 'LANG1', type: ENUM, enumKey: 'LANGUAGE' });
  g.addVariable({ name: 'LANG2', type: ENUM, enumKey: 'LANGUAGE' });

  g.addFunction({
    name: 'LEN',
    args: [{ name: 's', type: STR }],
    returns: NUM,
    handler: ([s]) => (s as string).length,
  });
  g.addFunction({
    name: 'LOG',
    args: [
      { name: 'label', type: STR },
      { name: 'model', type: ENUM, enumKey: 'MODEL' },
    ],
    returns: 'VOID',
    handler: () => {},
  });
  g.addFunction({
    name: 'LLM',
    args: [
      { name: 'model', type: ENUM, enumKey: 'MODEL' },
      { name: 'prompt', type: STR },
    ],
    returns: STR,
    handler: ([_model, prompt]) => `out:${prompt}`,
  });

  return g.build();
}

describe('end-to-end', () => {
  it('executes the spec example', async () => {
    const m = buildMachine();
    const source = `@HOTKEY(CTRL, SHIFT, F2)
@NAME("Translate selection")

warnLimit = 3000
inputLen = LEN(INPUTTEXT)
isLong = inputLen > warnLimit

languageNote = IF_THEN_ELSE(LANG1 == auto, "", " from {LANG1}")

lengthNote = IF_THEN_ELSE(isLong, " long ({inputLen} chars)", "")

prompt = "Translate{languageNote} to {LANG2}.{lengthNote}"

model = IF_THEN_ELSE(inputLen < 300, HAIKU_45, SONNET_46)
LOG("run", model)
out = LLM(model, prompt)
RETURN(out)
`;
    const check = m.check(source);
    expect(check.errors).toEqual([]);
    expect(check.ok).toBe(true);
    const result = await m.execute(source, {
      INPUTTEXT: 'hello world',
      LANG1: { __enum: true, enumKey: 'LANGUAGE', name: 'en' },
      LANG2: { __enum: true, enumKey: 'LANGUAGE', name: 'ru' },
    });
    expect(result).toContain('Translate from en to ru');
    expect(result).toContain('out:');
  });

  it('reports type errors', () => {
    const m = buildMachine();
    const check = m.check('x = "a" + 1\nRETURN(x)');
    expect(check.ok).toBe(false);
    expect(check.errors.some((e) => e.kind === 'type')).toBe(true);
  });

  it('reports missing RETURN', () => {
    const m = buildMachine();
    const check = m.check('x = 1\n');
    expect(check.ok).toBe(false);
    expect(check.errors.some((e) => e.kind === 'missing_return')).toBe(true);
  });

  it('reports unknown identifier', () => {
    const m = buildMachine();
    const check = m.check('RETURN(unknown_thing)');
    expect(check.ok).toBe(false);
    expect(check.errors.some((e) => e.kind === 'unknown_identifier')).toBe(
      true,
    );
  });

  it('reports reserved name on assignment', () => {
    const m = buildMachine();
    const check = m.check('LEN = 1\nRETURN(LEN)');
    expect(check.errors.some((e) => e.kind === 'reserved_name')).toBe(true);
  });

  it('runtime: division by zero', async () => {
    const m = buildMachine();
    await expect(
      m.execute('x = 1 / 0\nRETURN(x)', { INPUTTEXT: '', LANG1: { __enum: true, enumKey: 'LANGUAGE', name: 'en' }, LANG2: { __enum: true, enumKey: 'LANGUAGE', name: 'ru' } }),
    ).rejects.toThrow(/Division/);
  });

  it('IF_THEN_ELSE is lazy', async () => {
    const g = new Genby();
    let calls = 0;
    g.addFunction({
      name: 'BOOM',
      args: [],
      returns: STR,
      handler: () => {
        calls += 1;
        throw new Error('should not be called');
      },
    });
    g.addFunction({
      name: 'OK',
      args: [],
      returns: STR,
      handler: () => 'ok',
    });
    const m = g.build();
    const result = await m.execute(
      'x = IF_THEN_ELSE(1 < 2, OK(), BOOM())\nRETURN(x)',
      {},
    );
    expect(result).toBe('ok');
    expect(calls).toBe(0);
  });

  it('number interpolation renders as text', async () => {
    const g = new Genby();
    const m = g.build();
    const result = await m.execute('x = "n={42}"\nRETURN(x)', {});
    expect(result).toBe('n=42');
  });

  it('enum interpolation renders as name', async () => {
    const g = new Genby();
    g.addEnum('MODE', ['FAST', 'SLOW']);
    const m = g.build();
    const result = await m.execute('x = "m={FAST}"\nRETURN(x)', {});
    expect(result).toBe('m=FAST');
  });

  it('void function cannot be assigned', () => {
    const g = new Genby();
    g.addFunction({
      name: 'NOOP',
      args: [],
      returns: 'VOID',
      handler: () => {},
    });
    const m = g.build();
    const check = m.check('x = NOOP()\nRETURN(x)');
    expect(check.ok).toBe(false);
    expect(check.errors.some((e) => e.kind === 'type')).toBe(true);
  });

  it('variadic args are accepted', () => {
    const g = new Genby();
    g.addFunction({
      name: 'CONCAT',
      args: [{ name: 'parts', type: STR, rest: true }],
      returns: STR,
      handler: (parts) => parts.map((p) => String(p)).join(''),
    });
    const m = g.build();
    const check = m.check('x = CONCAT("a", "b", "c")\nRETURN(x)');
    expect(check.ok).toBe(true);
  });

  it('required directive missing is reported', () => {
    const g = new Genby();
    g.addDirective({
      name: 'NAME',
      required: true,
      args: [{ name: 't', type: STR }],
      handler: () => {},
    });
    const m = g.build();
    const check = m.check('RETURN("x")');
    expect(check.errors.some((e) => /Required directive/.test(e.message))).toBe(
      true,
    );
  });

  it('BUL type emerges only from comparisons', async () => {
    const g = new Genby();
    g.addFunction({
      name: 'GATE',
      args: [{ name: 'b', type: BUL }],
      returns: STR,
      handler: ([b]) => (b ? 'yes' : 'no'),
    });
    const m = g.build();
    const src = 'x = GATE(1 < 2)\nRETURN(x)';
    const check = m.check(src);
    expect(check.ok).toBe(true);
    const result = await m.execute(src, {});
    expect(result).toBe('yes');
  });
});
