#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Leandro <leandrofusdev@gmail.com>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataDir } from '../src/paths.js';

const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const pos = rest.filter((a) => !a.startsWith('--'));
const opt = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : ''; };
const DATA = dataDir(), PID = path.join(DATA, 'server.pid');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
const port = () => Number(process.env.PORT || readJson(path.join(DATA, 'config.json')).port || readJson(path.join(pkgRoot, 'src', 'defaults.json')).port);
const URL_ = () => `http://127.0.0.1:${port()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function up() { try { return (await fetch(URL_() + '/', { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } }

function openBrowser(url) {
  const [c, a] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  try { spawn(c, a, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref(); } catch {}
}

async function start() {
  if (await up()) console.log(`Already running: ${URL_()}`);
  else {
    fs.mkdirSync(DATA, { recursive: true });
    const child = spawn(process.execPath, [path.join(pkgRoot, 'src', 'server.js')], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env });
    child.unref(); fs.writeFileSync(PID, String(child.pid));
    for (let i = 0; i < 75 && !(await up()); i++) await sleep(200);
    if (!(await up())) { console.error('The server did not start (is the port busy? set "port" in ' + path.join(DATA, 'config.json') + ')'); process.exit(1); }
    console.log(`Started: ${URL_()}`);
  }
  try {
    const r = await fetch(URL_() + '/api/event', {
      method: 'POST',
      body: JSON.stringify({ type: 'repo', cwd: process.cwd() }),
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) throw new Error(`server returned ${r.status}`);
  } catch (e) {
    console.error(`Could not select the current folder as the quiz repo: ${e.message}`);
  }
  try { await fetch(URL_() + '/api/event', { method: 'POST', body: JSON.stringify({ type: 'repo', cwd: process.cwd(), session: 'cli' }), signal: AbortSignal.timeout(1500) }); } catch {} // adopt the folder `quiz-dev start` ran in
  if (!flags.has('--no-open')) openBrowser(URL_());
}

async function stop() {
  let pid = Number(fs.existsSync(PID) ? fs.readFileSync(PID, 'utf8') : 0);
  if (pid && alive(pid)) { try { process.kill(pid); } catch {} console.log('Stopped.'); } else console.log('Not running.');
  try { fs.rmSync(PID); } catch {}
}

// ---- hook entry point: `quiz-dev notify start|stop [--agent claude|codex|antigravity]`
// Reads the hook JSON on stdin. Claude Code and Codex send {session_id, cwd, prompt};
// Antigravity sends {conversationId, workspacePaths[], fullyIdle?}. Prints nothing on stdout.
const AGENT = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity' };
async function notify(kind) {
  if (process.env.QUIZ_GEN) return; // ignore hooks of the question-generating sub-sessions
  let raw = ''; if (!process.stdin.isTTY) for await (const c of process.stdin) raw += c;
  let p = {}; try { p = JSON.parse(raw || '{}'); } catch {}
  if (kind === 'stop' && p.fullyIdle === false) return; // Antigravity: still running sub-work
  const agent = AGENT[opt('--agent')] ? opt('--agent') : 'claude';
  const body = kind === 'start'
    ? { type: 'start', prompt: String(p.prompt || '').slice(0, 600), cwd: p.cwd || (p.workspacePaths || [])[0] || '', session: p.session_id || p.conversationId || '' }
    : { type: 'stop' };
  try { await fetch(URL_() + '/api/event', { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(1000) }); } catch {}
  if (kind === 'stop') desktopNotify('Agent ready ✔', AGENT[agent] + ' finished its response');
}

function desktopNotify(title, text) {
  const run = (c, a) => { try { spawn(c, a, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref(); } catch {} };
  if (process.platform === 'darwin') run('osascript', ['-e', `display notification "${text}" with title "${title}"`]);
  else if (process.platform === 'win32') run('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(5000, '${title}', '${text}', 'Info'); Start-Sleep -Seconds 6; $n.Dispose()`]);
  else run('notify-send', ['-a', 'Claude Code', title, text]);
}

// ---- install / uninstall: skill + hooks for Claude Code, Codex CLI and Antigravity
const home = os.homedir();
const TARGETS = {
  claude: { name: 'Claude Code', dir: process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), skills: 'skills', cmd: 'claude' },
  codex: { name: 'Codex CLI', dir: process.env.CODEX_HOME || path.join(home, '.codex'), skills: 'skills', cmd: 'codex' },
  antigravity: { name: 'Antigravity', dir: path.join(home, '.gemini'), skills: path.join('antigravity', 'skills'), cmd: 'agy' },
};
const hasCmd = (c) => { try { execFileSync(process.platform === 'win32' ? 'where' : 'sh', process.platform === 'win32' ? [c] : ['-c', `command -v ${c}`], { stdio: 'ignore', windowsHide: true }); return true; } catch { return false; } };
const readJsonStrict = (f) => { if (!fs.existsSync(f)) return {}; try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.error(`Cannot parse ${f}: ${e.message}`); process.exit(1); } };

