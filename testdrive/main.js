import {
    Genby,
    STR,
    NUM,
    BUL,
    ENUM,
    makeEnumValue,
} from '../dist/index.js';

const DEFAULT_CONFIG = `// declare your language here.
// available in scope: Genby, STR, NUM, BUL, ENUM, makeEnumValue.
// IF_THEN_ELSE is a built-in special form — no need to register it.
// return the configured Genby instance at the end.

const g = new Genby();

g.addFunction({
    name: 'SOME_PROCESS',
    describe: 'toy async processor: trims and upper-cases the input',
    args: [{ name: 'text', type: STR, describe: 'text to process' }],
    returns: STR,
    handler: async ([text]) => String(text ?? '').trim().toUpperCase(),
});

return g;
`;

const DEFAULT_PROGRAM = `x = SOME_PROCESS("  hello world  ")
y = IF_THEN_ELSE(x == "HELLO WORLD", "match", "no match")
RETURN("{x} — {y}")
`;

const configInput = document.getElementById('configInput');
const makeBtn = document.getElementById('makeBtn');
const configStatus = document.getElementById('configStatus');
const docsDetails = document.getElementById('docsDetails');
const docsBody = document.getElementById('docsBody');
const genbyHost = document.getElementById('genbyHost');
const runBtn = document.getElementById('runBtn');
const runStatus = document.getElementById('runStatus');
const runOutput = document.getElementById('runOutput');

configInput.value = DEFAULT_CONFIG;

let currentMachine = null;
let currentInput = null;

function setStatus(el, text, kind) {
    el.textContent = text;
    el.className = kind === 'error' ? 'error' : kind === 'success' ? 'success' : 'empty';
}

function buildMachine() {
    const userCode = configInput.value;
    let result;
    try {
        const fn = new Function(
            'Genby', 'STR', 'NUM', 'BUL', 'ENUM', 'makeEnumValue',
            userCode,
        );
        result = fn(Genby, STR, NUM, BUL, ENUM, makeEnumValue);
    } catch (err) {
        setStatus(configStatus, `config error: ${err.message ?? err}`, 'error');
        return;
    }
    if (!result) {
        setStatus(configStatus, 'config error: return a Genby or LangMachine instance', 'error');
        return;
    }
    let machine;
    try {
        machine = result instanceof Genby ? result.build() : result;
        if (typeof machine?.docs !== 'function' || typeof machine?.execute !== 'function') {
            throw new Error('returned value is not a Genby/LangMachine');
        }
    } catch (err) {
        setStatus(configStatus, `build error: ${err.message ?? err}`, 'error');
        return;
    }

    currentMachine = machine;
    setStatus(configStatus, 'built', 'success');
    renderDocs(machine);
    mountInput(machine);
    runBtn.disabled = false;
    setStatus(runStatus, 'idle', 'empty');
    runOutput.textContent = '';
}

function renderDocs(machine) {
    try {
        docsBody.textContent = machine.docs();
    } catch (err) {
        docsBody.textContent = `docs error: ${err.message ?? err}`;
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
    currentInput = input;
}

async function runProgram() {
    if (!currentMachine || !currentInput) return;
    const source = currentInput.getValue();
    runBtn.disabled = true;
    setStatus(runStatus, 'running…', 'empty');
    runOutput.textContent = '';
    try {
        const result = await currentMachine.execute(source);
        setStatus(runStatus, 'ok', 'success');
        runOutput.textContent = formatResult(result);
    } catch (err) {
        setStatus(runStatus, `error: ${err.message ?? err}`, 'error');
        const detail = err?.genbyErrors;
        if (Array.isArray(detail) && detail.length > 0) {
            runOutput.textContent = detail
                .map((e) => `[${e.kind}] line ${e.line}, col ${e.column}: ${e.message}`)
                .join('\n');
        }
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

makeBtn.addEventListener('click', buildMachine);
runBtn.addEventListener('click', runProgram);

buildMachine();
