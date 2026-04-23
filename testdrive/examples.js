// -----------------------------------------------------------------
// testdrive examples — a tiny genby tutorial, ordered from easiest
// to most advanced. each entry is a pair of (config, program):
//   1. variables and string interpolation (empty language)
//   2. your first custom functions with addFunction
//   3. enums: registering, using as args, returning from handlers
//   4. string helpers and composition
//   5. arrays and loops from presets
//   6. user-defined functions and recursion inside genby
//   7. directives + interesting async functions (fetch + SubtleCrypto)
//
// each example only introduces features on top of the previous one,
// so reading them in order acts as a hands-on walkthrough.
// -----------------------------------------------------------------

// =================================================================
// 1. variables + string interpolation
// =================================================================

const VARS_CONFIG = `// the smallest possible language — no functions at all.
// genby still gives you: variables, literals, arithmetic, comparisons
// and rich string interpolation ( { ... } inside string literals ).

import { Genby } from 'genby';

const machine = new Genby();
return machine;
`;

const VARS_PROGRAM = `// every line that starts with 'name =' declares a local variable.
// the right-hand side can be a literal or any expression.
name = "genby"
version = 1.0
ready = 1 == 1

// variables participate in normal arithmetic
a = 5
b = 7
sum  = a + b
area = a * b

// string literals can embed expressions between { and }.
// RETURN(...) marks the final value of the program.
RETURN("name    = {name}
version = {version}
ready   = {ready}

a + b   = {sum}
a * b   = {area}
(a+b)^2 = {(a + b) * (a + b)}")`;

// =================================================================
// 2. your first custom functions — addFunction
// =================================================================

const CUSTOM_CONFIG = `// declare your own functions via machine.addFunction(...).
// each function picks argument types (STR/NUM/BUL/ANY/...), a return
// type, and a JS handler. handlers receive Arg<T> handles and decide
// when to evaluate each argument via await arg.calc().
//
// this example also defines an external variable NOW_MS (system time).
// in this testdrive we patch machine.execute(...) to inject NOW_MS
// automatically on every run.

import { Genby, NUM } from 'genby';

const machine = new Genby();

machine.addVariable({
    name: 'NOW_MS',
    type: NUM,
    describe: 'system timestamp in milliseconds (injected by the host)',
});

machine.addFunction({
    name: 'ADD',
    describe: 'sum of two numbers',
    args: [{ name: 'a', type: NUM }, { name: 'b', type: NUM }],
    returns: NUM,
    handler: async ([a, b]) => Number(await a.calc()) + Number(await b.calc()),
});

machine.addFunction({
    name: 'MUL',
    describe: 'product of two numbers',
    args: [{ name: 'a', type: NUM }, { name: 'b', type: NUM }],
    returns: NUM,
    handler: async ([a, b]) => Number(await a.calc()) * Number(await b.calc()),
});

machine.addFunction({
    name: 'POW',
    describe: 'raise base to the given power',
    args: [{ name: 'base', type: NUM }, { name: 'exp', type: NUM }],
    returns: NUM,
    handler: async ([base, exp]) => Math.pow(Number(await base.calc()), Number(await exp.calc())),
});

machine.addFunction({
    name: 'SQRT',
    describe: 'square root of a non-negative number',
    args: [{ name: 'value', type: NUM }],
    returns: NUM,
    handler: async ([value]) => Math.sqrt(Math.max(0, Number(await value.calc()))),
});

machine.addFunction({
    name: 'NOW',
    describe: 'current system timestamp (Date.now)',
    args: [],
    returns: NUM,
    handler: async () => Date.now(),
});

machine.addFunction({
    name: 'DRIFT',
    describe: 'evaluates one argument twice and returns second - first',
    args: [{ name: 'value', type: NUM }],
    returns: NUM,
    handler: async ([value]) => {
        const first = Number(await value.calc());
        const second = Number(await value.calc());
        return second - first;
    },
});

const built = machine.build();
const originalExecute = built.execute.bind(built);
built.execute = (program, inputs = {}) =>
    originalExecute(program, { NOW_MS: Date.now(), ...inputs });

return built;
`;

