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
.genby-input__highlight > code {
  display: block;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  line-height: inherit;
  letter-spacing: inherit;
  word-spacing: inherit;
  white-space: inherit;
  word-wrap: inherit;
  word-break: inherit;
  tab-size: inherit;
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
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  font-size: 0.9em;
  line-height: 1.4;
  display: none;
}
.genby-input__popup[data-open="true"] {
  display: block;
}
.genby-input__popup-item {
  display: flex;
  justify-content: space-between;
  padding: 2px 8px;
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

.genby-input__sighint {
  position: absolute;
  z-index: 9;
  min-width: 140px;
  max-width: 90%;
  padding: 4px 8px;
  background: var(--genby-sighint-bg, var(--genby-popup-bg, #ffffff));
  border: 1px solid var(--genby-sighint-border, var(--genby-popup-border, #d0d7de));
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  font-size: 0.9em;
  line-height: 1.4;
  white-space: nowrap;
  display: none;
  pointer-events: none;
}
.genby-input__sighint[data-open="true"] {
  display: block;
}
.genby-input__sighint-name {
  color: var(--genby-color-function, #953800);
  font-weight: 600;
}
.genby-input__sighint-punct {
  color: var(--genby-color-punct, #24292f);
  opacity: 0.7;
}
.genby-input__sighint-arg {
  opacity: 0.55;
}
.genby-input__sighint-arg[data-active="true"] {
  opacity: 1;
  text-decoration: underline;
  text-decoration-color: var(--genby-color-function, #953800);
  text-underline-offset: 3px;
}
.genby-input__sighint-argname {
  color: var(--genby-color-ident, #1f2328);
}
.genby-input__sighint-type {
  color: var(--genby-color-ident, #1f2328);
  font-style: italic;
}
.genby-input__sighint-type[data-type="STR"] { color: var(--genby-color-string, #0a3069); }
.genby-input__sighint-type[data-type="NUM"] { color: var(--genby-color-number, #0550ae); }
.genby-input__sighint-type[data-type="BUL"] { color: var(--genby-color-number, #0550ae); }
.genby-input__sighint-type[data-type="ENUM"] { color: var(--genby-color-enum, #116329); }
.genby-input__sighint-type[data-type="ANY"] { color: var(--genby-color-ext-var, #6639ba); }
.genby-input__sighint-type[data-custom="true"] { color: var(--genby-color-custom, #a3562a); }
.genby-input__sighint-return {
  color: var(--genby-color-ident, #1f2328);
  opacity: 0.75;
  font-style: italic;
}
.genby-input__sighint-desc {
  margin-top: 2px;
  color: var(--genby-color-comment, #6e7781);
  font-style: italic;
  white-space: normal;
  font-size: 0.92em;
}

.genby-input__errhint {
  position: absolute;
  z-index: 11;
  max-width: 90%;
  padding: 4px 8px;
  background: var(--genby-sighint-bg, var(--genby-popup-bg, #ffffff));
  border: 1px solid var(--genby-error-color, #d1242f);
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  font-size: 0.9em;
  line-height: 1.4;
  color: var(--genby-color, #1f2328);
  white-space: pre-wrap;
  display: none;
  pointer-events: none;
}
.genby-input__errhint[data-open="true"] {
  display: block;
}
.genby-input__errhint-kind {
  color: var(--genby-error-color, #d1242f);
  font-weight: 600;
}
.genby-input__errhint-msg {
  color: inherit;
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
