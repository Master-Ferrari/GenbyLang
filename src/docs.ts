import type { LangMachine } from './genby.js';
import type { EnumDef } from './config.js';
import type {
  ArgSpec,
  DirectiveSpec,
  FunctionSpec,
  Type,
  TypeDef,
  VariableSpec,
} from './types.js';

export interface DocsOptions {
  /** Top-level title. Default: 'Language reference'. */
  title?: string;
  /** Optional paragraph shown right under the title. */
  intro?: string;
}

const DEFAULT_INTRO = `This build of the language ships with a specific set of functions, variables, and other hooks — that's what's documented below. The language itself is just glue: a tiny scripting layer for stitching their outputs together. A short syntax reference is at the very end for when you need it.`;

export function generateMarkdownDocs(
  machine: LangMachine,
  options: DocsOptions = {},
): string {
  const { config } = machine;
  const title = options.title ?? 'Language reference';
  const intro = (options.intro ?? DEFAULT_INTRO).trim();

  const sections: string[] = [];

  sections.push(`# ${title}\n\n${intro}`);

  const functions = [...config.functions.values()];
  if (functions.length > 0) {
    sections.push(`## Functions

The building blocks of every program. Each function is external and asynchronous — the engine awaits the result for you. Call with \`NAME(arg1, arg2, ...)\`; assign the result to a variable or drop it into an expression. Void functions are written as standalone statements and don't produce a value.

${functions.map(renderFunction).join('\n')}`);
  }

  const variables = [...config.variables.values()];
  if (variables.length > 0) {
    sections.push(`## Variables

Values supplied from the outside when the program runs. Use them like any other identifier.

${renderVariablesTable(variables)}`);
  }

  const enums = [...config.enums.values()];
  if (enums.length > 0) {
    sections.push(`## Enums

Named constants. Write the name directly in code; when interpolated into a string it becomes the text of that name.

${enums.map(renderEnum).join('\n')}`);
  }

  const types = [...config.types.values()];
  if (types.length > 0) {
    sections.push(`## Types

Custom types produced and consumed by the functions above. You never write their literals directly — values flow through variables, arguments, and return types, and render via the type's \`stringify\` hook when interpolated.

${renderTypesTable(types)}`);
  }

  const directives = [...config.directives.values()];
  if (directives.length > 0) {
    sections.push(`## Directives

One-off configuration written at the very top of the program and executed once on load. Arguments must be constants or enum values — nothing that depends on runtime state.

${directives.map(renderDirective).join('\n')}`);
  }

  sections.push(renderBasicSyntax());

  return sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function renderBasicSyntax(): string {
  return `## Syntax reference

A compact cheat sheet for the glue around the functions above. A program is a list of assignments and calls ending with \`RETURN(expression)\`; optional directives sit at the very top.

**Literals.** Double-quoted strings (\`"hello"\`, multi-line OK), numbers (\`42\`, \`3.14\`, \`-1\`). Escapes: \`\\"\`, \`\\\\\`, \`\\{\`, \`\\n\`, \`\\t\`. There are no boolean literals — \`BUL\` values only come out of comparisons.

**Interpolation.** \`"hello {name}"\` — anything inside \`{}\` is evaluated and spliced in. Custom-typed values render via their \`stringify\` hook.

**Built-in type tags.** \`STR\`, \`NUM\`, \`BUL\`, \`ENUM\`, \`ANY\`. \`ANY\` in an argument slot accepts a value of any type.

**Operators.** \`+\` (concat for \`STR\`, addition for \`NUM\`); \`-\`, \`*\`, \`/\` on \`NUM\`; \`==\`, \`!=\` between values of the same type; \`<\`, \`>\`, \`<=\`, \`>=\` on \`NUM\`. Division by zero is a runtime error.

**Assignment.** \`name = expression\`. Reassign freely, but the type is fixed by the first assignment. Reserved names (functions, directives, external variables, enum values) cannot be assigned to.

**Calls.** \`FN(arg1, arg2, ...)\`. Always implicitly asynchronous — no \`await\` needed. Void functions are standalone statements and produce no value.

**Comments.** \`// to the end of the line\`. No block comment form.

**Termination.** \`RETURN(expression)\` — required, exactly once, as the last line. Any type is allowed.
`;
}

function renderDirective(d: DirectiveSpec): string {
  const tag = d.required ? ' _(required)_' : '';
  const describe = d.describe ? `\n${d.describe.trim()}\n` : '';
  const args = d.args.length > 0 ? `\n${renderArgsList(d.args)}\n` : '';
  return `### \`@${d.name}\`${tag}

\`\`\`
@${d.name}${formatArgsList(d.args)}
\`\`\`
${describe}${args}`;
}

function renderFunction(f: FunctionSpec): string {
  const describe = f.describe ? `\n${f.describe.trim()}\n` : '';
  const args = f.args.length > 0 ? `\n${renderArgsList(f.args)}\n` : '';
  return `### \`${f.name}\`

\`\`\`
${f.name}${formatArgsList(f.args)}${formatReturn(f)}
\`\`\`
${describe}${args}`;
}

function renderVariablesTable(variables: VariableSpec[]): string {
  const rows = variables
    .map(
      (v) =>
        `| \`${v.name}\` | \`${formatType(v.type, v.enumKey)}\` | ${escapeCell(v.describe ?? '—')} |`,
    )
    .join('\n');
  return `| Name | Type | Description |
| --- | --- | --- |
${rows}`;
}

function renderTypesTable(types: TypeDef[]): string {
  const rows = types
    .map(
      (t) =>
        `| \`${t.name}\` | ${escapeCell(t.describe ?? '—')} |`,
    )
    .join('\n');
  return `| Name | Description |
| --- | --- |
${rows}`;
}

function renderEnum(e: EnumDef): string {
  const describe = e.describe ? `\n${e.describe.trim()}\n` : '';
  const anyDescribed = e.values.some((v) => v.describe);
  const body = anyDescribed
    ? `| Value | Description |
| --- | --- |
${e.values
  .map((v) => `| \`${v.name}\` | ${escapeCell(v.describe ?? '—')} |`)
  .join('\n')}`
    : e.values.map((v) => `\`${v.name}\``).join(', ');
  return `### \`${e.key}\`
${describe}
${body}
`;
}

