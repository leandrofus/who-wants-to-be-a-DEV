// Synthesizes the trailer score + the game's own SFX at the exact cut times. Output: out/score.wav (44.1k stereo).
import fs from 'node:fs';
const SR = 44100, DUR = 62.1, N = Math.ceil(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N);
let seed = 12345; const rnd = () => ((seed ^= seed << 13, seed ^= seed >>> 17, seed ^= seed << 5, (seed >>> 0) / 4294967296) * 2 - 1);
const alpha = (fc) => 1 - Math.exp(-2 * Math.PI * Math.max(20, fc) / SR);
const W = { sine: (p) => Math.sin(p * 2 * Math.PI), tri: (p) => 4 * Math.abs(p - Math.floor(p + .5)) - 1, saw: (p) => 2 * (p - Math.floor(p + .5)), square: (p) => (p % 1 < .5 ? 1 : -1) };

function tone({ t, dur, f, f2 = f, type = 'sine', vol = .2, a = .01, rel = .2, decay = 0, lp = 0, lp2 = lp, pan = 0, det = 0, vib = 0 }) {
  const i0 = Math.floor(t * SR), n = Math.floor((dur + rel) * SR), gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  let ph = Math.random(), ph2 = Math.random(), y = 0;
  for (let k = 0; k < n; k++) {
    const i = i0 + k; if (i < 0 || i >= N) continue; const x = k / SR, u = Math.min(1, x / dur);
    const fr = f * Math.pow(f2 / f, u) * (1 + (vib ? .004 * Math.sin(x * 5.5) : 0));
    ph += fr / SR; let s = W[type](ph); if (det) { ph2 += fr * (1 + det) / SR; s = (s + W[type](ph2)) * .5; }
    if (lp) { y += alpha(lp + (lp2 - lp) * u) * (s - y); s = y; }
    let g = Math.min(1, x / a); if (decay) g *= Math.exp(-x / decay); if (x > dur) g *= Math.max(0, 1 - (x - dur) / rel);
    s *= g * vol; L[i] += s * gl; R[i] += s * gr;
  }
}
function noise({ t, dur, vol = .1, lp = 0, lp2 = lp, hp = 0, a = .01, decay = 0, rel = .1, pan = 0 }) {
  const i0 = Math.floor(t * SR), n = Math.floor((dur + rel) * SR), gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  let y = 0, h = 0;
  for (let k = 0; k < n; k++) {
    const i = i0 + k; if (i < 0 || i >= N) continue; const x = k / SR, u = Math.min(1, x / dur); let s = rnd();
    if (lp) { y += alpha(lp + (lp2 - lp) * u) * (s - y); s = y; }
    if (hp) { h += alpha(hp) * (s - h); s -= h; }
    let g = Math.min(1, x / a); if (decay) g *= Math.exp(-x / decay); if (x > dur) g *= Math.max(0, 1 - (x - dur) / rel);
    s *= g * vol; L[i] += s * gl; R[i] += s * gr;
  }
}
const kick = (t, vol = .6, f = 130, f2 = 38, dur = .28) => tone({ t, dur, f, f2, vol, a: .003, rel: .08 });
const boom = (t, vol = .9) => { tone({ t, dur: 1.6, f: 80, f2: 26, vol, a: .004, rel: .5 }); noise({ t, dur: .15, vol: vol * .35, lp: 400, decay: .08 }); };
const hit = (t, vol = .5) => { kick(t, vol, 110, 34, .5); noise({ t, dur: .5, vol: vol * .25, hp: 2500, decay: .18, a: .002 }); };
const riser = (t, dur, vol = .2) => { noise({ t, dur, vol, lp: 300, lp2: 7000, a: dur * .9, rel: .05 }); tone({ t, dur, f: 110, f2: 880, type: 'saw', vol: vol * .5, a: dur * .9, rel: .05, lp: 600, lp2: 4000 }); };
const bell = (t, f, vol = .1, dec = 1.4) => { tone({ t, dur: dec * 2, f, vol, a: .004, decay: dec, rel: .3 }); tone({ t, dur: dec * 2, f: f * 2.01, vol: vol * .35, a: .004, decay: dec * .6, rel: .3 }); tone({ t, dur: dec, f: f * 3.99, vol: vol * .12, a: .004, decay: dec * .3, rel: .2 }); };
const chord = (t, dur, fs, vol = .07, lp = 1800) => fs.forEach((f, i) => tone({ t, dur, f, type: 'saw', vol, a: .06, rel: 1.2, lp: lp * .5, lp2: lp, det: .004, pan: (i - 2) * .25, vib: 1 }));
const N_ = { A1: 55, Bb1: 58.27, A2: 110, C3: 130.81, E3: 164.81, F2: 87.31, G2: 98, A3: 220, C4: 261.63, E4: 329.63, A4: 440, Cs4: 277.18, Cs5: 554.37, E5: 659.25, G3: 196, D3: 146.83, F3: 174.61, B3: 246.94, D4: 293.66, G4: 392 };

