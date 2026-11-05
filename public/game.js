// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Leandro <leandrofusdev@gmail.com>
import * as THREE from 'three';
const $ = (id) => document.getElementById(id);
const PRIZES = [100, 200, 300, 500, 1000, 2000, 4000, 8000, 16000, 32000]; // 10 preguntas = una ronda
const SAFE = [4, 9]; // índices de hitos: $1.000 y $32.000
const fmt = (n) => '$' + n.toLocaleString('en-US');
const LET = ['A', 'B', 'C', 'D'];

// ---------- fondo 3D: focos giratorios de plató ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100); camera.position.set(0, 0, 14);
const stage = new THREE.Group(); scene.add(stage); // todo el plató gira
const beams = [];
for (let i = 0; i < 7; i++) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(2.2, 26, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: i % 2 ? 0x6a8bff : 0xffd27a, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
  m.position.set((i - 3) * 5, 12, -8); m.userData.p = i; beams.push(m); stage.add(m);
}
const rings = [0xf2c14e, 0x6a8bff, 0xf2c14e].map((c, i) => {
  const r = new THREE.Mesh(new THREE.TorusGeometry(9 + i * 4.5, 0.06, 8, 96), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35 - i * 0.07 }));
  r.position.z = -14 - i * 3; stage.add(r); return r;
});
const core = new THREE.Mesh(new THREE.IcosahedronGeometry(4, 1), new THREE.MeshBasicMaterial({ color: 0x6a8bff, wireframe: true, transparent: true, opacity: 0.18 }));
core.position.z = -16; stage.add(core);
const sparks = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffe9a8, size: 0.08, transparent: true, opacity: 0.8 }));
const N = 220, pos = new Float32Array(N * 3);
for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - .5) * 40; pos[i * 3 + 1] = (Math.random() - .5) * 24; pos[i * 3 + 2] = (Math.random() - .5) * 20 - 5; }
sparks.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3)); scene.add(sparks);
const bursts = [];
function burst(color, n = 120) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), new THREE.MeshBasicMaterial({ color }));
    m.position.set((Math.random() - .5) * 4, -2, 6);
    bursts.push({ m, v: new THREE.Vector3((Math.random() - .5) * 14, Math.random() * 12, (Math.random() - .5) * 6), life: 1.6 }); scene.add(m);
  }
}
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
let shake = 0;
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  stage.rotation.y = Math.sin(t * 0.15) * 0.6; stage.rotation.z = t * 0.05;
  rings.forEach((r, i) => { r.rotation.z = t * (0.25 + i * 0.12) * (i % 2 ? -1 : 1); r.rotation.x = Math.sin(t * 0.3 + i) * 0.5; });
  core.rotation.x = t * 0.2; core.rotation.y = t * 0.3;
  camera.position.z = 14 + Math.sin(t * 0.2) * 1.5;
  beams.forEach((b) => { b.rotation.z = Math.sin(t * 0.5 + b.userData.p) * 0.5; b.position.x = (b.userData.p - 3) * 5 + Math.sin(t * 0.3 + b.userData.p) * 2; });
  sparks.rotation.y = t * 0.02; sparks.position.y = Math.sin(t * 0.4) * 0.5;
  for (let i = bursts.length - 1; i >= 0; i--) {
    const p = bursts[i]; p.life -= dt; p.v.y -= 14 * dt; p.m.position.addScaledVector(p.v, dt); p.m.rotation.x += dt * 6;
    if (p.life <= 0) { scene.remove(p.m); bursts.splice(i, 1); }
  }
  shake = Math.max(0, shake - dt * 2.5);
  camera.position.x = (Math.random() - .5) * shake; camera.position.y = (Math.random() - .5) * shake;
  renderer.render(scene, camera);
});

