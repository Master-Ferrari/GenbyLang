import { ANY, BUL, NUM, STR, isEnumValue, type Thunk, type Value } from './types.js';
import type { Genby } from './genby.js';

/**
 * Ready-made function presets. Every preset registers exactly one function
 * (and, where relevant, the supporting type/directive) under the matching
 * name. Add them via {@link Genby.addPreset}; names are the canonical
 * function names themselves, e.g. `g.addPreset('IF')` or `g.addPreset('RANGE')`.
 */
type Apply = (g: Genby) => void;

// ---------------------------------------------------------------------------
// control: IF / WHEN / UNLESS / AND / OR / NOT / EQ / NEQ / COALESCE / CHOOSE / CASE
// ---------------------------------------------------------------------------

const applyIF: Apply = (g) => {
  g.addFunction({
    name: 'IF',
    describe:
      'returns `then` if `cond` is truthy, otherwise `else` (branches are evaluated lazily)',
    args: [
      { name: 'cond', type: ANY, describe: 'condition (coerced to boolean)' },
      { name: 'then', type: ANY, lazy: true, describe: 'value when truthy' },
      {
        name: 'else',
        type: ANY,
        lazy: true,
        optional: true,
        describe: 'value when falsy (default: empty string)',
      },
    ],
    returns: ANY,
    handler: async ([cond, thenT, elseT]) => {
      if (truthy(cond)) return (thenT as Thunk)();
      if (elseT) return (elseT as Thunk)();
      return '';
    },
  });
};

const applyWHEN: Apply = (g) => {
  g.addFunction({
    name: 'WHEN',
    describe: 'returns `then` when `cond` is truthy, else empty string',
    args: [
      { name: 'cond', type: ANY },
      { name: 'then', type: ANY, lazy: true },
    ],
    returns: ANY,
    handler: async ([cond, thenT]) =>
      truthy(cond) ? (thenT as Thunk)() : '',
  });
};

const applyUNLESS: Apply = (g) => {
  g.addFunction({
    name: 'UNLESS',
    describe: 'returns `then` when `cond` is falsy, else empty string',
    args: [
      { name: 'cond', type: ANY },
      { name: 'then', type: ANY, lazy: true },
    ],
    returns: ANY,
    handler: async ([cond, thenT]) =>
      truthy(cond) ? '' : (thenT as Thunk)(),
  });
};

const applyAND: Apply = (g) => {
  g.addFunction({
    name: 'AND',
    describe: 'short-circuit logical AND; returns true if every arg is truthy',
    args: [{ name: 'value', type: ANY, rest: true, lazy: true }],
    returns: BUL,
    handler: async (thunks) => {
      for (const t of thunks) {
        const v = await (t as Thunk)();
        if (!truthy(v)) return false;
      }
      return true;
    },
  });
};

const applyOR: Apply = (g) => {
  g.addFunction({
    name: 'OR',
    describe: 'short-circuit logical OR; returns true if any arg is truthy',
    args: [{ name: 'value', type: ANY, rest: true, lazy: true }],
    returns: BUL,
    handler: async (thunks) => {
      for (const t of thunks) {
        const v = await (t as Thunk)();
        if (truthy(v)) return true;
      }
      return false;
    },
  });
};

const applyNOT: Apply = (g) => {
  g.addFunction({
    name: 'NOT',
    describe: 'logical NOT (truthy coercion)',
    args: [{ name: 'value', type: ANY }],
    returns: BUL,
    handler: ([v]) => !truthy(v),
  });
};

const applyEQ: Apply = (g) => {
  g.addFunction({
    name: 'EQ',
    describe: 'strict equality over any two values (enums by name)',
    args: [
      { name: 'a', type: ANY },
      { name: 'b', type: ANY },
    ],
    returns: BUL,
    handler: ([a, b]) => strictEq(a, b),
  });
};

const applyNEQ: Apply = (g) => {
  g.addFunction({
    name: 'NEQ',
    describe: 'strict inequality (inverse of EQ)',
    args: [
      { name: 'a', type: ANY },
      { name: 'b', type: ANY },
    ],
    returns: BUL,
    handler: ([a, b]) => !strictEq(a, b),
  });
};

