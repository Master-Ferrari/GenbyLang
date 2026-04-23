import { describe, it, expect } from 'vitest';
import { Genby, STR, NUM } from '../src/index.js';

describe('inputDom', () => {
  it('creates a mounted DOM element that reflects typed value', () => {
    const g = new Genby();
    g.addFunction({
      name: 'LEN',
      args: [{ name: 's', type: STR }],
      returns: NUM,
      handler: async ([s]) => (await s.calc()).length,
    });
    const m = g.build();
    const input = m.inputDom();
    document.body.appendChild(input.element);
    input.setValue('x = 1\nRETURN(x)');
    expect(input.getValue()).toBe('x = 1\nRETURN(x)');
    const check = input.check();
    expect(check.ok).toBe(true);

    const highlight = input.element.querySelector('.genby-input__highlight');
    expect(highlight?.textContent).toContain('RETURN');
    input.destroy();
  });

  it('renders error underline class for unknown identifier', () => {
    const g = new Genby();
    const m = g.build();
    const input = m.inputDom();
    document.body.appendChild(input.element);
    input.setValue('RETURN(unknown_id)');
    const errorSpans = input.element.querySelectorAll('.genby-error');
    expect(errorSpans.length).toBeGreaterThan(0);
    input.destroy();
  });

  it('fires onChange on setValue', () => {
    const g = new Genby();
    const m = g.build();
    const input = m.inputDom();
    document.body.appendChild(input.element);
    let last = '';
    const unsub = input.onChange((t) => {
      last = t;
    });
    input.setValue('RETURN("hi")');
    expect(last).toBe('RETURN("hi")');
    unsub();
    input.destroy();
  });
});