// ---------- efectos de sonido (WebAudio sintetizado, sin archivos) ----------
let AC = null;
const ac = () => { try { AC ||= new AudioContext(); AC.resume(); } catch {} return AC; };
function tone(f, t0, dur, { type = 'sine', vol = 0.2, to = null, lp = 0 } = {}) {
  const a = ac(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(); let out = g;
  o.type = type; o.frequency.setValueAtTime(f, a.currentTime + t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, a.currentTime + t0 + dur);
  if (lp) { const l = a.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = lp; g.connect(l); out = l; }
  o.connect(g); out.connect(a.destination);
  const t = a.currentTime + t0;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.05);
}
const kick = (t0, vol = 0.5) => tone(130, t0, 0.28, { type: 'sine', vol, to: 38 });
const sfx = {
  select: () => { tone(660, 0, 0.09, { type: 'square', vol: 0.08, lp: 2500 }); tone(880, 0.06, 0.09, { type: 'square', vol: 0.06, lp: 2500 }); },
  lock: () => { kick(0, 0.7); tone(196, 0, 0.5, { type: 'sawtooth', vol: 0.12, lp: 600 }); tone(98, 0, 0.7, { type: 'triangle', vol: 0.2 }); },
  // tensión: latido que se acelera + zumbido que sube
  suspense(ms) {
    const a = ac(); if (!a) return () => {};
    const dur = ms / 1000; let t = 0, gap = 0.95;
    while (t < dur - 0.2) { kick(t, 0.45); kick(t + 0.17, 0.3); t += gap; gap = Math.max(0.42, gap * 0.86); }
    const o = a.createOscillator(), g = a.createGain(), l = a.createBiquadFilter();
    o.type = 'sawtooth'; l.type = 'lowpass'; l.frequency.value = 300; o.connect(l); l.connect(g); g.connect(a.destination);
    o.frequency.setValueAtTime(70, a.currentTime); o.frequency.exponentialRampToValueAtTime(240, a.currentTime + dur);
    g.gain.setValueAtTime(0.0001, a.currentTime); g.gain.exponentialRampToValueAtTime(0.09, a.currentTime + dur - 0.1);
    o.start(); o.stop(a.currentTime + dur + 0.1);
    return () => { try { g.gain.cancelScheduledValues(a.currentTime); g.gain.setValueAtTime(0.0001, a.currentTime); } catch {} };
  },
  correct() { // fanfarria
    [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, i * 0.11, 0.55, { type: 'sawtooth', vol: 0.11, lp: 2200 }));
    tone(261.6, 0, 1.2, { type: 'triangle', vol: 0.2 }); tone(392, 0.5, 1.0, { type: 'triangle', vol: 0.15 });
  },
  wrong() { // zumbido descendente + golpe grave
    tone(260, 0, 0.9, { type: 'sawtooth', vol: 0.16, to: 55, lp: 900 }); kick(0, 0.9); tone(110, 0.05, 0.8, { type: 'square', vol: 0.08, to: 40, lp: 400 });
  },
  lifeline: () => { tone(300, 0, 0.5, { type: 'triangle', vol: 0.15, to: 1400 }); tone(1400, 0.45, 0.25, { type: 'sine', vol: 0.1 }); },
  // presentación de la pregunta: swell + golpe + notas, y un blip por opción
  question() {
    tone(180, 0, 0.55, { type: 'sine', vol: 0.12, to: 900 });
    kick(0.5, 0.6); tone(98, 0.5, 0.9, { type: 'sawtooth', vol: 0.1, lp: 500 });
    [392, 494, 587].forEach((f, i) => tone(f, 0.55 + i * 0.1, 0.5, { type: 'triangle', vol: 0.1 }));
    tone(1568, 0.8, 0.5, { type: 'sine', vol: 0.04 });
  },
  optIn: (i) => tone(520 + i * 110, 0.95 + i * 0.16, 0.12, { type: 'square', vol: 0.05, lp: 2200 }),
  intro() { // swell → hit → fanfare, ~3s
    tone(120, 0, 0.9, { type: 'sawtooth', vol: 0.08, to: 700, lp: 900 });
    kick(0.5, 0.9); tone(65, 0.5, 1.4, { type: 'triangle', vol: 0.25 });
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.55 + i * 0.12, 0.9, { type: 'sawtooth', vol: 0.09, lp: 2400 }));
    tone(1568, 1.3, 1.6, { type: 'sine', vol: 0.05 });
  },
  start: () => [392, 523.25, 659.25, 783.99].forEach((f, i) => tone(f, i * 0.09, 0.4, { type: 'triangle', vol: 0.12 })),
  win() { for (let k = 0; k < 3; k++) [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) => tone(f, k * 0.7 + i * 0.07, 0.5, { type: 'sawtooth', vol: 0.09, lp: 2500 })); },
};
addEventListener('pointerdown', ac); addEventListener('keydown', ac);

