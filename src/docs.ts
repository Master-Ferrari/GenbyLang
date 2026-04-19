import type { LangMachine } from './genby.js';
import type { EnumDef } from './config.js';
import type {
  ArgSpec,
  DirectiveSpec,
  FunctionSpec,
  Type,
  VariableSpec,
} from './types.js';

export interface DocsOptions {
  /** Top-level title. Default: 'Language reference'. */
  title?: string;
  /** Optional paragraph shown right under the title. */
  intro?: string;
}

const DEFAULT_INTRO = `A small embeddable language for stitching text together from variables, conditions, and calls. What follows is everything you need to know — first the syntax itself, then what this particular build gives you on top.`;

export function generateMarkdownDocs(
  machine: LangMachine,
  options: DocsOptions = {},
): string {
  const { config } = machine;
  const title = options.title ?? 'Language reference';
  const intro = (options.intro ?? DEFAULT_INTRO).trim();

  const sections: string[] = [];

  sections.push(`# ${title}\n\n${intro}`);
  sections.push(renderBasicSyntax(config.builtinIfThenElse));

  const directives = [...config.directives.values()];
  if (directives.length > 0) {
    sections.push(`## Directives

Written at the very top of the program and executed once, on load. Arguments must be constants or enum values — nothing that depends on runtime state.

${directives.map(renderDirective).join('\n')}`);
  }

  const functions = [...config.functions.values()];
  if (functions.length > 0) {
    sections.push(`## Functions

Every function is external and asynchronous — the engine awaits results for you. Void functions are used as standalone statements; their result cannot be assigned.

${functions.map(renderFunction).join('\n')}`);
  }

  const variables = [...config.variables.values()];
  if (variables.length > 0) {
    sections.push(`## Variables

Supplied from the outside when the program runs — use them like any other identifier.

${renderVariablesTable(variables)}`);
  }

  const enums = [...config.enums.values()];
  if (enums.length > 0) {
    sections.push(`## Enums

Named constants. In code you write the name directly; when interpolated into a string it becomes the text of that name.

${enums.map(renderEnum).join('\n')}`);
  }

  return sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function renderBasicSyntax(builtinIfThenElse: boolean): string {
  const conditional = builtinIfThenElse
    ? `
### Conditional

\`IF_THEN_ELSE(cond, a, b)\` — a built-in special form with lazy branches. Only the taken branch is evaluated; both branches must have the same type.
`
    : '';

  return `## Basic syntax

A program is a list of assignments and calls that always ends with \`RETURN(...)\`. Above it sit directives, if any — they run once when the program loads.

### Literals and strings

- Strings live inside double quotes: \`"hello"\`. Line breaks inside the quotes are fine.
- Interpolation: \`"hello {name}"\` — whatever sits in \`{}\` is evaluated and spliced in. Numbers and enum values render as text on their own.
- Escapes: \`\\"\`, \`\\\\\`, \`\\{\`, \`\\n\`, \`\\t\`.
- Numbers: \`42\`, \`3.14\`, \`-1\`.

### Types

\`STR\`, \`NUM\`, \`BUL\`, \`ENUM\`. There are no boolean literals — \`BUL\` only comes out of comparisons.

### Operators

| Operator | What it does |
| --- | --- |
| \`+\` | concatenation for \`STR + STR\`, addition for \`NUM + NUM\` |
| \`-\`, \`*\`, \`/\` | arithmetic over \`NUM\` |
| \`==\`, \`!=\` | equality between values of the same type |
| \`<\`, \`>\`, \`<=\`, \`>=\` | comparison of numbers |

Division by zero is a runtime error.

### Variables and assignment

\`name = expression\`. Reassign as often as you like, but don't change the type — it is fixed by the first assignment. Assigning to a reserved name (a function, directive, external variable, or enum value) is an error.

### Comments

\`// to the end of the line\`. There is no block comment form.

### Calls

\`FN(arg1, arg2, ...)\`. Every call is implicitly asynchronous — no \`await\` needed, the engine waits for you. The result can be assigned to a variable or used inside an expression. Void functions are written as standalone statements.
${conditional}
### Termination

\`RETURN(expression)\` — required, exactly once, as the last line. The returned value can be of any type.
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
      const tagStr = tags.length ? ` _(${tags.join(', ')})_` : '';
      const desc = a.describe ? ` — ${a.describe.trim()}` : '';
      return `- \`${a.name}\`: \`${t}\`${tagStr}${desc}`;
    })
    .join('\n');
}

function escapeCell(s: string): string {
  return s.replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim();
}
