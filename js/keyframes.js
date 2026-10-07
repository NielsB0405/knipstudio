'use strict';
/* =====================================================================
   Keyframe animation: per-property keyframes with easing curves.
   Keyframe times are relative to the clip start (seconds).
   ===================================================================== */
const ANIMATABLE = {
  x: 'Horizontaal', y: 'Verticaal', scale: 'Schaal', rot: 'Draaiing', opacity: 'Dekking',
  'f.blur': 'Vervaging', 'f.brightness': 'Helderheid', 'f.saturate': 'Verzadiging', 'f.hue': 'Kleurtoon',
  vol: 'Volume', pan: 'Balans', 'mask.w': 'Masker breedte', 'mask.h': 'Masker hoogte', 'mask.x': 'Masker X', 'mask.y': 'Masker Y',
};
const EASES = {
  linear: ['Lineair', p => p],
  ease: ['Vloeiend', p => p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2],
  in: ['Versnellen', p => p * p * p],
  out: ['Vertragen', p => 1 - Math.pow(1 - p, 3)],
  back: ['Terugveren', p => backOut(p)],
  bounce: ['Stuiteren', p => bounceOut(p)],
  elastic: ['Elastisch', p => p === 0 || p === 1 ? p : Math.pow(2, -10 * p) * Math.sin((p * 10 - .75) * (2 * Math.PI) / 3) + 1],
  hold: ['Vasthouden', () => 0],
};
const kfList = (c, path) => (c.kf && c.kf[path]) || null;
const hasKf = (c, path) => { const k = kfList(c, path); return !!(k && k.length); };
/** Animated value of a property at local time lt. */
function A(c, path, lt) {
  const k = kfList(c, path);
  if (!k || !k.length) return getP(c, path);
  if (lt <= k[0].t) return k[0].v;
  const last = k[k.length - 1]; if (lt >= last.t) return last.v;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1];
    if (lt < b.t) { const p = (lt - a.t) / Math.max(1e-6, b.t - a.t); return a.v + (b.v - a.v) * (EASES[a.e] || EASES.ease)[1](p); }
  }
  return last.v;
}
const kfTol = () => 0.5 / FPS;
function kfAt(c, path, lt) { const k = kfList(c, path); return k ? k.find(x => Math.abs(x.t - lt) < kfTol()) : null; }
function setKf(c, path, lt, v, e) {
  c.kf = c.kf || {}; const arr = c.kf[path] = c.kf[path] || [];
  const ex = kfAt(c, path, lt);
  if (ex) { ex.v = v; if (e) ex.e = e; }
  else { arr.push({ t: +lt.toFixed(4), v, e: e || 'ease' }); arr.sort((a, b) => a.t - b.t); }
}
function delKf(c, path, lt) {
  const k = kfList(c, path); if (!k) return;
  const i = k.findIndex(x => Math.abs(x.t - lt) < kfTol()); if (i >= 0) k.splice(i, 1);
  if (!k.length) delete c.kf[path];
}
const localT = c => clamp(playhead - c.start, 0, c.dur);
/** Write a value: if the property is animated, (auto)key at the playhead, otherwise set the static value. */
function setAnimated(c, path, v) {
  if (hasKf(c, path)) setKf(c, path, localT(c), v);
  else setP(c, path, v);
}
function toggleKf(c, path) {
  const lt = localT(c);
  if (kfAt(c, path, lt)) delKf(c, path, lt);
  else setKf(c, path, lt, A(c, path, lt));
}
function shiftKf(c, d) { for (const p in c.kf || {}) c.kf[p].forEach(k => k.t = +(k.t - d).toFixed(4)); }
function allKfTimes(c) { const s = new Set(); for (const p in c.kf || {}) c.kf[p].forEach(k => s.add(+k.t.toFixed(3))); return [...s].sort((a, b) => a - b); }
function kfNeighbour(c, path, dir) {
  const lt = localT(c), k = kfList(c, path) || [];
  const list = path ? k.map(x => x.t) : allKfTimes(c);
  if (dir < 0) return [...list].reverse().find(t => t < lt - kfTol());
  return list.find(t => t > lt + kfTol());
}
/** Ready-made motion presets built from keyframes. */
const KF_PRESETS = {
  'Inzoomen': c => { setKf(c, 'scale', 0, 1, 'ease'); setKf(c, 'scale', c.dur, 1.3); },
  'Uitzoomen': c => { setKf(c, 'scale', 0, 1.3, 'ease'); setKf(c, 'scale', c.dur, 1); },
  'Inschuiven links': c => { setKf(c, 'x', 0, -.5, 'out'); setKf(c, 'x', Math.min(1, c.dur), .5); },
  'Inschuiven rechts': c => { setKf(c, 'x', 0, 1.5, 'out'); setKf(c, 'x', Math.min(1, c.dur), .5); },
  'Van boven vallen': c => { setKf(c, 'y', 0, -.5, 'bounce'); setKf(c, 'y', Math.min(1.2, c.dur), .5); },
  'Ploppen': c => { setKf(c, 'scale', 0, 0, 'back'); setKf(c, 'scale', Math.min(.5, c.dur), c.scale || 1); },
  'Draaien in': c => { setKf(c, 'rot', 0, -180, 'out'); setKf(c, 'rot', Math.min(1, c.dur), 0); setKf(c, 'opacity', 0, 0, 'out'); setKf(c, 'opacity', Math.min(1, c.dur), 1); },
  'Infaden en uitfaden': c => { setKf(c, 'opacity', 0, 0, 'linear'); setKf(c, 'opacity', Math.min(.6, c.dur / 3), 1, 'linear'); setKf(c, 'opacity', Math.max(c.dur - .6, c.dur * 2 / 3), 1, 'linear'); setKf(c, 'opacity', c.dur, 0); },
  'Scherp worden': c => { setKf(c, 'f.blur', 0, 25, 'out'); setKf(c, 'f.blur', Math.min(1.2, c.dur), 0); },
  'Volume swell': c => { setKf(c, 'vol', 0, 0, 'in'); setKf(c, 'vol', c.dur, 1); },
};