// ---------- estado ----------
let q = null, sel = -1, locked = true, level = 0, banked = 0, f5Used = false, passUsed = false;
const rec = { best: 0 };
try { Object.assign(rec, JSON.parse(localStorage.getItem('quizRec') || '{}')); } catch {}
const saveRec = () => { try { localStorage.setItem('quizRec', JSON.stringify(rec)); } catch {} };
let srv = { theme: '', ready: 0, target: 0 };

function renderLadder() {
  $('ladder').innerHTML = '';
  PRIZES.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'lv' + (SAFE.includes(i) ? ' m' : '') + (i === level ? ' cur' : '') + (i < level ? ' done' : '');
    d.innerHTML = `<span>${i + 1}</span><span>${fmt(p)}</span>`; $('ladder').append(d);
  });
  $('f5').disabled = f5Used; $('fp').disabled = passUsed;
  $('meta').textContent = `best ${fmt(rec.best)}` + (srv.repo ? ` · ${srv.repo}` : '') + (srv.theme ? ` · ${srv.theme}` : '') + (srv.target ? ` · ready ${srv.ready}/${srv.target}` : '');
}

function banner(text, ms = 2600) {
  const b = $('banner'); b.textContent = text; b.style.display = 'flex';
  return new Promise((r) => setTimeout(() => { b.style.display = 'none'; r(); }, ms));
}
const CAT = { pr: 'Your PR', lang: 'Language', code: 'Your code', diff: 'Your changes', design: 'Design' };

// Unified-diff text -> two aligned panes (before | after). Plain code stays in a single block.
function splitDiff(code) {
  const rows = []; let dels = [], adds = [], marked = false;
  const flush = () => { for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push({ l: dels[i], r: adds[i] }); dels = []; adds = []; };
  for (const raw of code.split('\n')) {
    if (/^(\+\+\+|---) |^@@|^diff /.test(raw)) continue;
    const m = raw[0];
    if (m === '-') { marked = true; dels.push(raw.slice(1)); }
    else if (m === '+') { marked = true; adds.push(raw.slice(1)); }
    else { flush(); const t = m === ' ' ? raw.slice(1) : raw; rows.push({ l: t, r: t, ctx: true }); }
  }
  flush();
  return marked ? rows : null;
}
function showCode(code, category) {
  const rows = (category === 'pr' || category === 'diff') ? splitDiff(code) : null;
  if (!rows) { $('code').textContent = code; $('code').hidden = false; return; }
  const d = $('diff'); d.textContent = '';
  for (const side of ['l', 'r']) {
    const pane = document.createElement('div'); pane.className = 'pane';
    const h = document.createElement('div'); h.className = 'ph ' + (side === 'l' ? 'old' : 'new'); h.textContent = side === 'l' ? 'Before' : 'After'; pane.append(h);
    for (const row of rows) {
      const ln = document.createElement('div'); const t = row[side];
      ln.className = 'ln' + (row.ctx ? '' : t === undefined ? ' gap' : side === 'l' ? ' del' : ' add');
      ln.textContent = t ?? ''; pane.append(ln);
    }
    d.append(pane);
  }
  d.hidden = false;
}

