import {
    Genby,
    STR,
    NUM,
    BUL,
    ENUM,
    ANY,
    makeEnumValue,
} from '../dist/index.js';
import { EXAMPLES } from './examples.js';

// -----------------------------------------------------------------
// dom refs
// -----------------------------------------------------------------

const configInput = document.getElementById('configInput');
const configHighlight = document.getElementById('configHighlight');
const configEdit = document.getElementById('configEdit');
const configBadge = document.getElementById('configBadge');
const configMsg = document.getElementById('configMsg');

const docsBody = document.getElementById('docsBody');
const docsCount = document.getElementById('docsCount');

const genbyHost = document.getElementById('genbyHost');
const programRight = document.getElementById('programRight');
const programMsg = document.getElementById('programMsg');
const prettifyBtn = document.getElementById('prettifyBtn');

const runBtn = document.getElementById('runBtn');
const runBadge = document.getElementById('runBadge');
const runMsg = document.getElementById('runMsg');
const runOutput = document.getElementById('runOutput');
// const runRight = document.getElementById('runRight');

const installBtn = document.getElementById('installBtn');
const installLabel = document.getElementById('installLabel');

const exampleSelect = document.getElementById('exampleSelect');
const exampleSelectTrigger = document.getElementById('exampleSelectTrigger');
const exampleSelectLabel = document.getElementById('exampleSelectLabel');
const exampleSelectPopup = document.getElementById('exampleSelectPopup');

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

let buildDebounce = 0;
function scheduleRebuild() {
    clearTimeout(buildDebounce);
    buildDebounce = setTimeout(() => {
        buildDebounce = 0;
        buildMachine();
    }, 400);
}

