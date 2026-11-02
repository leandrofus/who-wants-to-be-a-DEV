// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Leandro <leandrofusdev@gmail.com>
// Servidor sin dependencias: sirve el juego, genera preguntas (Haiku u Ollama)
// y recibe eventos de los hooks de Claude Code (start/stop).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

import { dataDir } from './paths.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // package root (read-only when installed)
const readJson = (f, d = {}) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
// defaults shipped with the package + user overrides in the per-user config dir
const cfg = { ...readJson(path.join(root, 'src', 'defaults.json')), ...readJson(path.join(dataDir(), 'config.json')) };
const PORT = Number(process.env.PORT || cfg.port);

const CATEGORIES = [
  { id: 'code', label: 'what the SNIPPET does / returns / what happens if a line changes / where a likely bug is' },
  { id: 'lang', label: 'a language or library feature that appears in the SNIPPET (semantics, pitfalls, recommended idiom)' },
  { id: 'diff', label: 'the recent CHANGES (diff/commits): why a change is correct or what effect it has; if there is no diff, use the SNIPPET' },
  { id: 'design', label: 'the responsibility of a module or a design decision that can be inferred from the SNIPPET and the FILES list' },
];

const LANGS = { en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian', zh: 'Chinese', ja: 'Japanese' };
const langState = { code: 'en' };

const SRC = /\.(js|mjs|cjs|jsx|ts|tsx|py|go|rs|java|kt|c|h|cpp|hpp|cs|rb|php|swift|sh|sql|lua|ex|exs|scala|vue|svelte|css|scss|html|ya?ml|tf)$|(^|\/)(Dockerfile|Makefile)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|vendor|\.git|gatt-out)\/|\.min\.|lock|secret|credential|\.env|\.pem|\.key|\.d\.ts$|\.(test|spec)\./i;
const git = (cwd, ...a) => { try { return execFileSync('git', a, { cwd, encoding: 'utf8', timeout: 3000, maxBuffer: 4e6 }); } catch { return ''; } };

