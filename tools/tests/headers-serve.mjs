// Static server that applies a Cloudflare Pages `_headers` file, so the response headers can be tested
// before a deploy. Rules: a path, or a path with one `*` splat; every matching rule applies; a header set
// twice is joined with a comma, as Pages does; `! Name` detaches a header.
// usage: node headers-serve.mjs <root dir> <port>
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const [root, port] = process.argv.slice(2);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.xml': 'application/xml' };

function parseRules(text) {
    const rules = [];
    let cur = null;
    for (const raw of text.split('\n')) {
        const line = raw.replace(/\s+$/, '');
        if (!line.trim() || line.trim().startsWith('#')) continue;
        if (!/^\s/.test(line)) { cur = { pattern: line.trim(), headers: [] }; rules.push(cur); continue; }
        if (!cur) continue;
        const t = line.trim();
        if (t.startsWith('! ')) { cur.headers.push({ detach: t.slice(2).trim() }); continue; }
        const i = t.indexOf(':');
        cur.headers.push({ name: t.slice(0, i).trim(), value: t.slice(i + 1).trim() });
    }
    return rules;
}
function matches(pattern, path) {
    const star = pattern.indexOf('*');
    if (star < 0) return pattern === path;
    const pre = pattern.slice(0, star), post = pattern.slice(star + 1);
    return path.startsWith(pre) && path.endsWith(post) && path.length >= pre.length + post.length;
}
const headersFile = join(root, '_headers');
const rules = existsSync(headersFile) ? parseRules(readFileSync(headersFile, 'utf8')) : [];
// `_redirects` rewrites only (status 200): "/app/* /viewer 200". Like Pages, an address without an extension
// is served from the .html file of the same name.
const redirectsFile = join(root, '_redirects');
const rewrites = existsSync(redirectsFile)
    ? readFileSync(redirectsFile, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/)).filter((p) => p[2] === '200')
    : [];

createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let path = decodeURIComponent(url.pathname);
    for (const [from, to] of rewrites) if (matches(from, path)) { path = to; break; }
    if (path.endsWith('/')) path += 'index.html';
    if (!extname(path) && existsSync(normalize(join(root, `${path}.html`)))) path += '.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(normalize(root)) || path === '/_headers' || path === '/_redirects' || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return;
    }
    const out = new Map();
    for (const r of rules) {
        if (!matches(r.pattern, url.pathname)) continue;
        for (const h of r.headers) {
            if (h.detach) { out.delete(h.detach.toLowerCase()); continue; }
            const k = h.name.toLowerCase();
            out.set(k, out.has(k) ? out.get(k) + ', ' + h.value : h.value);
        }
    }
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', ...Object.fromEntries(out) });
    res.end(readFileSync(file));
}).listen(Number(port), '127.0.0.1', () => console.log(`serving ${root} with ${rules.length} header rule(s) and ${rewrites.length} rewrite(s) on http://127.0.0.1:${port}/`));
