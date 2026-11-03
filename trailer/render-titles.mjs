// Deterministic frame renderer: seek(t) → screenshot, for segment "a" or "b".
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
const seg = process.argv[2], dur = Number(process.argv[3]), FPS = 30, only = process.argv[4] ? Number(process.argv[4]) : null;
const root = path.resolve('.');
const srv = http.createServer((q, r) => { const f = path.join(root, q.url.split('?')[0] === '/' ? 'titles.html' : q.url.split('?')[0]); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(f).pipe(r); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://127.0.0.1:${srv.address().port}/`); await p.waitForFunction(() => window.ready); await p.evaluate(() => document.fonts.ready);
const dir = `frames/${seg}`; fs.mkdirSync(dir, { recursive: true });
if (only !== null) { await p.evaluate(([s, t]) => seek(s, t), [seg, only]); await p.screenshot({ path: `out/still_${seg}_${only}.png` }); }
else {
  const n = Math.round(dur * FPS);
  for (let i = 0; i < n; i++) { await p.evaluate(([s, t]) => seek(s, t), [seg, i / FPS]); await p.screenshot({ path: `${dir}/${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 94 }); if (i % 60 === 0) console.log(seg, i, '/', n); }
}
await b.close(); srv.close();
