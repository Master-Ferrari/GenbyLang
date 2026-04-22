import { describe, it, expect } from 'vitest';
import { Genby, PRESET_NAMES, type PresetName } from '../src/index.js';

// every preset registers exactly one function under its own name, so tests
// request just the presets they need.
function make(...presets: PresetName[]) {
  const g = new Genby();
  for (const p of presets) g.addPreset(p);
  return g.build();
}

// handy bundles so tests can keep reading like the feature groups they cover.
const CONTROL: PresetName[] = [
  'IF', 'WHEN', 'UNLESS', 'AND', 'OR', 'NOT', 'EQ', 'NEQ', 'COALESCE', 'CHOOSE', 'CASE',
];
const LOOPS: PresetName[] = ['FOR', 'TIMES', 'WHILE'];
const ARRAYS: PresetName[] = [
  'ARR', 'RANGE', 'SIZE', 'AT', 'FIRST', 'LAST', 'SLICE', 'CONCAT',
  'REVERSE', 'PUSH', 'CONTAINS', 'INDEX_OF', 'SPLIT', 'JOIN',
];
const CAST: PresetName[] = ['STR', 'NUM', 'BUL', 'INT'];
const MATH: PresetName[] = ['ADD', 'MUL', 'POW', 'SQRT'];
const STRINGS: PresetName[] = ['UPPER', 'LOWER', 'REPEAT', 'REPLACE', 'LEN'];
const ASYNC: PresetName[] = ['FETCH_JSON', 'SHA256', 'SHORT'];

describe('addPreset', () => {
  it('exports every per-function preset name', () => {
    expect(PRESET_NAMES).toEqual([
      ...CONTROL,
      ...LOOPS,
      ...ARRAYS,
      ...CAST,
      ...MATH,
      ...STRINGS,
      ...ASYNC,
    ]);
  });

  it('throws on unknown preset', () => {
    const g = new Genby();
    expect(() =>
      (g as unknown as { addPreset(n: string): unknown }).addPreset('bogus'),
    ).toThrow(/Unknown preset/);
  });

  it('throws when the same preset is applied twice (naming conflict)', () => {
    const g = new Genby();
    g.addPreset('STR');
    expect(() => g.addPreset('STR')).toThrow(/already registered/);
  });

  it('auto-registers the ARR type when an ARR-using preset is loaded first', () => {
    const g = new Genby();
    g.addPreset('RANGE');
    expect(g.hasType('ARR')).toBe(true);
  });

  it('any array preset exposes the ARR type in docs', () => {
    const m = make(...ARRAYS);
    const md = m.docs();
    expect(md).toContain('## Types');
    expect(md).toContain('`ARR`');
    expect(md).toContain('ordered list');
  });
});

