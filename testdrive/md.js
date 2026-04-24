// Minimal Markdown renderer shared by the testdrive pages (index.html and
// agents.html). Supports: ATX headings (#..####), fenced code blocks (```),
// inline code, bold (**..**), underscore-italic (_.._), horizontal rules,
// GitHub-style pipe tables, and unordered lists.
//
// Kept intentionally tiny — the testdrive does not need a full CommonMark
// implementation, and `machine.docs()` only ever emits this subset.

export function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function renderMarkdown(src) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

    const renderInline = (s) => {
        let r = escapeHtml(s);
        r = r.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
        r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        r = r.replace(/(^|[^\w])_([^_\n]+)_(?=$|[^\w])/g, '$1<em>$2</em>');
        return r;
    };

    const splitRow = (row) =>
        row
            .replace(/^\s*\|/, '')
            .replace(/\|\s*$/, '')
            .split('|')
            .map((s) => s.trim());

    while (i < lines.length) {
        const line = lines[i];

        // fenced code
        const fence = /^```(\w*)\s*$/.exec(line);
        if (fence) {
            let j = i + 1;
            const body = [];
            while (j < lines.length && !/^```\s*$/.test(lines[j])) {
                body.push(lines[j]);
                j++;
            }
            out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
            i = j + 1;
            continue;
        }

        // heading
        const h = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
        if (h) {
            const level = Math.min(h[1].length, 4);
            out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
            i++;
            continue;
        }

        // horizontal rule
        if (/^\s*-{3,}\s*$/.test(line)) {
            out.push('<hr />');
            i++;
            continue;
        }

        // table: header | ... followed by separator row
        if (
            line.includes('|') &&
            i + 1 < lines.length &&
            /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])
        ) {
            const head = splitRow(line);
            i += 2;
            const rows = [];
            while (
                i < lines.length &&
                lines[i].includes('|') &&
                lines[i].trim() !== ''
            ) {
                rows.push(splitRow(lines[i]));
                i++;
            }
            out.push(
                `<table><thead><tr>${head
                    .map((c) => `<th>${renderInline(c)}</th>`)
                    .join('')}</tr></thead>` +
                    `<tbody>${rows
                        .map(
                            (r) =>
                                `<tr>${r
                                    .map((c) => `<td>${renderInline(c)}</td>`)
                                    .join('')}</tr>`,
                        )
                        .join('')}</tbody></table>`,
            );
            continue;
        }

        // unordered list
        if (/^\s*[-*]\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
                items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
                i++;
            }
            out.push(
                `<ul>${items
                    .map((it) => `<li>${renderInline(it)}</li>`)
                    .join('')}</ul>`,
            );
            continue;
        }

        // blank
        if (line.trim() === '') {
            i++;
            continue;
        }

        // paragraph
        const para = [line];
        i++;
        while (
            i < lines.length &&
            lines[i].trim() !== '' &&
            !/^(#{1,6})\s+/.test(lines[i]) &&
            !/^```/.test(lines[i]) &&
            !/^\s*[-*]\s+/.test(lines[i]) &&
            !/^\s*-{3,}\s*$/.test(lines[i])
        ) {
            para.push(lines[i]);
            i++;
        }
        out.push(`<p>${renderInline(para.join(' '))}</p>`);
    }
    return out.join('');
}
