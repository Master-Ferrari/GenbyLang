import { describe, it, expect } from 'vitest';
import { Genby, STR, NUM } from '../src/index.js';

function buildArrMachine() {
  const g = new Genby();
  g.addType('ARR', {
    describe: 'Immutable string array.',
    stringify: (v) => JSON.stringify(v),
  });
  g.addFunction({
    name: 'SPLIT',
    args: [
      { name: 's', type: STR },
      { name: 'sep', type: STR },
    ],
    returns: 'ARR',
    handler: async ([s, sep]) => (await s.calc()).split(await sep.calc()),
  });
  g.addFunction({
    name: 'JOIN',
    args: [
      { name: 'arr', type: 'ARR' },
      { name: 'sep', type: STR },
    ],
    returns: STR,
    handler: async ([arr, sep]) =>
      ((await arr.calc()) as string[]).join(await sep.calc()),
  });
  g.addFunction({
    name: 'SIZE',
    args: [{ name: 'arr', type: 'ARR' }],
    returns: NUM,
    handler: async ([arr]) => ((await arr.calc()) as unknown[]).length,
  });
  return g.build();
}

describe('custom types', () => {
  it('function returning a custom type assigns to a local and flows back', async () => {
    const m = buildArrMachine();
    const src = `arr = SPLIT("a,b,c", ",")
out = JOIN(arr, "-")
RETURN(out)`;
    expect(m.check(src).errors).toEqual([]);
    const result = await m.execute(src, {});
    expect(result).toBe('a-b-c');
  });

  it('reassigning a custom-typed local with another type is an error', () => {
    const m = buildArrMachine();
    const check = m.check(`arr = SPLIT("a,b", ",")
arr = 42
RETURN(arr)`);
    expect(check.ok).toBe(false);
    expect(check.errors.some((e) => e.kind === 'type')).toBe(true);
  });

  it('interpolation uses the type stringify hook', async () => {
    const m = buildArrMachine();
    const src = `arr = SPLIT("a,b,c", ",")
out = "got {arr}"
RETURN(out)`;
    const result = await m.execute(src, {});
    expect(result).toBe('got ["a","b","c"]');
  });

  it('interpolation without stringify falls back to String(value)', async () => {
    const g = new Genby();
    g.addType('BOX');
    g.addFunction({
      name: 'BOX',
      args: [{ name: 'v', type: STR }],
      returns: 'BOX',
      handler: async ([v]) => {
        const inner = await v.calc();
        return { toString: () => `BOX(${inner})` };
      },
    });
    const m = g.build();
    const result = await m.execute(`b = BOX("x")
RETURN("wrap {b}")`, {});
    expect(result).toBe('wrap BOX(x)');
  });

  it('+ on custom types is a type error', () => {
    const m = buildArrMachine();
    const check = m.check(`arr = SPLIT("a", ",")
bad = arr + "x"
RETURN(bad)`);
    expect(check.ok).toBe(false);
    expect(check.errors.some((e) => e.kind === 'type' && /requires STR\+STR/.test(e.message))).toBe(true);
  });

  it('== between two values of the same custom type is allowed at check time', () => {
    const m = buildArrMachine();
    const check = m.check(`a = SPLIT("x", ",")
b = SPLIT("y", ",")
flag = a == b
RETURN(flag)`);
    expect(check.ok).toBe(true);
  });

  it('== between a custom type and STR is a type error', () => {
    const m = buildArrMachine();
    const check = m.check(`arr = SPLIT("a", ",")
flag = arr == "x"
RETURN(flag)`);
    expect(check.ok).toBe(false);
    expect(check.errors.some((e) => e.kind === 'type')).toBe(true);
  });

  it('== between two custom values uses reference equality at runtime', async () => {
    const g = new Genby();
    g.addType('REF');
    const shared: unknown[] = [];
    g.addFunction({
      name: 'SAME',
      args: [],
      returns: 'REF',
      handler: () => shared,
    });
    g.addFunction({
      name: 'FRESH',
      args: [],
      returns: 'REF',
      handler: () => [],
    });
    const m = g.build();
    const eqSame = await m.execute('RETURN(SAME() == SAME())', {});
    const eqDifferent = await m.execute('RETURN(FRESH() == FRESH())', {});
    expect(eqSame).toBe(true);
    expect(eqDifferent).toBe(false);
  });

  it('addType rejects built-in names and duplicates', () => {
    const g = new Genby();
    expect(() => g.addType('STR')).toThrow(/built-in/);
    expect(() => g.addType('VOID')).toThrow(/reserved/);
    g.addType('ARR');
    expect(() => g.addType('ARR')).toThrow(/already registered/);
    expect(() => g.addType('1bad')).toThrow(/Invalid type name/);
  });

  it('build() rejects functions referencing unregistered types', () => {
    const g = new Genby();
    g.addFunction({
      name: 'SPLIT',
      args: [{ name: 's', type: STR }],
      returns: 'ARR',
      handler: () => [],
    });
    expect(() => g.build()).toThrow(/unknown type 'ARR'/);
  });

  it('addType + addFunction order is free — build() resolves later', () => {
    const g = new Genby();
    g.addFunction({
      name: 'SPLIT',
      args: [{ name: 's', type: STR }],
      returns: 'ARR',
      handler: () => [],
    });
    g.addType('ARR');
    expect(() => g.build()).not.toThrow();
  });

  it('custom-typed external variable flows through', async () => {
    const g = new Genby();
    g.addType('ARR', { stringify: (v) => JSON.stringify(v) });
    g.addVariable({ name: 'ITEMS', type: 'ARR' });
    g.addFunction({
      name: 'SIZE',
      args: [{ name: 'a', type: 'ARR' }],
      returns: NUM,
      handler: async ([a]) => ((await a.calc()) as unknown[]).length,
    });
    const m = g.build();
    const src = `n = SIZE(ITEMS)
RETURN("count={n} src={ITEMS}")`;
    const result = await m.execute(src, { ITEMS: ['x', 'y', 'z'] });
    expect(result).toBe('count=3 src=["x","y","z"]');
  });

  it('docs output includes a Types section listing custom types', () => {
    const m = buildArrMachine();
    const md = m.docs();
    expect(md).toContain('## Types');
    expect(md).toContain('`ARR`');
    expect(md).toContain('Immutable string array.');
  });
});