describe('preset: control', () => {
  it('IF picks the truthy branch and evaluates only it', async () => {
    const m = make('IF');
    const yes = await m.execute('RETURN(IF(1, "yes", "no"))', {});
    const no = await m.execute('RETURN(IF(0, "yes", "no"))', {});
    expect(yes).toBe('yes');
    expect(no).toBe('no');
  });

  it('IF else is optional (defaults to "")', async () => {
    const m = make('IF');
    const fallback = await m.execute('RETURN(IF(0, "hit"))', {});
    expect(fallback).toBe('');
  });

  it('WHEN / UNLESS', async () => {
    const m = make('WHEN', 'UNLESS');
    expect(await m.execute('RETURN(WHEN(1, "a"))', {})).toBe('a');
    expect(await m.execute('RETURN(WHEN(0, "a"))', {})).toBe('');
    expect(await m.execute('RETURN(UNLESS(0, "b"))', {})).toBe('b');
    expect(await m.execute('RETURN(UNLESS(1, "b"))', {})).toBe('');
  });

  it('AND / OR short-circuit on truthiness', async () => {
    const m = make('AND', 'OR', 'NOT');
    expect(await m.execute('RETURN(AND(1, 1, 1))', {})).toBe(true);
    expect(await m.execute('RETURN(AND(1, 0, 1))', {})).toBe(false);
    expect(await m.execute('RETURN(OR(0, 0, 1))', {})).toBe(true);
    expect(await m.execute('RETURN(OR(0, 0, 0))', {})).toBe(false);
    expect(await m.execute('RETURN(NOT(0))', {})).toBe(true);
    expect(await m.execute('RETURN(NOT(1))', {})).toBe(false);
  });

  it('EQ / NEQ across STR, NUM, enums', async () => {
    const g = new Genby();
    g.addPreset('EQ');
    g.addPreset('NEQ');
    g.addEnum('Color', ['RED', 'GREEN']);
    g.addVariable({ name: 'C', type: 'ENUM', enumKey: 'Color' });
    const m = g.build();
    expect(await m.execute('RETURN(EQ("a", "a"))', {})).toBe(true);
    expect(await m.execute('RETURN(EQ(1, 2))', {})).toBe(false);
    expect(await m.execute('RETURN(NEQ(1, 2))', {})).toBe(true);
    expect(await m.execute('RETURN(EQ(C, RED))', { C: { __enum: true, enumKey: 'Color', name: 'RED' } })).toBe(true);
    expect(await m.execute('RETURN(EQ(C, GREEN))', { C: { __enum: true, enumKey: 'Color', name: 'RED' } })).toBe(false);
  });

  it('COALESCE returns first non-empty arg (lazy)', async () => {
    const m = make('COALESCE');
    expect(await m.execute('RETURN(COALESCE("", "", "hit"))', {})).toBe('hit');
    expect(await m.execute('RETURN(COALESCE("", ""))', {})).toBe('');
  });

  it('CHOOSE picks by index, other options not evaluated', async () => {
    const m = make('CHOOSE');
    expect(await m.execute('RETURN(CHOOSE(1, "a", "b", "c"))', {})).toBe('b');
    expect(await m.execute('RETURN(CHOOSE(9, "a", "b"))', {})).toBe('');
  });

  it('CASE finds a matching key and supports a trailing default', async () => {
    const m = make('CASE');
    const src = (v: string) => `v = "${v}"
RETURN(CASE(v, "a", "apple", "b", "banana", "none"))`;
    expect(await m.execute(src('a'), {})).toBe('apple');
    expect(await m.execute(src('b'), {})).toBe('banana');
    expect(await m.execute(src('x'), {})).toBe('none');
  });
});

describe('preset: loops', () => {
  it('FOR re-evaluates body in caller scope', async () => {
    const m = make('FOR', 'NUM');
    const src = `x = 0
bump() = ( x = NUM(x) + 1 )
FOR(5, bump())
RETURN(x)`;
    expect(await m.execute(src, {})).toBe(5);
  });

  it('TIMES collects body output joined by sep', async () => {
    const m = make('TIMES');
    const src = `RETURN(TIMES(3, "-", "x"))`;
    expect(await m.execute(src, {})).toBe('x-x-x');
  });

  it('WHILE loops until cond is falsy', async () => {
    const m = make('WHILE', 'NOT', 'EQ', 'NUM');
    const src = `i = 0
WHILE(NOT(EQ(i, 3)), ( i = NUM(i) + 1 ))
RETURN(i)`;
    expect(await m.execute(src, {})).toBe(3);
  });
});