const CUSTOM_PROGRAM = `// everything is a function call — calls nest freely: SQRT(ADD(...)) etc.
// NOW_MS is provided by the host at run-time.
area  = MUL(8, 9)
cube  = POW(3, 3)
hypot = SQRT(ADD(POW(3, 2), POW(4, 2)))
total = ADD(area, cube)
now   = NOW_MS
// DRIFT calls calc() twice.
// - external NOW_MS is stable for the whole run -> usually 0
// - NOW() is re-executed twice -> usually > 0
stable = DRIFT(NOW_MS + 1)
live   = DRIFT(NOW())

RETURN("area  = {area}
cube  = {cube}
hypot = {hypot}
total = {total}
now   = {now}
drift(stable source) = {stable}
drift(recomputed)    = {live}")`;

// =================================================================
// 3. enums — named value sets you can pass to handlers
// =================================================================

const ENUMS_CONFIG = `// machine.addEnum(key, values) registers a set of symbolic names. those
// names become usable as bare identifiers inside programs — the checker
// pins each one to the right enum from the argument type it is passed to.
//
// handlers receive Arg<EnumValue> handles; call await color.calc() to get
// { __enum, enumKey, name }. use
// makeEnumValue(key, name) to build fresh ones when your function returns
// an enum. an enum-returning function must also set returnsEnumKey so the
// type checker knows which enum it produces.

import { Genby, STR, ENUM, makeEnumValue } from 'genby';

const machine = new Genby();

machine.addEnum('Color', ['RED', 'GREEN', 'BLUE'], {
    describe: 'primary colors',
});

machine.addEnum('Mood', ['HAPPY', 'CALM', 'ANGRY']);

// ENUM -> STR: look up the css hex code for a given color.
machine.addFunction({
    name: 'HEX',
    describe: 'css hex code for a primary color',
    args: [{ name: 'color', type: ENUM, enumKey: 'Color' }],
    returns: STR,
    handler: async ([color]) => {
        const resolved = await color.calc();
        const map = { RED: '#ff0033', GREEN: '#22bb55', BLUE: '#1b7dff' };
        return map[resolved.name] ?? '#000000';
    },
});

// ENUM -> ENUM: map a color to the mood it evokes.
// note the returnsEnumKey next to returns: ENUM — required for any
// function that hands back an enum value.
machine.addFunction({
    name: 'MOOD_OF',
    describe: 'map a color to the mood it evokes',
    args: [{ name: 'color', type: ENUM, enumKey: 'Color' }],
    returns: ENUM,
    returnsEnumKey: 'Mood',
    handler: async ([color]) => {
        const resolved = await color.calc();
        const map = { RED: 'ANGRY', GREEN: 'CALM', BLUE: 'HAPPY' };
        return makeEnumValue('Mood', map[resolved.name] ?? 'CALM');
    },
});

return machine;
`;

const ENUMS_PROGRAM = `// enum values are written as bare identifiers — RED, GREEN, BLUE here
// all come from the Color enum. the checker figures out which enum each
// name belongs to from the receiving argument's type.
red_hex   = HEX(RED)
green_hex = HEX(GREEN)
blue_hex  = HEX(BLUE)

// functions can return enums too. the result keeps its enum identity
// and stringifies to the value name when interpolated into a string.
mood_red  = MOOD_OF(RED)
mood_blue = MOOD_OF(BLUE)

RETURN("RED   = {red_hex}  ( mood : {mood_red} )
GREEN = {green_hex}  ( mood : {MOOD_OF(GREEN)} )
BLUE  = {blue_hex}  ( mood : {mood_blue} )")`;

// =================================================================
// 4. strings — composing your own string helpers
// =================================================================

const STRINGS_CONFIG = `// a handful of string helpers. they all share the same pattern:
// STR-typed args, STR return, plain JS in the handler after await arg.calc().

import { Genby, STR, NUM } from 'genby';

const machine = new Genby();

machine.addFunction({
    name: 'UPPER',
    describe: 'upper-case a string',
    args: [{ name: 'text', type: STR }],
    returns: STR,
    handler: async ([text]) => String((await text.calc()) ?? '').toUpperCase(),
});

machine.addFunction({
    name: 'LOWER',
    describe: 'lower-case a string',
    args: [{ name: 'text', type: STR }],
    returns: STR,
    handler: async ([text]) => String((await text.calc()) ?? '').toLowerCase(),
});

machine.addFunction({
    name: 'REPEAT',
    describe: 'repeat a string n times',
    args: [{ name: 'text', type: STR }, { name: 'times', type: NUM }],
    returns: STR,
    handler: async ([text, times]) =>
        String((await text.calc()) ?? '').repeat(Math.max(0, Math.floor(Number(await times.calc()) || 0))),
});

machine.addFunction({
    name: 'REPLACE',
    describe: 'replace every occurrence of \`needle\` with \`replacement\`',
    args: [
        { name: 'haystack', type: STR },
        { name: 'needle', type: STR },
        { name: 'replacement', type: STR },
    ],
    returns: STR,
    handler: async ([haystack, needle, replacement]) =>
        String((await haystack.calc()) ?? '').split(String((await needle.calc()) ?? '')).join(String((await replacement.calc()) ?? '')),
});

machine.addFunction({
    name: 'LEN',
    describe: 'length of a string',
    args: [{ name: 'text', type: STR }],
    returns: NUM,
    handler: async ([text]) => String((await text.calc()) ?? '').length,
});

return machine;
`;

