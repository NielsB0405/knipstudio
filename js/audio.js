'use strict';
/* =====================================================================
   Audio engine (Web Audio API)
   clip chain: source → HP → LP → bass/mid/treble EQ → drive → (dry | echo | reverb) → pan → gain
   master:     mix → [limiter] → masterGain → exportDest + monitor → analyser → speakers
   The same chain builder is used for realtime playback and offline mixdown.
   ===================================================================== */
let AC = null, mix = null, limiter = null, masterGain = null, monitor = null, analyser = null, vizAnalyser = null, exportDest = null;
function ensureAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    mix = AC.createGain(); limiter = makeLimiter(AC); masterGain = AC.createGain();
    monitor = AC.createGain(); analyser = AC.createAnalyser(); analyser.fftSize = 2048;
    vizAnalyser = AC.createAnalyser(); vizAnalyser.fftSize = 2048; vizAnalyser.smoothingTimeConstant = .75;
    exportDest = AC.createMediaStreamDestination();
    routeMaster();
    masterGain.connect(exportDest); masterGain.connect(vizAnalyser); masterGain.connect(monitor);
    monitor.connect(analyser); analyser.connect(AC.destination);
    monitor.gain.value = +$('#monVol').value;
    for (const el of els.values()) connectEl(el);
  } catch (e) { console.warn(e); }
}
function makeLimiter(ac) { const c = ac.createDynamicsCompressor(); c.threshold.value = -3; c.knee.value = 2; c.ratio.value = 20; c.attack.value = .003; c.release.value = .15; return c; }
function routeMaster() {
  if (!AC) return;
  try { mix.disconnect(); limiter.disconnect(); } catch (e) { }
  if (P.limiter) { mix.connect(limiter); limiter.connect(masterGain); } else mix.connect(masterGain);
  masterGain.gain.value = P.masterVol ?? 1;
}
const impulseCache = new WeakMap();
function impulse(ac, size) {
  let m = impulseCache.get(ac); if (!m) { m = new Map(); impulseCache.set(ac, m); }
  const key = Math.round(size * 10) / 10; if (m.has(key)) return m.get(key);
  const len = Math.floor(ac.sampleRate * key), b = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
  m.set(key, b); return b;
}
const curveCache = new Map();
function driveCurve(drive) {
  const key = Math.round(drive * 50); if (curveCache.has(key)) return curveCache.get(key);
  const k = key * 4, n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = (3 + k) * x * 20 * Math.PI / 180 / (Math.PI + k * Math.abs(x)); }
  curveCache.set(key, c); return c;
}
function createChain(ac) {
  const n = {};
  n.input = ac.createGain();
  n.hp = ac.createBiquadFilter(); n.hp.type = 'highpass'; n.hp.frequency.value = 10;
  n.lp = ac.createBiquadFilter(); n.lp.type = 'lowpass'; n.lp.frequency.value = 22000;
  n.bass = ac.createBiquadFilter(); n.bass.type = 'lowshelf'; n.bass.frequency.value = 220;
  n.mid = ac.createBiquadFilter(); n.mid.type = 'peaking'; n.mid.frequency.value = 1100; n.mid.Q.value = .8;
  n.treb = ac.createBiquadFilter(); n.treb.type = 'highshelf'; n.treb.frequency.value = 3400;
  n.shaper = ac.createWaveShaper(); n.shaper.oversample = '2x';
  n.dry = ac.createGain();
  n.delay = ac.createDelay(2); n.fb = ac.createGain(); n.echoWet = ac.createGain(); n.echoWet.gain.value = 0;
  n.conv = ac.createConvolver(); n.revWet = ac.createGain(); n.revWet.gain.value = 0;
  n.pan = ac.createStereoPanner(); n.out = ac.createGain(); n.out.gain.value = 0;
  n.input.connect(n.hp); n.hp.connect(n.lp); n.lp.connect(n.bass); n.bass.connect(n.mid); n.mid.connect(n.treb); n.treb.connect(n.shaper);
  n.shaper.connect(n.dry); n.dry.connect(n.pan);
  n.shaper.connect(n.delay); n.delay.connect(n.fb); n.fb.connect(n.delay); n.delay.connect(n.echoWet); n.echoWet.connect(n.pan);
  n.shaper.connect(n.conv); n.conv.connect(n.revWet); n.revWet.connect(n.pan);
  n.pan.connect(n.out);
  const st = {};
  const setv = (param, v) => { if (Math.abs(param.value - v) > 1e-4) param.value = v; };
  n.update = (c, lt = 0) => {
    setv(n.hp.frequency, c.lowcut > 0 ? c.lowcut : 10);
    setv(n.lp.frequency, c.highcut > 0 ? c.highcut : 22000);
    setv(n.bass.gain, c.bass); setv(n.mid.gain, c.mid || 0); setv(n.treb.gain, c.treble);
    if (st.drive !== c.drive) { st.drive = c.drive; n.shaper.curve = c.drive > 0 ? driveCurve(c.drive) : null; }
    setv(n.delay.delayTime, c.echo.time); setv(n.fb.gain, Math.min(.9, c.echo.fb)); setv(n.echoWet.gain, c.echo.mix);
    if (c.reverb.mix > 0 && st.size !== c.reverb.size) { st.size = c.reverb.size; n.conv.buffer = impulse(ac, c.reverb.size); }
    setv(n.revWet.gain, c.reverb.mix * 1.5);
    setv(n.dry.gain, 1 - Math.min(.6, c.reverb.mix * .4));
    setv(n.pan.pan, clamp(A(c, 'pan', lt), -1, 1));
  };
  return n;
}
const AUDIO_PRESETS = {
  'Stem helder': { bass: -4, mid: 2, treble: 4, lowcut: 90, highcut: 0, drive: 0, echo: { mix: 0 }, reverb: { mix: 0 } },
  'Podcast': { bass: 2, mid: 1, treble: 3, lowcut: 70, highcut: 15000, drive: .05, echo: { mix: 0 }, reverb: { mix: 0 } },
  'Radio': { bass: -15, mid: 6, treble: -6, lowcut: 300, highcut: 4000, drive: .2, echo: { mix: 0 }, reverb: { mix: 0 } },
  'Telefoon': { bass: -15, mid: 8, treble: -10, lowcut: 500, highcut: 3000, drive: .35, echo: { mix: 0 }, reverb: { mix: 0 } },
  'Megafoon': { bass: -12, mid: 10, treble: 0, lowcut: 600, highcut: 5000, drive: .8, echo: { mix: 0 }, reverb: { mix: 0 } },
  'Grote zaal': { bass: 0, mid: 0, treble: 0, lowcut: 0, highcut: 0, drive: 0, echo: { mix: 0 }, reverb: { mix: .6, size: 4 } },
  'Kamer': { bass: 0, mid: 0, treble: 0, lowcut: 0, highcut: 0, drive: 0, echo: { mix: 0 }, reverb: { mix: .3, size: 1 } },
  'Echo': { bass: 0, mid: 0, treble: 0, lowcut: 0, highcut: 0, drive: 0, echo: { mix: .45, time: .35, fb: .45 }, reverb: { mix: 0 } },
  'Onderwater': { bass: 8, mid: -6, treble: -15, lowcut: 0, highcut: 600, drive: 0, echo: { mix: .2, time: .08, fb: .5 }, reverb: { mix: .3, size: 1.5 } },
  'Basboost': { bass: 10, mid: 0, treble: 0, lowcut: 0, highcut: 0, drive: 0, echo: { mix: 0 }, reverb: { mix: 0 } },
  'Lo-fi': { bass: 2, mid: -2, treble: -10, lowcut: 120, highcut: 5000, drive: .15, echo: { mix: 0 }, reverb: { mix: .15, size: 1 } },
  'Reset': { bass: 0, mid: 0, treble: 0, lowcut: 0, highcut: 0, drive: 0, echo: { mix: 0, time: .3, fb: .35 }, reverb: { mix: 0, size: 2 } },
};
function applyAudioPreset(c, p) { const q = deepClone(p); c.echo = Object.assign({}, c.echo, q.echo); c.reverb = Object.assign({}, c.reverb, q.reverb); delete q.echo; delete q.reverb; Object.assign(c, q); }

