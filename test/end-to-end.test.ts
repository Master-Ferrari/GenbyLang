import { describe, it, expect } from 'vitest';
import { Genby, STR, NUM, BUL, ENUM, ANY } from '../src/index.js';

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
    handler: async ([s]) => (await s.calc()).length,
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
      handler: async ([_model, prompt]) => `out:${await prompt.calc()}`,
  });

  return g.build();
}

describe('end-to-end', () => {
  it('executes the spec example', async () => {
    const m = buildMachine();
    const source = `@HOTKEY(CTRL, SHIFT, F2)
@NAME("Translate selection")

inputLen = LEN(INPUTTEXT)

languageNote = " from {LANG1}"
prompt = "Translate{languageNote} to {LANG2}. ({inputLen} chars)"

model = HAIKU_45
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
      handler: async ([parts]) =>
        (await Promise.all(parts.map((p) => p.calc()))).join(''),
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
      handler: async ([b]) => ((await b.calc()) ? 'yes' : 'no'),
    });
    const m = g.build();
    const src = 'x = GATE(1 < 2)\nRETURN(x)';
    const check = m.check(src);
    expect(check.ok).toBe(true);
    const result = await m.execute(src, {});
    expect(result).toBe('yes');
  });

  describe('setReturnType', () => {
    it('accepts a RETURN expression that matches the required type', async () => {
      const g = new Genby().setReturnType(STR);
      const m = g.build();
      const src = 'RETURN("hello")';
      const check = m.check(src);
      expect(check.ok).toBe(true);
      const result = await m.execute(src);
      expect(result).toBe('hello');
    });

    it('rejects a RETURN expression with the wrong type', () => {
      const g = new Genby().setReturnType(STR);
      const m = g.build();
      const check = m.check('RETURN(42)');
      expect(check.ok).toBe(false);
      expect(
        check.errors.some(
          (e) => e.kind === 'type' && /RETURN expects STR/.test(e.message),
        ),
      ).toBe(true);
    });

    it('supports ENUM with enumKey', async () => {
      const g = new Genby()
        .addEnum('MODE', ['FAST', 'SLOW'])
        .setReturnType(ENUM, { enumKey: 'MODE' });
      const m = g.build();
      expect(m.check('RETURN(FAST)').ok).toBe(true);
      const wrong = m.check('RETURN(1)');
      expect(wrong.ok).toBe(false);
      expect(
        wrong.errors.some(
          (e) => e.kind === 'type' && /RETURN expects ENUM<MODE>/.test(e.message),
        ),
      ).toBe(true);
    });

    it('rejects an ENUM return from a different enum key', () => {
      const g = new Genby()
        .addEnum('MODE', ['FAST', 'SLOW'])
        .addEnum('STATE', ['ON', 'OFF'])
        .setReturnType(ENUM, { enumKey: 'MODE' });
      const m = g.build();
      const res = m.check('RETURN(ON)');
      expect(res.ok).toBe(false);
      expect(
        res.errors.some(
          (e) => e.kind === 'type' && /ENUM<MODE>/.test(e.message) && /ENUM<STATE>/.test(e.message),
        ),
      ).toBe(true);
    });

    it('ANY required return type accepts anything', () => {
      const g = new Genby().setReturnType(ANY);
      const m = g.build();
      expect(m.check('RETURN(1)').ok).toBe(true);
      expect(m.check('RETURN("x")').ok).toBe(true);
    });

    it('supports custom types', async () => {
      const g = new Genby()
        .addType('BLOB', { stringify: (v) => `blob:${(v as { id: string }).id}` })
        .addFunction({
          name: 'MAKE_BLOB',
          args: [{ name: 'id', type: STR }],
          returns: 'BLOB',
          handler: async ([id]) => ({ id: await id.calc() }),
        })
        .setReturnType('BLOB');
      const m = g.build();
      const ok = m.check('b = MAKE_BLOB("x")\nRETURN(b)');
      expect(ok.ok).toBe(true);
      const bad = m.check('RETURN("plain")');
      expect(bad.ok).toBe(false);
      expect(
        bad.errors.some(
          (e) => e.kind === 'type' && /RETURN expects BLOB/.test(e.message),
        ),
      ).toBe(true);
      const result = (await m.execute('b = MAKE_BLOB("x")\nRETURN(b)')) as {
        id: string;
      };
      expect(result.id).toBe('x');
    });

    it('throws on ENUM without enumKey', () => {
      expect(() => new Genby().setReturnType(ENUM)).toThrow(
        /requires an 'enumKey'/,
      );
    });

    it('throws on VOID', () => {
      expect(() => new Genby().setReturnType('VOID' as never)).toThrow(
        /VOID/,
      );
    });

    it('throws when set more than once', () => {
      const g = new Genby().setReturnType(STR);
      expect(() => g.setReturnType(NUM)).toThrow(/already set/);
    });

    it('throws at build() when referencing an unregistered type', () => {
      const g = new Genby().setReturnType('GHOST');
      expect(() => g.build()).toThrow(/Program RETURN type references unknown type 'GHOST'/);
    });

    it('throws at build() when referencing an unknown enum', () => {
      const g = new Genby().setReturnType(ENUM, { enumKey: 'NOPE' });
      expect(() => g.build()).toThrow(/unknown enum 'NOPE'/);
    });

    it('execute rejects mismatched return', async () => {
      const g = new Genby().setReturnType(STR);
      const m = g.build();
      await expect(m.execute('RETURN(1)')).rejects.toThrow(/RETURN expects STR/);
    });
  });
});
