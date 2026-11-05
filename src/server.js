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

// File log (the server runs detached with stdio ignored). Truncated when it grows past 1 MB.
const LOG_FILE = path.join(dataDir(), 'server.log');
function log(level, msg, extra) {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1e6) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${level.padEnd(5)} ${msg}${extra ? '\n  ' + String(extra).slice(0, 1500).replace(/\n/g, '\n  ') : ''}\n`);
  } catch {}
}
process.on('uncaughtException', (e) => log('FATAL', 'uncaughtException: ' + e.message, e.stack));
process.on('unhandledRejection', (e) => log('ERROR', 'unhandledRejection: ' + (e?.message || e), e?.stack));
const PREFETCH = Math.max(1, Math.min(10, Math.floor(Number(cfg.prefetch) || 10)));

const CATEGORIES = [
  { id: 'code', label: 'what the SNIPPET does / returns / what happens if a line changes / where a likely bug is' },
  { id: 'lang', label: 'a language or library feature that appears in the SNIPPET (semantics, pitfalls, recommended idiom)' },
  { id: 'diff', label: 'the recent CHANGES (diff/commits): why a change is correct or what effect it has; if there is no diff, use the SNIPPET' },
  { id: 'design', label: 'the responsibility of a module or a design decision that can be inferred from the SNIPPET and the FILES list' },
];

// PR review mode: questions about the change set the user sent, instead of topics.
const PR_CATEGORIES = [
  { id: 'pr', label: 'what the PR change does: the exact behavior of the new/changed lines for a specific input or state' },
  { id: 'pr', label: 'a bug, edge case or regression risk a reviewer should catch in the PR change (ask what happens in a concrete case)' },
  { id: 'pr', label: 'why the PR change was needed / what would break or behave differently without it' },
  { id: 'pr', label: 'the effect of the PR change on callers or on other behavior, as far as the visible diff and context show' },
];

const LANGS = { en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian', zh: 'Chinese', ja: 'Japanese' };
const langState = { code: 'en' };
const PROVIDERS = [
  { id: 'auto', label: 'Automatic', detail: 'Anthropic API key → Claude Code → Ollama' },
  { id: 'claude-cli', label: 'Claude Code', detail: 'Uses your local Claude Code login' },
  { id: 'antigravity', label: 'Antigravity (agy)', detail: 'Uses your local agy CLI login' },
  { id: 'codex', label: 'Codex CLI', detail: 'Uses your local Codex CLI login' },
  { id: 'ollama', label: 'Ollama', detail: 'Uses the configured local Ollama model' },
  { id: 'anthropic', label: 'Anthropic API', detail: 'Requires ANTHROPIC_API_KEY' },
];

const SRC = /\.(js|mjs|cjs|jsx|ts|tsx|py|go|rs|java|kt|c|h|cpp|hpp|cs|rb|php|swift|sh|sql|lua|ex|exs|scala|vue|svelte|css|scss|html|ya?ml|tf)$|(^|\/)(Dockerfile|Makefile)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|vendor|\.git|gatt-out)\/|\.min\.|lock|secret|credential|\.env|\.pem|\.key|\.d\.ts$|\.(test|spec)\./i;
const git = (cwd, ...a) => { try { return execFileSync('git', a, { windowsHide: true, cwd, encoding: 'utf8', timeout: 3000, maxBuffer: 4e6 }); } catch { return ''; } };

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
        const rel = path.posix.join(d.split(path.sep).join('/'), e.name);
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

// ---- PR review: base branch, title and diff of the branch the user is sending
const gitL = (cwd, ...a) => { try { return execFileSync('git', a, { windowsHide: true, cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 16e6 }); } catch { return ''; } };
const prCache = new Map();
function prInfo(cwd) {
  const hit = prCache.get(cwd);
  if (hit && Date.now() - hit.at < 30000) return hit.v;
  const v = { ok: false, branch: '', base: '', title: '', body: '', number: 0, head: '', files: [] };
  if (cwd && fs.existsSync(cwd)) {
    v.branch = git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    v.head = git(cwd, 'rev-parse', 'HEAD').trim();
    try { // PR de GitHub si hay gh
      const j = JSON.parse(execFileSync('gh', ['pr', 'view', '--json', 'number,title,body,baseRefName'], { windowsHide: true, cwd, encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }));
      v.number = j.number; v.title = j.title || ''; v.body = (j.body || '').slice(0, 1200); v.base = j.baseRefName || '';
    } catch {}
    const cands = [v.base && 'origin/' + v.base, v.base, git(cwd, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').trim(), 'origin/main', 'origin/master', 'main', 'master'].filter(Boolean);
    let range = '';
    for (const b of cands) {
      if (b === v.branch || !git(cwd, 'rev-parse', '--verify', '-q', b).trim()) continue;
      if (gitL(cwd, 'diff', '--name-only', `${b}...HEAD`).trim()) { v.base = b; range = `${b}...HEAD`; break; }
    }
    if (!range && v.head) { range = 'HEAD~1..HEAD'; v.base = 'HEAD~1'; if (!v.title) v.title = git(cwd, 'log', '-1', '--pretty=%s').trim(); } // sin rama: último commit
    v.range = range;
    v.files = range ? gitL(cwd, 'diff', '--numstat', range).split('\n').filter(Boolean).map((l) => { const [a, d, ...f] = l.split('\t'); return { f: f.join('\t'), add: +a || 0, del: +d || 0 }; }).filter((x) => x.f && !SKIP.test(x.f)) : [];
    if (!v.title && v.branch) v.title = v.branch;
    v.ok = v.files.length > 0;
  }
  prCache.set(cwd, { at: Date.now(), v });
  return v;
}
function prContext(cwd) {
  const pr = prInfo(cwd);
  if (!pr.ok) return null;
  const total = pr.files.reduce((n, x) => n + x.add + x.del, 0) || 1;
  let r = Math.random() * total, pick = pr.files[0];
  for (const x of pr.files) { r -= x.add + x.del || 1; if (r <= 0) { pick = x; break; } } // ponderado por tamaño del cambio
  const full = gitL(cwd, 'diff', '-U6', pr.range, '--', pick.f);
  const hunks = full.split(/\n(?=@@ )/); // elige un hunk al azar y lo completa hasta ~3500 chars
  const h0 = hunks[0].startsWith('@@') ? 0 : 1;
  const start = h0 + Math.floor(Math.random() * Math.max(1, hunks.length - h0));
  let diff = hunks.slice(start).join('\n').slice(0, 3500);
  if (start > h0 || h0) diff = `${pick.f} (diff excerpt):\n` + diff;
  let after = '';
  try { const L = fs.readFileSync(path.join(cwd, pick.f), 'utf8').split('\n'); after = L.slice(0, 14).join('\n'); } catch {}
  const stat = pr.files.slice(0, 30).map((x) => `${x.f} +${x.add} -${x.del}`).join('\n');
  return { top: path.basename(cwd), file: pick.f, pr, stat, diff, after, near: '', files: '', log: '', snippet: '' };
}

// ---- preferencias de temática por repo (persisten en prefs.json)
fs.mkdirSync(dataDir(), { recursive: true });
const PREFS = path.join(dataDir(), 'prefs.json');
let prefs = {};
try { prefs = JSON.parse(fs.readFileSync(PREFS, 'utf8')); } catch {}
if (prefs._lang && LANGS[prefs._lang]) langState.code = prefs._lang; else if (LANGS[cfg.questionLanguage]) langState.code = cfg.questionLanguage;
const savePrefs = () => fs.writeFileSync(PREFS, JSON.stringify(prefs, null, 2));
const cleanList = (x) => (Array.isArray(x) ? x : []).map((v) => String(v).trim()).filter(Boolean).slice(0, 12);
const isProvider = (id) => PROVIDERS.some((p) => p.id === id);
const selectedProvider = () => {
  const id = prefs._provider || cfg.provider || 'auto';
  return isProvider(id) ? id : 'auto';
};

// ---- sesiones: cada sesión de Claude Code tiene su cola de preguntas, su repo y su tema
const sessions = new Map();
let activeId = null;
const state = { agent: 'idle', since: Date.now() };
const WORKING_TTL = 30 * 60 * 1000; // a lost Stop hook must not leave a session "working" forever
const isWorking = (x) => x.working && Date.now() - x.workingSince < WORKING_TTL;
function refreshAgent() { // global pill = any agent session still working
  const any = [...sessions.values()].some(isWorking);
  const next = any ? 'working' : 'idle';
  if (next !== state.agent) { state.agent = next; state.since = Date.now(); }
}
const clients = new Set();
let lastError = '', provider = '';
const active = () => sessions.get(activeId);
// Repo in use: pinned from the UI (prefs._repo) > repo of the agent that sent the hook (auto) > config.repo fallback.
const isDir = (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
const topOf = (d) => (d && isDir(d) ? (git(d, 'rev-parse', '--show-toplevel').trim() || d) : '');
const resolveRepo = (hookCwd) => (prefs._repo && isDir(prefs._repo) ? prefs._repo : topOf(hookCwd) || (cfg.repo && isDir(cfg.repo) ? cfg.repo : ''));
const initialRepo = cfg.repo && isDir(cfg.repo) ? cfg.repo : process.cwd();
function setRepo(target) { // target: absolute path, or '' for automatic
  if (target) {
    const d = path.resolve(target);
    if (!isDir(d)) throw new Error('not a folder');
    prefs._repo = d;
    prefs._recent = [prefs._repo, ...cleanList(prefs._recent).filter((x) => x !== prefs._repo)].slice(0, 8);
  } else delete prefs._repo;
  savePrefs();
  for (const x of sessions.values()) {
    x.cwd = resolveRepo(x.hookCwd); x.auto = detectTheme(x.cwd, x.prompts);
    x.sig = sigOf(x); x.epoch++; x.queue.length = 0; x.failed = 0;
  }
  fill(); broadcast();
}

function effectiveSel(s) {
  const p = prefs[s.cwd];
  if (p?.mode === 'pr') return { areas: [], focus: [], manual: true, pr: true, head: prInfo(s.cwd).head };
  if (p) return { areas: cleanList(p.areas).filter((a) => AREAS[a]), focus: cleanList(p.focus), manual: true };
  return { areas: s.auto === 'general' ? [] : [s.auto], focus: [], manual: false };
}
const labelOf = (sel) => sel.pr ? 'PR review' : (sel.manual ? '' : 'auto: ') + ([sel.areas.join('+') || 'all', ...(sel.focus.length ? ['«' + sel.focus.join(', ') + '»'] : [])].join(' · '));

function broadcast() {
  const s = active();
  const msg = `data: ${JSON.stringify({ agent: state.agent, since: state.since, repo: s?.cwd ? path.basename(s.cwd) : '', provider, error: lastError, theme: s ? labelOf(effectiveSel(s)) : '', ready: s?.queue.length || 0, target: PREFETCH })}\n\n`;
  for (const c of clients) c.write(msg);
}

function buildPrPrompt(rc, sess, n) {
  const lang = LANGS[langState.code];
  const pr = rc.pr;
  const angles = PR_CATEGORIES.map((cat) => `- ${cat.label}`).join('\n');
  return `Write exactly ${n} different multiple-choice questions in ${lang}, ${cfg.difficulty} level, about the player's own PULL REQUEST.
