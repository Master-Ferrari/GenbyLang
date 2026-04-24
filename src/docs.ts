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
  /** Top-level title. Default: 'Script reference'. */
  title?: string;
  /** Optional paragraph shown right under the title. */
  intro?: string;
}

const DEFAULT_INTRO = `This page describes the script tools available in this project: commands, values, and startup settings. Use it as a quick reference while writing your staff.`;

export function generateMarkdownDocs(
  machine: LangMachine,
  options: DocsOptions = {},
): string {
  const { config } = machine;
  const title = options.title ?? 'Script reference';
  const intro = (options.intro ?? DEFAULT_INTRO).trim();

  const sections: string[] = [];

  sections.push(`# ${title}\n\n${intro}`);

  const functions = [...config.functions.values()];
  if (functions.length > 0) {
    sections.push(`## Functions

Main commands available in this project. Use \`NAME(arg1, arg2, ...)\`. You can save the result to a variable or use it right away.

${joinWithDivider(functions.map(renderFunction))}`);
  }

  const variables = [...config.variables.values()];
  if (variables.length > 0) {
    sections.push(`## Variables

Ready-made values provided from outside. You can use them in expressions just like normal names.

${renderVariablesTable(variables)}`);
  }

  const enums = [...config.enums.values()];
  if (enums.length > 0) {
    sections.push(`## Enums

Fixed options. Write the name directly in code.

${joinWithDivider(enums.map(renderEnum))}`);
  }

  const types = [...config.types.values()];
  if (types.length > 0) {
    sections.push(`## Types

Special value formats used by some commands. If a command expects a specific type in an argument, pass a variable or value of that same type.

${renderTypesTable(types)}`);
  }

  const directives = [...config.directives.values()];
  if (directives.length > 0) {
    sections.push(`## Directives

Startup settings. Put them at the very top of the script. They run once when the script starts.

${joinWithDivider(directives.map(renderDirective))}`);
  }

  sections.push(renderBasicSyntax());

  return sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function renderBasicSyntax(): string {
  return `## Syntax reference

A short cheat sheet for writing scripts. A script is a list of assignments and calls, and it must end with \`RETURN(expression)\`. Optional directives go at the top.

**Literals.** Text in double quotes (\`"hello"\`, can be multi-line) and numbers (\`42\`, \`3.14\`, \`-1\`). Escapes: \`\\"\`, \`\\\\\`, \`\\{\`, \`\\n\`, \`\\t\`. Boolean values (\`BUL\`) are produced by comparisons.

**Interpolation.** \`"hello {name}"\` inserts calculated values into text.

**Built-in type tags.** \`STR\`, \`NUM\`, \`BUL\`, \`ENUM\`, \`ANY\`. \`ANY\` means "any value type".

**Operators.** \`+\` (concat for \`STR\`, addition for \`NUM\`); \`-\`, \`*\`, \`/\` on \`NUM\`; \`==\`, \`!=\` between values of the same type; \`<\`, \`>\`, \`<=\`, \`>=\` on \`NUM\`. Division by zero is a runtime error.

**Assignment.** \`name = expression\`. You can update a variable, but its type is set by the first value. Reserved names (functions, directives, external variables, enum values) cannot be assigned to.

**Calls.** \`FN(arg1, arg2, ...)\`. Functions with \`VOID\` return type are standalone actions and do not produce a value.

**Comments.** \`// to the end of the line\`. 

**Termination.** \`RETURN(expression)\` — required as the last line of the script. Any type is allowed.
`;
}

function renderDirective(d: DirectiveSpec): string {
  const tag = d.required ? ' _(required)_' : '';
  const describe = d.describe ? `\n${d.describe.trim()}\n` : '';
  const args = d.args.length > 0 ? `\n${renderArgsList(d.args)}\n` : '';
  return `### \`@${d.name}\`${tag}
${describe}
\`\`\`
@${d.name}${formatArgsList(d.args)}
\`\`\`
${args}`;
}

function renderFunction(f: FunctionSpec): string {
  const describe = f.describe ? `\n${f.describe.trim()}\n` : '';
  const args = f.args.length > 0 ? `\n${renderArgsList(f.args)}\n` : '';
  return `### \`${f.name}\`
${describe}
\`\`\`
${f.name}${formatArgsList(f.args)}${formatReturn(f)}
\`\`\`
${args}`;
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

function formatArgsList(args: readonly ArgSpec[]): string {
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

function renderArgsList(args: readonly ArgSpec[]): string {
  return args
    .map((a) => {
      const t = formatType(a.type, a.enumKey);
      const tags: string[] = [];
      if (a.rest) tags.push('variadic');
      if (a.optional) tags.push('optional');
      const tagStr = tags.length ? ` _(${tags.join(', ')})_` : '';
      const desc = a.describe ? ` — ${a.describe.trim()}` : '';
      return `- \`${a.name}\`: \`${t}\`${tagStr}${desc}`;
    })
    .join('\n');
}

function escapeCell(s: string): string {
  return s.replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim();
}

function joinWithDivider(blocks: string[]): string {
  return blocks.join('\n\n---\n\n');
}