/* ---------- media elements for realtime playback ---------- */
function connectEl(el) {
  if (!AC || el._chain) return;
  try {
    const src = AC.createMediaElementSource(el), ch = createChain(AC);
    src.connect(ch.input); ch.out.connect(mix); el._chain = ch; el.muted = false;
  } catch (e) { console.warn(e); }
}
function getEl(c) {
  const m = media.get(c.mediaId); if (!m || !m.url) return null;
  let el = els.get(c.id); const src = mediaSrc(m, c);
  if (el && el._url !== src) { killEl(c.id); el = null; }
  if (!el) {
    el = document.createElement(c.type === 'video' ? 'video' : 'audio');
    el.preload = 'auto'; el.playsInline = true; el.muted = true; el.src = src; el._url = src;
    el.addEventListener('seeked', requestDraw); el.addEventListener('loadeddata', requestDraw);
    els.set(c.id, el);
  }
  connectEl(el);
  return el;
}
function killEl(id) { const el = els.get(id); if (!el) return; el.pause(); if (el._chain) el._chain.out.disconnect(); el.removeAttribute('src'); el.load(); els.delete(id); }
function cleanupEls() { for (const id of [...els.keys()]) if (!clipById(id)) killEl(id); }
function audioEnv(c, lt) {
  let e = 1;
  if (c.fadeIn > 0) e = Math.min(e, lt / c.fadeIn);
  if (c.fadeOut > 0) e = Math.min(e, (c.dur - lt) / c.fadeOut);
  return clamp(e, 0, 1);
}
/** Level of the source audio of clip c at timeline time t (from pre-computed peaks, ±win seconds). */
function clipLevelAt(c, t, win = .12) {
  const m = media.get(c.mediaId); if (!m || !m.peaks || !isActiveAt(c, t)) return 0;
  const src = c.in + (t - c.start) * c.speed; let v = 0;
  for (let i = Math.max(0, Math.floor((src - win) * 100)); i <= (src + win) * 100 && i < m.peaks.length; i++) v = Math.max(v, m.peaks[i]);
  return v * c.vol;
}
function voiceActive(t) {
  for (const c of P.clips) { if (!isAV(c) || c.muted) continue; const tr = track(c.trackId); if (!tr || !tr.voice || tr.muted) continue; if (clipLevelAt(c, t) > 0.05) return true; }
  return false;
}
const duckState = {};
function duckTarget(tr, t) { return tr && tr.duck && voiceActive(t) ? 1 - tr.duckAmt : 1; }
function audible(c, tr, anySolo) { return !c.muted && tr && !tr.muted && (!anySolo || tr.solo); }
function syncMedia(t) {
  const anySolo = P.tracks.some(tr => tr.solo);
  for (const tr of P.tracks) if (tr.duck) { const tg = duckTarget(tr, t); duckState[tr.id] = lerp(duckState[tr.id] ?? 1, tg, playing ? .12 : 1); }
  for (const c of P.clips) {
    if (!isAV(c)) continue;
    const el = getEl(c); if (!el) continue;
    const tr = track(c.trackId);
    const active = isActiveAt(c, t), lt = t - c.start;
    if ('preservesPitch' in el && el.preservesPitch !== c.keepPitch) el.preservesPitch = c.keepPitch;
    if (active) {
      const target = c.in + lt * c.speed;
      if (playing) {
        const drift = target - el.currentTime;
        let rate = c.speed;
        if (el.paused) { if (Math.abs(drift) > 0.05) el.currentTime = target; el.play().catch(() => { }); }
        else if (Math.abs(drift) > 1) { if (!el.seeking) el.currentTime = target; }
        else if (Math.abs(drift) > 0.06) rate = c.speed * clamp(1 + drift, 0.9, 1.1);
        if (Math.abs(el.playbackRate - rate) > 0.005) el.playbackRate = rate;
      } else {
        if (el.playbackRate !== c.speed) el.playbackRate = c.speed;
        if (!el.paused) el.pause();
        // bij beeld-voor-beeld exporteren elk beeldje exact opzoeken (anders dubbele beeldjes bij 60 fps)
        if (Math.abs(el.currentTime - target) > (exporting && exporting.offline ? 0.002 : 0.02) && !el.seeking) el.currentTime = target;
      }
    } else {
      if (!el.paused) el.pause();
      if (playing && c.start > t && c.start - t < 1.5 && Math.abs(el.currentTime - c.in) > 0.05 && !el.seeking) el.currentTime = c.in;
    }
    if (el._chain) {
      let g = 0;
      if (active && audible(c, tr, anySolo)) g = A(c, 'vol', lt) * (tr.vol ?? 1) * audioEnv(c, lt) * (tr.duck ? (duckState[tr.id] ?? 1) : 1);
      el._chain.out.gain.setTargetAtTime(g, AC.currentTime, 0.012);
      el._chain.update(c, lt);
    }
  }
}
function pauseAllEls() { for (const el of els.values()) if (!el.paused) el.pause(); }