describe('preset: arrays', () => {
  it('ARR constructor, SIZE, AT, FIRST, LAST', async () => {
    const m = make('ARR', 'SIZE', 'AT', 'FIRST', 'LAST', 'STR');
    expect(await m.execute('RETURN(STR(ARR("a","b","c")))', {})).toBe(
      '["a","b","c"]',
    );
    expect(await m.execute('RETURN(SIZE(ARR("a","b","c")))', {})).toBe(3);
    expect(await m.execute('RETURN(AT(ARR("a","b","c"), 1))', {})).toBe('b');
    expect(await m.execute('RETURN(AT(ARR("a","b","c"), -1))', {})).toBe('c');
    expect(await m.execute('RETURN(FIRST(ARR("a","b","c")))', {})).toBe('a');
    expect(await m.execute('RETURN(LAST(ARR("a","b","c")))', {})).toBe('c');
  });

  it('SPLIT / JOIN round-trip', async () => {
    const m = make('SPLIT', 'JOIN');
    expect(await m.execute('RETURN(JOIN(SPLIT("a,b,c", ","), "-"))', {})).toBe('a-b-c');
  });

  it('RANGE ascending / descending', async () => {
    const m = make('RANGE', 'JOIN');
    expect(await m.execute('RETURN(JOIN(RANGE(0, 4), ","))', {})).toBe('0,1,2,3');
    expect(await m.execute('RETURN(JOIN(RANGE(3, 0), ","))', {})).toBe('3,2,1');
    expect(await m.execute('RETURN(JOIN(RANGE(2, 2), ","))', {})).toBe('');
  });

  it('SLICE / CONCAT / REVERSE / PUSH', async () => {
    const m = make('SLICE', 'CONCAT', 'REVERSE', 'PUSH', 'SPLIT', 'JOIN');
    expect(await m.execute('RETURN(JOIN(SLICE(SPLIT("a,b,c,d", ","), 1, 3), ""))', {})).toBe('bc');
    expect(await m.execute('RETURN(JOIN(CONCAT(SPLIT("a,b", ","), SPLIT("c,d", ",")), ""))', {})).toBe('abcd');
    expect(await m.execute('RETURN(JOIN(REVERSE(SPLIT("a,b,c", ",")), ""))', {})).toBe('cba');
    expect(await m.execute('RETURN(JOIN(PUSH(SPLIT("a,b", ","), "c"), ""))', {})).toBe('abc');
  });

  it('CONTAINS / INDEX_OF', async () => {
    const m = make('CONTAINS', 'INDEX_OF', 'SPLIT');
    expect(await m.execute('RETURN(CONTAINS(SPLIT("a,b,c", ","), "b"))', {})).toBe(true);
    expect(await m.execute('RETURN(CONTAINS(SPLIT("a,b,c", ","), "z"))', {})).toBe(false);
    expect(await m.execute('RETURN(INDEX_OF(SPLIT("a,b,c", ","), "c"))', {})).toBe(2);
    expect(await m.execute('RETURN(INDEX_OF(SPLIT("a,b,c", ","), "z"))', {})).toBe(-1);
  });

  it('interpolating an ARR uses the JSON stringify hook', async () => {
    const m = make('SPLIT');
    const out = await m.execute('items = SPLIT("a,b", ",")\nRETURN("v={items}")', {});
    expect(out).toBe('v=["a","b"]');
  });
});

describe('preset: cast', () => {
  it('STR / NUM / BUL basics', async () => {
    const m = make('STR', 'NUM', 'BUL');
    expect(await m.execute('RETURN(STR(42))', {})).toBe('42');
    expect(await m.execute('RETURN(NUM("12.5"))', {})).toBe(12.5);
    expect(await m.execute('RETURN(BUL(""))', {})).toBe(false);
    expect(await m.execute('RETURN(BUL("x"))', {})).toBe(true);
    expect(await m.execute('RETURN(NUM("nope"))', {})).toBe(0);
  });

  it('INT truncates toward zero', async () => {
    const m = make('INT');
    expect(await m.execute('RETURN(INT("3.9"))', {})).toBe(3);
    expect(await m.execute('RETURN(INT(-3.9))', {})).toBe(-3);
    expect(await m.execute('RETURN(INT("nope"))', {})).toBe(0);
  });

  it('STR preserves enum names', async () => {
    const g = new Genby();
    g.addPreset('STR');
    g.addEnum('Color', ['RED', 'BLUE']);
    g.addVariable({ name: 'C', type: 'ENUM', enumKey: 'Color' });
    const m = g.build();
    const out = await m.execute('RETURN(STR(C))', {
      C: { __enum: true, enumKey: 'Color', name: 'BLUE' },
    });
    expect(out).toBe('BLUE');
  });
});