async function nextQuestion() {
  locked = true; sel = -1; q = null;
  $('qt').textContent = 'Loading question…'; $('opts').innerHTML = ''; $('exp').textContent = ''; $('exp').className = '';
  $('code').hidden = true; $('diff').hidden = true; $('cat').textContent = ''; $('ctx').textContent = '';
  let tries = 0;
  while (true) {
    try {
      const r = await fetch('/api/question'); const j = await r.json();
      if (r.ok) { q = j; break; }
      $('qt').textContent = 'No questions: ' + (j.error || '?') + ' (retrying…)';
    } catch { $('qt').textContent = 'Server unavailable…'; }
    await new Promise((s) => setTimeout(s, Math.min(2000 + tries++ * 1000, 8000)));
  }
  $('cat').textContent = `Question ${level + 1} for ${fmt(PRIZES[level])} · ` + [CAT[q.category] || q.category, q.theme, q.file].filter(Boolean).join(' · ');
  $('ctx').textContent = q.context || '';
  $('qt').textContent = q.question;
  if (q.code) showCode(q.code, q.category);
  q.options.forEach((o, i) => {
    const b = document.createElement('button'); b.className = 'opt';
    b.innerHTML = `<div class="hex"><div><b>${LET[i]}:</b><span></span></div></div>`;
    b.querySelector('span').textContent = o;
    b.onclick = () => { select(i); confirmAnswer(); }; $('opts').append(b); // un clic = respuesta final
  });
  presentQuestion();
  $('exp').textContent = 'A-D choose · Enter confirm · F = 50:50 · P = pass';
  renderLadder();
}

function presentQuestion() {
  const els = [$('cat'), $('ctx'), $('code'), $('diff'), $('qt').parentElement, ...$('opts').children];
  els.forEach((e) => e.classList.remove('qin')); void document.body.offsetWidth; // reinicia la animación
  els.forEach((e) => e.classList.add('qin'));
  [...$('opts').children].forEach((b, i) => { b.style.animationDelay = 0.9 + i * 0.16 + 's'; sfx.optIn(i); });
  sfx.question(); locked = true;
  setTimeout(() => { if (q) locked = false; }, 1500 + 3 * 160); // no se puede responder hasta que termina la presentación
}

function select(i) {
  if (locked || [...$('opts').children][i].classList.contains('gone')) return;
  sel = i; sfx.select(); [...$('opts').children].forEach((b, k) => b.classList.toggle('sel', k === i));
}

async function confirmAnswer() {
  if (locked || sel < 0) return;
  locked = true;
  const btns = [...$('opts').children], good = sel === q.answer;
  btns[sel].classList.add('blink'); sfx.lock();
  $('exp').className = ''; $('exp').textContent = 'Final answer?…';
  btns.forEach((b, k) => { if (k !== sel) b.style.opacity = '.45'; });
  await new Promise((r) => setTimeout(r, 450));
  const stopTension = sfx.suspense(3400);
  await new Promise((r) => setTimeout(r, 3400));
  stopTension();
  btns.forEach((b) => (b.style.opacity = ''));
  btns[sel].classList.remove('blink', 'sel');
  btns[q.answer].classList.add('ok'); if (!good) btns[sel].classList.add('bad');
  good ? sfx.correct() : sfx.wrong();
  $('exp').className = 'show';
  $('exp').textContent = (good ? '✔ Correct! ' : '✘ Wrong. ') + q.explanation;
  if (good) {
    burst(0xffd27a); if (level >= banked) banked = level + 1;
    if (level === PRIZES.length - 1) { rec.best = Math.max(rec.best, PRIZES[level]); saveRec(); sfx.win(); await banner(`🏆 MILLIONAIRE!\n${fmt(PRIZES[level])}`, 4000); level = 0; banked = 0; f5Used = passUsed = false; }
    else { await new Promise((r) => setTimeout(r, 2600)); level++; }
  } else {
    shake = 1.2; burst(0xe5334b, 60);
    // A wrong answer is a learning moment, not game over: keep the level and move on to a fresh question.
    await new Promise((r) => setTimeout(r, 4200));
  }
  if (good && level === 0) { renderLadder(); return openThemes(true); } // round completed (won the top prize)
  nextQuestion();
}