// Áreas temáticas: el juego se restringe a la que el usuario está tocando.
const AREAS = {
  frontend: { re: /\.(tsx|jsx|vue|svelte|css|scss|html)$|(^|\/)(web|frontend|front|client|ui|components|pages|afiliados-web)\//i, kw: /\b(front|ui|css|react|componente|component|pantalla|página|pagina|vista|estilo|tailwind|hook|tsx|formulario|modal|botón|boton)\w*/gi },
  database: { re: /\.sql$|(^|\/)(migrations?|db|postgres)\//i, kw: /\b(sql|migraci|query|tabla|índice|indice|postgres|rls|schema|esquema|base de datos)\w*/gi },
  infra: { re: /\.(ya?ml|sh|tf)$|(^|\/)(Dockerfile|Makefile)$|(^|\/)(deploy|infra|\.github|build)\//i, kw: /\b(deploy|docker|ci|pipeline|k8s|kubernetes|terraform|makefile|infra|nginx|helm|yaml)\w*/gi },
  backend: { re: /./, kw: /\b(api|endpoint|handler|servidor|server|go|golang|rust|python|servicio|service|middleware|auth|permiso|rol|backend|grpc)\w*/gi },
};
const areaOf = (f) => ['frontend', 'database', 'infra'].find((k) => AREAS[k].re.test(f)) || 'backend';

// Detecta el tema según archivos tocados (git status), último commit y palabras de los prompts recientes.
function detectTheme(cwd, prompts) {
  const score = { frontend: 0, database: 0, infra: 0, backend: 0 };
  for (const l of git(cwd, 'status', '--porcelain').split('\n').filter(Boolean)) score[areaOf(l.slice(3))] += 3;
  for (const f of git(cwd, 'show', '--name-only', '--pretty=', 'HEAD').split('\n').filter(Boolean)) score[areaOf(f)] += 1;
  prompts.slice(-5).forEach((p, i, arr) => {
    const w = i === arr.length - 1 ? 3 : 1.5; // el prompt más reciente pesa más
    for (const k of Object.keys(AREAS)) score[k] += (p.match(AREAS[k].kw) || []).length * w;
  });
  const [best, v] = Object.entries(score).sort((x, y) => y[1] - x[1])[0];
  return v >= 3 ? best : 'general';
}

function listFiles(cwd) {
  let files = git(cwd, 'ls-files').split('\n').filter(Boolean);
  if (!files.length) { // sin git: recorrido acotado
    const out = [], walk = (d, depth) => {
      if (depth > 4 || out.length > 2000) return;
      for (const e of fs.readdirSync(path.join(cwd, d), { withFileTypes: true })) {
        const rel = path.join(d, e.name);
        if (e.name.startsWith('.') || SKIP.test(rel + '/')) continue;
        e.isDirectory() ? walk(rel, depth + 1) : out.push(rel);
      }
    };
    try { walk('', 0); } catch {}
    files = out;
  }
  return files.filter((f) => SRC.test(f) && !SKIP.test(f));
}

const norm = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP = new Set('src internal cmd pkg lib app apps test tests index main mod types type utils util common shared handler handlers service services model models mock mocks config static assets public components component pages page hooks hook store api web docs init data base core impl http route routes router repo repository dto'.split(' '));

// Features candidatas: tokens de rutas (carpetas y nombres de archivo) más frecuentes dentro de las áreas dadas.
function discoverFeatures(cwd, areas) {
  const files = listFiles(cwd).filter((f) => !areas.length || areas.includes(areaOf(f)));
  const count = new Map();
  for (const f of files) {
    const toks = new Set();
    for (const seg of f.replace(/\.[^.]+$/, '').split('/'))
      for (const t of seg.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9áéíóúñÁÉÍÓÚÑ]+/)) {
        const n = norm(t); if (n.length >= 4 && !STOP.has(n) && !/^\d+$/.test(n)) toks.add(n);
      }
    toks.forEach((t) => count.set(t, (count.get(t) || 0) + 1));
  }
  return [...count].filter(([, c]) => c >= 2).sort((x, y) => y[1] - x[1]).slice(0, 60).map(([name, count]) => ({ name, count }));
}

function poolFor(cwd, sel) {
  const all = listFiles(cwd);
  let pool = sel.areas.length ? all.filter((f) => sel.areas.includes(areaOf(f))) : all;
  if (sel.focus.length) {
    const terms = sel.focus.map(norm);
    let hit = pool.filter((f) => terms.some((t) => norm(f).includes(t)));
    if (hit.length < 3) { // completa buscando en el contenido
      const inPool = new Set(pool);
      for (const t of terms) for (const f of git(cwd, 'grep', '-l', '-i', '-F', '--', t).split('\n')) if (inPool.has(f) && !hit.includes(f)) hit.push(f);
    }
    if (hit.length) pool = hit;
  }
  return { pool, all };
}

// Contexto del repo para UNA pregunta: archivo del tema, cabecera (imports), ventana de código, diff y commits.
function repoContext(cwd, sel) {
  if (!cwd || !fs.existsSync(cwd)) return null;
  const { pool: p0, all } = poolFor(cwd, sel);
  const pool = p0.length ? p0 : all;
  if (!pool.length) return null;
  let f, lines = [];
  for (let i = 0; i < 8; i++) {
    f = pool[Math.floor(Math.random() * pool.length)];
    try { lines = fs.readFileSync(path.join(cwd, f), 'utf8').split('\n'); } catch { lines = []; }
    if (lines.length > 25) break;
  }
  const W = 50;
  const start = Math.max(0, Math.floor(Math.random() * Math.max(1, lines.length - W)));
  const head = start > 12 ? lines.slice(0, 12).join('\n') + '\n// ...\n' : '';
  const snippet = `${f} (líneas ${start + 1}-${Math.min(lines.length, start + W)} de ${lines.length}):\n${head}${lines.slice(start, start + W).join('\n')}`;
  const near = pool.filter((x) => path.dirname(x) === path.dirname(f)).slice(0, 15).join('\n');
  const log = git(cwd, 'log', '-6', '--pretty=%s').trim();
  const diff = (git(cwd, 'diff', 'HEAD', '--stat').trim() + '\n' + git(cwd, 'diff', 'HEAD', '-U3').slice(0, 2500)).trim();
  return { top: path.basename(cwd), file: f, near, files: pool.slice(0, 40).join('\n'), log, diff, snippet };
}

// ---- preferencias de temática por repo (persisten en prefs.json)
fs.mkdirSync(dataDir(), { recursive: true });
const PREFS = path.join(dataDir(), 'prefs.json');
let prefs = {};
try { prefs = JSON.parse(fs.readFileSync(PREFS, 'utf8')); } catch {}
if (prefs._lang && LANGS[prefs._lang]) langState.code = prefs._lang; else if (LANGS[cfg.questionLanguage]) langState.code = cfg.questionLanguage;
const savePrefs = () => fs.writeFileSync(PREFS, JSON.stringify(prefs, null, 2));
const cleanList = (x) => (Array.isArray(x) ? x : []).map((v) => String(v).trim()).filter(Boolean).slice(0, 12);

// ---- sesiones: cada sesión de Claude Code tiene su cola de preguntas, su repo y su tema
const sessions = new Map();
let activeId = null;
const state = { agent: 'idle', since: Date.now() };
const clients = new Set();
let lastError = '', provider = '';
const active = () => sessions.get(activeId);
function effectiveSel(s) {
  const p = prefs[s.cwd];
  if (p) return { areas: cleanList(p.areas).filter((a) => AREAS[a]), focus: cleanList(p.focus), manual: true };
  return { areas: s.auto === 'general' ? [] : [s.auto], focus: [], manual: false };
}
const labelOf = (sel) => (sel.manual ? '' : 'auto: ') + ([sel.areas.join('+') || 'all', ...(sel.focus.length ? ['«' + sel.focus.join(', ') + '»'] : [])].join(' · '));

function broadcast() {
  const s = active();
  const msg = `data: ${JSON.stringify({ agent: state.agent, since: state.since, provider, error: lastError, theme: s ? labelOf(effectiveSel(s)) : '', ready: s?.queue.length || 0, target: cfg.prefetch })}\n\n`;
  for (const c of clients) c.write(msg);
}

function buildPrompt(cat, rc, sess) {
  const sel = effectiveSel(sess);
  const lang = LANGS[langState.code];
  const ctx = rc
    ? `Active repo: ${rc.top}\nTOPIC: ${labelOf(sel)}\n\nFILES IN TOPIC:\n${rc.files}\n\nSIBLING FILES OF ${rc.file}:\n${rc.near}\n\nRECENT COMMITS:\n${rc.log || '(none)'}\n\nUNCOMMITTED CHANGES:\n${rc.diff || '(none)'}\n\nSNIPPET:\n${rc.snippet}`
    : `(no active repo yet: ask a general question about ${cfg.language} and ${cfg.extraTopics.join(', ')})`;
  return `Write ONE multiple-choice question in ${lang}, ${cfg.difficulty} level, about: ${cat.label}.
The player is waiting for a coding agent working on this repo and wants to stay sharp on the language and on development. Current TOPIC: ${labelOf(sel)} (stay within it${sel.focus.length ? `; the questions must be about the "${sel.focus.join(', ')}" functionality of the repo` : ''}).
Recent prompts the user sent to the agent: ${sess.prompts.slice(-3).join(' | ').slice(0, 500) || '(none)'}

${ctx}

Reply with VALID JSON only, no markdown, in exactly this shape (keep the key order):
{"category":"${cat.id}","file":"path/to/file","context":"...","code":"","question":"...","reasoning":"...","options":["A","B","C","D"],"answer":0,"explanation":"1-2 sentences"}
All human-readable text values (context, question, options, explanation) MUST be written in ${lang}. Keep code, identifiers and file paths as they are.
Rules:
- SELF-CONTAINED: it must be solvable by reading only "context" + "code" + "question", without running anything and without knowing the rest of the repo. The player CANNOT see the repo.
- CONCRETE: always set a specific scenario inside the question (a particular input, state or return value) and ask what happens in THAT case. Abstract questions are forbidden ("what happens with error handling?", "is this design correct?", "what would you improve?").
- If the code calls functions, types or constants that are not in "code", describe their exact behavior in "context" (what they return, when they fail, with which values). Never depend on something the player cannot see.
- Before writing the options, solve the question step by step in "reasoning" using ONLY what is visible. If you cannot reach a single certain answer, replace the question with one that can be solved.
- "code": the relevant lines copied verbatim from the SNIPPET (5-25 lines), trimmed so the important ones fit completely; required if the question mentions code.
- "context": 1-3 sentences, concise.
- Exactly 4 short, distinct options; "answer" is the index (0-3) of the correct one; only one correct; distractors must come from typical misreadings.
- Avoid trivial questions (what does import do?) and name-memorization questions.`;
}

async function viaAnthropic(prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: cfg.anthropicModel, max_tokens: 1400, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).content[0].text;
}

