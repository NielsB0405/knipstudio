'use strict';
/* =====================================================================
   Playback loop, preview interaction and editing actions.
   ===================================================================== */
function setPlayhead(t) { playhead = Math.max(0, t); if (playing) { playStartT = playhead; playStartWall = performance.now(); } requestDraw(); }
function play() {
  ensureAudio(); if (playing) return;
  const end = projectDur(); if (end <= 0) return toast('Voeg eerst media toe aan de tijdlijn');
  if (playhead >= end - 0.01) playhead = 0;
  playing = true; playStartT = playhead; playStartWall = performance.now(); $('#playBtn').textContent = '❚❚'; requestDraw();
}
function pause() { playing = false; pauseAllEls(); $('#playBtn').textContent = '▶'; requestDraw(); }
function togglePlay() { playing ? pause() : play(); }
let frameCount = 0;
function loop() {
  if (playing && !(exporting && exporting.offline)) {
    playhead = playStartT + (performance.now() - playStartWall) / 1000;
    const end = exporting ? exporting.end : projectDur();
    if (playhead >= end) {
      if (exporting) { playhead = end; finishRealtimeExport(); }
      else if (looping && end > 0) { playhead = 0; playStartT = 0; playStartWall = performance.now(); pauseAllEls(); }
      else { playhead = end; pause(); }
    }
    if (exporting) exportProgress((playhead - exporting.start) / (exporting.end - exporting.start), `Bezig met exporteren… ${fmt(playhead - exporting.start)} / ${fmt(exporting.end - exporting.start)}`);
    needsDraw = true;
  }
  if (needsDraw && !(exporting && exporting.offline)) {
    needsDraw = false;
    syncMedia(playhead); draw(playhead); drawOverlay(); updatePlayheadUI();
    if (S.scopes !== 'none' && (frameCount++ % 4 === 0)) drawScopes();
  }
  drawMeter();
  requestAnimationFrame(loop);
}
const meterBuf = new Float32Array(2048); let meterPeak = 0;
function drawMeter() {
  const m = $('#meter'), g = m.getContext('2d'); let lvl = 0;
  if (analyser) { analyser.getFloatTimeDomainData(meterBuf); let s = 0; for (const v of meterBuf) s = Math.max(s, Math.abs(v)); lvl = s; }
  meterPeak = Math.max(lvl, meterPeak * 0.95);
  g.clearRect(0, 0, m.width, m.height); g.fillStyle = '#111'; g.fillRect(0, 0, m.width, m.height);
  const db = v => clamp((20 * Math.log10(Math.max(v, 1e-5)) + 48) / 48, 0, 1);
  const gr = g.createLinearGradient(0, 0, m.width, 0);
  gr.addColorStop(0, '#3ddc97'); gr.addColorStop(.7, '#ffd84d'); gr.addColorStop(1, '#ff4d6d');
  g.fillStyle = gr; g.fillRect(0, 4, db(lvl) * m.width, m.height - 8);
  g.fillStyle = '#fff'; g.fillRect(db(meterPeak) * m.width - 2, 2, 2, m.height - 4);
}