function fifty() {
  if (locked || f5Used || !q) return;
  f5Used = true; sfx.lifeline(); const btns = [...$('opts').children];
  const wrong = [0, 1, 2, 3].filter((i) => i !== q.answer).sort(() => Math.random() - .5).slice(0, 2);
  wrong.forEach((i) => { btns[i].classList.add('gone'); if (sel === i) sel = -1; }); renderLadder();
}
function pass() { if (locked || passUsed) return; passUsed = true; sfx.lifeline(); renderLadder(); nextQuestion(); }
function beginRound() { sfx.start(); renderLadder(); nextQuestion(); }

$('f5').onclick = fifty; $('fp').onclick = pass;
addEventListener('keydown', (e) => {
  if (!$('themes').hidden) { if (e.key === 'Escape') $('tcancel').click(); return; }
  const k = e.key.toLowerCase();
  if ('abcd'.includes(k) && k.length === 1) select('abcd'.indexOf(k));
  else if (k >= '1' && k <= '4') select(+k - 1);
  else if (k === 'enter' || k === ' ') { e.preventDefault(); confirmAnswer(); }
  else if (k === 'f') fifty(); else if (k === 'p') pass(); else if (k === 't') { e.preventDefault(); openThemes(); }
});

// ---------- selector de temáticas ----------
let th = null, chosenAreas = new Set(), chosenFocus = new Set(), dirState = null;
let startMode = false;
// idioma de las preguntas: lo guardado en el navegador, o el idioma del navegador si lo soportamos
let langPref = null;
try { langPref = localStorage.getItem('quizLang'); } catch {}
const browserLang = (navigator.language || 'en').slice(0, 2);
function renderRepoInfo() {
  $('trepo').textContent = `Repo: ${th.repoPath || '(not set)'}${th.pinned ? ' · pinned' : ' · automatic'}`;
  $('recent-repos').innerHTML = '';
  th.recent.forEach((p) => {
    const b = document.createElement('button'); b.className = 'repo-btn'; b.textContent = p;
    b.onclick = () => setRepo(p); $('recent-repos').append(b);
  });
}
async function loadDirs(dir) {
  const query = dir ? '?path=' + encodeURIComponent(dir) : '';
  const r = await fetch('/api/dirs' + query);
  dirState = await r.json();
  if (!r.ok) throw new Error(dirState.error || `Could not browse folders (${r.status})`);
  $('folder-path').textContent = dirState.path;
  $('rup').disabled = !dirState.parent;
  $('folder-list').innerHTML = '';
  dirState.dirs.forEach((d) => {
    const b = document.createElement('button'); b.className = 'repo-btn';
    b.textContent = `${d.name}/${d.git ? '  [git]' : ''}`;
    b.onclick = () => loadDirs(dirState.path + '/' + d.name).catch(showRepoError);
    $('folder-list').append(b);
  });
}
function showRepoError(e) { $('repo-error').textContent = e.message || String(e); }
async function setRepo(repoPath) {
  $('repo-error').textContent = '';
  try {
    const r = await fetch('/api/repo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: repoPath }) });
    if (!r.ok) {
      const j = r.headers.get('content-type')?.includes('application/json') ? await r.json() : {};
      throw new Error(j.error || `Could not change repo (${r.status})`);
    }
    $('folder-picker').hidden = true;
    await openThemes(startMode);
  } catch (e) { showRepoError(e); }
}
async function pushLang() {
  const code = $('lang').value; if (!code) return;
  try { localStorage.setItem('quizLang', code); } catch {}
  langPref = code;
  await fetch('/api/lang', { method: 'POST', body: JSON.stringify({ lang: code }) });
}
async function pushProvider() {
  const r = await fetch('/api/provider', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: $('provider').value }),
  });
  if (!r.ok) {
    const j = r.headers.get('content-type')?.includes('application/json') ? await r.json() : {};
    throw new Error(j.error || `Could not change provider (${r.status})`);
  }
}
const openThemes = async (start = false) => {
  startMode = start === true;
  $('themes').hidden = false;
  $('tt').textContent = startMode ? 'Who Wants to Be a Dev?' : 'Choose your topics';
  $('tok').textContent = startMode ? 'Start!' : 'Apply';
  $('tcancel').textContent = startMode ? 'Keep current' : 'Cancel';
  th = await (await fetch('/api/themes')).json();
  chosenAreas = new Set(th.manual ? th.sel.areas : []); chosenFocus = new Set(th.manual ? th.sel.focus : []);
  renderRepoInfo();
  $('autoinfo').textContent = '(now: ' + th.auto + ', based on what you touch)';
  $('lang').innerHTML = Object.entries(th.langs).map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
  $('lang').value = langPref || (th.langs[browserLang] ? browserLang : th.lang);
  $('provider').replaceChildren(...th.providers.map((p) => {
    const option = document.createElement('option');
    option.value = p.id; option.textContent = p.label;
    return option;
  }));
  $('provider').value = th.provider;
  $('provider-info').textContent = th.providers.find((p) => p.id === th.provider)?.detail || '';
  $('provider-error').textContent = '';
  $('provider').onchange = () => {
    $('provider-info').textContent = th.providers.find((p) => p.id === $('provider').value)?.detail || '';
    $('provider-error').textContent = '';
  };
  $('mauto').checked = !th.manual; $('mman').checked = th.manual && !th.pr; $('mpr').checked = th.pr;
  const pi = th.prinfo;
  $('prinfo').textContent = pi.ok ? `(${pi.number ? '#' + pi.number + ' ' : ''}${pi.title} · ${pi.files} files vs ${pi.base}) — quiz on the change you are sending` : '(no changes found against the base branch — commit on a branch first)';
  renderTokens();
  renderAreas(); await loadFeats();
  $('mauto').checked = !th.manual; $('mman').checked = th.manual && !th.pr; $('mpr').checked = th.pr; syncMode();
};
 $('rchange').onclick = async () => {
  $('repo-error').textContent = ''; $('folder-picker').hidden = false;
  try { await loadDirs(th.repoPath); } catch (e) { showRepoError(e); }
};
$('rauto').onclick = () => setRepo('');
$('rup').onclick = () => { if (dirState?.parent) loadDirs(dirState.parent).catch(showRepoError); };
$('ruse').onclick = () => { if (dirState?.path) setRepo(dirState.path); };
$('rclose').onclick = () => { $('folder-picker').hidden = true; };
const syncMode = () => $('manual').classList.toggle('off', !$('mman').checked);
function chip(label, on, fn) { const b = document.createElement('button'); b.className = 'chip' + (on ? ' on' : ''); b.textContent = label; b.onclick = () => { fn(); b.classList.toggle('on'); $('mman').checked = true; syncMode(); }; return b; }
function renderAreas() {
  $('areas').innerHTML = '';
  th.areas.forEach((a) => $('areas').append(chip(a, chosenAreas.has(a), () => { chosenAreas.has(a) ? chosenAreas.delete(a) : chosenAreas.add(a); loadFeats(); })));
  syncMode();
}
async function loadFeats() {
  const r = await (await fetch('/api/themes?areas=' + [...chosenAreas].join(','))).json();
  $('feats').innerHTML = '';
  r.features.forEach((f) => { const c = chip(`${f.name} (${f.count})`, chosenFocus.has(f.name), () => {
    chosenFocus.has(f.name) ? chosenFocus.delete(f.name) : chosenFocus.add(f.name); renderTokens();
  }); c.dataset.name = f.name; $('feats').append(c); });
}
// selected features / typed terms are shown as removable tokens
function renderTokens() {
  $('tokens').querySelectorAll('.tok').forEach((t) => t.remove());
  [...chosenFocus].forEach((name) => {
    const t = document.createElement('span'); t.className = 'tok'; t.textContent = name;
    const x = document.createElement('button'); x.type = 'button'; x.className = 'x'; x.textContent = '×'; x.title = 'Remove';
    x.onclick = () => { chosenFocus.delete(name); renderTokens(); };
    t.append(x); $('tokens').insertBefore(t, $('focus'));
  });
  $('feats').querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', chosenFocus.has(c.dataset.name)));
  $('mman').checked = true; syncMode();
}
function addTyped() {
  const v = $('focus').value.split(',').map((x) => x.trim()).filter(Boolean);
  if (!v.length) return; v.forEach((x) => chosenFocus.add(x)); $('focus').value = ''; renderTokens();
}
$('focus').onkeydown = (e) => {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); e.stopPropagation(); addTyped(); }
  else if (e.key === 'Backspace' && !$('focus').value && chosenFocus.size) { chosenFocus.delete([...chosenFocus].pop()); renderTokens(); }
};
$('focus').onblur = addTyped;
$('tokens').onclick = () => $('focus').focus();
$('mauto').onchange = $('mman').onchange = $('mpr').onchange = syncMode;
$('ftema').onclick = () => openThemes(); $('tcancel').onclick = async () => { $('themes').hidden = true; if (startMode) { await pushLang(); beginRound(); } };
$('tok').onclick = async () => {
  addTyped();
  const body = $('mauto').checked ? { auto: true } : $('mpr').checked ? { pr: true } : { areas: [...chosenAreas], focus: [...chosenFocus] };
  $('provider-error').textContent = '';
  try { await pushProvider(); } catch (e) { $('provider-error').textContent = e.message || String(e); return; }
  await pushLang();
  await fetch('/api/theme', { method: 'POST', body: JSON.stringify(body) });
  $('themes').hidden = true;
  if (startMode) return beginRound();
  $('exp').className = 'show';
  $('exp').textContent = 'Settings applied: the next questions will take a few seconds to generate.';
};

