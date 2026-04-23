import {
  ANY,
  BUL,
  ENUM,
  Genby,
  NUM,
  STR,
  makeEnumValue,
  type Value,
  type LangMachine,
} from '../../src/index.js';

export interface TestdriveExample {
  id: string;
  label: string;
  config: string;
  program: string;
}

export interface ExampleRunResult {
  machine: LangMachine;
  result: Value;
}

/**
 * testdrive configs are authored like real snippets with top-level imports;
 * when evaluating via `new Function(...)` in tests we strip those lines and
 * inject symbols manually.
 */
function stripImports(src: string): string {
  return src.replace(
    /^[\t ]*import\s[\s\S]*?from\s+['"][^'"]+['"]\s*;?[\t ]*\r?\n?/gm,
    '',
  );
}

export function buildMachineFromExampleConfig(configSource: string): LangMachine {
  const userCode = stripImports(configSource);
  const fn = new Function(
    'Genby',
    'STR',
    'NUM',
    'BUL',
    'ENUM',
    'ANY',
    'makeEnumValue',
    userCode,
  );
  const built = fn(Genby, STR, NUM, BUL, ENUM, ANY, makeEnumValue) as unknown;
  if (built instanceof Genby) return built.build();
  if (
    built &&
    typeof built === 'object' &&
    typeof (built as LangMachine).execute === 'function' &&
    typeof (built as LangMachine).check === 'function'
  ) {
    return built as LangMachine;
  }
  throw new Error('Example config must return Genby or LangMachine');
}

export async function runExample(
  example: TestdriveExample,
  inputs: Record<string, Value> = {},
): Promise<ExampleRunResult> {
  const machine = buildMachineFromExampleConfig(example.config);
  const check = machine.check(example.program);
  if (!check.ok) {
    const details = check.errors
      .map((e) => `[${e.kind}] ${e.line}:${e.column} ${e.message}`)
      .join('\n');
    throw new Error(`Example '${example.id}' failed static check:\n${details}`);
  }
  const result = await machine.execute(example.program, inputs);
  return { machine, result };
}