/* ---------- preview interaction: move / scale / rotate (keyframe aware) ---------- */
function toCv(e) { const r = ov.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; }
function toLocal(p, bb) { const a = -bb.rot * Math.PI / 180, dx = p.x - bb.cx, dy = p.y - bb.cy; return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) }; }
function hitTest(p) {
  for (const tr of P.tracks.filter(t => t.kind === 'visual' && !t.hidden)) {
    const cs = P.clips.filter(c => c.trackId === tr.id && isActiveAt(c, playhead) && c.type !== 'adjust').sort((a, b) => b.start - a.start);
    for (const c of cs) { const bb = bbs.get(c.id); if (!bb) continue; const L = toLocal(p, bb); if (Math.abs(L.x) <= bb.w / 2 && Math.abs(L.y) <= bb.h / 2) return c; }
  }
  return null;
}
function handleAt(c, p) {
  if (!c || kindOf(c) !== 'visual' || !isActiveAt(c, playhead) || !bbs.has(c.id)) return null;
  const px = cv.width / ov.clientWidth, bb = bbs.get(c.id), L = toLocal(p, bb), hs = 12 * px;
  if (Math.hypot(L.x, L.y + bb.h / 2 + 24 * px) < hs) return 'rot';
  if (Math.abs(Math.abs(L.x) - bb.w / 2) < hs && Math.abs(Math.abs(L.y) - bb.h / 2) < hs) return 'scale';
  if (Math.abs(L.x) <= bb.w / 2 && Math.abs(L.y) <= bb.h / 2) return 'move';
  return null;
}
ov.addEventListener('pointerdown', e => {
  ensureAudio(); if (exporting || e.button !== 0) return;
  const p = toCv(e);
  let c = sel && clipById(sel), mode = handleAt(c, p);
  if (!mode) { const hit = hitTest(p); if (hit) { select(hit.id, e.shiftKey ? 'toggle' : null); c = hit; mode = 'move'; } else { select(null); return; } }
  if (track(c.trackId)?.locked) return toast('Deze track is vergrendeld');
  const before = snap(), lt = localT(c), bb = bbs.get(c.id);
  const o = { x: A(c, 'x', lt), y: A(c, 'y', lt), scale: A(c, 'scale', lt), rot: A(c, 'rot', lt) };
  const d0 = Math.hypot(p.x - bb.cx, p.y - bb.cy) || 1, a0 = Math.atan2(p.y - bb.cy, p.x - bb.cx);
  let moved = false;
  const mv = ev => {
    const q = toCv(ev); moved = true;
    if (mode === 'move') {
      let nx = o.x + (q.x - p.x) / cv.width, ny = o.y + (q.y - p.y) / cv.height; guide = { x: false, y: false };
      if (!ev.altKey) { if (Math.abs(nx - .5) < .012) { nx = .5; guide.x = true; } if (Math.abs(ny - .5) < .012) { ny = .5; guide.y = true; } }
      setAnimated(c, 'x', +nx.toFixed(4)); setAnimated(c, 'y', +ny.toFixed(4));
    } else if (mode === 'scale') setAnimated(c, 'scale', +clamp(o.scale * Math.hypot(q.x - bb.cx, q.y - bb.cy) / d0, .02, 10).toFixed(3));
    else { let r = o.rot + (Math.atan2(q.y - bb.cy, q.x - bb.cx) - a0) * 180 / Math.PI; r = ((r + 180) % 360 + 360) % 360 - 180; if (ev.shiftKey) r = Math.round(r / 15) * 15; setAnimated(c, 'rot', Math.round(r * 10) / 10); }
    requestDraw();
  };
  const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); guide = null; if (moved) commit(before, { move: 'Verplaatst', scale: 'Geschaald', rot: 'Gedraaid' }[mode]); else requestDraw(); };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
});
ov.addEventListener('pointermove', e => {
  if (e.buttons) return; const p = toCv(e), mode = handleAt(sel && clipById(sel), p);
  ov.style.cursor = mode === 'rot' ? 'grab' : mode === 'scale' ? 'nwse-resize' : mode === 'move' ? 'move' : hitTest(p) ? 'pointer' : 'default';
});
ov.addEventListener('dblclick', () => { const c = sel && clipById(sel); if (c && c.type === 'text') { secOpen.text = true; renderProps(); setTimeout(() => $('#propsBody textarea')?.focus(), 30); } });
ov.addEventListener('wheel', e => {
  const c = sel && clipById(sel); if (!c || kindOf(c) !== 'visual' || !isActiveAt(c, playhead) || exporting) return;
  e.preventDefault(); if (!pend) { pend = snap(); }
  setAnimated(c, 'scale', +clamp(A(c, 'scale', localT(c)) * (e.deltaY < 0 ? 1.05 : 1 / 1.05), .02, 10).toFixed(3)); requestDraw();
  clearTimeout(ov._wt); ov._wt = setTimeout(() => { if (pend) { const b = pend; pend = null; commit(b, 'Geschaald'); } }, 400);
}, { passive: false });