The player is waiting for a coding agent. The goal is to check that they truly understand the change they are about to ship (code they wrote or accepted from an agent), not to quiz them on trivia.
Vary the questions across these review angles:
${angles}

PR: ${pr.number ? '#' + pr.number + ' ' : ''}${pr.title}  (branch ${pr.branch} -> ${pr.base})
${pr.body ? 'DESCRIPTION:\n' + pr.body + '\n' : ''}
FILES CHANGED:
${rc.stat}

DIFF EXCERPT (lines starting with + were added, - removed):
${rc.diff}

${rc.after ? 'TOP OF ' + rc.file + ':\n' + rc.after + '\n' : ''}
Reply with VALID JSON only, no markdown, in exactly this shape:
{"file":"${rc.file}","context":"shared context that makes the excerpt understandable","code":"relevant changed lines copied verbatim from the diff","questions":[{"category":"pr","question":"...","reasoning":"...","options":["A","B","C","D"],"answer":0,"explanation":"1-2 sentences"}]}
The batch-level "context" and "code" are shared by every question. All human-readable text values (context, question, options, explanation) MUST be written in ${lang}. Keep code, identifiers and file paths as they are.
Rules:
- Return exactly ${n} questions in the "questions" array. Every question must be distinct and self-contained using the shared "context" + "code" and its "question". The player CANNOT see the repo or the diff beyond what you copy into "code".
- "code": relevant changed lines copied verbatim from the DIFF EXCERPT (keep the +/- markers, 4-15 lines); required.
- CONCRETE: set a specific input/state and ask what happens in THAT case with the new code (or what the old code did differently). No abstract questions ("is this a good change?", "what could be improved?").
- If the code depends on things not shown, state their exact behavior in "context".
- Before writing the options, solve the question step by step in "reasoning" using ONLY what is visible. If you cannot reach a single certain answer, ask a different question that you can.
- Exactly 4 short, distinct options; "answer" is the index (0-3) of the correct one; only one correct; distractors come from typical misreadings of the diff.
- Vary the correct answer index across the batch; do not make every correct answer the same letter. Do not refer to option letters in explanations.
- Do not ask about commit metadata, file names or line numbers.`;
}

function buildPrompt(rc, sess, n) {
  const sel = effectiveSel(sess);
  const lang = LANGS[langState.code];
  if (sel.pr) return buildPrPrompt(rc, sess, n);
  const categories = CATEGORIES.map((item) => `- ${item.id}: ${item.label}`).join('\n');
  const ctx = rc
    ? `Active repo: ${rc.top}\nTOPIC: ${labelOf(sel)}\n\nFILES IN TOPIC:\n${rc.files}\n\nSIBLING FILES OF ${rc.file}:\n${rc.near}\n\nRECENT COMMITS:\n${rc.log || '(none)'}\n\nUNCOMMITTED CHANGES:\n${rc.diff || '(none)'}\n\nSNIPPET:\n${rc.snippet}`
    : `(no active repo yet: ask a general question about ${cfg.language} and ${cfg.extraTopics.join(', ')})`;
  return `Write exactly ${n} different multiple-choice questions in ${lang}, ${cfg.difficulty} level, about the player's current repo and topic.