// ===== SEGMENT A: 0–27 =====
tone({ t: 0, dur: 27, f: 55, type: 'saw', vol: .1, a: 5, rel: 1, lp: 160, lp2: 260, det: .003, pan: -.2 });
tone({ t: 0, dur: 27, f: 82.41, type: 'saw', vol: .06, a: 6, rel: 1, lp: 220, lp2: 420, det: .004, pan: .2 });
tone({ t: 1, dur: 26, f: 110, type: 'triangle' in W ? 'tri' : 'sine', vol: .07, a: 6, rel: 1 });
hit(1.2, .4);
for (let b = 0; b < 3; b++) { kick(4.8 + b, .5, 62, 34, .3); kick(4.8 + b + .17, .3, 62, 34, .25); }
tone({ t: 7.9, dur: 4.2, f: 55, type: 'saw', vol: .08, a: 1, rel: .5, lp: 220 }); tone({ t: 7.9, dur: 4.2, f: 58.27, type: 'saw', vol: .08, a: 1, rel: .5, lp: 220 });
noise({ t: 8, dur: 3.9, vol: .05, hp: 1200, lp: 5000, a: 1.5, rel: .5 });
boom(9.2, .8); noise({ t: 9.2, dur: .9, vol: .14, hp: 900, lp: 3500, decay: .35 });
[[12.5], [13.9], [14.8], [15.7], [16.6], [17.3], [17.9]].forEach(([t]) => noise({ t, dur: .03, vol: .05, hp: 3000, decay: .01 }));
const arp = [N_.A2, N_.C3, N_.E3, N_.A3, N_.E3, N_.C3];
for (let t = 12.2, k = 0; t < 18.4; t += .25, k++) { const g = .5 + .5 * ((t - 12.2) / 6.2); tone({ t, dur: .12, f: arp[k % arp.length] * 2, type: 'tri', vol: .07 * g, a: .003, decay: .08, rel: .06, pan: ((k % 5) - 2) * .2 }); if (k % 2 === 0) tone({ t, dur: .2, f: 55, type: 'saw', vol: .12 * g, a: .005, decay: .12, lp: 200, rel: .1 }); }
riser(16.9, 1.8, .18);
[[19.0, N_.A3], [19.7, N_.C4], [20.4, N_.E4], [21.1, N_.A4]].forEach(([t, f]) => bell(t, f, .13, 1.6)); bell(20.7, N_.E5, .06, 2.4);
riser(21.5, 1.4, .25); for (let t = 21.9, g = .12; t < 22.9; t += g, g = Math.max(.04, g * .86)) noise({ t, dur: .05, vol: .12 + (t - 21.9) * .1, lp: 5000, hp: 800, decay: .03 });
boom(22.9, 1.0); noise({ t: 22.9, dur: 2.6, vol: .22, hp: 3000, decay: 1.0, a: .002 });
chord(22.9, 4, [N_.A2, N_.E3, N_.A3, N_.Cs4, N_.E4], .075, 2400);
[[23.4, N_.E4], [23.55, N_.A4], [23.7, N_.Cs5], [23.85, N_.E5]].forEach(([t, f]) => tone({ t, dur: .5, f, type: 'tri', vol: .1, a: .01, decay: .35, rel: .3 }));
bell(24.4, N_.E5, .08, 2.2);