const applyCOALESCE: Apply = (g) => {
  g.addFunction({
    name: 'COALESCE',
    describe: 'first argument that is neither empty, null, nor undefined',
    args: [{ name: 'value', type: ANY, rest: true, lazy: true }],
    returns: ANY,
    handler: async (thunks) => {
      for (const t of thunks) {
        const v = await (t as Thunk)();
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return '';
    },
  });
};

const applyCHOOSE: Apply = (g) => {
  g.addFunction({
    name: 'CHOOSE',
    describe:
      'pick option by 0-based index; only the chosen option is evaluated',
    args: [
      { name: 'index', type: NUM },
      { name: 'option', type: ANY, rest: true, lazy: true },
    ],
    returns: ANY,
    handler: async ([idx, ...options]) => {
      const i = Math.floor(Number(idx) || 0);
      const picked = options[i];
      if (picked === undefined) return '';
      return (picked as Thunk)();
    },
  });
};

const applyCASE: Apply = (g) => {
  g.addFunction({
    name: 'CASE',
    describe:
      'switch-like: CASE(value, key1, result1, key2, result2, [default]). Returns first result whose key strict-equals `value`; optional trailing default otherwise',
    args: [
      { name: 'value', type: ANY },
      { name: 'entry', type: ANY, rest: true, lazy: true },
    ],
    returns: ANY,
    handler: async ([value, ...entries]) => {
      let i = 0;
      while (i + 1 < entries.length) {
        const key = await (entries[i] as Thunk)();
        if (strictEq(value, key)) {
          return (entries[i + 1] as Thunk)();
        }
        i += 2;
      }
      if (entries.length % 2 === 1) {
        return (entries[entries.length - 1] as Thunk)();
      }
      return '';
    },
  });
};

// ---------------------------------------------------------------------------
// loops: FOR / TIMES / WHILE
// ---------------------------------------------------------------------------

const WHILE_GUARD = 1_000_000;

const applyFOR: Apply = (g) => {
  g.addFunction({
    name: 'FOR',
    describe:
      'runs body `count` times in the caller scope (body is lazy, re-evaluated per iteration)',
    args: [
      { name: 'count', type: NUM },
      { name: 'body', type: ANY, lazy: true },
    ],
    returns: 'VOID',
    handler: async ([count, body]) => {
      const n = Math.max(0, Math.floor(Number(count) || 0));
      for (let i = 0; i < n; i++) await (body as Thunk)();
    },
  });
};

const applyTIMES: Apply = (g) => {
  g.addFunction({
    name: 'TIMES',
    describe:
      'stringify the body `count` times and join with `sep` (returns STR)',
    args: [
      { name: 'count', type: NUM },
      { name: 'sep', type: STR },
      { name: 'body', type: ANY, lazy: true },
    ],
    returns: STR,
    handler: async ([count, sep, body]) => {
      const n = Math.max(0, Math.floor(Number(count) || 0));
      const out: string[] = [];
      for (let i = 0; i < n; i++) {
        out.push(basicString(await (body as Thunk)()));
      }
      return out.join(String(sep ?? ''));
    },
  });
};

const applyWHILE: Apply = (g) => {
  g.addFunction({
    name: 'WHILE',
    describe: `runs body while cond is truthy (cond and body both lazy; capped at ${WHILE_GUARD.toLocaleString('en-US')} iterations)`,
    args: [
      { name: 'cond', type: ANY, lazy: true },
      { name: 'body', type: ANY, lazy: true },
    ],
    returns: 'VOID',
    handler: async ([cond, body]) => {
      for (let i = 0; i < WHILE_GUARD; i++) {
        const c = await (cond as Thunk)();
        if (!truthy(c)) return;
        await (body as Thunk)();
      }
      throw new Error(
        `WHILE exceeded ${WHILE_GUARD} iterations (infinite loop?)`,
      );
    },
  });
};

// ---------------------------------------------------------------------------
// arrays: ARR type is auto-registered by any array-oriented preset
// ---------------------------------------------------------------------------

function ensureArrType(g: Genby): void {
  if (g.hasType('ARR')) return;
  g.addType('ARR', {
    describe: 'ordered list of values (JS array under the hood)',
    stringify: (v) => JSON.stringify(v),
  });
}

const applyARR: Apply = (g) => {
  ensureArrType(g);
  g.addFunction({
    name: 'ARR',
    describe: 'construct an ARR from any number of items',
    args: [{ name: 'item', type: ANY, rest: true }],
    returns: 'ARR',
    handler: (items) => [...(items as Value[])],
  });
};

const applyRANGE: Apply = (g) => {
  ensureArrType(g);
  g.addFunction({
    name: 'RANGE',
    describe:
      'numeric range [from, to) as an ARR of NUM (supports descending when from > to)',
    args: [
      { name: 'from', type: NUM },
      { name: 'to', type: NUM },
    ],
    returns: 'ARR',
    handler: ([from, to]) => {
      const a = Math.floor(Number(from) || 0);
      const b = Math.floor(Number(to) || 0);
      const out: number[] = [];
      if (a <= b) for (let i = a; i < b; i++) out.push(i);
      else for (let i = a; i > b; i--) out.push(i);
      return out;
    },
  });
};

const applySIZE: Apply = (g) => {
  ensureArrType(g);
  g.addFunction({
    name: 'SIZE',
    describe: 'length of an ARR',
    args: [{ name: 'arr', type: 'ARR' }],
    returns: NUM,
    handler: ([arr]) => (Array.isArray(arr) ? arr.length : 0),
  });
};

const applyAT: Apply = (g) => {
  ensureArrType(g);
  g.addFunction({
    name: 'AT',
    describe:
      'element at 0-based index (negative indices count from the end); empty string if out of range',
    args: [
      { name: 'arr', type: 'ARR' },
      { name: 'index', type: NUM },
    ],
    returns: ANY,
    handler: ([arr, idx]) => {
      if (!Array.isArray(arr)) return '';
      const i = Math.floor(Number(idx) || 0);
      const v = arr.at(i);
      return v === undefined ? '' : v;
    },
  });
};

const applyFIRST: Apply = (g) => {
  ensureArrType(g);
  g.addFunction({
    name: 'FIRST',
    describe: 'first element of an ARR, or empty string if the ARR is empty',
    args: [{ name: 'arr', type: 'ARR' }],
    returns: ANY,
    handler: ([arr]) =>
      Array.isArray(arr) && arr.length > 0 ? arr[0] : '',
  });
};

const applyLAST: Apply = (g) => {
  ensureArrType(g);
  g.addFunction({
    name: 'LAST',
    describe: 'last element of an ARR, or empty string if the ARR is empty',
    args: [{ name: 'arr', type: 'ARR' }],
    returns: ANY,
    handler: ([arr]) =>
      Array.isArray(arr) && arr.length > 0 ? arr[arr.length - 1] : '',
  });
};

const applySLICE: Apply = (g) => {
  ensureArrType(g);
  g.addFunction({
    name: 'SLICE',
    describe: 'shallow copy of a slice [from, to) of an ARR',
    args: [
      { name: 'arr', type: 'ARR' },
      { name: 'from', type: NUM },
      { name: 'to', type: NUM, optional: true },
    ],
    returns: 'ARR',
    handler: ([arr, from, to]) => {
      if (!Array.isArray(arr)) return [];
      const a = Math.floor(Number(from) || 0);
      const b =
        to === undefined ? arr.length : Math.floor(Number(to) || 0);
      return arr.slice(a, b);
    },
  });
};

const applyCONCAT: Apply = (g) => {
  ensureArrType(g);
  g.addFunction({
    name: 'CONCAT',
    describe: 'concatenate any number of ARRs into a new ARR',
    args: [{ name: 'arr', type: 'ARR', rest: true }],
    returns: 'ARR',
    handler: (arrs) => {
      const out: Value[] = [];
      for (const a of arrs as Value[]) if (Array.isArray(a)) out.push(...a);
      return out;
    },
  });
};

const applyREVERSE: Apply = (g) => {
  ensureArrType(g);
  g.addFunction({
    name: 'REVERSE',
    describe: 'new ARR with items in reverse order',
    args: [{ name: 'arr', type: 'ARR' }],
    returns: 'ARR',
    handler: ([arr]) => (Array.isArray(arr) ? [...arr].reverse() : []),
  });
};

const applyPUSH: Apply = (g) => {
  ensureArrType(g);
  g.addFunction({
    name: 'PUSH',
    describe: 'new ARR with `item` appended',
    args: [
      { name: 'arr', type: 'ARR' },
      { name: 'item', type: ANY },
    ],
    returns: 'ARR',
    handler: ([arr, item]) =>
      Array.isArray(arr) ? [...arr, item] : [item],
  });
};

const applyCONTAINS: Apply = (g) => {
  ensureArrType(g);
  g.addFunction({
    name: 'CONTAINS',
    describe: 'true if ARR contains an item strict-equal to `item`',
    args: [
      { name: 'arr', type: 'ARR' },
      { name: 'item', type: ANY },
    ],
    returns: BUL,
    handler: ([arr, item]) =>
      Array.isArray(arr) ? arr.some((x) => strictEq(x, item)) : false,
  });
};

const applyINDEX_OF: Apply = (g) => {
  ensureArrType(g);
  g.addFunction({
    name: 'INDEX_OF',
    describe: 'first index of `item` in ARR, or -1',
    args: [
      { name: 'arr', type: 'ARR' },
      { name: 'item', type: ANY },
    ],
    returns: NUM,
    handler: ([arr, item]) =>
      Array.isArray(arr) ? arr.findIndex((x) => strictEq(x, item)) : -1,
  });
};

const applySPLIT: Apply = (g) => {
  ensureArrType(g);
  g.addFunction({
    name: 'SPLIT',
    describe: 'split a string by a separator into an ARR of STR',
    args: [
      { name: 's', type: STR },
      { name: 'sep', type: STR, describe: 'separator' },
    ],
    returns: 'ARR',
    handler: ([s, sep]) => String(s ?? '').split(String(sep ?? '')),
  });
};

const applyJOIN: Apply = (g) => {
  ensureArrType(g);
  g.addFunction({
    name: 'JOIN',
    describe: 'join an ARR into a string using `sep`',
    args: [
      { name: 'arr', type: 'ARR' },
      { name: 'sep', type: STR },
    ],
    returns: STR,
    handler: ([arr, sep]) =>
      Array.isArray(arr)
        ? arr.map(basicString).join(String(sep ?? ''))
        : '',
  });
};

// ---------------------------------------------------------------------------
// cast: STR / NUM / BUL / INT
// ---------------------------------------------------------------------------

const applySTR: Apply = (g) => {
  g.addFunction({
    name: 'STR',
    describe:
      'coerce any value to STR (null/undefined → "", enums → their name, objects → JSON)',
    args: [{ name: 'v', type: ANY }],
    returns: STR,
    handler: ([v]) => basicString(v),
  });
};

const applyNUM: Apply = (g) => {
  g.addFunction({
    name: 'NUM',
    describe:
      'coerce any value to NUM (booleans → 1/0, unparseable → 0)',
    args: [{ name: 'v', type: ANY }],
    returns: NUM,
    handler: ([v]) => {
      if (v === undefined || v === null || v === '') return 0;
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'number') return v;
      if (isEnumValue(v)) {
        const n = Number(v.name);
        return Number.isFinite(n) ? n : 0;
      }
      const n = Number(v as string);
      return Number.isFinite(n) ? n : 0;
    },
  });
};

