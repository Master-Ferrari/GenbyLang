import { lex, type Token } from '../lexer.js';
import { parse } from '../parser.js';
import { check, type IdentCategory, type ResolvedType } from '../checker.js';
import { isBuiltinType, RETURN } from '../config.js';
import type { LangMachine } from '../genby.js';
import type { CheckResult, GenbyError } from '../types.js';
import { STR, NUM, BUL, ENUM, ANY } from '../types.js';
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
  const errHint = doc.createElement('div');
  errHint.className = 'genby-input__errhint';
  errHint.setAttribute('data-open', 'false');

  stack.appendChild(highlight);
  stack.appendChild(textarea);
  stack.appendChild(sigHint);
  stack.appendChild(popup);
  stack.appendChild(errHint);
  root.appendChild(stack);

  const listeners = new Set<(text: string) => void>();

  type State = {
    tokens: Token[];
    identInfo: Map<number, IdentCategory>;
    errors: GenbyError[];
    locals: Map<string, ResolvedType>;
  };

  let state: State = emptyState();
  let suggestions: Suggestion[] = [];
  let selectedIdx = 0;
  let popupOpen = false;
  let sigHintOpen = false;
  let errHintOpen = false;

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

    // Hint priority:
    //   1. Cursor sits inside a known identifier → show its type.
    //   2. Cursor is in the argument region of a call → show signature hint.
    // The completion popup is suppressed whenever the cursor is not at the
    // trailing edge of the identifier (i.e. the user is hovering, not typing).
    const identHint = resolveIdentHint(ctx);
    if (identHint) {
      renderIdentHint(identHint);
      positionSignatureHint();
      sigHint.setAttribute('data-open', 'true');
      sigHintOpen = true;
    } else {
      updateSignatureHint(ctx);
    }

    if (!ctx.atWordEnd) {
      hidePopup();
      return;
    }

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
    // Preserve the highlighted row when the set of suggestions didn't
    // actually change (e.g. user pressed an arrow key while the popup is
    // open — keyup re-enters updatePopup but the list is the same).
    const prevKey = suggestionsKey(suggestions);
    const nextKey = suggestionsKey(items);
    suggestions = items;
    if (prevKey !== nextKey) {
      selectedIdx = 0;
    } else if (selectedIdx >= items.length) {
      selectedIdx = 0;
    }
    renderPopupItems();
    positionPopup();
    popup.setAttribute('data-open', 'true');
    popupOpen = true;
  }

  function suggestionsKey(items: Suggestion[]): string {
    return items.map((s) => s.label).join('\u0001');
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

  type IdentHint =
    | { kind: 'variable'; name: string; type: ResolvedType; source: 'local' | 'external' }
    | { kind: 'enum_value'; name: string; enumKey: string }
    | { kind: 'signature'; sig: SignatureInfo };

  function resolveIdentHint(ctx: AutocompleteContext): IdentHint | null {
    const name = ctx.fullWord;
    if (!name || !/^[a-zA-Z_]/.test(name)) return null;
    // Skip directive tokens (`@name(` handled by sighint) and RETURN.
    if (ctx.afterAt) return null;
    if (name === RETURN) return null;
    // Only treat as identifier if lexer produced an IDENT token at this span
    // (guards against cursor being inside a string or comment).
    if (!state.identInfo.has(ctx.wordStart)) return null;

    const local = state.locals.get(name);
    if (local) {
      return { kind: 'variable', name, type: local, source: 'local' };
    }
    const extVar = machine.config.variables.get(name);
    if (extVar) {
      const type: ResolvedType =
        extVar.type === ENUM
          ? { kind: ENUM, enumKey: extVar.enumKey ?? '' }
          : isBuiltinType(extVar.type)
            ? { kind: extVar.type as typeof STR | typeof NUM | typeof BUL | typeof ANY }
            : { kind: 'CUSTOM', name: extVar.type };
      return { kind: 'variable', name, type, source: 'external' };
    }
    const enumKey = machine.config.enumValueIndex.get(name);
    if (enumKey) {
      return { kind: 'enum_value', name, enumKey };
    }
    const fn = machine.config.functions.get(name);
    if (fn) {
      return {
        kind: 'signature',
        sig: {
          kind: 'function',
          name: fn.name,
          args: fn.args,
          activeIndex: -1,
          returns: fn.returns,
          describe: fn.describe,
        },
      };
    }
    const dir = machine.config.directives.get(name);
    if (dir) {
      return {
        kind: 'signature',
        sig: {
          kind: 'directive',
          name: dir.name,
          args: dir.args,
          activeIndex: -1,
          returns: null,
          describe: dir.describe,
        },
      };
    }
    return null;
  }

  function formatType(t: ResolvedType): string {
    if (t.kind === ENUM) return `ENUM<${t.enumKey || '?'}>`;
    if (t.kind === 'CUSTOM') return t.name;
    if (t.kind === 'VOID') return 'VOID';
    return t.kind;
  }

  function renderIdentHint(hint: IdentHint): void {
    if (hint.kind === 'signature') {
      renderSignatureHint(hint.sig);
      return;
    }
    sigHint.innerHTML = '';
    const nameEl = doc.createElement('span');
    nameEl.className = 'genby-input__sighint-argname';
    nameEl.textContent = hint.name;
    sigHint.appendChild(nameEl);
    const colon = doc.createElement('span');
    colon.className = 'genby-input__sighint-punct';
    colon.textContent = ': ';
    sigHint.appendChild(colon);
    const ty = doc.createElement('span');
    ty.className = 'genby-input__sighint-type';
    if (hint.kind === 'variable') {
      const typeText = formatType(hint.type);
      const baseType = hint.type.kind === 'CUSTOM' ? hint.type.name : hint.type.kind;
      ty.setAttribute('data-type', baseType);
      if (hint.type.kind === 'CUSTOM') ty.setAttribute('data-custom', 'true');
      ty.textContent = typeText;
      sigHint.appendChild(ty);
      const suffix = doc.createElement('span');
      suffix.className = 'genby-input__sighint-return';
      suffix.textContent = hint.source === 'local' ? '  (local)' : '  (variable)';
      sigHint.appendChild(suffix);
    } else {
      ty.setAttribute('data-type', 'ENUM');
      ty.textContent = `ENUM<${hint.enumKey}>`;
      sigHint.appendChild(ty);
      const suffix = doc.createElement('span');
      suffix.className = 'genby-input__sighint-return';
      suffix.textContent = '  (enum value)';
      sigHint.appendChild(suffix);
    }
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
    hideErrHint();
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

  function findErrorAtPoint(
    clientX: number,
    clientY: number,
  ): { errorIdx: number; rect: DOMRect } | null {
    const spans =
      highlight.querySelectorAll<HTMLElement>('[data-error-idx]');
    for (let i = 0; i < spans.length; i++) {
      const el = spans[i]!;
      const rects = el.getClientRects();
      for (let j = 0; j < rects.length; j++) {
        const r = rects[j]!;
        if (
          clientX >= r.left &&
          clientX <= r.right &&
          clientY >= r.top &&
          clientY <= r.bottom
        ) {
          const idx = Number(el.getAttribute('data-error-idx'));
          if (Number.isFinite(idx)) return { errorIdx: idx, rect: r };
        }
      }
    }
    return null;
  }

  function showErrHint(err: GenbyError, rect: DOMRect): void {
    errHint.innerHTML = '';
    const kind = doc.createElement('span');
    kind.className = 'genby-input__errhint-kind';
    kind.textContent = `[${err.kind}]`;
    errHint.appendChild(kind);
    const msg = doc.createElement('span');
    msg.className = 'genby-input__errhint-msg';
    msg.textContent = ' ' + err.message;
    errHint.appendChild(msg);

    const stackRect = stack.getBoundingClientRect();
    const top = rect.bottom - stackRect.top + 6;
    const left = rect.left - stackRect.left;
    errHint.style.top = `${top}px`;
    errHint.style.left = `${left}px`;
    errHint.setAttribute('data-open', 'true');
    errHintOpen = true;
  }

  function hideErrHint(): void {
    if (!errHintOpen) return;
    errHint.setAttribute('data-open', 'false');
    errHintOpen = false;
  }

  function onMouseMove(ev: MouseEvent): void {
    const hit = findErrorAtPoint(ev.clientX, ev.clientY);
    if (!hit) {
      hideErrHint();
      return;
    }
    const err = state.errors[hit.errorIdx];
    if (!err) {
      hideErrHint();
      return;
    }
    showErrHint(err, hit.rect);
  }

  function onScrollAll(): void {
    syncScroll();
    hideErrHint();
  }

  textarea.addEventListener('input', onInput);
  textarea.addEventListener('scroll', onScrollAll);
  textarea.addEventListener('keydown', onKeydown);
  textarea.addEventListener('keyup', onCaretMove);
  textarea.addEventListener('click', onCaretMove);
  textarea.addEventListener('focus', onCaretMove);
  textarea.addEventListener('mousemove', onMouseMove);
  textarea.addEventListener('mouseleave', hideErrHint);
  textarea.addEventListener('blur', () => {
    // Slight delay to let mousedown on popup items land first.
    setTimeout(() => {
      hidePopup();
      hideSignatureHint();
      hideErrHint();
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
      hideErrHint();
      textarea.removeEventListener('input', onInput);
      textarea.removeEventListener('scroll', onScrollAll);
      textarea.removeEventListener('keydown', onKeydown);
      textarea.removeEventListener('keyup', onCaretMove);
      textarea.removeEventListener('click', onCaretMove);
      textarea.removeEventListener('focus', onCaretMove);
      textarea.removeEventListener('mousemove', onMouseMove);
      textarea.removeEventListener('mouseleave', hideErrHint);
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