/* ---------- offline mixdown (exact, faster than realtime) ---------- */
async function decodeMedia(m) {
  if (m._buf) return m._buf;
  const ab = await m.blob.arrayBuffer();
  m._buf = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(ab);
  return m._buf;
}
async function renderMixdown(start, end, onProg, sr = 44100) {
  const len = Math.max(1, Math.ceil((end - start) * sr));
  const oc = new OfflineAudioContext(2, len, sr);
  const omix = oc.createGain(), oMaster = oc.createGain(); oMaster.gain.value = P.masterVol ?? 1;
  if (P.limiter) { const l = makeLimiter(oc); omix.connect(l); l.connect(oMaster); } else omix.connect(oMaster);
  oMaster.connect(oc.destination);
  const anySolo = P.tracks.some(tr => tr.solo);
  const list = P.clips.filter(c => isAV(c) && c.start < end && c.start + c.dur > start);
  let i = 0;
  for (const c of list) {
    onProg && onProg(i++ / Math.max(1, list.length) * .5);
    const tr = track(c.trackId), m = media.get(c.mediaId);
    if (!audible(c, tr, anySolo) || !m || !m.blob || m.hasAudio === false) continue;
    let buf; try { buf = await decodeMedia(m); } catch (e) { continue; }
    const src = oc.createBufferSource(); src.buffer = buf; src.playbackRate.value = c.speed;
    const ch = createChain(oc); ch.update(c, 0); src.connect(ch.input); ch.out.connect(omix);
    const cs = Math.max(c.start, start), ce = Math.min(c.start + c.dur, end);
    src.start(cs - start, c.in + (cs - c.start) * c.speed, (ce - cs) * c.speed);
    const g = ch.out.gain, pan = ch.pan.pan;
    g.setValueAtTime(0, 0);
    for (let t = cs; t <= ce + 1e-6; t += 0.02) {
      const lt = t - c.start;
      g.linearRampToValueAtTime(A(c, 'vol', lt) * (tr.vol ?? 1) * audioEnv(c, lt) * duckTarget(tr, t), t - start);
      if (hasKf(c, 'pan')) pan.linearRampToValueAtTime(clamp(A(c, 'pan', lt), -1, 1), t - start);
    }
    g.linearRampToValueAtTime(0, Math.min(end - start, ce - start + 0.01));
  }
  onProg && onProg(.6);
  const out = await oc.startRendering();
  onProg && onProg(1);
  return out;
}
function wavBlob(ab) {
  const nc = ab.numberOfChannels, len = ab.length, buf = new ArrayBuffer(44 + len * nc * 2), v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + len * nc * 2, true); ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, nc, true); v.setUint32(24, ab.sampleRate, true); v.setUint32(28, ab.sampleRate * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, len * nc * 2, true);
  const chs = []; for (let c = 0; c < nc; c++) chs.push(ab.getChannelData(c));
  let o = 44; for (let i = 0; i < len; i++) for (let c = 0; c < nc; c++) { const s = clamp(chs[c][i], -1, 1); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Blob([buf], { type: 'audio/wav' });
}