The player is waiting for a coding agent working on this repo and wants to stay sharp on the language and on development. Current TOPIC: ${labelOf(sel)} (stay within it${sel.focus.length ? `; the questions must be about the "${sel.focus.join(', ')}" functionality of the repo` : ''}).
Vary the questions across these categories:
${categories}
Recent prompts the user sent to the agent: ${sess.prompts.slice(-3).join(' | ').slice(0, 500) || '(none)'}

${ctx}

Reply with VALID JSON only, no markdown, in exactly this shape:
{"file":"path/to/file","context":"shared context that makes the snippet understandable","code":"relevant snippet lines","questions":[{"category":"code","question":"...","reasoning":"...","options":["A","B","C","D"],"answer":0,"explanation":"1-2 sentences"}]}
The batch-level "context" and "code" are shared by every question. All human-readable text values (context, question, options, explanation) MUST be written in ${lang}. Keep code, identifiers and file paths as they are.
Rules:
- Return exactly ${n} questions in the "questions" array. Every question must be distinct and self-contained using the shared "context" + "code" and its "question". The player CANNOT see the repo.
- CONCRETE: always set a specific scenario inside the question (a particular input, state or return value) and ask what happens in THAT case. Abstract questions are forbidden ("what happens with error handling?", "is this design correct?", "what would you improve?").
- If the code calls functions, types or constants that are not in "code", describe their exact behavior in "context" (what they return, when they fail, with which values). Never depend on something the player cannot see.
- Before writing the options, solve each question step by step in "reasoning" using ONLY what is visible. If you cannot reach a single certain answer, replace that question with one that can be solved.
- "code": relevant lines copied verbatim from the SNIPPET (5-15 lines), trimmed so the important ones fit completely.
- "context": 1-3 sentences, concise.
- Exactly 4 short, distinct options; "answer" is the index (0-3) of the correct one; only one correct; distractors must come from typical misreadings.
- Vary the correct answer index across the batch; do not make every correct answer the same letter. Do not refer to option letters in explanations.
- Avoid trivial questions (what does import do?) and name-memorization questions.`;
}

async function viaAnthropic(prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: cfg.anthropicModel, max_tokens: 8192, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).content[0].text;
}

// Run generation CLIs outside the repo so question prompts cannot grant them workspace access.
function viaCli(command, args, prompt, name) {
  return new Promise((resolve, reject) => {
    const win = process.platform === 'win32'; // shell:true on Windows drops empty args (--tools '') unless quoted
    const p = spawn(command, win ? args.map((a) => (a === '' ? '""' : a)) : args,
      { cwd: os.tmpdir(), env: { ...process.env, QUIZ_GEN: '1' }, shell: win, windowsHide: true });
    let out = '', err = '';
    let settled = false;
    const t0 = Date.now();
    log('INFO', `${name}: spawned (prompt ${prompt.length} chars)`);
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const ms = Date.now() - t0;
      if (error) log('ERROR', `${name}: failed after ${ms}ms: ${error.message}`, (err ? 'stderr: ' + err.slice(0, 600) + '\n' : '') + (out ? 'stdout: ' + out.slice(0, 600) : ''));
      else log('INFO', `${name}: ok in ${ms}ms (${out.length} chars out)`);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => { p.kill(); finish(new Error(`${name} timeout`)); }, cfg.cliTimeoutMs || 240000);
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => finish(new Error(`${name}: ${e.message}`)));
    p.on('close', (code) => code === 0 ? finish(null, out) : finish(new Error(`${name} ${code}: ${err.slice(0, 160)}`)));
    p.stdin.end(prompt);
  });
}

// Uses the local Claude Code login, without an API key.
function viaClaudeCli(prompt) {
  return viaCli('claude', ['-p', '--model', cfg.claudeCliModel || 'haiku', '--tools', '', '--no-session-persistence', '--disable-slash-commands'], prompt, 'claude cli');
}

function viaAntigravityCli(prompt) {
  return viaCli('agy', ['--print=', '--disable-slash-commands', '--output-format', 'stream-json', '--input-format', 'stream-json', '--sandbox'],
    JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n', 'agy cli')
    .then(parseAntigravityOutput);
}

function parseAntigravityOutput(output) {
  let result;
  for (const [index, line] of output.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch (e) {
      throw new Error(`agy cli returned invalid stream-json on line ${index + 1}: ${e.message}`);
    }
    if (event.event === 'result') result = event.result;
  }
  if (!result) throw new Error('agy cli did not return a result event');
  if (result.status !== 'SUCCESS') throw new Error(`agy cli ${result.status || 'failed'}: ${result.response || 'no response'}`);
  if (typeof result.response !== 'string') throw new Error('agy cli returned no response text');
  return result.response;
}

function viaCodexCli(prompt) {
  return viaCli('codex', ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '-'], prompt, 'codex cli');
}

async function viaOllama(prompt) {
  const r = await fetch(`${cfg.ollamaUrl}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({ model: cfg.ollamaModel, stream: false, format: 'json', messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return (await r.json()).message.content;
}

function parseQuestion(question, categories, shared, sess, rc) {
  if (!question || typeof question !== 'object' || !question.question || !Array.isArray(question.options) || question.options.length !== 4) {
    throw new Error('invalid question shape');
  }
  const q = { ...question };
  if (categories === PR_CATEGORIES) q.category = 'pr'; // PR angles share one id; the model only sees labels
  const category = categories.find((item) => item.id === q.category);
  if (!category) throw new Error(`invalid category: ${q.category}`);
  q.options = q.options.map(String);
  q.answer = Number(q.answer);
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) throw new Error('invalid answer');
  if (/cannot be determined|can't be determined|not clear|ambiguous|depends on|no se puede (determinar|saber)|no (est[aá]|queda) claro|ambig/i.test(String(q.reasoning || ''))) throw new Error('ambiguous question');
  delete q.reasoning;
  q.code = String(q.code || shared.code || ''); q.explanation = q.explanation || '';
  q.context = String(q.context || shared.context || ''); q.file = q.file || shared.file || rc?.file || '';
  q.theme = labelOf(effectiveSel(sess));
  return q;
}

function balanceAnswerPositions(questions) {
  const counts = [0, 0, 0, 0];
  for (const q of questions) {
    const leastUsed = Math.min(...counts);
    const candidates = counts.flatMap((count, index) => count === leastUsed ? [index] : []);
    const correctIndex = candidates[Math.floor(Math.random() * candidates.length)];
    const correctOption = q.options[q.answer];
    const distractors = q.options.filter((_, index) => index !== q.answer);
    for (let i = distractors.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [distractors[i], distractors[j]] = [distractors[j], distractors[i]];
    }
    let distractorIndex = 0;
    q.options = Array.from({ length: 4 }, (_, index) =>
      index === correctIndex ? correctOption : distractors[distractorIndex++]);
    q.answer = correctIndex;
    counts[correctIndex]++;
  }
  return questions;
}

async function generateBatch(sess, epoch, n = PREFETCH) {
  const sel = effectiveSel(sess);
  const categories = sel.pr ? PR_CATEGORIES : CATEGORIES;
  const rc = sel.pr ? prContext(sess.cwd) : repoContext(sess.cwd, sel);
  if (sel.pr && !rc) throw new Error('PR review: no changes found against the base branch (commit your work on a branch first)');
  const prompt = buildPrompt(rc, sess, n);
  const choice = selectedProvider();
  const order = choice === 'auto' ? [process.env.ANTHROPIC_API_KEY && 'anthropic', 'claude-cli', 'ollama'].filter(Boolean)
    : [choice]
  const generators = { anthropic: viaAnthropic, 'claude-cli': viaClaudeCli, antigravity: viaAntigravityCli, codex: viaCodexCli, ollama: viaOllama };
  let err;
  log('INFO', `batch: start n=${n} theme="${labelOf(sel)}" cwd=${sess.cwd} providers=${order.join('>')}`);
  const tb = Date.now();
  for (const p of order) {
    let text = '';
    try {
      text = await generators[p](prompt);
      const m = text.match(/\{[\s\S]*\}/);
      const batch = JSON.parse(m ? m[0] : text);
      if (!Array.isArray(batch.questions) || batch.questions.length !== n) {
        throw new Error(`invalid batch size: expected ${n}, received ${batch.questions?.length || 0}`);
      }
      const questions = balanceAnswerPositions(batch.questions.map((q) => parseQuestion(q, categories, batch, sess, rc)));
      if (epoch === sess.epoch) { provider = p; lastError = ''; }
      log('INFO', `batch: ${questions.length} questions via ${p} in ${Date.now() - tb}ms${epoch === sess.epoch ? '' : ' (stale, discarded)'}`);
      return questions;
    } catch (e) { err = e; log('WARN', `batch: provider ${p} rejected: ${e.message}`, text && !/^(claude|agy|codex)/.test(e.message) ? 'raw: ' + text.slice(0, 800) : ''); }
  }
  log('ERROR', `batch: all providers failed: ${err?.message || err}`);
  if (epoch === sess.epoch) lastError = String(err?.message || err);
  throw err;
}

// Genera cada lote con una sola llamada y mantiene hasta `prefetch` preguntas listas.
// Solo se rellena la sesión activa; las demás conservan lo que ya tienen.
function fill() {
  const sess = active();
  if (!sess) return Promise.resolve();
  if (sess.madeFor !== sess.epoch) { sess.madeFor = sess.epoch; sess.made = 0; }
  // Time-to-first-question: a small first batch, then top up to a full round in the background.
  const FIRST = Math.min(3, PREFETCH);
  if (sess.inflight.size || (sess.queue.length && sess.made >= PREFETCH)) return Promise.race([...sess.inflight, Promise.resolve()]);
  const n = sess.made === 0 ? FIRST : sess.made < PREFETCH ? PREFETCH - sess.made : PREFETCH;
  const epoch = sess.epoch;
  const p = generateBatch(sess, epoch, n).then((questions) => {
    if (epoch === sess.epoch) { sess.queue.push(...questions); sess.made += questions.length; broadcast(); }
  }).catch((e) => {
    if (epoch === sess.epoch) { log('WARN', `fill: retry in 15s after: ${e.message}`); sess.failed = Date.now(); }
  }).finally(() => {
    sess.inflight.delete(p);
    if (!sess.failed || Date.now() - sess.failed > 15000) fill(); else broadcast();
  });
  sess.inflight.add(p);
  return p;
}

const sigOf = (s) => JSON.stringify(effectiveSel(s));
function onStart(e, { fillNow = true, force = false } = {}) {
  const id = e.session || e.cwd || 'default';
  let s = sessions.get(id);
  if (!s) { s = { id, cwd: '', auto: 'general', sig: '', prompts: [], queue: [], inflight: new Set(), epoch: 0, failed: 0 }; sessions.set(id, s); }
  if (e.cwd) s.hookCwd = e.cwd;
  s.cwd = resolveRepo(s.hookCwd) || s.cwd;
  if (e.prompt) { s.prompts.push(e.prompt); s.prompts = s.prompts.slice(-8); }
  s.auto = detectTheme(s.cwd, s.prompts);
  const sig = sigOf(s);
  if (sig !== s.sig) { s.sig = sig; s.epoch++; s.queue.length = 0; } // otro tema: preguntas viejas fuera
  s.failed = 0;
  // Several agents in different repos: do not steal the game from a session that is still working.
  const cur = active();
  if (force || !cur || cur === s || !isWorking(cur)) { if (activeId !== id) log('INFO', `active session -> ${id} (${s.cwd})`); activeId = id; if (fillNow) fill(); }
  else log('INFO', `session ${id} (${s.cwd}) started while ${cur.id} (${cur.cwd}) is active and working: not switching`);
}

function onStop(e) {
  const x = sessions.get(e.session || e.cwd || '');
  if (x) x.working = false;
  else for (const y of sessions.values()) if (y.working && !e.session) y.working = false; // legacy Stop without session id
  // if the active session finished and another one is still working, follow that one
  const cur = active();
  if (cur && !isWorking(cur)) {
    const next = [...sessions.values()].filter(isWorking).sort((a, b) => b.workingSince - a.workingSince)[0];
    if (next) { log('INFO', `active session finished -> following ${next.id} (${next.cwd})`); activeId = next.id; fill(); }
  }
}

function applyTheme(body) {
  const s = active(); if (!s) return;
  if (body.auto) delete prefs[s.cwd];
  else if (body.pr) prefs[s.cwd] = { mode: 'pr' };
  else prefs[s.cwd] = { areas: cleanList(body.areas).filter((a) => AREAS[a]), focus: cleanList(body.focus) };
  savePrefs();
  s.sig = sigOf(s); s.epoch++; s.queue.length = 0; s.failed = 0;
  fill(); broadcast();
}

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/question') {
    if (!active()) onStart({ cwd: initialRepo, session: 'default' });
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
    if (!active()) onStart({ cwd: initialRepo, session: 'default' });
    const sess = active(), areas = cleanList((url.searchParams.get('areas') || '').split(','));
    const sel = effectiveSel(sess);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ lang: langState.code, langs: LANGS, provider: selectedProvider(), providers: PROVIDERS, repo: path.basename(sess.cwd || '') || '(no repo)', repoPath: sess.cwd || '', pinned: !!prefs._repo, recent: cleanList(prefs._recent).filter(isDir), areas: Object.keys(AREAS), auto: sess.auto, manual: sel.manual, pr: !!sel.pr, prinfo: (({ ok, branch, base, title, number, files }) => ({ ok, branch, base, title, number, files: files.length }))(prInfo(sess.cwd)), sel, features: sess.cwd ? discoverFeatures(sess.cwd, areas.filter((a) => AREAS[a])) : [] }));
  }
  if (url.pathname === '/api/dirs') { // folder browser for the repo picker (local only)
    const requested = url.searchParams.get('path');
    let dir = path.resolve(requested || active()?.cwd || os.homedir());
    if (!isDir(dir)) {
      if (requested) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'not a folder' })); }
      dir = os.homedir();
    }
    let dirs = [];
    try { dirs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules').map((d) => ({ name: d.name, git: fs.existsSync(path.join(dir, d.name, '.git')) })).sort((a, b) => a.name.localeCompare(b.name)); }
    catch (e) { res.writeHead(403, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: e.message })); }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ path: dir, parent: path.dirname(dir) !== dir ? path.dirname(dir) : '', git: fs.existsSync(path.join(dir, '.git')), dirs }));
  }
  if (url.pathname === '/api/repo' && req.method === 'POST') {
    const o = req.headers.origin; if (o && new URL(o).host !== req.headers.host) { res.writeHead(403); return res.end(); }
    let body = ''; for await (const c of req) body += c;
    try { setRepo(String(JSON.parse(body || '{}').path || '')); res.writeHead(204); } catch (e) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: e.message })); }
    return res.end();
  }
  if (url.pathname === '/api/provider' && req.method === 'POST') {
    const o = req.headers.origin;
    if (o && new URL(o).host !== req.headers.host) { res.writeHead(403); return res.end(); }
    let body;
    try {
      let raw = ''; for await (const c of req) raw += c;
      body = JSON.parse(raw || '{}');
    } catch { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'invalid JSON body' })); }
    if (!isProvider(body?.provider)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'unknown provider' }));
    }
    const previousPrefs = prefs;
    prefs = { ...prefs, _provider: body.provider };
    try { savePrefs(); } catch (e) {
      prefs = previousPrefs;
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: `could not save provider: ${e.message}` }));
    }
    provider = ''; lastError = '';
    for (const sess of sessions.values()) { sess.epoch++; sess.queue.length = 0; sess.failed = 0; }
    fill(); broadcast();
    res.writeHead(204); return res.end();
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
      log('INFO', `event: ${e.type} session=${e.session || '-'} cwd=${e.cwd || '-'}`);
      if (e.type === 'start') { onStart(e); const x = sessions.get(e.session || e.cwd || 'default'); if (x) { x.working = true; x.workingSince = Date.now(); } }
      if (e.type === 'repo' && e.cwd) { onStart({ cwd: e.cwd, session: e.session || 'cli' }, { force: true }); }
      if (e.type === 'stop') onStop(e);
      refreshAgent();
    } catch {}
    broadcast(); res.writeHead(204); return res.end();
  }
  let f = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(root, 'public', path.normalize(f).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => { log('INFO', `server up on :${PORT} pid=${process.pid} provider=${cfg.provider} lang=${langState.code}`); console.log(`Quiz runner en http://localhost:${PORT}`); onStart({ cwd: initialRepo, session: 'default' }, { fillNow: false }); });