const applyBUL: Apply = (g) => {
  g.addFunction({
    name: 'BUL',
    describe: 'coerce any value to BUL (truthy test)',
    args: [{ name: 'v', type: ANY }],
    returns: BUL,
    handler: ([v]) => truthy(v),
  });
};

const applyINT: Apply = (g) => {
  g.addFunction({
    name: 'INT',
    describe: 'floor-truncate any value to an integer NUM',
    args: [{ name: 'v', type: ANY }],
    returns: NUM,
    handler: ([v]) => {
      if (typeof v === 'boolean') return v ? 1 : 0;
      const n = Number(v as string | number);
      return Number.isFinite(n) ? Math.trunc(n) : 0;
    },
  });
};

// ---------------------------------------------------------------------------
// math: ADD / MUL / POW / SQRT
// ---------------------------------------------------------------------------

const applyADD: Apply = (g) => {
  g.addFunction({
    name: 'ADD',
    describe: 'sum of two numbers',
    args: [
      { name: 'a', type: NUM },
      { name: 'b', type: NUM },
    ],
    returns: NUM,
    handler: ([a, b]) => Number(a) + Number(b),
  });
};

const applyMUL: Apply = (g) => {
  g.addFunction({
    name: 'MUL',
    describe: 'product of two numbers',
    args: [
      { name: 'a', type: NUM },
      { name: 'b', type: NUM },
    ],
    returns: NUM,
    handler: ([a, b]) => Number(a) * Number(b),
  });
};

