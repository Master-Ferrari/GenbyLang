import {
    Genby,
    STR,
    NUM,
    BUL,
    ENUM,
    ANY,
    makeEnumValue,
} from '../dist/index.js';

// -----------------------------------------------------------------
// defaults
// -----------------------------------------------------------------

const DEFAULT_CONFIG = `// declare your language here.
// scope: Genby, STR, NUM, BUL, ENUM, ANY, makeEnumValue.
// return the configured Genby instance.

const g = new Genby();

// --- type-coercion helpers (ANY in, specific type out) ----------------

g.addFunction({
    name: 'NUM',
    describe: 'coerces any value to a number (strings parsed, booleans become 1/0)',
    args: [{ name: 'v', type: ANY, describe: 'any value' }],
    returns: NUM,
    handler: ([v]) => {
        if (v === undefined || v === null) return 0;
        if (typeof v === 'boolean') return v ? 1 : 0;
        if (v && typeof v === 'object' && v.__enum) return Number(v.name);
        return Number(v);
    },
});

g.addFunction({
    name: 'STR',
    describe: 'coerces any value to a string (enums render as their name)',
    args: [{ name: 'v', type: ANY, describe: 'any value' }],
    returns: STR,
    handler: ([v]) => {
        if (v === undefined || v === null) return '';
        if (v && typeof v === 'object' && v.__enum) return v.name;
        return String(v);
    },
});

g.addFunction({
    name: 'BUL',
    describe: 'coerces any value to a boolean (empty string / 0 / enum-nothing is false)',
    args: [{ name: 'v', type: ANY, describe: 'any value' }],
    returns: BUL,
    handler: ([v]) => {
        if (v === undefined || v === null) return false;
        if (v && typeof v === 'object' && v.__enum) return true;
        return Boolean(v);
    },
});

// --- control flow: re-evaluate body count times -----------------------

g.addFunction({
    name: 'FOR',
    describe: 'runs body count times; body is re-evaluated on each iteration in the caller scope',
    args: [
        { name: 'count', type: NUM, describe: 'iteration count' },
        { name: 'body', type: ANY, lazy: true, describe: 'expression re-evaluated each iteration' },
    ],
    returns: 'VOID',
    handler: async ([count, body]) => {
        const n = Math.max(0, Math.floor(Number(count)));
        for (let i = 0; i < n; i++) {
            await body();
        }
    },
});

// --- directive with a state it shares with a function ----------------

let prefix = '';

g.addDirective({
    name: 'PREFIX',
    describe: 'sets a prefix that SOME_PROCESS prepends to its result',
    args: [{ name: 'text', type: STR, describe: 'prefix text' }],
    handler: ([text]) => { prefix = String(text ?? ''); },
});

g.addFunction({
    name: 'SOME_PROCESS',
    describe: 'trims, upper-cases, and prepends the @PREFIX value',
    args: [{ name: 'text', type: STR, describe: 'text to process' }],
    returns: STR,
    handler: async ([text]) => prefix + String(text ?? '').trim().toUpperCase(),
});

g.addFunction({
    name: 'IF_THEN_ELSE',
    args: [
        { name: 'cond', type: BUL },
        { name: 'a', type: STR },
        { name: 'b', type: STR },
    ],
    returns: STR,
    handler: ([c, a, b]) => (c ? a : b),
});

return g;
`;

const DEFAULT_PROGRAM = `// user-defined function and a lazy FOR — prints 4 (1 + 1 + 1 + 1).
x = 1

func(a) = (
  x = NUM(x) + NUM(a)
)

FOR(3, (func(3) func(-2)))

RETURN(x)
`;

// -----------------------------------------------------------------
// dom refs
// -----------------------------------------------------------------

const configInput = document.getElementById('configInput');
const configHighlight = document.getElementById('configHighlight');
const configEdit = document.getElementById('configEdit');
const makeBtn = document.getElementById('makeBtn');
const configBadge = document.getElementById('configBadge');
const configMsg = document.getElementById('configMsg');

const docsBody = document.getElementById('docsBody');
const docsCount = document.getElementById('docsCount');