// ---------- aviso de "agente terminó": sonido + toast + notificación del sistema ----------
let actx = null, blinkT = null;
const unlock = () => { try { actx ||= new AudioContext(); actx.resume(); if (Notification.permission === 'default') Notification.requestPermission(); } catch {} };
addEventListener('keydown', unlock); addEventListener('pointerdown', unlock);
function chime() { // do-mi-sol ascendente
  try {
    actx ||= new AudioContext(); actx.resume();
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.13;
      o.type = 'triangle'; o.frequency.value = f; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.start(t); o.stop(t + 0.55);
    });
  } catch {}
}
function stopBlink() { clearInterval(blinkT); blinkT = null; }
function agentDone() {
  chime();
  const t = $('toast'); t.textContent = '✔ The agent is done — back to the terminal'; t.classList.add('show');
  t.onclick = () => t.classList.remove('show'); setTimeout(() => t.classList.remove('show'), 12000);
  try { if (document.hidden && Notification.permission === 'granted') new Notification('Agent ready ✔', { body: 'Claude Code finished its response.', silent: true }); } catch {}
  stopBlink(); let on = false;
  blinkT = setInterval(() => { document.title = (on = !on) ? '✔ AGENT READY' : 'Who Wants to Be a Dev?'; if (!document.hidden && !blinkT) stopBlink(); }, 800);
  addEventListener('focus', stopBlink, { once: true });
}