const applyPOW: Apply = (g) => {
  g.addFunction({
    name: 'POW',
    describe: 'raise `base` to the given `exp` power',
    args: [
      { name: 'base', type: NUM },
      { name: 'exp', type: NUM },
    ],
    returns: NUM,
    handler: ([b, e]) => Math.pow(Number(b), Number(e)),
  });
};

const applySQRT: Apply = (g) => {
  g.addFunction({
    name: 'SQRT',
    describe: 'square root of a non-negative number (negative inputs clamp to 0)',
    args: [{ name: 'n', type: NUM }],
    returns: NUM,
    handler: ([n]) => Math.sqrt(Math.max(0, Number(n))),
  });
};

// ---------------------------------------------------------------------------
// strings: UPPER / LOWER / REPEAT / REPLACE / LEN
// ---------------------------------------------------------------------------

const applyUPPER: Apply = (g) => {
  g.addFunction({
    name: 'UPPER',
    describe: 'upper-case a string',
    args: [{ name: 's', type: STR }],
    returns: STR,
    handler: ([s]) => String(s ?? '').toUpperCase(),
  });
};

const applyLOWER: Apply = (g) => {
  g.addFunction({
    name: 'LOWER',
    describe: 'lower-case a string',
    args: [{ name: 's', type: STR }],
    returns: STR,
    handler: ([s]) => String(s ?? '').toLowerCase(),
  });
};

