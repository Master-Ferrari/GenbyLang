import type { LangConfig } from '../config.js';

export interface Suggestion {
  label: string;
  detail: string;
  /** 'function' | 'variable' | 'enum' | 'directive' | 'local' */
  kind: 'function' | 'variable' | 'enum' | 'directive' | 'local';
  /** Text to insert in place of the current token. */
  insertText: string;
}

export interface AutocompleteContext {
  /** Text up to the cursor. */
  before: string;
  /** Text after the cursor. */
  after: string;
  /** The identifier token currently under the cursor (may be empty). */
  currentWord: string;
  /** Absolute offset of the start of currentWord. */
  wordStart: number;
  /** True if the cursor is at the start of an identifier after '@'. */
  afterAt: boolean;
  /** True if the cursor is inside a function call — we can scope by expected arg type. */
  insideCall: { name: string; argIndex: number } | null;
}

const IDENT_START = /[a-zA-Z_]/;
const IDENT_CONT = /[a-zA-Z0-9_]/;

export function buildContext(
  source: string,
  cursor: number,
): AutocompleteContext {
  // Find the current identifier prefix.
  let wordStart = cursor;
  while (wordStart > 0 && IDENT_CONT.test(source[wordStart - 1] ?? '')) {
    wordStart -= 1;
  }
  const currentWord = source.slice(wordStart, cursor);
  const afterAt = wordStart > 0 && source[wordStart - 1] === '@';

  // Quick call-context detection: walk backwards, tracking paren depth and commas.
  // Ignore content inside strings.
  const insideCall = detectCallContext(source, cursor);

  return {
    before: source.slice(0, cursor),
    after: source.slice(cursor),
    currentWord,
    wordStart,
    afterAt,
    insideCall,
  };
}

function detectCallContext(
  source: string,
  cursor: number,
): { name: string; argIndex: number } | null {
  let depth = 0;
  let argIndex = 0;
  let inString = false;
  let i = cursor - 1;
  while (i >= 0) {
    const ch = source[i]!;
    // Handle line comments naively: if we see `//` on a line (not in string), skip back past newline.
    if (inString) {
      if (ch === '"' && source[i - 1] !== '\\') inString = false;
      i -= 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      i -= 1;
      continue;
    }
    if (ch === ')') {
      depth += 1;
      i -= 1;
      continue;
    }
    if (ch === '(') {
      if (depth === 0) {
        // Found our opener. Read identifier backwards.
        let j = i - 1;
        while (j >= 0 && /\s/.test(source[j] ?? '')) j -= 1;
        const nameEnd = j + 1;
        while (j >= 0 && IDENT_CONT.test(source[j] ?? '')) j -= 1;
        const name = source.slice(j + 1, nameEnd);
        if (name.length === 0 || !IDENT_START.test(name[0] ?? '')) return null;
        return { name, argIndex };
      }
      depth -= 1;
      i -= 1;
      continue;
    }
    if (ch === ',' && depth === 0) {
      argIndex += 1;
      i -= 1;
      continue;
    }
    i -= 1;
  }
  return null;
}

export function computeSuggestions(
  config: LangConfig,
  context: AutocompleteContext,
  localVars: Map<string, unknown>,
): Suggestion[] {
  const prefix = context.currentWord;
  const results: Suggestion[] = [];

  if (context.afterAt) {
    for (const d of config.directives.values()) {
      if (startsWith(d.name, prefix)) {
        results.push({
          label: d.name,
          detail: 'directive',
          kind: 'directive',
          insertText: d.name,
        });
      }
    }
    return sortAndDedupe(results, prefix);
  }

  // Scope enum candidates to the expected argument type if possible.
  const expectedEnum = scopeEnumFromContext(config, context);

  if (expectedEnum) {
    const e = config.enums.get(expectedEnum);
    if (e) {
      for (const v of e.values) {
        if (startsWith(v.name, prefix)) {
          results.push({
            label: v.name,
            detail: `enum ${expectedEnum}`,
            kind: 'enum',
            insertText: v.name,
          });
        }
      }
    }
    // Also allow local/external variables of matching type — skipped here for simplicity.
    return sortAndDedupe(results, prefix);
  }

  // General suggestions.
  for (const fn of config.functions.values()) {
    if (startsWith(fn.name, prefix)) {
      results.push({
        label: fn.name,
        detail: 'function',
        kind: 'function',
        insertText: `${fn.name}(`,
      });
    }
  }
  if (config.builtinIfThenElse && startsWith('IF_THEN_ELSE', prefix)) {
    results.push({
      label: 'IF_THEN_ELSE',
      detail: 'built-in',
      kind: 'function',
      insertText: 'IF_THEN_ELSE(',
    });
  }
  if (startsWith('RETURN', prefix)) {
    results.push({
      label: 'RETURN',
      detail: 'built-in',
      kind: 'function',
      insertText: 'RETURN(',
    });
  }
  for (const v of config.variables.values()) {
    if (startsWith(v.name, prefix)) {
      results.push({
        label: v.name,
        detail: `variable ${v.type}`,
        kind: 'variable',
        insertText: v.name,
      });
    }
  }
  for (const name of localVars.keys()) {
    if (startsWith(name, prefix)) {
      results.push({
        label: name,
        detail: 'local',
        kind: 'local',
        insertText: name,
      });
    }
  }
  for (const [v, enumKey] of config.enumValueIndex) {
    if (startsWith(v, prefix)) {
      results.push({
        label: v,
        detail: `enum ${enumKey}`,
        kind: 'enum',
        insertText: v,
      });
    }
  }
  return sortAndDedupe(results, prefix);
}

function scopeEnumFromContext(
  config: LangConfig,
  context: AutocompleteContext,
): string | null {
  const call = context.insideCall;
  if (!call) return null;
  const fn = config.functions.get(call.name);
  if (!fn) return null;
  const argSpec = fn.args[call.argIndex] ?? fn.args[fn.args.length - 1];
  if (!argSpec) return null;
  if (argSpec.type !== 'ENUM' || !argSpec.enumKey) return null;
  return argSpec.enumKey;
}

function startsWith(name: string, prefix: string): boolean {
  if (prefix.length === 0) return true;
  return name.toLowerCase().startsWith(prefix.toLowerCase());
}

function sortAndDedupe(items: Suggestion[], prefix: string): Suggestion[] {
  const seen = new Set<string>();
  const uniq: Suggestion[] = [];
  for (const s of items) {
    if (seen.has(s.label)) continue;
    seen.add(s.label);
    uniq.push(s);
  }
  uniq.sort((a, b) => {
    // Prefer exact-prefix over case-insensitive.
    const ea = a.label.startsWith(prefix) ? 0 : 1;
    const eb = b.label.startsWith(prefix) ? 0 : 1;
    if (ea !== eb) return ea - eb;
    return a.label.localeCompare(b.label);
  });
  return uniq;
}
