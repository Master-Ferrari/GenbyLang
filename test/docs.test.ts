import { describe, it, expect } from 'vitest';
import { Genby, STR, NUM, ENUM, generateMarkdownDocs } from '../src/index.js';

function makeRichMachine() {
  const g = new Genby();
  g.addEnum(
    'MODEL',
    [
      { name: 'HAIKU_45', describe: 'Fast, small model.' },
      { name: 'SONNET_46', describe: 'General-purpose workhorse.' },
    ],
    { describe: 'Supported LLM models.' },
  );
  g.addEnum('LANGUAGE', ['auto', 'en', 'ru']);
  g.addDirective({
    name: 'NAME',
    describe: 'Scenario name shown in listings.',
    args: [{ name: 'title', type: STR, describe: 'Short label.' }],
    handler: () => {},
  });
  g.addVariable({
    name: 'INPUTTEXT',
    type: STR,
    describe: 'Text currently selected by the user.',
  });
  g.addVariable({ name: 'LANG1', type: ENUM, enumKey: 'LANGUAGE' });
  g.addFunction({
    name: 'LEN',
    describe: 'Length of a string in characters.',
    args: [{ name: 's', type: STR }],
    returns: NUM,
    handler: async ([s]) => (await s.calc()).length,
  });
  g.addFunction({
    name: 'LLM',
    describe: 'Calls a model and returns its reply as a string.',
    args: [
      { name: 'model', type: ENUM, enumKey: 'MODEL', describe: 'Which model to dispatch to.' },
      { name: 'prompt', type: STR, describe: 'Prepared prompt.' },
    ],
    returns: STR,
    handler: () => 'ok',
  });
  return g.build();
}

describe('docs generator', () => {
  it('renders basic syntax section and all registered entities', () => {
    const md = makeRichMachine().docs();
    expect(md).toMatch(/^# Script reference/);
    expect(md).toContain('## Syntax reference');
    expect(md).toContain('RETURN');
    expect(md).toContain('## Directives');
    expect(md).toContain('`@NAME`');
    expect(md).toContain('@NAME(title: STR)');
    expect(md).toContain('## Functions');
    expect(md).toContain('`LEN`');
    expect(md).toContain('LEN(s: STR) → NUM');
    expect(md).toContain('LLM(model: ENUM<MODEL>, prompt: STR) → STR');
    expect(md).toContain('## Variables');
    expect(md).toContain('`INPUTTEXT`');
    expect(md).toContain('Text currently selected by the user.');
    expect(md).toContain('## Enums');
    expect(md).toContain('`MODEL`');
    expect(md).toContain('Supported LLM models.');
    expect(md).toContain('Fast, small model.');
    // Enum without value-level describes falls back to inline list.
    expect(md).toMatch(/`auto`, `en`, `ru`/);
  });

  it('respects title and intro overrides', () => {
    const md = makeRichMachine().docs({
      title: 'Translate DSL',
      intro: 'A tiny language for describing translation scenarios.',
    });
    expect(md).toMatch(/^# Translate DSL/);
    expect(md).toContain('A tiny language for describing translation scenarios.');
  });

  it('omits empty sections', () => {
    const g = new Genby();
    const md = generateMarkdownDocs(g.build());
    expect(md).toContain('## Syntax reference');
    expect(md).not.toMatch(/^## Directives$/m);
    expect(md).not.toMatch(/^## Functions$/m);
    expect(md).not.toMatch(/^## Variables$/m);
    expect(md).not.toMatch(/^## Enums$/m);
  });

  it('renders variadic and optional args correctly', () => {
    const g = new Genby();
    g.addFunction({
      name: 'CONCAT',
      describe: 'Concatenates strings.',
      args: [
        { name: 'sep', type: STR, optional: true, describe: 'Separator.' },
        { name: 'parts', type: STR, rest: true },
      ],
      returns: STR,
      handler: () => '',
    });
    const md = g.build().docs();
    expect(md).toContain('CONCAT(sep?: STR, ...parts: STR) → STR');
    expect(md).toContain('variadic');
    expect(md).toContain('optional');
  });
});