const applyREPEAT: Apply = (g) => {
  g.addFunction({
    name: 'REPEAT',
    describe: 'repeat a string `n` times',
    args: [
      { name: 's', type: STR },
      { name: 'n', type: NUM },
    ],
    returns: STR,
    handler: ([s, n]) =>
      String(s ?? '').repeat(Math.max(0, Math.floor(Number(n) || 0))),
  });
};

const applyREPLACE: Apply = (g) => {
  g.addFunction({
    name: 'REPLACE',
    describe: 'replace every occurrence of `needle` with `replacement`',
    args: [
      { name: 'haystack', type: STR },
      { name: 'needle', type: STR },
      { name: 'replacement', type: STR },
    ],
    returns: STR,
    handler: ([h, n, r]) =>
      String(h ?? '').split(String(n ?? '')).join(String(r ?? '')),
  });
};

const applyLEN: Apply = (g) => {
  g.addFunction({
    name: 'LEN',
    describe: 'length of a string',
    args: [{ name: 's', type: STR }],
    returns: NUM,
    handler: ([s]) => String(s ?? '').length,
  });
};

// ---------------------------------------------------------------------------
// async: FETCH_JSON (+ @API_BASE directive) / SHA256 / SHORT
// ---------------------------------------------------------------------------

const applyFETCH_JSON: Apply = (g) => {
  // each preset invocation gets its own apiBase closure so multiple Genby
  // instances never share mutable state.
  let apiBase = '';
  g.addDirective({
    name: 'API_BASE',
    describe: 'override the base URL prefixed to FETCH_JSON paths',
    args: [{ name: 'url', type: STR }],
    handler: ([url]) => {
      apiBase = String(url ?? '');
    },
  });
  g.addFunction({
    name: 'FETCH_JSON',
    describe:
      'async HTTP GET `@API_BASE + path`. With a 2nd arg, returns that ' +
      'top-level JSON field; otherwise returns the full JSON text.',
    args: [
      { name: 'path', type: STR },
      { name: 'field', type: STR, optional: true },
    ],
    returns: STR,
    handler: async ([path, field]) => {
      const url = apiBase + String(path ?? '');
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' ' + res.statusText);
      }
      const data = (await res.json()) as Record<string, unknown>;
      if (field !== undefined && field !== null && field !== '') {
        return String(data[String(field)] ?? '');
      }
      return JSON.stringify(data, null, 2);
    },
  });
};