// ---------- estado del agente (SSE) ----------
const es = new EventSource('/api/events');
es.onmessage = (e) => {
  const s = JSON.parse(e.data); srv = s;
  const el = $('agent'), was = el.classList.contains('working');
  el.className = 'pill ' + s.agent;
  el.textContent = s.agent === 'working' ? 'agent working…' : 'agent ready ✔';
  if (s.error) el.title = s.error;
  el.className = 'pill ' + s.agent + (was && s.agent === 'idle' ? ' flash' : '');
  if (was && s.agent === 'idle') agentDone();
  else if (s.agent === 'working') { document.title = 'Who Wants to Be a Dev?'; stopBlink(); }
  renderLadder();
};

// ---------- intro (< 5 s, skippable) then topic selection ----------
function runIntro() {
  return new Promise((done) => {
    const el = $('intro'); let over = false;
    const end = () => { if (over) return; over = true; el.classList.add('gone'); removeEventListener('keydown', end); done(); };
    sfx.intro(); setTimeout(end, 4800);
    el.addEventListener('pointerdown', () => { end(); }); addEventListener('keydown', end);
  });
}
// Start as soon as the intro ends (questions are already being generated); topics stay available with T.
renderLadder(); runIntro().then(async () => { await pushLang(); beginRound(); });
