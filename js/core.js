'use strict';
/* =====================================================================
   KnipStudio Pro 2 — core: helpers, settings, project model, undo
   ===================================================================== */
const KS_VERSION = '2.0-privacy';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dpr = () => window.devicePixelRatio || 1;
const fmt = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = Math.floor(t % 60), f = Math.floor((t % 1) * 100); return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`; };
const fmtS = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; };
const getP = (o, p) => p.split('.').reduce((a, k) => a == null ? a : a[k], o);
const setP = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
const hex2rgb = h => { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(x => x + x).join(''); return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0]; };
const hex2vec = h => hex2rgb(h).map(v => v / 255);
const ease = p => p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
const backOut = p => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
const bounceOut = p => { const n = 7.5625, d = 2.75; if (p < 1 / d) return n * p * p; if (p < 2 / d) return n * (p -= 1.5 / d) * p + .75; if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + .9375; return n * (p -= 2.625 / d) * p + .984375; };
const safeName = s => (s || 'video').replace(/[\\/:*?"<>|]+/g, '_');
const deepClone = o => JSON.parse(JSON.stringify(o));
function once(el, ev, ms = 10000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { cleanup(); rej(new Error('timeout ' + ev)); }, ms);
    const ok = () => { cleanup(); res(); }, bad = () => { cleanup(); rej(new Error('error')); };
    function cleanup() { clearTimeout(t); el.removeEventListener(ev, ok); el.removeEventListener('error', bad); }
    el.addEventListener(ev, ok); el.addEventListener('error', bad);
  });
}
function h(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms); }
/* Op claude.ai loopt opslaan via het downloads-venster; daarbuiten via een gewone link. */
function dlName(n) { return n.replace(/\.srt$/i, '.srt.txt').replace(/\.ksp$/i, '.ksp.zip'); }
async function download(blob, name) {
  let d = null; try { d = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { }
  if (d) {
    try { await d.save({ filename: dlName(name), data: blob }); } catch (e) {
      if (e && e.code === 'rejected_extension') toast('Dit bestandstype kan hier niet worden opgeslagen — kies een ander formaat (bijv. WebM voor audio).');
      else if (e && e.code !== 'declined') toast('Opslaan lukte niet: ' + (e.message || e.code));
    }
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 120000);
}
/** Fill missing keys of `t` from defaults `d` (deep for plain objects). Used for migrating old projects. */
function deepDefaults(t, d) {
  for (const k in d) {
    if (t[k] === undefined) t[k] = deepClone(d[k]);
    else if (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k]) && t[k] && typeof t[k] === 'object') deepDefaults(t[k], d[k]);
  }
  return t;
}
/** Seeded pseudo random in [0,1) — deterministic so scrubbing shows identical frames. */
const srand = (a, b = 0, c = 0) => { const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123; return x - Math.floor(x); };

/* ---------------- settings (localStorage) ---------------- */
const SETTINGS_DEF = { theme: 'dark', accent: '#7c5cff', quality: 720, autosave: true, snapPx: 8, imgDur: 5, transDur: .6, waveforms: true, rippleMode: false, scopes: 'none', thirds: false, safe: false, autoKey: true };
let S = (() => { try { return Object.assign({}, SETTINGS_DEF, JSON.parse(localStorage.getItem('ks2-settings') || '{}')); } catch (e) { return Object.assign({}, SETTINGS_DEF); } })();
function saveSettings() { try { localStorage.setItem('ks2-settings', JSON.stringify(S)); } catch (e) { } }

/* ---------------- model ---------------- */
const HEAD = 178;
const FPS = 30;
function mkTrack(kind, name) { return { id: uid(), kind, name, muted: false, hidden: false, locked: false, solo: false, vol: 1, voice: false, duck: false, duckAmt: .7 }; }
const FACE_DEF = { on: true, mode: 'blur', strength: 60, pad: .3, conf: .45, hold: .4, small: true, boxes: false, shape: 'ellipse', emoji: '😊', color: '#000000' };
function newProject() {
  return {
    face: deepClone(FACE_DEF), v: 2, name: 'Mijn video', ratio: '16:9', bg: '#000000', limiter: true, masterVol: 1,
    tracks: [mkTrack('visual', 'Video 2'), mkTrack('visual', 'Video 1'), mkTrack('audio', 'Audio 1'), mkTrack('audio', 'Audio 2')],
    clips: [], markers: []
  };
}
function baseClip(type, extra) {
  return Object.assign({
    id: uid(), type, trackId: null, mediaId: null, name: '', start: 0, dur: 5, in: 0, speed: 1, keepPitch: true,
    x: .5, y: .5, scale: 1, rot: 0, opacity: 1, flipH: false, flipV: false, fit: 'contain', blend: 'source-over',
    crop: { l: 0, r: 0, t: 0, b: 0 }, radius: 0, border: 0, borderColor: '#ffffff', shadow: false, bgFill: false,
    f: { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, grayscale: 0, sepia: 0, invert: 0 },
    tint: { color: '#ff8800', amt: 0 }, vignette: 0,
    chroma: { on: false, color: '#00ff00', tol: 45, soft: 25 },
    mask: { type: 'none', w: .7, h: .7, x: 0, y: 0, rot: 0, feather: 0, invert: false },
    fx: [], kf: {},
    anim: 'none', tin: { type: 'none', dur: .6 }, tout: { type: 'none', dur: .6 },
    faceMode: 'auto', faceStyle: 'project',
    vol: 1, muted: false, pan: 0, fadeIn: 0, fadeOut: 0, bass: 0, mid: 0, treble: 0, lowcut: 0, highcut: 0, drive: 0,
    echo: { mix: 0, time: .3, fb: .35 }, reverb: { mix: 0, size: 2 },
  }, extra || {});
}
function textClip(p) {
  return baseClip('text', Object.assign({
    name: 'Tekst', text: 'Je tekst hier', font: 'Segoe UI', size: 80, bold: true, italic: false,
    color: '#ffffff', color2: '#ffd84d', gradFill: false, align: 'center', lineH: 1.2, spacing: 0, stroke: '#000000', strokeW: 0, shadow: true, glow: false,
    bgColor: '#000000', bgOpacity: 0, pad: 20, tanim: 'none', countFrom: 0, countTo: 100, dec: 0
  }, p));
}
function shapeClip(p) { return baseClip('shape', Object.assign({ name: 'Vorm', shape: 'rect', fill: '#7c5cff', strokeC: '#ffffff', strokeW2: 0, cr: 0, w: .3, h: .3 }, p)); }
function colorClip(p) { return baseClip('color', Object.assign({ name: 'Achtergrond', color: '#7c5cff', color2: '#ff5c7a', grad: false, angle: 135, animGrad: false }, p)); }
function particlesClip(p) { return baseClip('particles', Object.assign({ name: 'Deeltjes', pkind: 'confetti', count: 120, pspeed: 1, psize: 1, pcolor: '#ffffff', multi: true, wind: 0, emoji: '❤️', seed: Math.floor(Math.random() * 1000) }, p)); }
function vizClip(p) { return baseClip('viz', Object.assign({ name: 'Audiovisualizer', vstyle: 'bars', bars: 48, color: '#7c5cff', color2: '#3ddc97', w: .8, h: .35, sens: 1.2, y: .75 }, p)); }
function adjustClip(p) { return baseClip('adjust', Object.assign({ name: 'Aanpassingslaag' }, p)); }
const DEF = Object.assign(baseClip('x'), textClip({}), shapeClip({}), colorClip({}), particlesClip({}), vizClip({}), { name: '', type: 'x', y: .5, color: '#7c5cff', color2: '#ff5c7a', w: .3, h: .3 });
const TYPE_NAMES = { video: 'Video', audio: 'Audio', image: 'Afbeelding', text: 'Tekst', shape: 'Vorm', color: 'Achtergrond', particles: 'Deeltjes', viz: 'Visualizer', adjust: 'Aanpassingslaag' };
const TYPE_ICONS = { video: '🎬', audio: '🎵', image: '🖼', text: '🅣', shape: '◆', color: '🎨', particles: '❄', viz: '📊', adjust: '🎚' };
const MAKERS = { text: textClip, shape: shapeClip, color: colorClip, particles: particlesClip, viz: vizClip, adjust: adjustClip };
function migrateClip(c) {
  const d = (MAKERS[c.type] || baseClip.bind(null, c.type))({});
  delete d.id; deepDefaults(c, d); if (!Array.isArray(c.fx)) c.fx = []; return c;
}
function migrateProject(p) {
  deepDefaults(p, newProject()); p.tracks.forEach(t => deepDefaults(t, mkTrack(t.kind, t.name))); p.clips.forEach(migrateClip); p.v = 2; return p;
}

/* ---------------- runtime state ---------------- */
let P = newProject();
const media = new Map();     // id -> {id,name,type,url,blob,duration,w,h,thumb,strip,peaks,img,missing,busy}
let sel = null;              // primary selected clip id
const selSet = new Set();    // multi selection (includes sel)
let playhead = 0, playing = false, looping = false, snapOn = true, pps = 60;
let playStartT = 0, playStartWall = 0, needsDraw = true, exporting = null;
let clipboard = null, pend = null, pendLabel = '';
const bbs = new Map();       // clipId -> bounding box on canvas
const els = new Map();       // clipId -> media element

const track = id => P.tracks.find(t => t.id === id);
const clipById = id => P.clips.find(c => c.id === id);
const kindOf = c => c.type === 'audio' ? 'audio' : 'visual';
const isAV = c => c.type === 'video' || c.type === 'audio';
const isMediaVis = c => c.type === 'video' || c.type === 'image';
const projectDur = () => P.clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0);
const isActiveAt = (c, t) => t >= c.start && t < c.start + c.dur;
const selectedClips = () => [...selSet].map(clipById).filter(Boolean);
const requestDraw = () => { needsDraw = true; };

/* ---------------- undo / redo with labels ---------------- */
const undoStack = [], redoStack = [];
const snap = () => JSON.stringify(P);
function commit(before, label = 'Bewerking') {
  if (before != null && before !== snap()) {
    undoStack.push({ s: before, label, time: Date.now() }); if (undoStack.length > 250) undoStack.shift(); redoStack.length = 0;
  }
  changed();
}
function edit(fn, label) { const b = snap(); const r = fn(); commit(b, label); return r; }
function restore(s) {
  P = migrateProject(JSON.parse(s));
  for (const id of [...selSet]) if (!clipById(id)) selSet.delete(id);
  if (sel && !clipById(sel)) sel = null;
  cleanupEls(); changed();
}
function undo() { if (!undoStack.length) return toast('Niets om ongedaan te maken'); const e = undoStack.pop(); redoStack.push({ s: snap(), label: e.label, time: Date.now() }); restore(e.s); toast('↶ ' + e.label, 1200); }
function redo() { if (!redoStack.length) return; const e = redoStack.pop(); undoStack.push({ s: snap(), label: e.label, time: Date.now() }); restore(e.s); toast('↷ ' + e.label, 1200); }
function changed() {
  $('#projName').value = P.name; $('#ratioSel').value = P.ratio;
  ensureCanvasDims(); renderTimeline(); renderProps(); requestDraw(); scheduleAutosave();
  $('#bUndo').disabled = !undoStack.length; $('#bRedo').disabled = !redoStack.length;
  if (curPanel === 'history') renderPanel();
}

/* ---------------- tiny worker helper (blob worker with main-thread fallback) ---------------- */
function createRpc(fn) {
  const pending = new Map(); let n = 0, impl = null;
  const onMsg = e => { const p = pending.get(e.data.id); if (!p) return; if (e.data.progress != null) { p.prog && p.prog(e.data.progress); return; } pending.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.res); };
  function inline() {
    const inner = { onmessage: null, postMessage: m => setTimeout(() => onMsg({ data: m })) };
    fn(inner);
    return { postMessage: m => setTimeout(() => inner.onmessage({ data: m })), kind: 'inline' };
  }
  try {
    const w = new Worker(URL.createObjectURL(new Blob(['(' + fn.toString() + ')(self)'], { type: 'text/javascript' })));
    w.onmessage = onMsg; w.onerror = () => { if (impl && impl.kind === 'worker') { impl = inline(); for (const [id, p] of pending) impl.postMessage(p.msg); } };
    impl = { postMessage: (m, tr) => w.postMessage(m, tr || []), kind: 'worker' };
  } catch (e) { impl = inline(); }
  const call = (msg, transfer, prog) => new Promise((res, rej) => { const id = ++n; const m = Object.assign({}, msg, { id }); pending.set(id, { res, rej, prog, msg: m }); impl.postMessage(m, impl.kind === 'worker' ? transfer : undefined); });
  call.kind = () => impl.kind;
  return call;
}