const genbyHost = document.getElementById('genbyHost');
const programRight = document.getElementById('programRight');
const programMsg = document.getElementById('programMsg');

const runBtn = document.getElementById('runBtn');
const runBadge = document.getElementById('runBadge');
const runMsg = document.getElementById('runMsg');
const runOutput = document.getElementById('runOutput');
const runRight = document.getElementById('runRight');

const installBtn = document.getElementById('installBtn');
const installLabel = document.getElementById('installLabel');

if (installBtn && installLabel) {
    let resetTimer = 0;
    installBtn.addEventListener('click', async () => {
        const cmd = 'npm i genby';
        try {
            await navigator.clipboard.writeText(cmd);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = cmd;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch { }
            document.body.removeChild(ta);
        }
        installBtn.classList.add('copied');
        installLabel.textContent = 'copied';
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
            installBtn.classList.remove('copied');
            installLabel.textContent = 'copy';
        }, 1500);
    });
}

// -----------------------------------------------------------------
// js highlighter (overlay)
// -----------------------------------------------------------------

const JS_KEYWORDS = new Set([
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
    'switch', 'case', 'break', 'continue', 'new', 'async', 'await', 'true', 'false',
    'null', 'undefined', 'try', 'catch', 'finally', 'throw', 'this', 'typeof',
    'instanceof', 'of', 'in', 'import', 'export', 'from', 'default', 'class',
    'extends', 'static', 'void', 'yield',
]);