function install(undo, targetArg) {
  const dry = flags.has('--dry-run'), skillOnly = flags.has('--skill-only');
  const log = (m) => console.log((dry ? '[dry-run] ' : '') + m);
  const write = (f, c) => { if (!dry) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); } };
  const backupOf = (f) => { const b = f + '.bak-quiz'; if (fs.existsSync(f) && !fs.existsSync(b)) { log(`backup → ${b}`); if (!dry) fs.copyFileSync(f, b); } };
  if (!undo && /[\\/]_npx[\\/]/.test(pkgRoot)) { console.error('Hooks need a stable command on PATH. Install globally first:\n  npm i -g ' + pkg.name + '\n  quiz-dev install'); process.exit(1); }
  if (!undo && !hasCmd('quiz-dev')) console.log('! `quiz-dev` is not on PATH: the hooks and the /quiz skill call it. Use `npm i -g ' + pkg.name + '`.');
  // which agents: explicit name, "all", or auto-detect (Claude Code is always included)
  let ids = targetArg === 'all' ? Object.keys(TARGETS) : TARGETS[targetArg] ? [targetArg]
    : Object.keys(TARGETS).filter((k) => k === 'claude' || fs.existsSync(TARGETS[k].dir) || hasCmd(TARGETS[k].cmd));
  if (targetArg && targetArg !== 'all' && !TARGETS[targetArg]) { console.error(`Unknown target "${targetArg}". Use: ${Object.keys(TARGETS).join(', ')}, all`); process.exit(1); }
  if (!undo && ids.includes('claude') && !hasCmd('claude')) console.log('! `claude` CLI not found on PATH: questions will need ANTHROPIC_API_KEY or Ollama (see README).');
  const skillsSrc = path.join(pkgRoot, 'skills');
  for (const id of ids) {
    const T = TARGETS[id];
    console.log(`\n${T.name}:`);
    for (const name of fs.existsSync(skillsSrc) ? fs.readdirSync(skillsSrc) : []) {
      const src = path.join(skillsSrc, name, 'SKILL.md'), dst = path.join(T.dir, T.skills, name, 'SKILL.md');
      if (!fs.existsSync(src)) continue;
      if (undo) { if (fs.existsSync(dst)) { log(`remove skill ${name}`); if (!dry) fs.rmSync(path.dirname(dst), { recursive: true }); } continue; }
      let text = fs.readFileSync(src, 'utf8');
      if (id !== 'claude') text = text.replace(/^Argument received:.*$/m, 'The user may add the argument `stop` after the skill name.'); // $ARGUMENTS is Claude-only
      write(dst, text); log(`installed skill ${name} → ${dst}`);
    }
    if (skillOnly && !undo) continue;
    if (id === 'antigravity') {
      const f = path.join(T.dir, 'config', 'hooks.json'), j = readJsonStrict(f);
      if (undo) delete j['quiz-dev'];
      else j['quiz-dev'] = {
        PreInvocation: [{ type: 'command', command: 'quiz-dev notify start --agent antigravity', timeout: 5 }],
        Stop: [{ type: 'command', command: 'quiz-dev notify stop --agent antigravity', timeout: 5 }],
      };
      backupOf(f); write(f, JSON.stringify(j, null, 2) + '\n'); log(`${undo ? 'removed' : 'set'} hooks in ${f}`);
      continue;
    }
    // Claude Code (settings.json) and Codex (hooks.json) share the same hooks shape
    const f = id === 'claude' ? path.join(T.dir, 'settings.json') : path.join(T.dir, 'hooks.json'), j = readJsonStrict(f);
    backupOf(f);
    j.hooks ||= {};
    const mine = (h) => typeof h.command === 'string' && /(quiz-dev notify|hooks[\\/]notify\.sh)/.test(h.command); // also drops the old script-based hooks
    for (const [event, command] of Object.entries({ UserPromptSubmit: `quiz-dev notify start --agent ${id}`, Stop: `quiz-dev notify stop --agent ${id}` })) {
      const entries = (j.hooks[event] || []).map((e) => ({ ...e, hooks: (e.hooks || []).filter((h) => !mine(h)) })).filter((e) => e.hooks.length);
      if (!undo) entries.push({ hooks: [{ type: 'command', command, timeout: 5 }] });
      if (entries.length) j.hooks[event] = entries; else delete j.hooks[event];
      log(`${undo ? 'removed' : 'set'} hook ${event}`);
    }
    if (!Object.keys(j.hooks).length) delete j.hooks;
    write(f, JSON.stringify(j, null, 2) + '\n');
    if (id === 'codex' && !undo) console.log('  Codex asks you to review new hooks once: open Codex and run /hooks to trust them.');
  }
  console.log(undo ? '\nUninstalled.' : '\nDone. Restart your agent (Claude Code: /reload-skills), then use the quiz skill (/quiz).');
}

const HELP = `quiz-dev ${pkg.version} — a quiz game to play while your coding agent works

  quiz-dev start [--no-open]   start the game server and open the browser
  quiz-dev stop                stop it
  quiz-dev status              is it running?
  quiz-dev install [target]    install the /quiz skill + hooks. target: claude | codex | antigravity | all
                               (default: every agent detected on this machine; --dry-run, --skill-only)
  quiz-dev uninstall [target]  remove them
  quiz-dev config              print the config file path
`;
switch (cmd) {
  case 'start': await start(); break;
  case 'stop': await stop(); break;
  case 'status': console.log((await up()) ? `Running: ${URL_()}` : 'Not running.'); break;
  case 'notify': await notify(pos[0]); break;
  case 'install': install(false, pos[0]); break;
  case 'uninstall': install(true, pos[0]); break;
  case 'config': console.log(path.join(DATA, 'config.json')); break;
  case '-v': case '--version': console.log(pkg.version); break;
  default: console.log(HELP);
}
