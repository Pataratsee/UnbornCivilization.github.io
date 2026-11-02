#!/usr/bin/env node
/**
 * Unborn Civilization static dev server — no dependencies, no build step.
 * Usage: node server.mjs [--port 8000] [--no-open]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let portValue = process.env.PORT || 8000;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1] && /^\d+$/.test(args[i + 1])) portValue = args[i + 1];
}
const PORT = Number(portValue);
const OPEN = !args.includes('--no-open') && process.env.NO_OPEN !== '1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function safePath(urlPath) {
  const decoded = decodeURIComponent((urlPath || '/').split('?')[0].split('#')[0]);
  const target = decoded === '/' ? '/index.html' : decoded;
  const resolved = path.resolve(ROOT, '.' + target);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== path.join(ROOT, 'index.html')) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return;
  }
  let file = safePath(req.url);
  if (!file) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + req.url);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error(`  Try: npm start -- --port 8001\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  UNBORN CIVILIZATION — serving ${ROOT}`);
  console.log(`  ${url}\n  Ctrl+C to stop.\n`);
  if (OPEN) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const cargs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    try {
      const child = spawn(cmd, cargs, { stdio: 'ignore', detached: true });
      child.on('error', () => { /* headless machines: URL still printed */ });
      child.unref();
    } catch { /* ignore */ }
  }
});

const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 500).unref(); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
