// Records the real game UI in real time (1080p) while a script plays it. Writes out/gameplay.webm + out/marks.json.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const B = 'http://127.0.0.1:7799';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'en-US' });
const p = await ctx.newPage();
// real-time capture through the DevTools screencast (frames + timestamps), assembled later with ffmpeg
fs.rmSync('out/rec', { recursive: true, force: true }); fs.mkdirSync('out/rec', { recursive: true });
const cdp = await ctx.newCDPSession(p); const frames = []; let n = 0;
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const f = `out/rec/f${String(n++).padStart(6, '0')}.jpg`; fs.writeFileSync(f, Buffer.from(data, 'base64')); frames.push({ f, ts: metadata.timestamp });
  try { await cdp.send('Page.screencastFrameAck', { sessionId }); } catch {}
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const t0 = Date.now(); const marks = {};
const mark = (k) => { marks[k] = (Date.now() - t0) / 1000; console.log(k, marks[k].toFixed(2)); };
const wait = (ms) => p.waitForTimeout(ms);
const post = (type) => fetch(B + '/api/event', { method: 'POST', body: JSON.stringify({ type }) });

await post('start');
await p.goto(B + '/'); mark('loaded');
await wait(600); await p.keyboard.press('Shift'); // skip the intro (the trailer has its own)
await p.locator('#themes').waitFor({ state: 'visible' }); await wait(1400); mark('themes');
await p.locator('label.row', { hasText: 'Manual' }).click(); await wait(500);
await p.locator('#areas .chip', { hasText: 'backend' }).click(); await wait(900);
await p.locator('#feats .chip', { hasText: 'auth' }).first().click(); await wait(600);
await p.locator('#feats .chip', { hasText: 'orders' }).first().click(); await wait(600);
await p.locator('#focus').click(); await p.keyboard.type('sessions', { delay: 70 }); await p.keyboard.press('Enter'); await wait(1300); mark('tokens');
await p.locator('#tok').click(); mark('start');
await p.locator('.opt').first().waitFor(); await wait(300); mark('q1-in');
await wait(3600); mark('q1-read');
await p.locator('.opt').nth(1).hover(); await wait(500);
await p.locator('.opt').nth(1).click(); mark('q1-click');
await p.locator('.opt.ok').waitFor({ timeout: 15000 }); mark('q1-reveal');
await wait(2800);
await p.locator('.opt').first().waitFor(); await p.waitForFunction(() => document.querySelector('#cat')?.textContent.includes('Question 2')); mark('q2-in');
await wait(3400); await p.keyboard.press('f'); mark('q2-5050'); await wait(1500);
const idx = await p.evaluate(() => [...document.querySelectorAll('.opt')].findIndex((b, i) => i === 1 && !b.classList.contains('gone')));
await p.locator('.opt').nth(idx >= 0 ? 1 : 1).click(); mark('q2-click');
await p.locator('.opt.ok').waitFor({ timeout: 15000 }); mark('q2-reveal'); await wait(1500);
await post('stop'); mark('agent-done'); await wait(3500); mark('end');
await cdp.send('Page.stopScreencast'); await wait(300);
const t00 = frames[0].ts; let list = '';
frames.forEach((fr, i) => { const d = i + 1 < frames.length ? frames[i + 1].ts - fr.ts : 0.04; list += `file '${process.cwd()}/${fr.f}'\nduration ${d.toFixed(4)}\n`; });
list += `file '${process.cwd()}/${frames.at(-1).f}'\n`; fs.writeFileSync('out/rec/list.txt', list);
marks._offset = t00 - t0 / 1000; console.log('frames', frames.length, 'first-frame offset', marks._offset.toFixed(2));
await ctx.close();
fs.writeFileSync('out/marks.json', JSON.stringify(marks, null, 2)); await browser.close();