// ---- helpers ----

function formatArgsList(args: ArgSpec[]): string {
  if (args.length === 0) return '()';
  return `(${args.map(formatArg).join(', ')})`;
}

function formatArg(arg: ArgSpec): string {
  const t = formatType(arg.type, arg.enumKey);
  if (arg.rest) return `...${arg.name}: ${t}`;
  if (arg.optional) return `${arg.name}?: ${t}`;
  return `${arg.name}: ${t}`;
}

function formatReturn(f: FunctionSpec): string {
  if (f.returns === 'VOID') return ' → VOID';
  return ` → ${formatType(f.returns, f.returnsEnumKey)}`;
}

function formatType(type: Type | 'VOID', enumKey?: string): string {
  if (type === 'ENUM') return `ENUM<${enumKey ?? '?'}>`;
  return type;
}

function renderArgsList(args: ArgSpec[]): string {
  return args
    .map((a) => {
      const t = formatType(a.type, a.enumKey);
      const tags: string[] = [];
      if (a.rest) tags.push('variadic');
      if (a.optional) tags.push('optional');
      if (a.lazy) tags.push('lazy');
      const tagStr = tags.length ? ` _(${tags.join(', ')})_` : '';
      const desc = a.describe ? ` — ${a.describe.trim()}` : '';
      return `- \`${a.name}\`: \`${t}\`${tagStr}${desc}`;
    })
    .join('\n');
}

function escapeCell(s: string): string {
  return s.replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim();
}
