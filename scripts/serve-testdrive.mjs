import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = Number(process.env.PORT ?? 5173);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map':  'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.png':  'image/png',
    '.txt':  'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === '/') pathname = '/testdrive/index.html';

        const target = normalize(join(ROOT, pathname));
        if (!target.startsWith(ROOT + sep) && target !== ROOT) {
            res.writeHead(403); res.end('forbidden'); return;
        }

        let file = target;
        try {
            const s = await stat(file);
            if (s.isDirectory()) file = join(file, 'index.html');
        } catch {
            res.writeHead(404); res.end('not found'); return;
        }

        const body = await readFile(file);
        const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type': type,
            'Cache-Control': 'no-store',
        });
        res.end(body);
    } catch (err) {
        res.writeHead(500); res.end(String(err?.message ?? err));
    }
});

server.listen(PORT, () => {
    const url = `http://localhost:${PORT}/testdrive/index.html`;
    console.log(`testdrive serving at ${url}`);
});