const JS_RULES = [
    { cls: 'comment', re: /^\/\/[^\n]*/ },
    { cls: 'comment', re: /^\/\*[\s\S]*?\*\// },
    { cls: 'string', re: /^"(?:[^"\\\n]|\\.)*"/ },
    { cls: 'string', re: /^'(?:[^'\\\n]|\\.)*'/ },
    { cls: 'string', re: /^`(?:[^`\\]|\\[\s\S])*`/ },
    { cls: 'number', re: /^(?:0x[0-9a-fA-F]+|\d+\.?\d*)/ },
    { cls: 'ident', re: /^[A-Za-z_$][\w$]*/ },
    { cls: 'op', re: /^(?:=>|===|!==|==|!=|<=|>=|\+\+|--|&&|\|\||\+|-|\*|\/|%|=|<|>|!|&|\||\^|~|\?|:)/ },
    { cls: 'punct', re: /^[{}()\[\].,;]/ },
    { cls: 'space', re: /^\s+/ },
];

function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function highlightJs(src) {
    let out = '';
    let rest = src;
    while (rest.length > 0) {
        let matched = false;
        for (const rule of JS_RULES) {
            const m = rule.re.exec(rest);
            if (!m) continue;
            let tok = m[0];
            let cls = rule.cls;
            if (cls === 'ident') {
                if (JS_KEYWORDS.has(tok)) cls = 'keyword';
                else if (/^[A-Z][A-Z0-9_]*$/.test(tok) || /^[A-Z][a-z]/.test(tok)) cls = 'cap';
            }
            if (cls === 'space') {
                out += escapeHtml(tok);
            } else {
                out += `<span class="tok-${cls}">${escapeHtml(tok)}</span>`;
            }
            rest = rest.slice(tok.length);
            matched = true;
            break;
        }
        if (!matched) {
            out += escapeHtml(rest[0]);
            rest = rest.slice(1);
        }
    }
    // trailing space keeps layout sane when source ends with newline
    return out + ' ';
}

function updateConfigHighlight() {
    configHighlight.innerHTML = highlightJs(configInput.value);
}
function syncConfigScroll() {
    const pre = configHighlight.parentElement;
    pre.scrollTop = configInput.scrollTop;
    pre.scrollLeft = configInput.scrollLeft;
}

configInput.addEventListener('input', () => { updateConfigHighlight(); syncConfigScroll(); });
configInput.addEventListener('scroll', syncConfigScroll);

// tab = indent (2 spaces) instead of focus jump
configInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Tab') {
        ev.preventDefault();
        const s = configInput.selectionStart;
        const e = configInput.selectionEnd;
        const v = configInput.value;
        configInput.value = v.slice(0, s) + '  ' + v.slice(e);
        configInput.selectionStart = configInput.selectionEnd = s + 2;
        updateConfigHighlight();
    }
});

// -----------------------------------------------------------------
// minimal markdown renderer
// -----------------------------------------------------------------

function renderMarkdown(src) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

    const renderInline = (s) => {
        let r = escapeHtml(s);
        // inline code
        r = r.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
        // bold
        r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        // italic (underscore, to avoid conflicting with *)
        r = r.replace(/(^|[^\w])_([^_\n]+)_(?=$|[^\w])/g, '$1<em>$2</em>');
        return r;
    };

    const splitRow = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((s) => s.trim());

    while (i < lines.length) {
        const line = lines[i];

        // fenced code
        const fence = /^```(\w*)\s*$/.exec(line);
        if (fence) {
            let j = i + 1;
            const body = [];
            while (j < lines.length && !/^```\s*$/.test(lines[j])) { body.push(lines[j]); j++; }
            out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
            i = j + 1;
            continue;
        }

        // heading
        const h = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
        if (h) {
            const level = Math.min(h[1].length, 4);
            out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
            i++;
            continue;
        }

        // table: header | ... followed by separator row
        if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
            const head = splitRow(line);
            i += 2;
            const rows = [];
            while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
                rows.push(splitRow(lines[i]));
                i++;
            }
            out.push(
                `<table><thead><tr>${head.map((c) => `<th>${renderInline(c)}</th>`).join('')}</tr></thead>` +
                `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
            );
            continue;
        }

        // unordered list
        if (/^\s*[-*]\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
                items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
                i++;
            }
            out.push(`<ul>${items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</ul>`);
            continue;
        }

        // blank
        if (line.trim() === '') { i++; continue; }

        // paragraph
        const para = [line];
        i++;
        while (
            i < lines.length &&
            lines[i].trim() !== '' &&
            !/^(#{1,6})\s+/.test(lines[i]) &&
            !/^```/.test(lines[i]) &&
            !/^\s*[-*]\s+/.test(lines[i])
        ) {
            para.push(lines[i]);
            i++;
        }
        out.push(`<p>${renderInline(para.join(' '))}</p>`);
    }
    return out.join('');
}

// -----------------------------------------------------------------
// status helpers
// -----------------------------------------------------------------

function setBadge(el, kind, text) {
    el.className = `badge ${kind === 'none' ? '' : kind}`.trim();
    el.textContent = text;
}
function setMsg(el, text) {
    el.textContent = text ?? '';
}

// -----------------------------------------------------------------
// state
// -----------------------------------------------------------------

let currentMachine = null;
let currentInput = null;

// -----------------------------------------------------------------
// actions
// -----------------------------------------------------------------

function buildMachine() {
    const userCode = configInput.value;
    let result;
    try {
        const fn = new Function(
            'Genby', 'STR', 'NUM', 'BUL', 'ENUM', 'ANY', 'makeEnumValue',
            userCode,
        );
        result = fn(Genby, STR, NUM, BUL, ENUM, ANY, makeEnumValue);
    } catch (err) {
        setBadge(configBadge, 'err', 'error');
        setMsg(configMsg, `config: ${err.message ?? err}`);
        return;
    }
    if (!result) {
        setBadge(configBadge, 'err', 'error');
        setMsg(configMsg, 'return a Genby or LangMachine instance');
        return;
    }
    let machine;
    try {
        machine = result instanceof Genby ? result.build() : result;
        if (typeof machine?.docs !== 'function' || typeof machine?.execute !== 'function') {
            throw new Error('returned value is not a Genby/LangMachine');
        }
    } catch (err) {
        setBadge(configBadge, 'err', 'error');
        setMsg(configMsg, `build: ${err.message ?? err}`);
        return;
    }

    currentMachine = machine;
    setBadge(configBadge, 'ok', 'built');
    const counts = summarizeMachine(machine);
    setMsg(configMsg, counts.summary);

    renderDocs(machine, counts);
    mountInput(machine);

    runBtn.disabled = false;
    setBadge(runBadge, 'none', 'idle');
    runOutput.textContent = 'no output yet';
    runOutput.classList.add('empty');
    runRight.textContent = '—';
    setMsg(runMsg, '');
}

function summarizeMachine(machine) {
    const c = machine.config;
    const parts = [];
    if (c.functions.size) parts.push(`${c.functions.size} fn`);
    if (c.directives.size) parts.push(`${c.directives.size} directive${c.directives.size === 1 ? '' : 's'}`);
    if (c.variables.size) parts.push(`${c.variables.size} var${c.variables.size === 1 ? '' : 's'}`);
    if (c.enums.size) parts.push(`${c.enums.size} enum${c.enums.size === 1 ? '' : 's'}`);
    const summary = parts.length ? parts.join(' · ') : 'empty language';
    return { summary, total: c.functions.size + c.directives.size + c.variables.size + c.enums.size };
}

function renderDocs(machine, counts) {
    try {
        const md = machine.docs();
        docsBody.innerHTML = renderMarkdown(md);
        if (docsCount) docsCount.textContent = `[ ${counts.summary} ]`;
    } catch (err) {
        docsBody.innerHTML = `<div class="md-placeholder">docs error: ${escapeHtml(String(err.message ?? err))}</div>`;
    }
}

function formatCheckErrors(errors) {
    return errors
        .map((e) => `[${e.kind}] line ${e.line}, col ${e.column}\n  ${e.message}`)
        .join('\n\n');
}

function refreshProgramCheck(input) {
    const { ok, errors } = input.check();
    if (ok) {
        programMsg.textContent = '';
        programMsg.classList.remove('err');
        programRight.textContent = 'ready';
    } else {
        programMsg.textContent = formatCheckErrors(errors);
        programMsg.classList.add('err');
        programRight.textContent = `${errors.length} error${errors.length === 1 ? '' : 's'}`;
    }
}

function mountInput(machine) {
    if (currentInput) {
        currentInput.destroy();
        currentInput = null;
    }
    genbyHost.innerHTML = '';
    const input = machine.inputDom();
    genbyHost.appendChild(input.element);
    input.setValue(DEFAULT_PROGRAM);
    input.onChange(() => refreshProgramCheck(input));
    refreshProgramCheck(input);
    currentInput = input;
}

async function runProgram() {
    if (!currentMachine || !currentInput) return;
    const source = currentInput.getValue();
    runBtn.disabled = true;
    setBadge(runBadge, 'run', 'running…');
    setMsg(runMsg, '');
    runOutput.textContent = '';
    runOutput.classList.remove('empty');
    runRight.textContent = 'running';

    const t0 = performance.now();
    try {
        const result = await currentMachine.execute(source);
        const dt = (performance.now() - t0).toFixed(1);
        setBadge(runBadge, 'ok', `ok · ${dt}ms`);
        runOutput.textContent = formatResult(result);
        runRight.textContent = `${dt}ms`;
    } catch (err) {
        const dt = (performance.now() - t0).toFixed(1);
        setBadge(runBadge, 'err', `error · ${dt}ms`);
        runRight.textContent = 'error';
        const detail = err?.genbyErrors;
        if (Array.isArray(detail) && detail.length > 0) {
            runOutput.textContent = detail
                .map((e) => `[${e.kind}] line ${e.line}, col ${e.column}\n  ${e.message}`)
                .join('\n\n');
        } else {
            runOutput.textContent = String(err.message ?? err);
        }
        setMsg(runMsg, '');
    } finally {
        runBtn.disabled = false;
    }
}

function formatResult(v) {
    if (v === undefined || v === null) return '(void)';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v && typeof v === 'object' && v.__enum) return v.name;
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

// -----------------------------------------------------------------
// wire up
// -----------------------------------------------------------------

makeBtn.addEventListener('click', buildMachine);
runBtn.addEventListener('click', runProgram);

configInput.value = DEFAULT_CONFIG;
updateConfigHighlight();
buildMachine();
