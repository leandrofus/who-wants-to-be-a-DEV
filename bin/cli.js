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
const DATA = dataDir(), PID = path.join(DATA, 'server.pid');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
const port = () => Number(process.env.PORT || readJson(path.join(DATA, 'config.json')).port || readJson(path.join(pkgRoot, 'src', 'defaults.json')).port);
const URL_ = () => `http://127.0.0.1:${port()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function up() { try { return (await fetch(URL_() + '/', { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } }

function openBrowser(url) {
  const [c, a] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawn(c, a, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
}

async function start() {
  if (await up()) console.log(`Already running: ${URL_()}`);
  else {
    fs.mkdirSync(DATA, { recursive: true });
    const child = spawn(process.execPath, [path.join(pkgRoot, 'src', 'server.js')], { detached: true, stdio: 'ignore', env: process.env });
    child.unref(); fs.writeFileSync(PID, String(child.pid));
    for (let i = 0; i < 30 && !(await up()); i++) await sleep(200);
    if (!(await up())) { console.error('The server did not start (is the port busy? set "port" in ' + path.join(DATA, 'config.json') + ')'); process.exit(1); }
    console.log(`Started: ${URL_()}`);
  }
  if (!flags.has('--no-open')) openBrowser(URL_());
}

async function stop() {
  let pid = Number(fs.existsSync(PID) ? fs.readFileSync(PID, 'utf8') : 0);
  if (pid && alive(pid)) { try { process.kill(pid); } catch {} console.log('Stopped.'); } else console.log('Not running.');
  try { fs.rmSync(PID); } catch {}
}

// ---- hook entry point: `quiz-dev notify start|stop` (reads the Claude Code hook JSON on stdin)
async function notify(kind) {
  if (process.env.QUIZ_GEN) return; // ignore hooks of the question-generating sub-sessions
  let raw = ''; if (!process.stdin.isTTY) for await (const c of process.stdin) raw += c;
  let p = {}; try { p = JSON.parse(raw || '{}'); } catch {}
  const body = kind === 'start' ? { type: 'start', prompt: String(p.prompt || '').slice(0, 600), cwd: p.cwd || '', session: p.session_id || '' } : { type: 'stop' };
  try { await fetch(URL_() + '/api/event', { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(1000) }); } catch {}
  if (kind === 'stop') desktopNotify('Agent ready ✔', 'Claude finished its response');
}

function desktopNotify(title, text) {
  const run = (c, a) => { try { spawn(c, a, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {} };
  if (process.platform === 'darwin') run('osascript', ['-e', `display notification "${text}" with title "${title}"`]);
  else if (process.platform === 'win32') run('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(5000, '${title}', '${text}', 'Info'); Start-Sleep -Seconds 6; $n.Dispose()`]);
  else run('notify-send', ['-a', 'Claude Code', title, text]);
}

// ---- install / uninstall: skills into ~/.claude/skills and hooks into ~/.claude/settings.json
function install(undo) {
  const dry = flags.has('--dry-run'), skillOnly = flags.has('--skill-only');
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const log = (m) => console.log((dry ? '[dry-run] ' : '') + m);
  const write = (f, c) => { if (!dry) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); } };
  if (!undo) {
    if (/[\\/]_npx[\\/]/.test(pkgRoot)) { console.error('Hooks need a stable command on PATH. Install globally first:\n  npm i -g ' + pkg.name + '\n  quiz-dev install'); process.exit(1); }
    const has = (c) => { try { execFileSync(process.platform === 'win32' ? 'where' : 'sh', process.platform === 'win32' ? [c] : ['-c', `command -v ${c}`], { stdio: 'ignore' }); return true; } catch { return false; } };
    if (!has('claude')) console.log('! `claude` CLI not found on PATH: questions will need ANTHROPIC_API_KEY or Ollama (see README).');
    if (!has('quiz-dev')) console.log('! `quiz-dev` is not on PATH: the hooks and the /quiz skill call it. Use `npm i -g ' + pkg.name + '`.');
  }
  const skillsSrc = path.join(pkgRoot, 'skills');
  for (const name of fs.existsSync(skillsSrc) ? fs.readdirSync(skillsSrc) : []) {
    const src = path.join(skillsSrc, name, 'SKILL.md'), dst = path.join(claudeDir, 'skills', name, 'SKILL.md');
    if (!fs.existsSync(src)) continue;
    if (undo) { if (fs.existsSync(dst)) { log(`remove skill /${name}`); if (!dry) fs.rmSync(path.dirname(dst), { recursive: true }); } continue; }
    write(dst, fs.readFileSync(src, 'utf8')); log(`installed skill /${name} → ${dst}`);
  }
  if (skillOnly && !undo) return;
  let settings = {};
  if (fs.existsSync(settingsPath)) { try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (e) { console.error(`Cannot parse ${settingsPath}: ${e.message}`); process.exit(1); } }
  const backup = settingsPath + '.bak-quiz';
  if (fs.existsSync(settingsPath) && !fs.existsSync(backup)) { log(`backup → ${backup}`); if (!dry) fs.copyFileSync(settingsPath, backup); }
  settings.hooks ||= {};
  const mine = (h) => typeof h.command === 'string' && /(quiz-dev notify|hooks[\\/]notify\.sh)/.test(h.command); // also drops the old script-based hooks
  for (const [event, command] of Object.entries({ UserPromptSubmit: 'quiz-dev notify start', Stop: 'quiz-dev notify stop' })) {
    let entries = (settings.hooks[event] || []).map((e) => ({ ...e, hooks: (e.hooks || []).filter((h) => !mine(h)) })).filter((e) => e.hooks.length);
    if (!undo) entries.push({ hooks: [{ type: 'command', command }] });
    if (entries.length) settings.hooks[event] = entries; else delete settings.hooks[event];
    log(`${undo ? 'removed' : 'set'} hook ${event}`);
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  write(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log(undo ? '\nUninstalled.' : '\nDone. Restart Claude Code (or run /reload-skills), then type /quiz.');
}

const HELP = `quiz-dev ${pkg.version} — a quiz game to play while your coding agent works

  quiz-dev start [--no-open]   start the game server and open the browser
  quiz-dev stop                stop it
  quiz-dev status              is it running?
  quiz-dev install             install the /quiz skill + Claude Code hooks (--dry-run, --skill-only)
  quiz-dev uninstall           remove them
  quiz-dev config              print the config file path
`;
switch (cmd) {
  case 'start': await start(); break;
  case 'stop': await stop(); break;
  case 'status': console.log((await up()) ? `Running: ${URL_()}` : 'Not running.'); break;
  case 'notify': await notify(pos[0]); break;
  case 'install': install(false); break;
  case 'uninstall': install(true); break;
  case 'config': console.log(path.join(DATA, 'config.json')); break;
  case '-v': case '--version': console.log(pkg.version); break;
  default: console.log(HELP);
}