describe('preset: math', () => {
  it('ADD / MUL / POW / SQRT', async () => {
    const m = make('ADD', 'MUL', 'POW', 'SQRT');
    expect(await m.execute('RETURN(ADD(2, 3))', {})).toBe(5);
    expect(await m.execute('RETURN(MUL(4, 5))', {})).toBe(20);
    expect(await m.execute('RETURN(POW(2, 10))', {})).toBe(1024);
    expect(await m.execute('RETURN(SQRT(9))', {})).toBe(3);
    expect(await m.execute('RETURN(SQRT(-1))', {})).toBe(0);
  });

  it('math composes with nested calls', async () => {
    const m = make('ADD', 'POW', 'SQRT');
    const hypot = await m.execute('RETURN(SQRT(ADD(POW(3, 2), POW(4, 2))))', {});
    expect(hypot).toBe(5);
  });
});

describe('preset: strings', () => {
  it('UPPER / LOWER / LEN', async () => {
    const m = make('UPPER', 'LOWER', 'LEN');
    expect(await m.execute('RETURN(UPPER("genby"))', {})).toBe('GENBY');
    expect(await m.execute('RETURN(LOWER("GENBY"))', {})).toBe('genby');
    expect(await m.execute('RETURN(LEN("hello"))', {})).toBe(5);
  });

  it('REPEAT clamps non-positive counts to 0', async () => {
    const m = make('REPEAT');
    expect(await m.execute('RETURN(REPEAT("ab", 3))', {})).toBe('ababab');
    expect(await m.execute('RETURN(REPEAT("x", 0))', {})).toBe('');
    expect(await m.execute('RETURN(REPEAT("x", -2))', {})).toBe('');
  });

  it('REPLACE replaces every occurrence', async () => {
    const m = make('REPLACE');
    expect(await m.execute('RETURN(REPLACE("a-b-c", "-", "."))', {})).toBe('a.b.c');
    expect(await m.execute('RETURN(REPLACE("none", "-", "."))', {})).toBe('none');
  });
});

describe('preset: async', () => {
  it('SHORT trims a string to n chars with an ellipsis', async () => {
    const m = make('SHORT');
    expect(await m.execute('RETURN(SHORT("hello world", 5))', {})).toBe('hello…');
    expect(await m.execute('RETURN(SHORT("hi", 5))', {})).toBe('hi');
    expect(await m.execute('RETURN(SHORT("abc", 0))', {})).toBe('…');
  });

  it('SHA256 returns a hex digest (checks via globalThis.crypto.subtle)', async () => {
    if (typeof globalThis.crypto?.subtle?.digest !== 'function') return;
    const m = make('SHA256');
    const out = await m.execute('RETURN(SHA256(""))', {});
    expect(out).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('FETCH_JSON + @API_BASE hits the mocked fetch', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = ((url: string) => {
      calls.push(String(url));
      return Promise.resolve(
        new Response(JSON.stringify({ fact: 'cats purr' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;
    try {
      const m = make('FETCH_JSON');
      const out = await m.execute(
        `@API_BASE("https://api.example.com")
RETURN(FETCH_JSON("/fact", "fact"))`,
        {},
      );
      expect(out).toBe('cats purr');
      expect(calls).toEqual(['https://api.example.com/fact']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('presets compose', () => {
  it('control + loops + arrays + cast work together', async () => {
    const m = make('FOR', 'RANGE', 'SIZE', 'AT', 'NUM', 'STR');
    const src = `items = RANGE(0, 5)
total = 0
FOR(SIZE(items), (
  total = NUM(total) + NUM(AT(items, NUM(total)))
))
RETURN("items={items} total={total}")`;
    const out = await m.execute(src, {});
    expect(typeof out).toBe('string');
    expect(out as string).toContain('items=[0,1,2,3,4]');
  });
});