// ===== GAMEPLAY: 27–46.1 (the game's own SFX, replicated 1:1 from public/game.js) =====
for (let t = 27, k = 0; t < 46.1; t += .6, k++) {
  if (t > 37.0 && t < 41.4) continue; // duck the groove during suspense
  tone({ t, dur: .25, f: 55, f2: 55, type: 'saw', vol: .16, a: .004, decay: .14, lp: 180, rel: .1 }); noise({ t: t + .3, dur: .04, vol: .04, hp: 6000, decay: .02 });
  if (k % 4 === 0) chord(t, 2.2, [N_.A2, N_.C3, N_.E3], .03, 900);
}
const blip = (t, f = 660) => { tone({ t, dur: .09, f, type: 'square', vol: .06, a: .005, lp: 2500, rel: .02 }); tone({ t: t + .06, dur: .09, f: f * 1.333, type: 'square', vol: .045, a: .005, lp: 2500, rel: .02 }); };
[28.9, 29.7, 30.6, 31.4, 31.9, 32.4].forEach((t, i) => blip(t, 560 + i * 40));
[0, 1, 2, 3].forEach((i) => tone({ t: 32.8 + i * .09, dur: .4, f: [392, 523.25, 659.25, 783.99][i], type: 'tri', vol: .12, a: .01, rel: .1 }));
const qsfx = (t) => { tone({ t, dur: .55, f: 180, f2: 900, vol: .12, rel: .1 }); kick(t + .5, .6); tone({ t: t + .5, dur: .9, f: 98, type: 'saw', vol: .1, lp: 500, rel: .1 }); [392, 494, 587].forEach((f, i) => tone({ t: t + .55 + i * .1, dur: .5, f, type: 'tri', vol: .1, rel: .1 })); tone({ t: t + .8, dur: .5, f: 1568, vol: .04, rel: .1 }); [0, 1, 2, 3].forEach((i) => tone({ t: t + .95 + i * .16, dur: .12, f: 520 + i * 110, type: 'square', vol: .05, lp: 2200, rel: .02 })); };
qsfx(33.0);
// lock + suspense + reveal
kick(37.03, .7); tone({ t: 37.03, dur: .5, f: 196, type: 'saw', vol: .12, lp: 600, rel: .1 }); tone({ t: 37.03, dur: .7, f: 98, type: 'tri', vol: .2, rel: .1 });
{ const dur = 3.4, t0 = 38.0; let t = 0, gap = .95; while (t < dur - .2) { kick(t0 + t, .45); kick(t0 + t + .17, .3); t += gap; gap = Math.max(.42, gap * .86); } tone({ t: t0, dur, f: 70, f2: 240, type: 'saw', vol: .09, a: dur - .1, lp: 300, rel: .1 }); }
[523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5].forEach((f, i) => tone({ t: 41.4 + i * .11, dur: .55, f, type: 'saw', vol: .11, lp: 2200, a: .02, rel: .1 }));
tone({ t: 41.4, dur: 1.2, f: 261.6, type: 'tri', vol: .2, rel: .1 }); tone({ t: 41.9, dur: 1.0, f: 392, type: 'tri', vol: .15, rel: .1 }); noise({ t: 41.4, dur: .8, vol: .05, hp: 4000, decay: .3 });
[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ t: 42.63 + i * .13, dur: .5, f, type: 'tri', vol: .2, a: .02, decay: .2, rel: .2 }));

// ===== SEGMENT B: 46.1–62.1 =====
const B0 = 46.1;
tone({ t: B0, dur: 16, f: 55, type: 'saw', vol: .1, a: 1, rel: 1.5, lp: 200, lp2: 300, det: .003 });
const hits = [[.3, [N_.A2, N_.E3, N_.A3, N_.C4]], [4.2, [N_.F2, N_.A2, N_.C3 * 2, N_.F3 * 2]], [8.1, [N_.G2, N_.D3, N_.G3, N_.B3]]];
hits.forEach(([t, ch]) => { riser(B0 + t - .7, .7, .16); hit(B0 + t, .7); chord(B0 + t, 3, ch, .07, 2200); bell(B0 + t + .1, ch[3] * 2, .06, 1.2); });
riser(B0 + 11.4, .8, .2); boom(B0 + 12.2, 1.0); noise({ t: B0 + 12.2, dur: 2.5, vol: .2, hp: 3000, decay: 1.0 });
chord(B0 + 12.2, 3.8, [N_.A2, N_.E3, N_.A3, N_.Cs4, N_.E4], .08, 2600); bell(B0 + 12.6, N_.E5, .09, 2.4); bell(B0 + 13.2, N_.A4 * 2, .06, 2.4); bell(B0 + 13.8, N_.Cs5 * 2, .05, 2.4);

// ---- master: gentle bus compression-ish soft clip + fades, then WAV ----
let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = .92 / peak; const out = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) { const f = Math.min(1, i / (SR * .3), (N - i) / (SR * 1.4)); const sl = Math.tanh(L[i] * g * 1.3) * f, sr = Math.tanh(R[i] * g * 1.3) * f; out.writeInt16LE(Math.round(sl * 32000), i * 4); out.writeInt16LE(Math.round(sr * 32000), i * 4 + 2); }
const hdr = Buffer.alloc(44); hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + out.length, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(out.length, 40);
fs.writeFileSync('out/score.wav', Buffer.concat([hdr, out])); console.log('score.wav', (N / SR).toFixed(1) + 's', 'peak', peak.toFixed(2));