const STRINGS_PROGRAM = `// calls compose the same way they do in any functional language.
name   = "genby"
banner = UPPER(name)

// LEN returns NUM — so REPEAT can consume it directly.
line   = REPEAT("-", LEN(banner) + 8)

// REPLACE is a pure STR -> STR transformer; chain it with interpolation.
template = "hello, NAME! ready to genby?"
greet    = REPLACE(template, "NAME", banner)

RETURN("{line}
  {greet}
{line}
length = {LEN(greet)}  ·  lower = {LOWER(banner)}")`;

// =================================================================
// 5. arrays & loops — using bundled presets
// =================================================================

const ARRAYS_CONFIG = `// machine.addPreset(name) registers one ready-made function under the
// same name. mix and match only what you need — see the docs panel on the
// right for every preset's signature. here we pull:
//   arrays:  ARR, RANGE, SIZE, AT, SPLIT, JOIN, REVERSE  (ARR type is
//            auto-registered by any array-using preset)
//   loops:   WHILE
//   cast:    NUM  (coerce values between types)

import { Genby } from 'genby';

const machine = new Genby();

// arrays
machine.addPreset('ARR');
machine.addPreset('RANGE');
machine.addPreset('SIZE');
machine.addPreset('AT');
machine.addPreset('SPLIT');
machine.addPreset('JOIN');
machine.addPreset('REVERSE');

// loops
machine.addPreset('WHILE');

// cast
machine.addPreset('NUM');

return machine;
`;

const ARRAYS_PROGRAM = `// build a multiplication table by walking 1..5 with WHILE.
// RANGE(1, 6) produces the ARR [1, 2, 3, 4, 5].
nums  = RANGE(1, 6)
table = ""
i     = 0

// AT(nums, i) returns ANY, so we cast through NUM() to pin the local's
// type — otherwise the checker would refuse to register a pure-ANY var.
WHILE(i < SIZE(nums), (
  x = NUM(AT(nums, i))
  table = table + "{x} x {x} = {x * x}\\n"
  i = i + 1
))

// SPLIT -> REVERSE -> JOIN pipeline on an ARR of strings
words    = SPLIT("one,two,three,four", ",")
reversed = JOIN(REVERSE(words), " > ")

RETURN("squares (size = {SIZE(nums)}):
{table}
words reversed: {reversed}")`;

// =================================================================
// 6. user-defined functions & recursion inside genby
// =================================================================

const RECURSION_CONFIG = `// user functions are written directly in genby — see the program
// on the right. each preset adds exactly one same-named function, so we
// pull just IF (for branching) and NUM (to pin local types).

import { Genby } from 'genby';

const machine = new Genby();

machine.addPreset('IF');
machine.addPreset('NUM');

return machine;
`;

const RECURSION_PROGRAM = `// genby supports inline function definitions of the form:
//   name(params) = ( body )
// the body is a block; its last expression is the function's value.
// names are hoisted, so functions can call themselves (recursion) and
// each other regardless of order.
// important (new semantics): each read of a user-fn param re-evaluates
// the caller expression unless you cache it in a local variable.

// classic factorial.  IF's 'else' branch is evaluated lazily, which is
// exactly what stops the recursion from blowing the stack.
fact(n) = (
  IF(n <= 1, 1, (n * fact(n - 1)))
)

// plain fibonacci — two recursive calls per frame.
fib(n) = (
  IF(n < 2, n, (fib(n - 1) + fib(n - 2)))
)

// user functions compose just like built-ins.
sumto(k) = (
  IF(k <= 0, 0, (k + sumto(k - 1)))
)

RETURN("5!        = {fact(5)}
7!        = {fact(7)}
fib(10)   = {fib(10)}
1+2+...+10 = {sumto(10)}")`;

// =================================================================
// 7. directives + interesting async functions (fetch + SHA-256)
// =================================================================

