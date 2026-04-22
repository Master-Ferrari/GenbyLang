import { lex, type Token } from '../lexer.js';
import { parse } from '../parser.js';
import { check, type IdentCategory } from '../checker.js';
import { isBuiltinType } from '../config.js';
import type { LangMachine } from '../genby.js';
import type { CheckResult, GenbyError } from '../types.js';
import { highlightToHtml } from './highlight.js';
import {
  buildContext,
  computeSuggestions,
  getActiveArgSpec,
  resolveSignature,
  type AutocompleteContext,
  type Suggestion,
  type SignatureInfo,
} from './autocomplete.js';
import type { ArgSpec } from '../types.js';
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
  const sigHint = doc.createElement('div');
  sigHint.className = 'genby-input__sighint';
  sigHint.setAttribute('data-open', 'false');

  stack.appendChild(highlight);
  stack.appendChild(textarea);
  stack.appendChild(sigHint);
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
  let sigHintOpen = false;

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

    // Signature hint is independent of the completion popup.
    updateSignatureHint(ctx);

    const activeArg = getActiveArgSpec(machine.config, ctx);
    const enumAutoOpen =
      ctx.currentWord.length === 0 &&
      !ctx.afterAt &&
      activeArg?.type === 'ENUM' &&
      !!activeArg.enumKey;

    if (ctx.currentWord.length === 0 && !ctx.afterAt && !enumAutoOpen) {
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

  function updateSignatureHint(ctx: AutocompleteContext): void {
    const sig = resolveSignature(machine.config, ctx);
    if (!sig) {
      hideSignatureHint();
      return;
    }
    renderSignatureHint(sig);
    positionSignatureHint();
    sigHint.setAttribute('data-open', 'true');
    sigHintOpen = true;
  }

  function hideSignatureHint(): void {
    if (!sigHintOpen) return;
    sigHint.setAttribute('data-open', 'false');
    sigHintOpen = false;
  }

  function renderSignatureHint(sig: SignatureInfo): void {
    sigHint.innerHTML = '';
    const head = doc.createElement('span');
    head.className = 'genby-input__sighint-name';
    head.textContent = sig.kind === 'directive' ? `@${sig.name}` : sig.name;
    sigHint.appendChild(head);
    const open = doc.createElement('span');
    open.className = 'genby-input__sighint-punct';
    open.textContent = '(';
    sigHint.appendChild(open);

    sig.args.forEach((arg, i) => {
      if (i > 0) {
        const sep = doc.createElement('span');
        sep.className = 'genby-input__sighint-punct';
        sep.textContent = ', ';
        sigHint.appendChild(sep);
      }
      const slot = doc.createElement('span');
      slot.className = 'genby-input__sighint-arg';
      if (i === sig.activeIndex) slot.setAttribute('data-active', 'true');
      slot.appendChild(buildArgLabel(arg));
      sigHint.appendChild(slot);
    });

    const close = doc.createElement('span');
    close.className = 'genby-input__sighint-punct';
    close.textContent = ')';
    sigHint.appendChild(close);

    if (sig.returns && sig.returns !== 'VOID') {
      const ret = doc.createElement('span');
      ret.className = 'genby-input__sighint-return';
      ret.textContent = ` → ${sig.returns}`;
      sigHint.appendChild(ret);
    }

    const activeArg = sig.args[sig.activeIndex];
    if (activeArg?.describe) {
      const desc = doc.createElement('div');
      desc.className = 'genby-input__sighint-desc';
      desc.textContent = activeArg.describe;
      sigHint.appendChild(desc);
    }
  }

  function buildArgLabel(arg: ArgSpec): HTMLElement {
    const wrap = doc.createElement('span');
    const nm = doc.createElement('span');
    nm.className = 'genby-input__sighint-argname';
    const decoration = arg.rest ? '...' : '';
    const suffix = arg.optional && !arg.rest ? '?' : '';
    nm.textContent = `${decoration}${arg.name}${suffix}`;
    wrap.appendChild(nm);
    const colon = doc.createElement('span');
    colon.className = 'genby-input__sighint-punct';
    colon.textContent = ': ';
    wrap.appendChild(colon);
    const ty = doc.createElement('span');
    ty.className = 'genby-input__sighint-type';
    ty.setAttribute('data-type', arg.type);
    if (!isBuiltinType(arg.type)) {
      ty.setAttribute('data-custom', 'true');
    }
    ty.textContent =
      arg.type === 'ENUM' ? `ENUM<${arg.enumKey ?? '?'}>` : arg.type;
    wrap.appendChild(ty);
    return wrap;
  }

  function positionSignatureHint(): void {
    const cursor = textarea.selectionStart ?? 0;
    const coords = getCaretCoordinates(textarea, cursor);
    // Anchor below the caret line, plus a half-line gap.
    const top = coords.top + coords.height + coords.height * 0.5;
    sigHint.style.top = `${top}px`;
    sigHint.style.left = `${coords.left}px`;
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
    let top = coords.top + coords.height + coords.height * 0.5;
    if (sigHintOpen) {
      // Stack the completion popup under the signature hint.
      top += sigHint.offsetHeight + 4;
    }
    popup.style.top = `${top}px`;
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

  function onCaretMove(): void {
    // Refresh popup/signature hint on caret move without input (arrows, clicks).
    updatePopup();
  }

  textarea.addEventListener('input', onInput);
  textarea.addEventListener('scroll', syncScroll);
  textarea.addEventListener('keydown', onKeydown);
  textarea.addEventListener('keyup', onCaretMove);
  textarea.addEventListener('click', onCaretMove);
  textarea.addEventListener('focus', onCaretMove);
  textarea.addEventListener('blur', () => {
    // Slight delay to let mousedown on popup items land first.
    setTimeout(() => {
      hidePopup();
      hideSignatureHint();
    }, 100);
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
      hideSignatureHint();
      textarea.removeEventListener('input', onInput);
      textarea.removeEventListener('scroll', syncScroll);
      textarea.removeEventListener('keydown', onKeydown);
      textarea.removeEventListener('keyup', onCaretMove);
      textarea.removeEventListener('click', onCaretMove);
      textarea.removeEventListener('focus', onCaretMove);
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
