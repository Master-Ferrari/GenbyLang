import { lex, type Token } from '../lexer.js';
import { parse } from '../parser.js';
import { check, type IdentCategory } from '../checker.js';
import type { LangMachine } from '../genby.js';
import type { CheckResult, GenbyError } from '../types.js';
import { highlightToHtml } from './highlight.js';
import {
  buildContext,
  computeSuggestions,
  type Suggestion,
} from './autocomplete.js';
import { ensureStylesInjected } from './styles.js';

export type Unsubscribe = () => void;

export interface GenbyInput {
  element: HTMLElement;
  getValue(): string;
  setValue(text: string): void;
  onChange(cb: (text: string) => void): Unsubscribe;
  check(): CheckResult;
  destroy(): void;
}

export function createInputDom(machine: LangMachine): GenbyInput {
  const doc = globalThis.document;
  if (!doc) {
    throw new Error('Genby inputDom requires a DOM environment');
  }
  ensureStylesInjected(doc);

  const root = doc.createElement('div');
  root.className = 'genby-input';
  const stack = doc.createElement('div');
  stack.className = 'genby-input__stack';
  const highlight = doc.createElement('pre');
  highlight.className = 'genby-input__highlight';
  highlight.setAttribute('aria-hidden', 'true');
  const code = doc.createElement('code');
  highlight.appendChild(code);
  const textarea = doc.createElement('textarea');
  textarea.className = 'genby-input__textarea';
  textarea.setAttribute('spellcheck', 'false');
  textarea.setAttribute('autocomplete', 'off');
  textarea.setAttribute('autocorrect', 'off');
  textarea.setAttribute('autocapitalize', 'off');
  const popup = doc.createElement('div');
  popup.className = 'genby-input__popup';
  popup.setAttribute('data-open', 'false');

  stack.appendChild(highlight);
  stack.appendChild(textarea);
  stack.appendChild(popup);
  root.appendChild(stack);

  const listeners = new Set<(text: string) => void>();

  type State = {
    tokens: Token[];
    identInfo: Map<number, IdentCategory>;
    errors: GenbyError[];
    locals: Map<string, unknown>;
  };

  let state: State = emptyState();
  let suggestions: Suggestion[] = [];
  let selectedIdx = 0;
  let popupOpen = false;

  function emptyState(): State {
    return {
      tokens: [],
      identInfo: new Map(),
      errors: [],
      locals: new Map(),
    };
  }

  function render(): void {
    const source = textarea.value;
    const { tokens, errors: lexErrs } = lex(source);
    const { program, errors: parseErrs } = parse(tokens);
    const checkResult = check(program, machine.config);
    const errors: GenbyError[] = [...lexErrs, ...parseErrs, ...checkResult.errors];
    state = {
      tokens,
      identInfo: checkResult.identInfo,
      errors,
      locals: checkResult.locals,
    };
    code.innerHTML = highlightToHtml({
      source,
      tokens,
      identInfo: checkResult.identInfo,
      errors,
    });
  }

  function syncScroll(): void {
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
  }

  function updatePopup(): void {
    const ctx = buildContext(textarea.value, textarea.selectionStart ?? 0);
    if (ctx.currentWord.length === 0 && !ctx.afterAt) {
      hidePopup();
      return;
    }
    const items = computeSuggestions(machine.config, ctx, state.locals);
    if (items.length === 0) {
      hidePopup();
      return;
    }
    suggestions = items;
    selectedIdx = 0;
    renderPopupItems();
    positionPopup();
    popup.setAttribute('data-open', 'true');
    popupOpen = true;
  }

  function hidePopup(): void {
    if (!popupOpen) return;
    popup.setAttribute('data-open', 'false');
    popupOpen = false;
    suggestions = [];
  }

  function renderPopupItems(): void {
    popup.innerHTML = '';
    suggestions.forEach((s, i) => {
      const row = doc.createElement('div');
      row.className = 'genby-input__popup-item';
      row.setAttribute('data-selected', String(i === selectedIdx));
      const label = doc.createElement('span');
      label.textContent = s.label;
      const detail = doc.createElement('span');
      detail.className = 'genby-input__popup-detail';
      detail.textContent = s.detail;
      row.appendChild(label);
      row.appendChild(detail);
      row.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        applySuggestion(i);
      });
      popup.appendChild(row);
    });
  }

  function positionPopup(): void {
    // Approximate caret position via a mirror div.
    const cursor = textarea.selectionStart ?? 0;
    const coords = getCaretCoordinates(textarea, cursor);
    popup.style.top = `${coords.top + coords.height}px`;
    popup.style.left = `${coords.left}px`;
  }

  function applySuggestion(index: number): void {
    const s = suggestions[index];
    if (!s) return;
    const cursor = textarea.selectionStart ?? 0;
    const ctx = buildContext(textarea.value, cursor);
    const before = textarea.value.slice(0, ctx.wordStart);
    const after = textarea.value.slice(cursor);
    const newValue = before + s.insertText + after;
    const newCursor = (before + s.insertText).length;
    textarea.value = newValue;
    textarea.setSelectionRange(newCursor, newCursor);
    hidePopup();
    onInput();
  }

  function onInput(): void {
    render();
    syncScroll();
    for (const cb of listeners) cb(textarea.value);
    updatePopup();
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (!popupOpen) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      selectedIdx = (selectedIdx + 1) % suggestions.length;
      renderPopupItems();
      return;
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      selectedIdx =
        (selectedIdx - 1 + suggestions.length) % suggestions.length;
      renderPopupItems();
      return;
    }
    if (ev.key === 'Enter' || ev.key === 'Tab') {
      if (suggestions.length > 0) {
        ev.preventDefault();
        applySuggestion(selectedIdx);
      }
      return;
    }
    if (ev.key === 'Escape') {
      hidePopup();
      ev.stopPropagation();
    }
  }

  textarea.addEventListener('input', onInput);
  textarea.addEventListener('scroll', syncScroll);
  textarea.addEventListener('keydown', onKeydown);
  textarea.addEventListener('blur', () => {
    // Slight delay to let mousedown on popup items land first.
    setTimeout(hidePopup, 100);
  });

  // Initial render.
  render();

  return {
    element: root,
    getValue: () => textarea.value,
    setValue: (text: string) => {
      textarea.value = text;
      onInput();
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    check(): CheckResult {
      return { ok: state.errors.length === 0, errors: state.errors };
    },
    destroy() {
      listeners.clear();
      hidePopup();
      textarea.removeEventListener('input', onInput);
      textarea.removeEventListener('scroll', syncScroll);
      textarea.removeEventListener('keydown', onKeydown);
      root.remove();
    },
  };
}