const applySHA256: Apply = (g) => {
  g.addFunction({
    name: 'SHA256',
    describe: 'async hex SHA-256 digest via globalThis.crypto.subtle',
    args: [{ name: 'text', type: STR }],
    returns: STR,
    handler: async ([text]) => {
      const buf = new TextEncoder().encode(String(text ?? ''));
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    },
  });
};

const applySHORT: Apply = (g) => {
  g.addFunction({
    name: 'SHORT',
    describe: 'trim a string to the first `n` chars, appending an ellipsis',
    args: [
      { name: 's', type: STR },
      { name: 'n', type: NUM },
    ],
    returns: STR,
    handler: ([s, n]) => {
      const str = String(s ?? '');
      const len = Math.max(0, Math.floor(Number(n) || 0));
      return str.length > len ? str.slice(0, len) + '…' : str;
    },
  });
};

// ---------------------------------------------------------------------------
// preset registry
// ---------------------------------------------------------------------------

const PRESETS = {
  // control
  IF: applyIF,
  WHEN: applyWHEN,
  UNLESS: applyUNLESS,
  AND: applyAND,
  OR: applyOR,
  NOT: applyNOT,
  EQ: applyEQ,
  NEQ: applyNEQ,
  COALESCE: applyCOALESCE,
  CHOOSE: applyCHOOSE,
  CASE: applyCASE,
  // loops
  FOR: applyFOR,
  TIMES: applyTIMES,
  WHILE: applyWHILE,
  // arrays
  ARR: applyARR,
  RANGE: applyRANGE,
  SIZE: applySIZE,
  AT: applyAT,
  FIRST: applyFIRST,
  LAST: applyLAST,
  SLICE: applySLICE,
  CONCAT: applyCONCAT,
  REVERSE: applyREVERSE,
  PUSH: applyPUSH,
  CONTAINS: applyCONTAINS,
  INDEX_OF: applyINDEX_OF,
  SPLIT: applySPLIT,
  JOIN: applyJOIN,
  // cast
  STR: applySTR,
  NUM: applyNUM,
  BUL: applyBUL,
  INT: applyINT,
  // math
  ADD: applyADD,
  MUL: applyMUL,
  POW: applyPOW,
  SQRT: applySQRT,
  // strings
  UPPER: applyUPPER,
  LOWER: applyLOWER,
  REPEAT: applyREPEAT,
  REPLACE: applyREPLACE,
  LEN: applyLEN,
  // async
  FETCH_JSON: applyFETCH_JSON,
  SHA256: applySHA256,
  SHORT: applySHORT,
} as const;

export type PresetName = keyof typeof PRESETS;
export const PRESET_NAMES = Object.keys(PRESETS) as readonly PresetName[];

export function applyPreset(g: Genby, name: PresetName): void {
  const fn = PRESETS[name];
  fn(g);
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

function truthy(v: Value): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  if (isEnumValue(v)) return true;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function strictEq(a: Value, b: Value): boolean {
  if (isEnumValue(a) && isEnumValue(b)) {
    return a.enumKey === b.enumKey && a.name === b.name;
  }
  return a === b;
}

function basicString(v: Value): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (isEnumValue(v)) return v.name;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
