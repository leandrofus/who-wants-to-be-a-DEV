// Serves the REAL game UI (../public) with scripted demo questions (a fictional "shop-api" repo),
// so the trailer never shows anyone's private code and needs no LLM calls.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT || 7799);

const Q = [
  { category: 'code', theme: 'backend · «auth»', file: 'src/middleware/auth.ts',
    context: 'Express middleware. `verify(token)` returns the decoded payload and throws for anything that is not a valid signed token, including `undefined`.',
    code: "export function auth(req, res, next) {\n  const token = req.headers.authorization?.split(' ')[1]\n  try {\n    req.user = verify(token)\n  } catch {\n    return res.status(401).json({ error: 'unauthorized' })\n  }\n  next()\n}",
    question: 'A request arrives with no Authorization header at all. What happens?',
    options: ['next() runs with req.user undefined', 'It responds 401 and stops here', 'It throws a TypeError at split()', 'It responds 400 Bad Request'], answer: 1,
    explanation: 'The optional chaining makes token undefined, verify() throws, and the catch block answers 401 without calling next().' },
  { category: 'lang', theme: 'frontend · «checkout»', file: 'src/components/Counter.tsx',
    context: 'A React function component. `count` is 0 when the user clicks the button, which calls `add3()` once.',
    code: 'const [count, setCount] = useState(0)\n\nfunction add3() {\n  setCount(count + 1)\n  setCount(count + 1)\n  setCount(count + 1)\n}',
    question: 'What is `count` after the next render?',
    options: ['3', '1', '0', 'It throws an error'], answer: 1,
    explanation: 'All three calls read the same stale `count` (0), so each one schedules 1. Use setCount(c => c + 1) to accumulate.' },
  { category: 'design', theme: 'database · «orders»', file: 'db/reports/big_spenders.sql',
    context: 'Table orders(customer_id, status, total) holds: (1,paid,60), (1,paid,50), (2,paid,90), (2,refunded,500).',
    code: "SELECT customer_id, SUM(total)\nFROM orders\nWHERE status = 'paid'\nGROUP BY customer_id\nHAVING SUM(total) > 100;",
    question: 'Which customer_ids does this query return?',
    options: ['1 only', '1 and 2', '2 only', 'None'], answer: 0,
    explanation: 'WHERE removes the refunded row first, so customer 2 sums to 90 and fails HAVING; customer 1 sums to 110.' },
];
let qi = 0, agent = 'idle', theme = 'auto: backend';
const clients = new Set();
const push = () => { const m = `data: ${JSON.stringify({ agent, since: Date.now(), provider: 'claude-cli', error: '', theme, ready: 10, target: 10 })}\n\n`; clients.forEach((c) => c.write(m)); };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
  if (u.pathname === '/api/question') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(Q[qi++ % Q.length])); }
  if (u.pathname === '/api/themes') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ lang: 'en', langs: { en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian', zh: 'Chinese', ja: 'Japanese' }, repo: 'shop-api', areas: ['frontend', 'backend', 'database', 'infra'], auto: 'backend', manual: false, sel: { areas: [], focus: [], manual: false },
      features: [['auth', 24], ['orders', 19], ['customers', 17], ['payments', 15], ['invoices', 12], ['sessions', 9], ['catalog', 8], ['webhooks', 6]].map(([name, count]) => ({ name, count })) }));
  }
  if (u.pathname === '/api/theme') { try { const b = JSON.parse(body); theme = b.auto ? 'auto: backend' : `${(b.areas || []).join('+') || 'all'} · «${(b.focus || []).join(', ')}»`; } catch {} push(); res.writeHead(204); return res.end(); }
  if (u.pathname === '/api/lang') { res.writeHead(204); return res.end(); }
  if (u.pathname === '/api/events') { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); clients.add(res); req.on('close', () => clients.delete(res)); return push(); }
  if (u.pathname === '/api/event') { try { const e = JSON.parse(body); agent = e.type === 'start' ? 'working' : 'idle'; } catch {} push(); res.writeHead(204); return res.end(); }
  const f = path.join(pub, u.pathname === '/' ? 'index.html' : path.normalize(u.pathname));
  if (!f.startsWith(pub) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('mock on', PORT));