interface CaretCoords {
  top: number;
  left: number;
  height: number;
}

/**
 * Approximate the caret's pixel position inside a textarea by rendering a
 * mirror div that copies the textarea's styling.
 */
function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number,
): CaretCoords {
  const doc = textarea.ownerDocument;
  const mirror = doc.createElement('div');
  const style = getComputedStyle(textarea);
  const props = [
    'boxSizing',
    'width',
    'height',
    'overflowX',
    'overflowY',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'fontStyle',
    'fontVariant',
    'fontWeight',
    'fontStretch',
    'fontSize',
    'fontSizeAdjust',
    'lineHeight',
    'fontFamily',
    'textAlign',
    'textTransform',
    'textIndent',
    'letterSpacing',
    'wordSpacing',
    'tabSize',
    'whiteSpace',
    'wordWrap',
    'wordBreak',
  ] as const;
  for (const p of props) {
    (mirror.style as unknown as Record<string, string>)[p] = (
      style as unknown as Record<string, string>
    )[p] ?? '';
  }
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.top = '0';
  mirror.style.left = '0';
  mirror.style.overflow = 'hidden';

  const value = textarea.value.slice(0, position);
  mirror.textContent = value;
  const marker = doc.createElement('span');
  marker.textContent = textarea.value[position] ?? '.';
  mirror.appendChild(marker);
  doc.body.appendChild(mirror);
  const markerRect = marker.getBoundingClientRect();
  const taRect = textarea.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const top =
    markerRect.top - mirrorRect.top - textarea.scrollTop + taRect.top -
    taRect.top;
  const left =
    markerRect.left - mirrorRect.left - textarea.scrollLeft + taRect.left -
    taRect.left;
  const height = markerRect.height || parseFloat(style.lineHeight) || 14;
  doc.body.removeChild(mirror);
  return { top, left, height };
}