const ASYNC_CONFIG = `// directives are compile-time knobs written as @NAME(...) at the very
// top of the program. they fire before any statement runs and usually
// mutate shared state inside the handler closure.
//
// because genby handlers can be async, you can expose *real* network /
// crypto primitives to the program — not just toy timers.
// this example wires up:
//   @API_BASE     — configure a base URL
//   FETCH_JSON    — async HTTP GET, returns field or full JSON
//   SHA256        — async SubtleCrypto digest
//   SHORT         — tiny helper for pretty-printing long strings

import { Genby, STR, NUM } from 'genby';

const machine = new Genby();

let apiBase = 'https://catfact.ninja';

machine.addDirective({
    name: 'API_BASE',
    describe: 'override the base URL used by FETCH_JSON',
    args: [{ name: 'url', type: STR }],
    handler: async ([url]) => { apiBase = String((await url.calc()) ?? apiBase); },
});

machine.addFunction({
    name: 'FETCH_JSON',
    describe:
        'HTTP GET @API_BASE + path. with a 2nd arg, extracts that top-level ' +
        'field; otherwise returns the full JSON text',
    args: [
        { name: 'path', type: STR },
        { name: 'field', type: STR, optional: true },
    ],
    returns: STR,
    handler: async ([path, field]) => {
        const res = await fetch(apiBase + String((await path.calc()) ?? ''));
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
        const data = await res.json();
        if (field) return String(data[String(await field.calc())] ?? '');
        return JSON.stringify(data, null, 2);
    },
});

machine.addFunction({
    name: 'SHA256',
    describe: 'async hex SHA-256 digest via window.crypto.subtle',
    args: [{ name: 'text', type: STR }],
    returns: STR,
    handler: async ([text]) => {
        const buf = new TextEncoder().encode(String((await text.calc()) ?? ''));
        const digest = await crypto.subtle.digest('SHA-256', buf);
        return Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
    },
});

machine.addFunction({
    name: 'SHORT',
    describe: 'trim a string to the first n chars, appending an ellipsis',
    args: [{ name: 'text', type: STR }, { name: 'limit', type: NUM }],
    returns: STR,
    handler: async ([text, limit]) => {
        const str = String((await text.calc()) ?? '');
        const max = Math.max(0, Math.floor(Number(await limit.calc()) || 0));
        return str.length > max ? str.slice(0, max) + '…' : str;
    },
});

return machine;
`;

const ASYNC_PROGRAM = `// the directive fires first — its value lives in the closure of the
// FETCH_JSON handler for the rest of the program.
@API_BASE("https://catfact.ninja")

// FETCH_JSON actually hits the network. the interpreter awaits the
// promise transparently, so downstream code reads like ordinary code.
fact = FETCH_JSON("/fact", "fact")

// SHA256 awaits crypto.subtle.digest and returns a hex string.
// chaining it with the previous result just works.
hash = SHA256(fact)

RETURN("cat fact ({SHORT(fact, 80)}):
  {fact}

sha-256 digest:
  {hash}

short id: {SHORT(hash, 12)}")`;

// -----------------------------------------------------------------
// EXAMPLES — ordered list shown in the dropdown. the first one is the
// default that loads on page init. each label doubles as a chapter
// heading of the mini tutorial.
// -----------------------------------------------------------------

export const EXAMPLES = [
    {
        id: 'vars',
        label: '1 · variables & string interpolation',
        config: VARS_CONFIG,
        program: VARS_PROGRAM,
    },
    {
        id: 'custom',
        label: '2 · your first custom functions (addFunction)',
        config: CUSTOM_CONFIG,
        program: CUSTOM_PROGRAM,
    },
    {
        id: 'enums',
        label: '3 · enums — named values as function args',
        config: ENUMS_CONFIG,
        program: ENUMS_PROGRAM,
    },
    {
        id: 'strings',
        label: '4 · working with strings',
        config: STRINGS_CONFIG,
        program: STRINGS_PROGRAM,
    },
    {
        id: 'arrays',
        label: '5 · arrays & loops from presets',
        config: ARRAYS_CONFIG,
        program: ARRAYS_PROGRAM,
    },
    {
        id: 'recursion',
        label: '6 · user functions & recursion inside genby',
        config: RECURSION_CONFIG,
        program: RECURSION_PROGRAM,
    },
    {
        id: 'async',
        label: '7 · directives & async functions (fetch + sha-256)',
        config: ASYNC_CONFIG,
        program: ASYNC_PROGRAM,
    },
];
