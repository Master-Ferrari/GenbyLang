/** Minimal default stylesheet. Injected once per document on first inputDom creation. */
export const DEFAULT_CSS = `
.genby-input {
  position: relative;
  display: block;
  font-family: var(--genby-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: var(--genby-font-size, 14px);
  line-height: var(--genby-line-height, 1.45);
  color: var(--genby-color, #1f2328);
  background: var(--genby-bg, #ffffff);
  border: 1px solid var(--genby-border-color, #d0d7de);
  border-radius: var(--genby-radius, 6px);
  padding: 0;
  overflow: hidden;
}
.genby-input__stack {
  position: relative;
  min-height: var(--genby-min-height, 6em);
}
.genby-input__highlight,
.genby-input__textarea {
  margin: 0;
  padding: var(--genby-padding, 8px 10px);
  white-space: pre-wrap;
  word-wrap: break-word;
  word-break: break-word;
  font: inherit;
  line-height: inherit;
  box-sizing: border-box;
  tab-size: 2;
}
.genby-input__highlight {
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: inherit;
  background: transparent;
  overflow: hidden;
  z-index: 1;
}
.genby-input__textarea {
  position: relative;
  width: 100%;
  min-height: var(--genby-min-height, 6em);
  border: none;
  outline: none;
  resize: vertical;
  color: transparent;
  caret-color: var(--genby-caret, #1f2328);
  background: transparent;
  z-index: 2;
  overflow: auto;
}
.genby-input__textarea::selection {
  background: var(--genby-selection, rgba(51, 136, 255, 0.3));
  color: transparent;
}
.genby-input__popup {
  position: absolute;
  z-index: 10;
  min-width: 140px;
  max-height: 200px;
  overflow-y: auto;
  background: var(--genby-popup-bg, #ffffff);
  border: 1px solid var(--genby-popup-border, #d0d7de);
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  font-size: 0.95em;
  display: none;
}
.genby-input__popup[data-open="true"] {
  display: block;
}
.genby-input__popup-item {
  display: flex;
  justify-content: space-between;
  padding: 3px 8px;
  cursor: pointer;
  white-space: nowrap;
  gap: 12px;
}
.genby-input__popup-item[data-selected="true"] {
  background: var(--genby-popup-selected-bg, #0969da);
  color: var(--genby-popup-selected-color, #ffffff);
}
.genby-input__popup-detail {
  opacity: 0.6;
}

.genby-tok-string { color: var(--genby-color-string, #0a3069); }
.genby-tok-number { color: var(--genby-color-number, #0550ae); }
.genby-tok-comment { color: var(--genby-color-comment, #6e7781); font-style: italic; }
.genby-tok-directive { color: var(--genby-color-directive, #8250df); font-weight: 600; }
.genby-tok-function { color: var(--genby-color-function, #953800); }
.genby-tok-enum { color: var(--genby-color-enum, #116329); }
.genby-tok-ext-var { color: var(--genby-color-ext-var, #6639ba); }
.genby-tok-local-var { color: var(--genby-color-local-var, #1f2328); }
.genby-tok-ident { color: var(--genby-color-ident, #1f2328); }
.genby-tok-op { color: var(--genby-color-op, #24292f); }
.genby-tok-punct { color: var(--genby-color-punct, #24292f); }
.genby-tok-interp { color: var(--genby-color-interp, #8250df); font-weight: 600; }

.genby-error {
  text-decoration: underline wavy var(--genby-error-color, #d1242f);
  text-decoration-skip-ink: none;
  text-underline-offset: 3px;
}
`;

let injected = false;

export function ensureStylesInjected(doc: Document): void {
  if (injected) return;
  const style = doc.createElement('style');
  style.setAttribute('data-genby', 'styles');
  style.textContent = DEFAULT_CSS;
  doc.head.appendChild(style);
  injected = true;
}