// Llama a `claude -p` por stdin: usa tu login de Claude Code, sin API key.
// QUIZ_GEN=1 hace que notify.sh ignore los hooks de esta sub-sesión.
function viaClaudeCli(prompt) {
  return new Promise((resolve, reject) => {
    const p = spawn('claude', ['-p', '--model', cfg.claudeCliModel || 'haiku', '--tools', '', '--no-session-persistence', '--disable-slash-commands'],
      { cwd: os.tmpdir(), env: { ...process.env, QUIZ_GEN: '1' }, shell: process.platform === 'win32' });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('claude cli timeout')); }, 60000);
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`claude cli ${code}: ${err.slice(0, 160)}`)); });
    p.stdin.end(prompt);
  });
}

async function viaOllama(prompt) {
  const r = await fetch(`${cfg.ollamaUrl}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({ model: cfg.ollamaModel, stream: false, format: 'json', messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return (await r.json()).message.content;
}

function parseQuestion(text, cat, sess, rc) {
  const m = text.match(/\{[\s\S]*\}/);
  const q = JSON.parse(m ? m[0] : text);
  if (!q.question || !Array.isArray(q.options) || q.options.length !== 4) throw new Error('invalid shape');
  q.options = q.options.map(String);
  q.answer = Number(q.answer);
  if (!(q.answer >= 0 && q.answer <= 3)) throw new Error('invalid answer');
  if (/cannot be determined|can't be determined|not clear|ambiguous|depends on|no se puede (determinar|saber)|no (est[aá]|queda) claro|ambig/i.test(String(q.reasoning || ''))) throw new Error('ambiguous question');
  delete q.reasoning;
  q.category = cat.id; q.code = q.code ? String(q.code) : ''; q.explanation = q.explanation || '';
  q.context = q.context ? String(q.context) : ''; q.file = q.file || rc?.file || ''; q.theme = labelOf(effectiveSel(sess));
  return q;
}

async function generate(sess) {
  const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const rc = repoContext(sess.cwd, effectiveSel(sess));
  const prompt = buildPrompt(cat, rc, sess);
  const order = cfg.provider === 'ollama' ? ['ollama']
    : cfg.provider === 'anthropic' ? ['anthropic']
    : cfg.provider === 'claude-cli' ? ['claude-cli']
    : [process.env.ANTHROPIC_API_KEY && 'anthropic', 'claude-cli', 'ollama'].filter(Boolean);
  let err;
  for (const p of order) {
    try {
      const text = await ({ anthropic: viaAnthropic, 'claude-cli': viaClaudeCli, ollama: viaOllama }[p])(prompt);
      const q = parseQuestion(text, cat, sess, rc);
      provider = p; lastError = '';
      return q;
    } catch (e) { err = e; }
  }
  lastError = String(err?.message || err);
  throw err;
}

// Mantiene `prefetch` preguntas listas por sesión (hasta 2 generaciones en paralelo).
// Solo se rellena la sesión activa; las demás conservan lo que ya tienen.
function fill() {
  const sess = active();
  if (!sess) return Promise.resolve();
  while (sess.inflight.size < 2 && sess.queue.length + sess.inflight.size < cfg.prefetch) {
    const epoch = sess.epoch;
    const p = generate(sess).then((q) => {
      if (epoch === sess.epoch) { sess.queue.push(q); broadcast(); } // descarta si cambió el tema/repo
    }).catch((e) => { console.error('[gen]', e.message); sess.failed = Date.now(); })
      .finally(() => { sess.inflight.delete(p); if (!sess.failed || Date.now() - sess.failed > 15000) fill(); else broadcast(); });
    sess.inflight.add(p);
  }
  return Promise.race([...sess.inflight, Promise.resolve()]);
}

const sigOf = (s) => JSON.stringify(effectiveSel(s));
function onStart(e) {
  const id = e.session || e.cwd || 'default';
  let s = sessions.get(id);
  if (!s) { s = { id, cwd: '', auto: 'general', sig: '', prompts: [], queue: [], inflight: new Set(), epoch: 0, failed: 0 }; sessions.set(id, s); }
  s.cwd = cfg.repo || e.cwd || s.cwd;
  if (e.prompt) { s.prompts.push(e.prompt); s.prompts = s.prompts.slice(-8); }
  s.auto = detectTheme(s.cwd, s.prompts);
  const sig = sigOf(s);
  if (sig !== s.sig) { s.sig = sig; s.epoch++; s.queue.length = 0; } // otro tema: preguntas viejas fuera
  activeId = id; s.failed = 0;
  fill();
}

function applyTheme(body) {
  const s = active(); if (!s) return;
  if (body.auto) delete prefs[s.cwd];
  else prefs[s.cwd] = { areas: cleanList(body.areas).filter((a) => AREAS[a]), focus: cleanList(body.focus) };
  savePrefs();
  s.sig = sigOf(s); s.epoch++; s.queue.length = 0; s.failed = 0;
  fill(); broadcast();
}

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/question') {
    if (!active()) onStart({ cwd: cfg.repo || '', session: 'default' });
    const sess = active();
    const t0 = Date.now();
    while (!sess.queue.length && sess.inflight.size && Date.now() - t0 < 90000) await Promise.race([...sess.inflight]);
    if (!sess.queue.length) { sess.failed = 0; fill(); await Promise.race([...sess.inflight, new Promise((r) => setTimeout(r, 90000))]); }
    const q = sess.queue.shift();
    fill(); broadcast();
    res.writeHead(q ? 200 : 503, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(q || { error: lastError || 'no questions' }));
  }
  if (url.pathname === '/api/themes') {
    if (!active()) onStart({ cwd: cfg.repo || '', session: 'default' });
    const sess = active(), areas = cleanList((url.searchParams.get('areas') || '').split(','));
    const sel = effectiveSel(sess);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ lang: langState.code, langs: LANGS, repo: path.basename(sess.cwd || '') || '(no repo)', areas: Object.keys(AREAS), auto: sess.auto, manual: sel.manual, sel, features: sess.cwd ? discoverFeatures(sess.cwd, areas.filter((a) => AREAS[a])) : [] }));
  }
  if (url.pathname === '/api/lang' && req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    try {
      const { lang } = JSON.parse(body || '{}');
      if (LANGS[lang] && lang !== langState.code) {
        langState.code = lang; prefs._lang = lang; savePrefs();
        for (const x of sessions.values()) { x.epoch++; x.queue.length = 0; }
        fill();
      }
    } catch {}
    broadcast(); res.writeHead(204); return res.end();
  }
  if (url.pathname === '/api/theme' && req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    try { applyTheme(JSON.parse(body || '{}')); } catch {}
    res.writeHead(204); return res.end();
  }
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    clients.add(res); req.on('close', () => clients.delete(res));
    return broadcast();
  }
  if (url.pathname === '/api/event' && req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    try {
      const e = JSON.parse(body || '{}');
      if (e.type === 'start') { state.agent = 'working'; state.since = Date.now(); onStart(e); }
      if (e.type === 'stop') { state.agent = 'idle'; state.since = Date.now(); }
    } catch {}
    broadcast(); res.writeHead(204); return res.end();
  }
  let f = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(root, 'public', path.normalize(f).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => { console.log(`Quiz runner en http://localhost:${PORT}`); onStart({ cwd: cfg.repo || '', session: 'default' }); });