configInput.addEventListener('input', () => {
    updateConfigHighlight();
    syncConfigScroll();
    scheduleRebuild();
});
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

        // horizontal rule
        if (/^\s*-{3,}\s*$/.test(line)) {
            out.push('<hr />');
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
            !/^\s*[-*]\s+/.test(lines[i]) &&
            !/^\s*-{3,}\s*$/.test(lines[i])
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
let currentProgram = EXAMPLES[0]?.program ?? '';

// -----------------------------------------------------------------
// actions
// -----------------------------------------------------------------

// strip top-level `import ... from '...'` lines so the example can read like
// real project code (with the genby import at the top), while still running
// inside `new Function` where Genby, STR, NUM, ... are injected as arguments.
function stripImports(src) {
    return src.replace(
        /^[\t ]*import\s[\s\S]*?from\s+['"][^'"]+['"]\s*;?[\t ]*\r?\n?/gm,
        '',
    );
}

function buildMachine() {
    const userCode = stripImports(configInput.value);
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
    // runRight.textContent = '—';
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
    input.setValue(currentProgram);
    input.onChange(() => {
        currentProgram = input.getValue();
        refreshProgramCheck(input);
    });
    refreshProgramCheck(input);
    currentInput = input;
    if (prettifyBtn) prettifyBtn.disabled = false;
}

async function runProgram() {
    if (!currentMachine || !currentInput) return;
    const source = currentInput.getValue();
    runBtn.disabled = true;
    setBadge(runBadge, 'run', 'running…');
    setMsg(runMsg, '');
    runOutput.textContent = '';
    runOutput.classList.remove('empty');
    // runRight.textContent = 'running';

    const t0 = performance.now();
    try {
        const result = await currentMachine.execute(source);
        const dt = (performance.now() - t0).toFixed(1);
        setBadge(runBadge, 'ok', `ok · ${dt}ms`);
        runOutput.textContent = formatResult(result);
        // runRight.textContent = `${dt}ms`;
    } catch (err) {
        const dt = (performance.now() - t0).toFixed(1);
        setBadge(runBadge, 'err', `error · ${dt}ms`);
        // runRight.textContent = 'error';
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

runBtn.addEventListener('click', runProgram);

if (prettifyBtn) {
    prettifyBtn.addEventListener('click', () => {
        if (!currentInput) return;
        currentInput.prettify();
    });
}

// vertical resize handles
document.querySelectorAll('.resizeHandle[data-resize-target]').forEach((handle) => {
    const selector = handle.getAttribute('data-resize-target');
    handle.addEventListener('mousedown', (e) => {
        const target = document.querySelector(selector);
        if (!target) return;
        e.preventDefault();
        handle.classList.add('active');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';

        const startY = e.clientY;
        const startHeight = target.getBoundingClientRect().height;
        const minHeight = 80;

        const onMove = (ev) => {
            const dy = ev.clientY - startY;
            target.style.height = Math.max(minHeight, startHeight + dy) + 'px';
        };
        const onUp = () => {
            handle.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });
});

// -----------------------------------------------------------------
// examples dropdown (custom)
// -----------------------------------------------------------------

let selectedExampleId = null;
let activeExampleIndex = -1;

function populateExamples() {
    if (!exampleSelectPopup) return;
    exampleSelectPopup.innerHTML = '';
    EXAMPLES.forEach((ex, idx) => {
        const li = document.createElement('li');
        li.className = 'example-select__option';
        li.setAttribute('role', 'option');
        li.dataset.value = ex.id;
        li.dataset.index = String(idx);
        li.textContent = ex.label;
        li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectExample(ex.id);
            closeExamplePopup();
        });
        li.addEventListener('mouseenter', () => setActiveIndex(idx));
        exampleSelectPopup.appendChild(li);
    });
}

function syncExampleUi() {
    if (!exampleSelectPopup) return;
    const options = exampleSelectPopup.querySelectorAll('.example-select__option');
    options.forEach((el) => {
        const isSelected = el.dataset.value === selectedExampleId;
        el.classList.toggle('is-selected', isSelected);
        const idx = Number(el.dataset.index);
        el.classList.toggle('is-active', idx === activeExampleIndex);
        if (isSelected) el.setAttribute('aria-selected', 'true');
        else el.removeAttribute('aria-selected');
    });
    if (exampleSelectLabel) {
        const ex = EXAMPLES.find((e) => e.id === selectedExampleId);
        exampleSelectLabel.textContent = ex?.label ?? '';
    }
}

function setActiveIndex(idx) {
    if (idx < 0 || idx >= EXAMPLES.length) return;
    activeExampleIndex = idx;
    syncExampleUi();
    const el = exampleSelectPopup?.querySelector(`.example-select__option[data-index="${idx}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
}

function openExamplePopup() {
    if (!exampleSelect || !exampleSelectPopup) return;
    exampleSelectPopup.hidden = false;
    exampleSelect.classList.add('is-open');
    exampleSelectTrigger?.setAttribute('aria-expanded', 'true');
    const selectedIdx = EXAMPLES.findIndex((e) => e.id === selectedExampleId);
    activeExampleIndex = selectedIdx >= 0 ? selectedIdx : 0;
    syncExampleUi();
    const el = exampleSelectPopup.querySelector(`.example-select__option[data-index="${activeExampleIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
}

function closeExamplePopup() {
    if (!exampleSelect || !exampleSelectPopup) return;
    exampleSelectPopup.hidden = true;
    exampleSelect.classList.remove('is-open');
    exampleSelectTrigger?.setAttribute('aria-expanded', 'false');
}

function toggleExamplePopup() {
    if (exampleSelectPopup?.hidden) openExamplePopup();
    else closeExamplePopup();
}

function selectExample(id) {
    const ex = EXAMPLES.find((e) => e.id === id) ?? EXAMPLES[0];
    if (!ex) return;
    selectedExampleId = ex.id;
    syncExampleUi();
    currentProgram = ex.program;
    configInput.value = ex.config;
    updateConfigHighlight();
    syncConfigScroll();
    buildMachine();
}

if (exampleSelect && exampleSelectTrigger && exampleSelectPopup) {
    populateExamples();

    exampleSelectTrigger.addEventListener('click', (e) => {
        e.preventDefault();
        toggleExamplePopup();
    });

    exampleSelectTrigger.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (exampleSelectPopup.hidden) openExamplePopup();
        } else if (e.key === 'Escape') {
            if (!exampleSelectPopup.hidden) { e.preventDefault(); closeExamplePopup(); }
        }
    });

    exampleSelect.addEventListener('keydown', (e) => {
        if (exampleSelectPopup.hidden) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex(Math.min(EXAMPLES.length - 1, activeExampleIndex + 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex(Math.max(0, activeExampleIndex - 1));
        } else if (e.key === 'Home') {
            e.preventDefault();
            setActiveIndex(0);
        } else if (e.key === 'End') {
            e.preventDefault();
            setActiveIndex(EXAMPLES.length - 1);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const ex = EXAMPLES[activeExampleIndex];
            if (ex) selectExample(ex.id);
            closeExamplePopup();
            exampleSelectTrigger.focus();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeExamplePopup();
            exampleSelectTrigger.focus();
        }
    });

    document.addEventListener('mousedown', (e) => {
        if (exampleSelectPopup.hidden) return;
        if (exampleSelect.contains(e.target)) return;
        closeExamplePopup();
    });

    window.addEventListener('blur', () => closeExamplePopup());
    window.addEventListener('resize', () => closeExamplePopup());
    // Capture-phase scroll listener: closes the popup when the page (or any
    // ancestor) scrolls and the popup would drift away. Must ignore scrolls
    // originating inside the popup itself — otherwise dragging the scrollbar
    // or wheel-scrolling the options dismisses the menu.
    window.addEventListener(
        'scroll',
        (e) => {
            if (exampleSelectPopup.hidden) return;
            const t = e.target;
            if (t instanceof Node && exampleSelectPopup.contains(t)) return;
            closeExamplePopup();
        },
        true,
    );
}

const initialExample = EXAMPLES[0];
if (initialExample) {
    selectedExampleId = initialExample.id;
    syncExampleUi();
}
configInput.value = initialExample?.config ?? '';
updateConfigHighlight();
buildMachine();
