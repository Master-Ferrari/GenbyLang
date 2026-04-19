import type { Token } from '../lexer.js';
import type { GenbyError } from '../types.js';
import type { IdentCategory } from '../checker.js';

export interface HighlightInput {
  source: string;
  tokens: Token[];
  identInfo: Map<number, IdentCategory>;
  errors: GenbyError[];
  /** Line offsets — indexOf each '\n' so we can convert line/col to absolute offset. */
}

/** Build HTML for the highlighted overlay. */
export function highlightToHtml(input: HighlightInput): string {
  const { source, tokens, identInfo, errors } = input;

  // Build per-character error ranges as (start, end) in offsets.
  const lineStarts = computeLineStarts(source);
  const errorRanges: Array<{ start: number; end: number }> = errors.map((e) => {
    const lineIdx = Math.max(0, e.line - 1);
    const base = lineStarts[lineIdx] ?? 0;
    const start = base + Math.max(0, e.column - 1);
    const end = start + Math.max(1, e.length);
    return { start, end };
  });

  const classOf = (tok: Token): string | null => {
    switch (tok.kind) {
      case 'NUMBER':
        return 'genby-tok-number';
      case 'STRING_START':
      case 'STRING_END':
      case 'STRING_TEXT':
        return 'genby-tok-string';
      case 'INTERP_OPEN':
      case 'INTERP_CLOSE':
        return 'genby-tok-interp';
      case 'COMMENT':
        return 'genby-tok-comment';
      case 'AT':
        return 'genby-tok-directive';
      case 'PLUS':
      case 'MINUS':
      case 'STAR':
      case 'SLASH':
      case 'EQ':
      case 'EQEQ':
      case 'NEQ':
      case 'LT':
      case 'GT':
      case 'LE':
      case 'GE':
        return 'genby-tok-op';
      case 'LPAREN':
      case 'RPAREN':
      case 'COMMA':
        return 'genby-tok-punct';
      case 'IDENT': {
        const cat = identInfo.get(tok.start);
        if (cat === 'function_name') return 'genby-tok-function';
        if (cat === 'directive_name') return 'genby-tok-directive';
        if (cat === 'enum_value') return 'genby-tok-enum';
        if (cat === 'external_var') return 'genby-tok-ext-var';
        if (cat === 'local_var') return 'genby-tok-local-var';
        return 'genby-tok-ident';
      }
      default:
        return null;
    }
  };

  // Emit characters in order; use tokens as segment guide. Fill gaps with raw source.
  let out = '';
  let cursor = 0;

  const emitRaw = (text: string, classes: string[]) => {
    if (text.length === 0) return;
    if (classes.length === 0) {
      out += escapeHtml(text);
    } else {
      out += `<span class="${classes.join(' ')}">${escapeHtml(text)}</span>`;
    }
  };

  const emitRange = (start: number, end: number, baseClass: string | null) => {
    if (start >= end) return;
    // Split by error-range boundaries.
    const boundaries = new Set<number>([start, end]);
    for (const r of errorRanges) {
      if (r.end <= start || r.start >= end) continue;
      boundaries.add(Math.max(start, r.start));
      boundaries.add(Math.min(end, r.end));
    }
    const sorted = [...boundaries].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      const inError = errorRanges.some((r) => r.start < b && r.end > a);
      const classes: string[] = [];
      if (baseClass) classes.push(baseClass);
      if (inError) classes.push('genby-error');
      emitRaw(source.slice(a, b), classes);
    }
  };

  for (const tok of tokens) {
    if (tok.kind === 'EOF') continue;
    if (tok.start > cursor) {
      emitRange(cursor, tok.start, null);
    }
    emitRange(tok.start, tok.end, classOf(tok));
    cursor = tok.end;
  }
  if (cursor < source.length) {
    emitRange(cursor, source.length, null);
  }

  // Trailing newline to ensure the last line has height.
  out += '\n';
  return out;
}

function computeLineStarts(source: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