/* ---------- clip actions ---------- */
function needSel() { const c = sel && clipById(sel); if (!c) toast('Selecteer eerst een clip'); return c; }
function cloneClip(c) { const n = deepClone(c); n.id = uid(); return n; }
function splitAt(c, t) {
  if (!(t > c.start + 0.02 && t < c.start + c.dur - 0.02)) return null;
  const b = cloneClip(c), d = t - c.start;
  c.dur = d; b.start = t; b.dur -= d; if (isAV(c)) b.in = c.in + d * c.speed;
  shiftKf(b, d);
  c.tout = { type: 'none', dur: c.tout.dur }; b.tin = { type: 'none', dur: b.tin.dur }; c.fadeOut = 0; b.fadeIn = 0;
  P.clips.push(b); return b;
}
function actSplit() {
  const targets = selectedClips().filter(c => isActiveAt(c, playhead));
  if (targets.length) { edit(() => { let last = null; for (const c of targets) { const b = splitAt(c, playhead); if (b) last = b; } if (last) select(last.id); }, 'Gesplitst'); return; }
  let n = 0; edit(() => { for (const x of [...P.clips]) if (!track(x.trackId)?.locked && splitAt(x, playhead)) n++; }, 'Alles gesplitst');
  toast(n ? `${n} clip(s) gesplitst` : 'Geen clip onder de afspeelkop');
}
function actDelete() {
  if (S.rippleMode) return actRipple();
  const list = selectedClips(); if (!list.length) return toast('Selecteer eerst een clip');
  edit(() => { const ids = new Set(list.map(c => c.id)); P.clips = P.clips.filter(x => !ids.has(x.id)); selSet.clear(); sel = null; }, list.length > 1 ? `${list.length} clips verwijderd` : 'Clip verwijderd');
  cleanupEls();
}
function actRipple() {
  const list = selectedClips().sort((a, b) => b.start - a.start); if (!list.length) return toast('Selecteer eerst een clip');
  edit(() => {
    for (const c of list) { P.clips = P.clips.filter(x => x.id !== c.id); for (const o of P.clips) if (o.trackId === c.trackId && o.start >= c.start + c.dur - 1e-4) o.start -= c.dur; }
    selSet.clear(); sel = null;
  }, 'Ripple-verwijderd');
  cleanupEls();
}
function actDup() {
  const list = selectedClips(); if (!list.length) return toast('Selecteer eerst een clip');
  edit(() => {
    const span = Math.max(...list.map(c => c.start + c.dur)) - Math.min(...list.map(c => c.start)); const ids = [];
    for (const c of list) { const n = cloneClip(c); n.start = c.start + span; addClip(n, c.trackId); ids.push(n.id); }
    selectMany(ids);
  }, 'Gedupliceerd');
}
function actCopy() { const list = selectedClips(); if (!list.length) return toast('Selecteer eerst een clip'); clipboard = JSON.stringify(list); toast(`${list.length} clip(s) gekopieerd`); }
function actPaste() {
  if (!clipboard) return toast('Klembord is leeg');
  edit(() => {
    const list = JSON.parse(clipboard), t0 = Math.min(...list.map(c => c.start)), ids = [];
    for (const c of list) { c.id = uid(); c.start = playhead + c.start - t0; addClip(migrateClip(c), c.trackId); ids.push(c.id); }
    selectMany(ids);
  }, 'Geplakt');
}
function actDetach(c) {
  edit(() => {
    const a = baseClip('audio', { mediaId: c.mediaId, name: c.name + ' (audio)', start: c.start, dur: c.dur, in: c.in, speed: c.speed, vol: c.vol, pan: c.pan, fadeIn: c.fadeIn, fadeOut: c.fadeOut, bass: c.bass, mid: c.mid, treble: c.treble, keepPitch: c.keepPitch });
    if (c.kf.vol) a.kf.vol = deepClone(c.kf.vol);
    c.muted = true; addClip(a);
  }, 'Audio losgekoppeld');
  toast('Audio losgekoppeld naar een audiotrack');
}
async function actFreeze(c) {
  if (!isActiveAt(c, playhead)) return toast('Zet de afspeelkop op de videoclip');
  const el = getEl(c); if (!el || el.readyState < 2) return toast('Video nog niet geladen');
  const k = document.createElement('canvas'); k.width = el.videoWidth; k.height = el.videoHeight; k.getContext('2d').drawImage(el, 0, 0);
  const blob = await new Promise(r => k.toBlob(r, 'image/png'));
  const [m] = await importFiles([new File([blob], `Stilstaand beeld ${fmt(playhead)}.png`, { type: 'image/png' })]);
  const t = playhead, fd = 2;
  edit(() => {
    splitAt(c, t);
    for (const o of P.clips) if (o.trackId === c.trackId && o.start >= t - 1e-4) o.start += fd;
    const ic = clipFromMedia(m);
    for (const k2 of ['x', 'y', 'scale', 'rot', 'fit', 'opacity', 'flipH', 'flipV', 'radius', 'border', 'borderColor', 'shadow', 'bgFill', 'blend', 'crop', 'f', 'tint', 'vignette', 'fx', 'mask']) ic[k2] = deepClone(c[k2]);
    ic.start = t; ic.dur = fd; ic.trackId = c.trackId; P.clips.push(ic); select(ic.id);
  }, 'Freeze frame');
  toast('Freeze frame van 2 s ingevoegd');
}
async function actSilence(c) {
  const m = media.get(c.mediaId); if (!m || !m.peaks) return toast('Geen audiogegevens voor deze clip');
  const thrDb = +(prompt('Drempel voor stilte in dB (bijv. -35):', '-35') || NaN); if (isNaN(thrDb)) return;
  const a = c.in, b = c.in + c.dur * c.speed, padT = 0.12;
  const sil = await analysis({ op: 'silence', peaks: m.peaks, a, b, thr: Math.pow(10, thrDb / 20), minSil: .5 });
  if (!sil.length) return toast('Geen stiltes gevonden');
  const segs = []; let cur = a;
  for (const [s, e] of sil) { const s2 = Math.max(cur, s + (s > a ? padT : 0)), e2 = e - (e < b ? padT : 0); if (s2 > cur + 0.05) segs.push([cur, s2]); cur = Math.max(cur, e2); }
  if (b > cur + 0.05) segs.push([cur, b]);
  edit(() => {
    let pos = c.start, total = 0; const end = c.start + c.dur;
    P.clips = P.clips.filter(x => x.id !== c.id);
    segs.forEach(([s, e], i) => {
      const n = cloneClip(c); n.in = s; n.dur = (e - s) / c.speed; n.start = pos; pos += n.dur; total += n.dur; n.kf = {};
      if (i > 0) { n.tin = { type: 'none', dur: .5 }; n.fadeIn = 0; } if (i < segs.length - 1) { n.tout = { type: 'none', dur: .5 }; n.fadeOut = 0; }
      P.clips.push(n); if (i === 0) { selSet.clear(); selSet.add(n.id); sel = n.id; }
    });
    const removed = c.dur - total;
    for (const o of P.clips) if (o.trackId === c.trackId && o.start >= end - 1e-4) o.start -= removed;
    toast(`${sil.length} stilte(s) verwijderd, ${removed.toFixed(1)} s korter`);
  }, 'Stiltes weggeknipt');
  cleanupEls();
}
function actNormalize(c) {
  const m = media.get(c.mediaId); if (!m || !m.peaks) return toast('Geen audiogegevens');
  let mx = 0; for (let i = Math.floor(c.in * 100); i < (c.in + c.dur * c.speed) * 100 && i < m.peaks.length; i++) mx = Math.max(mx, m.peaks[i]);
  if (mx < 1e-4) return toast('Clip is stil');
  edit(() => { c.vol = +clamp(0.95 / mx, 0, 3).toFixed(2); }, 'Genormaliseerd');
  toast(`Volume ingesteld op ${Math.round(c.vol * 100)}%`);
}
async function actBeats(c) {
  const m = media.get(c.mediaId); if (!m || !m.peaks) return toast('Geen audiogegevens');
  toast('Beats zoeken…');
  const r = await analysis({ op: 'beats', peaks: m.peaks, from: c.in, to: c.in + c.dur * c.speed, sens: 1.6, minGap: .22 });
  if (!r.onsets.length) return toast('Geen beats gevonden');
  edit(() => {
    P.markers = P.markers.filter(x => !x.beat);
    for (const s of r.onsets) P.markers.push({ t: +(c.start + (s - c.in) / c.speed).toFixed(3), beat: true, color: '#ff9f43', label: 'beat' });
    P.markers.sort((a, b) => a.t - b.t);
  }, 'Beats gedetecteerd');
  toast(`${r.onsets.length} beats gevonden${r.bpm ? ` · ±${r.bpm} BPM` : ''}`, 4000);
}
function actCutOnBeats() {
  const beats = P.markers.filter(m => m.beat).map(m => m.t); if (!beats.length) return toast('Detecteer eerst beats (rechtsklik op muziek → Beats detecteren)');
  const list = selectedClips().filter(c => kindOf(c) === 'visual'); if (!list.length) return toast('Selecteer visuele clips');
  let n = 0; edit(() => { for (const c of list) { let cur = c; for (const t of beats) { const b = splitAt(cur, t); if (b) { cur = b; n++; } } } }, 'Geknipt op beats');
  toast(`${n} knippen op de beat`);
}
async function actScenes(c) {
  toast('Scènes analyseren…', 60000);
  const cuts = await detectScenes(c, .3, p => { $('#toast').textContent = `Scènes analyseren… ${Math.round(p * 100)}%`; });
  if (!cuts.length) return toast('Geen scènewissels gevonden');
  edit(() => { let cur = c; for (const s of cuts) { const b = splitAt(cur, c.start + (s - c.in) / c.speed); if (b) cur = b; } }, 'Scènes gesplitst');
  toast(`${cuts.length} scènewissels gevonden en gesplitst`);
}
function actCloseGaps(trId) {
  edit(() => { let cur = 0; P.clips.filter(c => c.trackId === trId).sort((a, b) => a.start - b.start).forEach(c => { if (c.start > cur) c.start = cur; cur = c.start + c.dur; }); }, 'Gaten gedicht');
}
function actSequence() {
  const list = selectedClips().sort((a, b) => a.start - b.start); if (list.length < 2) return toast('Selecteer meerdere clips');
  edit(() => { let cur = list[0].start; for (const c of list) { c.start = cur; cur += c.dur; } }, 'Achter elkaar gezet');
}
function actCrossfadeAll() {
  const list = selectedClips().filter(c => kindOf(c) === 'visual'); if (!list.length) return toast('Selecteer visuele clips');
  edit(() => list.forEach(c => { c.tin = { type: 'fade', dur: S.transDur }; c.tout = { type: 'fade', dur: S.transDur }; }), 'Overgangen toegevoegd');
}
function actMarker() {
  edit(() => { const colors = ['#ffd84d', '#ff5c7a', '#3ddc97', '#4db8ff', '#c77dff']; const n = P.markers.filter(m => !m.beat).length; P.markers.push({ t: playhead, label: 'Markering ' + (n + 1), color: colors[n % colors.length] }); P.markers.sort((a, b) => a.t - b.t); }, 'Markering');
}
function jumpMarker(dir) { const ts = [0, ...P.markers.map(m => m.t), projectDur()]; const t = dir > 0 ? ts.find(x => x > playhead + 1e-3) : [...ts].reverse().find(x => x < playhead - 1e-3); if (t != null) setPlayhead(t); }
async function actSnapshot() {
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  download(blob, `${safeName(P.name)}_${fmt(playhead).replace(/[:.]/g, '-')}.png`); toast('Momentopname opgeslagen');
}
function addFxTo(c, key) {
  if (!c) return toast('Selecteer eerst een clip');
  if (kindOf(c) !== 'visual') return toast('Effecten werken op visuele clips');
  edit(() => c.fx.push({ id: uid(), type: key, on: true, p: fxDefaults(key) }), 'Effect: ' + FX[key].name);
  secOpen.gpu = true; renderProps(); toast('Effect toegevoegd: ' + FX[key].name);
}
function clipMenu(c) {
  const items = [['✂️ Splitsen op afspeelkop   S', actSplit], ['⧉ Dupliceren   Ctrl+D', actDup], ['📋 Kopiëren   Ctrl+C', actCopy], ['📥 Plakken   Ctrl+V', actPaste, !clipboard], '-'];
  if (c.type === 'video') { items.push(['🔊 Audio loskoppelen', () => actDetach(c)], ['🧊 Stilstaand beeld (freeze frame)', () => actFreeze(c)], ['🎬 Scènes detecteren & splitsen', () => actScenes(c)]); }
  if (isAV(c)) items.push(['🤫 Stiltes wegknippen', () => actSilence(c)], ['📈 Volume normaliseren', () => actNormalize(c)], ['🥁 Beats detecteren → markeringen', () => actBeats(c)]);
  if (selSet.size > 1) items.push('-', ['↔ Achter elkaar plaatsen', actSequence], ['◐ Fade-overgangen op alles', actCrossfadeAll], ['🥁 Knippen op beats', actCutOnBeats]);
  else if (kindOf(c) === 'visual' && P.markers.some(m => m.beat)) items.push(['🥁 Knippen op beats', actCutOnBeats]);
  items.push(['⇤ Gaten in track dichten', () => actCloseGaps(c.trackId)]);
  items.push('-', ['🗑 Verwijderen   Del', actDelete], ['⇤ Ripple-verwijderen   Shift+Del', actRipple]);
  return items;
}
function showCtx(x, y, items) {
  const m = $('#ctx'); m.innerHTML = '';
  for (const it of items) {
    if (it === '-') { m.appendChild(h('hr')); continue; }
    const b = h('button', '', esc(it[0])); if (it[2]) b.disabled = true;
    b.onclick = () => { hideCtx(); it[1](); }; m.appendChild(b);
  }
  m.classList.remove('hidden');
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'; m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
}
function hideCtx() { $('#ctx').classList.add('hidden'); }