/* ---------- procedural sound & music generator ---------- */
const SR = 44100;
function noise(oc, dur) { const b = oc.createBuffer(1, Math.ceil(SR * dur), SR), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
function tone(oc, out, type, f, t, d, vol, f2) {
  const o = oc.createOscillator(), g = oc.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d * .8);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .005); g.gain.exponentialRampToValueAtTime(.0001, t + d);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + d + .05);
}
function noiseHit(oc, out, t, d, vol, ftype, freq) {
  const s = oc.createBufferSource(); s.buffer = noise(oc, d + .05); const f = oc.createBiquadFilter(); f.type = ftype; f.frequency.value = freq;
  const g = oc.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
  s.connect(f); f.connect(g); g.connect(out); s.start(t);
}
const kick = (oc, o, t) => tone(oc, o, 'sine', 150, t, .45, .9, 40);
const snare = (oc, o, t) => { noiseHit(oc, o, t, .2, .45, 'highpass', 1200); tone(oc, o, 'triangle', 190, t, .12, .3); };
const hat = (oc, o, t, v = .15) => noiseHit(oc, o, t, .05, v, 'highpass', 7000);
const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);
function pad(oc, o, chords, len, vol, type = 'sawtooth', cutoff = 900) {
  const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; const mg = oc.createGain(); mg.gain.value = vol; lp.connect(mg); mg.connect(o);
  chords.forEach((ch, i) => ch.forEach(n => [-7, 7].forEach(det => {
    const t = i * len, os = oc.createOscillator(); os.type = type; os.frequency.value = NOTE(n); os.detune.value = det;
    const g = oc.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + len * .3); g.gain.setValueAtTime(1, t + len * .85); g.gain.linearRampToValueAtTime(0, t + len * 1.15);
    os.connect(g); g.connect(lp); os.start(t); os.stop(t + len * 1.2);
  })));
}
const SOUNDS = [
  { k: 'beep', n: 'Piep', d: .5, cat: 'Effect', f: (oc, o) => tone(oc, o, 'sine', 1000, 0, .48, .35) },
  { k: 'pop', n: 'Pop', d: .3, cat: 'Effect', f: (oc, o) => tone(oc, o, 'sine', 700, 0, .2, .7, 90) },
  { k: 'click', n: 'Klik', d: .15, cat: 'Effect', f: (oc, o) => { noiseHit(oc, o, 0, .02, .6, 'bandpass', 3000); tone(oc, o, 'square', 2400, 0, .03, .15); } },
  { k: 'ding', n: 'Ding', d: 2.2, cat: 'Effect', f: (oc, o) => { tone(oc, o, 'sine', 1318.5, 0, 2, .4); tone(oc, o, 'sine', 2637, 0, 1.2, .15); } },
  { k: 'success', n: 'Succes-jingle', d: 1.4, cat: 'Effect', f: (oc, o) => [72, 76, 79, 84].forEach((n, i) => tone(oc, o, 'triangle', NOTE(n), i * .11, .7, .3)) },
  { k: 'error', n: 'Fout-geluid', d: .7, cat: 'Effect', f: (oc, o) => { tone(oc, o, 'square', 300, 0, .25, .15); tone(oc, o, 'square', 200, .28, .35, .15); } },
  { k: 'coin', n: 'Muntje', d: .6, cat: 'Effect', f: (oc, o) => { tone(oc, o, 'square', NOTE(83), 0, .08, .15); tone(oc, o, 'square', NOTE(88), .08, .45, .15); } },
  { k: 'laser', n: 'Laser', d: .5, cat: 'Effect', f: (oc, o) => tone(oc, o, 'sawtooth', 1800, 0, .4, .2, 120) },
  { k: 'whoosh', n: 'Whoosh', d: 1.2, cat: 'Overgang', f: (oc, o) => {
      const s = oc.createBufferSource(); s.buffer = noise(oc, 1.2); const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(300, 0); bp.frequency.exponentialRampToValueAtTime(4000, .6); bp.frequency.exponentialRampToValueAtTime(400, 1.2);
      const g = oc.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(.8, .55); g.gain.linearRampToValueAtTime(0, 1.2);
      s.connect(bp); bp.connect(g); g.connect(o); s.start(); } },
  { k: 'boom', n: 'Boem', d: 2.5, cat: 'Overgang', f: (oc, o) => { tone(oc, o, 'sine', 90, 0, 2.2, 1, 28); noiseHit(oc, o, 0, 1.2, .5, 'lowpass', 500); } },
  { k: 'rise', n: 'Spanningsopbouw (4 s)', d: 4.2, cat: 'Overgang', f: (oc, o) => {
      const os = oc.createOscillator(); os.type = 'sawtooth'; os.frequency.setValueAtTime(110, 0); os.frequency.exponentialRampToValueAtTime(1400, 4);
      const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, 0); lp.frequency.exponentialRampToValueAtTime(6000, 4);
      const g = oc.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(.25, 3.9); g.gain.linearRampToValueAtTime(0, 4.1);
      os.connect(lp); lp.connect(g); g.connect(o); os.start(); os.stop(4.2);
      const s = oc.createBufferSource(); s.buffer = noise(oc, 4.2); const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.setValueAtTime(500, 0); hp.frequency.exponentialRampToValueAtTime(9000, 4);
      const g2 = oc.createGain(); g2.gain.setValueAtTime(0, 0); g2.gain.linearRampToValueAtTime(.3, 3.9); g2.gain.linearRampToValueAtTime(0, 4.1); s.connect(hp); hp.connect(g2); g2.connect(o); s.start(); } },
  { k: 'tick', n: 'Tik-tak klok (5 s)', d: 5, cat: 'Sfeer', f: (oc, o) => { for (let i = 0; i < 10; i++) tone(oc, o, 'sine', i % 2 ? 1500 : 2000, i * .5, .04, .5); } },
  { k: 'applause', n: 'Applaus (4 s)', d: 4, cat: 'Sfeer', f: (oc, o) => {
      const b = oc.createBuffer(2, SR * 4, SR);
      for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let n = 0; n < 1100; n++) { const st = Math.floor(Math.random() * (d.length - 1200)), a = .05 + Math.random() * .15; for (let j = 0; j < 1200; j++) d[st + j] += (Math.random() * 2 - 1) * a * Math.exp(-j / 160); } }
      const s = oc.createBufferSource(); s.buffer = b; const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = .6;
      const g = oc.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(1, .4); g.gain.setValueAtTime(1, 3); g.gain.linearRampToValueAtTime(0, 4);
      s.connect(bp); bp.connect(g); g.connect(o); s.start(); } },
  { k: 'rain', n: 'Regen (10 s)', d: 10, cat: 'Sfeer', f: (oc, o) => {
      const s = oc.createBufferSource(); s.buffer = noise(oc, 10); const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
      const g = oc.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(.35, 1); g.gain.setValueAtTime(.35, 9); g.gain.linearRampToValueAtTime(0, 10);
      s.connect(lp); lp.connect(g); g.connect(o); s.start(); for (let i = 0; i < 160; i++) noiseHit(oc, o, Math.random() * 9.8, .03, .08 + Math.random() * .1, 'bandpass', 2000 + Math.random() * 4000); } },
  { k: 'drums', n: 'Drumbeat 120 BPM (8 s)', d: 8, cat: 'Muziek', f: (oc, o) => {
      for (let i = 0; i < 16; i++) { const t = i * .5; if (i % 2 === 0) kick(oc, o, t); else snare(oc, o, t); if (i % 4 === 3) kick(oc, o, t + .25); }
      for (let i = 0; i < 32; i++) hat(oc, o, i * .25, i % 2 ? .08 : .15); } },
  { k: 'pad', n: 'Ambient sfeer (20 s)', d: 20, cat: 'Muziek', f: (oc, o) => pad(oc, o, [[57, 60, 64], [53, 57, 60], [48, 52, 55, 60], [55, 59, 62]], 5, .07) },
  { k: 'chill', n: 'Chill akkoorden 90 BPM (16 s)', d: 16, cat: 'Muziek', f: (oc, o) => {
      const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; lp.connect(o); const beat = 60 / 90;
      const chords = [[60, 64, 67, 71], [57, 60, 64, 67], [62, 65, 69, 72], [55, 59, 62, 65]];
      for (let bar = 0; bar < 4; bar++) for (const hit of [0, 1.5, 2.5]) chords[bar].forEach(n => tone(oc, lp, 'triangle', NOTE(n), bar * 4 * beat + hit * beat, 1.6, .07));
      for (let b = 0; b * beat < 16; b++) { const t = b * beat; if (b % 4 === 0) kick(oc, o, t); if (b % 4 === 2) snare(oc, o, t); hat(oc, o, t + beat / 2, .06); } } },
  { k: 'epic', n: 'Episch trailer (16 s)', d: 16, cat: 'Muziek', f: (oc, o) => {
      pad(oc, o, [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59], [40, 47, 52, 56]], 4, .08, 'sawtooth', 1400);
      for (let i = 0; i < 16; i++) { if (i % 2 === 0) { tone(oc, o, 'sine', 70, i, 1.4, .9, 30); noiseHit(oc, o, i, .6, .3, 'lowpass', 300); } } } },
  { k: 'happy', n: 'Vrolijk ukulele-achtig (12 s)', d: 12, cat: 'Muziek', f: (oc, o) => {
      const prog = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], beat = .375;
      for (let bar = 0; bar < 8; bar++) { const ch = prog[bar % 4]; for (let s = 0; s < 8; s++) { const t = bar * 8 * beat / 2 + s * beat / 2; if (t > 11.8) break; ch.forEach((n, i) => tone(oc, o, 'triangle', NOTE(n + 12), t + i * .012, .3, s % 2 ? .04 : .07)); } }
      [72, 74, 76, 79, 76, 74, 72, 67, 69, 72, 74, 72].forEach((n, i) => tone(oc, o, 'sine', NOTE(n), i * 1, .8, .12));
      for (let b = 0; b < 32; b++) { if (b % 4 === 0) kick(oc, o, b * beat); hat(oc, o, b * beat, .05); } } },
  { k: 'synthwave', n: 'Synthwave 100 BPM (19 s)', d: 19.2, cat: 'Muziek', f: (oc, o) => {
      const beat = .6; pad(oc, o, [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]], 4.8, .06, 'sawtooth', 2000);
      const bassN = [45, 41, 43, 40]; for (let b = 0; b < 32; b++) { const t = b * beat; tone(oc, o, 'sawtooth', NOTE(bassN[Math.floor(b / 8) % 4]), t, .25, .18); tone(oc, o, 'sawtooth', NOTE(bassN[Math.floor(b / 8) % 4]), t + beat / 2, .25, .12); if (b % 2 === 0) kick(oc, o, t); else snare(oc, o, t); hat(oc, o, t + beat / 2, .07); } } },
];
async function renderSound(s) {
  const oc = new OfflineAudioContext(2, Math.ceil(SR * s.d), SR);
  const comp = oc.createDynamicsCompressor(); comp.connect(oc.destination);
  s.f(oc, comp); return await oc.startRendering();
}
