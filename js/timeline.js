'use strict';
/* =====================================================================
   Timeline: tracks, clips, ruler, playhead, selection, drag/trim,
   marquee multi-select, keyframe diamonds, drag & drop.
   ===================================================================== */
const timeLbl = $('#timeLbl'), tlScroll = $('#tl-scroll'), tlInner = $('#tl-inner'), tracksEl = $('#tracks'), phEl = $('#playhead');
const tlWidth = () => Math.max(projectDur() + 30, (tlScroll.clientWidth - HEAD) / pps + 5) * pps;
function renderTimeline() {
  const w = tlWidth();
  tlInner.style.width = (HEAD + w) + 'px';
  tracksEl.innerHTML = '';
  P.tracks.forEach(tr => {
    const row = h('div', `trow ${tr.kind}${tr.locked ? ' locked' : ''}`); row.dataset.track = tr.id;
    const hd = h('div', 'thead'); hd.dataset.track = tr.id;
    const b = (act, label, on, title) => `<button data-act="${act}" class="${on ? 'on' : ''}" title="${title}">${label}</button>`;
    hd.innerHTML = `<div class="tnrow"><div class="tn" data-act="rename" title="Dubbelklik om te hernoemen">${tr.kind === 'visual' ? '🎞' : '🔊'} ${esc(tr.name)}</div>
        ${tr.kind === 'audio' ? `<input type="range" min="0" max="2" step="0.01" value="${tr.vol}" data-act="tvol" title="Trackvolume">` : ''}</div>
      <div class="tbtns">
        ${tr.kind === 'visual' ? b('hide', tr.hidden ? '🙈' : '👁', tr.hidden, 'Verbergen') : b('solo', 'S', tr.solo, 'Solo')}
        ${b('mute', tr.muted ? '🔇' : '🔈', tr.muted, 'Dempen')}
        ${b('lock', '🔒', tr.locked, 'Vergrendelen')}
        ${tr.kind === 'audio' ? b('voice', '🎙', tr.voice, 'Spraaktrack (stuurt ducking aan)') + b('duck', '🦆', tr.duck, 'Ducking: automatisch zachter als er gesproken wordt') : ''}
        ${b('up', '▲', false, 'Omhoog (naar voren)')}${b('down', '▼', false, 'Omlaag')}
        ${b('deltrack', '✕', false, 'Track verwijderen')}
      </div>`;
    const lane = h('div', 'lane'); lane.style.width = w + 'px'; lane.dataset.track = tr.id;
    for (const c of P.clips.filter(c => c.trackId === tr.id)) lane.appendChild(clipEl(c));
    row.append(hd, lane); tracksEl.appendChild(row);
  });
  const add = h('div', 'trow addrow');
  add.innerHTML = `<div class="thead"><button data-act="addv">+ Video</button><button data-act="adda">+ Audio</button></div><div class="lane drop-new" data-track="new" style="width:${w}px">⤓ Sleep hier media naartoe om een nieuwe track te maken</div>`;
  tracksEl.appendChild(add);
  $('#tlInfo').textContent = `${P.clips.length} clips · ${fmtS(projectDur())}${selSet.size > 1 ? ` · ${selSet.size} geselecteerd` : ''}`;
  drawRuler(); updatePlayheadUI();
}
function clipEl(c) {
  const d = h('div', `clip t-${c.type}${selSet.has(c.id) ? ' sel' : ''}${c.id === sel ? ' prim' : ''}`); d.dataset.id = c.id;
  d.style.left = c.start * pps + 'px'; d.style.width = Math.max(4, c.dur * pps) + 'px';
  const m = media.get(c.mediaId);
  if (m && m.missing) d.classList.add('missing');
  if (isMediaVis(c) && m) { const bg = m.strip || m.thumb; if (bg) { d.style.backgroundImage = `url(${bg})`; if (m.strip && c.type === 'video') { const px = Math.max(1, c.dur * pps); const tileW = 54 / 36 * 52; d.style.backgroundSize = `auto 100%`; } } }
  if (c.type === 'color') d.style.background = c.grad ? `linear-gradient(${c.angle + 90}deg,${c.color},${c.color2})` : c.color;
  if (isMediaVis(c)) d.appendChild(h('div', 'shade'));
  let label = `${TYPE_ICONS[c.type]} ${esc(c.type === 'text' ? c.text.split('\n')[0] : (c.name || TYPE_NAMES[c.type]))}`;
  if (c.speed !== 1) label += ` · ${c.speed}×`;
  if (c.muted && isAV(c)) label += ' · 🔇';
  if (c.fx && c.fx.length) label += ` · ✨${c.fx.length}`;
  if (c.chroma && c.chroma.on) label += ' · 🟩';
  if (c.mask && c.mask.type !== 'none') label += ' · ◐';
  d.appendChild(h('div', 'lbl', label));
  if (c.tin && c.tin.type !== 'none') d.appendChild(h('div', 'tri in'));
  if (c.tout && c.tout.type !== 'none') d.appendChild(h('div', 'tri out'));
  if (S.waveforms && isAV(c) && m && m.peaks) { const wc = h('canvas', 'wf'); drawWave(wc, c, m); d.appendChild(wc); }
  for (const t of allKfTimes(c)) { const k = h('div', 'kfd'); k.style.left = (t * pps - 5) + 'px'; k.dataset.t = t; k.title = 'Keyframe op ' + fmt(c.start + t); d.appendChild(k); }
  d.appendChild(h('div', 'h l')); d.appendChild(h('div', 'h r'));
  return d;
}
function drawWave(wc, c, m) {
  const w = Math.min(4000, Math.max(4, Math.ceil(c.dur * pps))), hh = 34;
  wc.width = w; wc.height = hh; const g = wc.getContext('2d');
  const pk = m.peaks, n = pk.length, span = c.dur * c.speed;
  g.fillStyle = c.type === 'audio' ? 'rgba(220,255,240,.85)' : 'rgba(255,255,255,.7)';
  for (let x = 0; x < w; x++) {
    const t0 = c.in + (x / w) * span, t1 = c.in + ((x + 1) / w) * span;
    const i0 = Math.floor(t0 * 100), i1 = Math.max(i0 + 1, Math.ceil(t1 * 100)); let v = 0;
    for (let i = i0; i < i1 && i < n; i++) v = Math.max(v, pk[i]);
    const lt = (x / w) * c.dur, vol = c.muted ? .15 : Math.min(1.6, A(c, 'vol', lt));
    const bh = Math.max(1, Math.min(1, v * vol * audioEnv(c, lt)) * hh);
    g.fillRect(x, hh - bh, 1, bh);
  }
}
function updateClipEl(c) {
  const d = tracksEl.querySelector(`.clip[data-id="${c.id}"]`); if (!d) return;
  d.style.left = c.start * pps + 'px'; d.style.width = Math.max(4, c.dur * pps) + 'px';
}
function drawRuler() {
  const rc = $('#ruler-cv'), w = Math.max(10, tlScroll.clientWidth - HEAD), D = dpr();
  rc.width = w * D; rc.height = 28 * D; rc.style.width = w + 'px';
  const g = rc.getContext('2d'); g.scale(D, D); g.clearRect(0, 0, w, 28);
  const sl = tlScroll.scrollLeft, t0 = sl / pps, t1 = (sl + w) / pps;
  const steps = [1 / FPS, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = steps.find(s => s * pps >= 70) || 600, minor = step / 5;
  const css = getComputedStyle(document.documentElement);
  g.strokeStyle = css.getPropertyValue('--line').trim() || '#444455'; g.fillStyle = css.getPropertyValue('--muted').trim() || '#9a9ab0'; g.font = '10px Segoe UI'; g.beginPath();
  for (let t = Math.floor(t0 / minor) * minor; t <= t1 + minor; t += minor) {
    const x = Math.round(t * pps - sl) + .5, major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    g.moveTo(x, major ? 12 : 21); g.lineTo(x, 28);
    if (major) g.fillText(step < 1 ? (step < .1 ? fmt(t).slice(3) : t.toFixed(1) + 's') : fmtS(t), x + 3, 11);
  }
  g.stroke();
  const ex = projectDur() * pps - sl; g.fillStyle = 'rgba(124,92,255,.6)'; g.fillRect(ex, 22, 2, 6);
  P.markers.forEach(mk => {
    const x = mk.t * pps - sl; if (x < -10 || x > w + 10) return;
    g.fillStyle = mk.color || '#ffd84d';
    if (mk.beat) { g.fillRect(x - 1, 20, 2, 8); return; }
    g.beginPath(); g.moveTo(x - 6, 14); g.lineTo(x + 6, 14); g.lineTo(x + 6, 22); g.lineTo(x, 28); g.lineTo(x - 6, 22); g.closePath(); g.fill();
  });
}
function updatePlayheadUI() {
  const x = playhead * pps, sl = tlScroll.scrollLeft, vw = tlScroll.clientWidth - HEAD;
  phEl.style.left = (HEAD + x) + 'px';
  phEl.style.visibility = x < sl - 1 ? 'hidden' : 'visible';
  const lbl = `${fmt(playhead)} / ${fmt(projectDur())}`; if (timeLbl.textContent !== lbl) timeLbl.textContent = lbl;
  if (playing && (x > sl + vw - 40 || x < sl)) tlScroll.scrollLeft = Math.max(0, x - 60);
  refreshLiveProps();
}
function timeFromClientX(cx) { const r = tlScroll.getBoundingClientRect(); return Math.max(0, (cx - r.left + tlScroll.scrollLeft - HEAD) / pps); }
tlScroll.addEventListener('scroll', () => { drawRuler(); updatePlayheadUI(); });
function refreshSelClasses() {
  $$('.clip', tracksEl).forEach(e => { e.classList.toggle('sel', selSet.has(e.dataset.id)); e.classList.toggle('prim', e.dataset.id === sel); });
  $('#tlInfo').textContent = `${P.clips.length} clips · ${fmtS(projectDur())}${selSet.size > 1 ? ` · ${selSet.size} geselecteerd` : ''}`;
}
function select(id, mode) {
  if (mode === 'toggle' && id) {
    if (selSet.has(id)) { selSet.delete(id); if (sel === id) sel = [...selSet][0] || null; }
    else { selSet.add(id); sel = id; }
  } else { selSet.clear(); if (id) selSet.add(id); sel = id || null; }
  refreshSelClasses(); renderProps(); requestDraw();
}
function selectMany(ids) { selSet.clear(); ids.forEach(i => selSet.add(i)); sel = ids[0] || null; refreshSelClasses(); renderProps(); requestDraw(); }
function snapPoints(exclude) {
  const pts = [0, playhead, ...P.markers.map(m => m.t)];
  for (const c of P.clips) if (!exclude.has(c.id)) pts.push(c.start, c.start + c.dur);
  return pts;
}
function showSnap(t) { const s = $('#snapline'); if (t == null) { s.style.display = 'none'; return; } s.style.display = 'block'; s.style.left = (HEAD + t * pps) + 'px'; }
tlScroll.addEventListener('pointerdown', e => {
  ensureAudio(); if (e.button !== 0 || exporting) return;
  if (e.target.closest('.thead')) return;
  const kd = e.target.closest('.kfd');
  if (kd) { const c = clipById(kd.closest('.clip').dataset.id); select(c.id); setPlayhead(c.start + +kd.dataset.t); e.stopPropagation(); return; }
  const ce = e.target.closest('.clip');
  if (ce) {
    const c = clipById(ce.dataset.id); if (!c) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) { select(c.id, 'toggle'); return; }
    if (!selSet.has(c.id) || selSet.size < 2) select(c.id); else { sel = c.id; refreshSelClasses(); renderProps(); }
    if (track(c.trackId)?.locked) return;
    const hd = e.target.closest('.h');
    startClipDrag(e, c, ce, hd ? (hd.classList.contains('l') ? 'l' : 'r') : 'move');
    return;
  }
  const onRuler = e.target.closest('.ruler');
  if (onRuler) {
    const t = timeFromClientX(e.clientX), mk = P.markers.find(m => !m.beat && Math.abs(m.t - t) * pps < 7);
    if (mk) { setPlayhead(mk.t); return; }
  }
  if (!onRuler && e.target.closest('.lane') && e.shiftKey) { startMarquee(e); return; }
  if (onRuler || e.target.closest('.lane')) {
    if (!onRuler) select(null);
    const wasPlaying = playing; if (wasPlaying) pause();
    const mv = ev => { let t = timeFromClientX(ev.clientX); if (snapOn && ev.shiftKey === false) { const pts = P.markers.map(m => m.t); const n = pts.find(p => Math.abs(p - t) * pps < 6); if (n != null) t = n; } setPlayhead(t); };
    mv(e);
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (wasPlaying) play(); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }
});
function startMarquee(e) {
  const box = h('div', 'marquee'); tlInner.appendChild(box);
  const ir = () => tlInner.getBoundingClientRect();
  const x0 = e.clientX - ir().left, y0 = e.clientY - ir().top;
  const mv = ev => {
    const x1 = ev.clientX - ir().left, y1 = ev.clientY - ir().top;
    const l = Math.min(x0, x1), t = Math.min(y0, y1), w = Math.abs(x1 - x0), hh = Math.abs(y1 - y0);
    Object.assign(box.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: hh + 'px' });
    const R = { l: ev.clientX < e.clientX ? ev.clientX : e.clientX, r: Math.max(ev.clientX, e.clientX), t: Math.min(ev.clientY, e.clientY), b: Math.max(ev.clientY, e.clientY) };
    const ids = $$('.clip', tracksEl).filter(el => { const b = el.getBoundingClientRect(); return b.right > R.l && b.left < R.r && b.bottom > R.t && b.top < R.b; }).map(el => el.dataset.id);
    selSet.clear(); ids.forEach(i => selSet.add(i)); sel = ids[0] || null; refreshSelClasses();
  };
  const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); box.remove(); renderProps(); requestDraw(); };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}
function startClipDrag(e, c, el, mode) {
  const before = snap(), x0 = e.clientX, y0 = e.clientY;
  const group = mode === 'move' && selSet.has(c.id) && selSet.size > 1 ? selectedClips().filter(x => !track(x.trackId)?.locked) : [c];
  const orig = new Map(group.map(x => [x.id, { start: x.start, dur: x.dur, in: x.in, trackId: x.trackId, kf: deepClone(x.kf || {}) }]));
  const o = orig.get(c.id);
  let moved = false;
  const m = media.get(c.mediaId);
  const maxSrc = isAV(c) && m && isFinite(m.duration) && m.duration > 0 ? m.duration : Infinity;
  const pts = snapPoints(new Set(group.map(x => x.id)));
  const minGroupStart = Math.min(...group.map(x => orig.get(x.id).start));
  const snapT = t => {
    if (!snapOn) return [t, false];
    const th = S.snapPx / pps; let best = null;
    for (const p of pts) if (Math.abs(p - t) < th && (best === null || Math.abs(p - t) < Math.abs(best - t))) best = p;
    return best === null ? [t, false] : [best, true];
  };
  const mv = ev => {
    if (!moved && Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return;
    moved = true; let st = null; const dx = (ev.clientX - x0) / pps;
    if (mode === 'move') {
      let ns = o.start + dx;
      const [s1, ok1] = snapT(ns), [e1, ok2] = snapT(ns + c.dur);
      if (ok1) { ns = s1; st = s1; } else if (ok2) { ns = e1 - c.dur; st = e1; }
      let delta = ns - o.start; delta = Math.max(delta, -minGroupStart);
      for (const x of group) { x.start = orig.get(x.id).start + delta; updateClipEl(x); }
      if (group.length === 1) {
        const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.trow');
        if (row && row.dataset.track) {
          const tr = track(row.dataset.track);
          if (tr && tr.kind === kindOf(c) && !tr.locked && tr.id !== c.trackId) { c.trackId = tr.id; row.querySelector('.lane').appendChild(el); }
        }
      }
    } else if (mode === 'l') {
      let ns = o.start + dx; const [s1, ok] = snapT(ns); if (ok) { ns = s1; st = s1; }
      const minStart = isAV(c) ? Math.max(0, o.start - o.in / c.speed) : 0;
      ns = clamp(ns, minStart, o.start + o.dur - 0.1);
      const d = ns - o.start; c.start = ns; c.dur = o.dur - d; if (isAV(c)) c.in = Math.max(0, o.in + d * c.speed);
      c.kf = deepClone(o.kf); shiftKf(c, d);
      updateClipEl(c);
    } else {
      let ne = o.start + o.dur + dx; const [e1, ok] = snapT(ne); if (ok) { ne = e1; st = e1; }
      c.dur = clamp(ne - o.start, 0.1, isAV(c) ? (maxSrc - o.in) / c.speed : 1e6);
      updateClipEl(c);
    }
    showSnap(st); requestDraw();
  };
  const up = () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); showSnap(null);
    if (!moved) return;
    if (mode === 'move') group.forEach(resolveOverlap);
    commit(before, mode === 'move' ? (group.length > 1 ? `${group.length} clips verplaatst` : 'Clip verplaatst') : 'Clip getrimd');
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}
function overlaps(c, trackId) {
  return P.clips.some(o => o.id !== c.id && o.trackId === trackId && o.start < c.start + c.dur - 1e-4 && c.start < o.start + o.dur - 1e-4);
}
function newTrack(kind, atIndex) {
  const n = P.tracks.filter(t => t.kind === kind).length + 1;
  const tr = mkTrack(kind, (kind === 'visual' ? 'Video ' : 'Audio ') + n);
  if (atIndex == null) { if (kind === 'visual') P.tracks.unshift(tr); else P.tracks.push(tr); }
  else P.tracks.splice(atIndex, 0, tr);
  return tr;
}
function resolveOverlap(c) {
  if (!overlaps(c, c.trackId)) return;
  const kind = kindOf(c), idx = P.tracks.findIndex(t => t.id === c.trackId);
  const cand = P.tracks.filter(t => t.kind === kind && !t.locked && t.id !== c.trackId)
    .sort((a, b) => Math.abs(P.tracks.indexOf(a) - idx) - Math.abs(P.tracks.indexOf(b) - idx));
  const free = cand.find(t => !overlaps(c, t.id));
  if (free) { c.trackId = free.id; toast('Clip verplaatst naar ' + free.name + ' (overlap)'); }
  else { const tr = newTrack(kind, kind === 'visual' ? idx : idx + 1); c.trackId = tr.id; toast('Nieuwe track gemaakt (overlap)'); }
}
function addClip(c, trackId) {
  const kind = kindOf(c);
  let tr = trackId ? track(trackId) : null;
  if (!tr || tr.kind !== kind || tr.locked || overlaps(c, tr.id)) {
    let list = P.tracks.filter(t => t.kind === kind && !t.locked);
    if (kind === 'visual' && (isMediaVis(c) || c.type === 'color')) list = list.reverse();
    tr = list.find(t => !overlaps(c, t.id)) || newTrack(kind);
  }
  c.trackId = tr.id; P.clips.push(c); return c;
}
function mainTrack(kind) { const l = P.tracks.filter(t => t.kind === kind && !t.locked); return kind === 'visual' ? l[l.length - 1] : l[0]; }
function trackEnd(trId) { return P.clips.filter(c => c.trackId === trId).reduce((m, c) => Math.max(m, c.start + c.dur), 0); }
tracksEl.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, trId = b.closest('.thead')?.dataset.track, tr = trId && track(trId);
  if (act === 'addv') return edit(() => newTrack('visual'), 'Track toegevoegd');
  if (act === 'adda') return edit(() => newTrack('audio'), 'Track toegevoegd');
  if (!tr || act === 'tvol' || act === 'rename') return;
  edit(() => {
    const i = P.tracks.indexOf(tr);
    if (act === 'hide') tr.hidden = !tr.hidden;
    if (act === 'mute') tr.muted = !tr.muted;
    if (act === 'solo') tr.solo = !tr.solo;
    if (act === 'lock') tr.locked = !tr.locked;
    if (act === 'voice') { tr.voice = !tr.voice; if (tr.voice) tr.duck = false; toast(tr.voice ? 'Spraaktrack: andere tracks met 🦆 worden zachter als hier gesproken wordt' : 'Spraaktrack uit'); }
    if (act === 'duck') { tr.duck = !tr.duck; if (tr.duck) tr.voice = false; if (tr.duck && !P.tracks.some(t => t.voice)) toast('Markeer ook een spraaktrack met 🎙'); }
    if (act === 'up' && i > 0) { P.tracks.splice(i, 1); P.tracks.splice(i - 1, 0, tr); }
    if (act === 'down' && i < P.tracks.length - 1) { P.tracks.splice(i, 1); P.tracks.splice(i + 1, 0, tr); }
    if (act === 'deltrack') {
      const n = P.clips.filter(c => c.trackId === tr.id).length;
      if (n && !confirm(`Track "${tr.name}" met ${n} clip(s) verwijderen?`)) return;
      P.clips = P.clips.filter(c => c.trackId !== tr.id); P.tracks.splice(i, 1);
      for (const id of [...selSet]) if (!clipById(id)) selSet.delete(id); if (sel && !clipById(sel)) sel = null; cleanupEls();
    }
  }, 'Track aangepast');
});
tracksEl.addEventListener('dblclick', e => {
  const b = e.target.closest('[data-act="rename"]'); if (!b) return;
  const tr = track(b.closest('.thead').dataset.track); const n = prompt('Naam van de track:', tr.name);
  if (n) edit(() => { tr.name = n; }, 'Track hernoemd');
});
tracksEl.addEventListener('input', e => {
  if (e.target.dataset.act !== 'tvol') return;
  const tr = track(e.target.closest('.thead').dataset.track); if (!pend) pend = snap(); tr.vol = +e.target.value; requestDraw();
});
tracksEl.addEventListener('change', e => { if (e.target.dataset.act === 'tvol' && pend) { const b = pend; pend = null; commit(b, 'Trackvolume'); } });
tracksEl.addEventListener('dragover', e => {
  const lane = e.target.closest('.lane'); if (!lane) return; e.preventDefault();
  $$('.lane.dragover').forEach(l => l.classList.remove('dragover')); lane.classList.add('dragover');
});
tracksEl.addEventListener('dragleave', e => { e.target.closest?.('.lane')?.classList.remove('dragover'); });
tracksEl.addEventListener('drop', async e => {
  const lane = e.target.closest('.lane'); if (!lane) return; e.preventDefault(); e.stopPropagation();
  $$('.lane.dragover').forEach(l => l.classList.remove('dragover')); $('#dropOverlay').classList.add('hidden');
  const t = timeFromClientX(e.clientX), trId = lane.dataset.track;
  const key = e.dataTransfer.getData('text/plain');
  let toAdd = [];
  if (key && key.startsWith('kn:')) { const c = await makeFromKey(key.slice(3)); if (c) toAdd.push(c); }
  else if (key && key.startsWith('fx:')) { const ce = e.target.closest('.clip'); if (ce) addFxTo(clipById(ce.dataset.id), key.slice(3)); return; }
  else if (e.dataTransfer.files.length) { const ms = await importFiles(e.dataTransfer.files); toAdd = ms.map(clipFromMedia); }
  if (!toAdd.length) return;
  edit(() => {
    let cur = t;
    for (const c of toAdd) { c.start = cur; cur += c.dur; if (trId === 'new') addClip(c, newTrack(kindOf(c)).id); else addClip(c, trId); }
    selectMany(toAdd.map(c => c.id));
  }, 'Toegevoegd aan tijdlijn');
});
tlScroll.addEventListener('wheel', e => {
  if (!e.ctrlKey) {
    // op de tijdbalk: scrollwiel én horizontaal swipen (touchpad) schuiven de tijdlijn links/rechts
    if (!e.target.closest('.ruler')) return;
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    tlScroll.scrollLeft += d * (e.deltaMode === 1 ? 30 : e.deltaMode === 2 ? tlScroll.clientWidth : 1);
    return;
  }
  e.preventDefault();
  const t = timeFromClientX(e.clientX), r = tlScroll.getBoundingClientRect();
  setZoom(pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  tlScroll.scrollLeft = t * pps - (e.clientX - r.left - HEAD);
}, { passive: false });
tlScroll.addEventListener('contextmenu', e => {
  const ce = e.target.closest('.clip');
  if (e.target.closest('.ruler')) {
    const t = timeFromClientX(e.clientX), mk = P.markers.find(m => Math.abs(m.t - t) * pps < 7);
    e.preventDefault();
    const items = [];
    if (mk) items.push(['📍 Hernoemen: ' + (mk.label || 'markering'), () => { const n = prompt('Label:', mk.label || ''); if (n != null) edit(() => mk.label = n, 'Markering hernoemd'); }], ['🗑 Markering verwijderen', () => edit(() => P.markers = P.markers.filter(x => x !== mk), 'Markering verwijderd')]);
    items.push(['📍 Markering hier', () => { setPlayhead(t); actMarker(); }]);
    if (P.markers.some(m => m.beat)) items.push(['🥁 Alle beat-markeringen wissen', () => edit(() => P.markers = P.markers.filter(m => !m.beat), 'Beats gewist')]);
    showCtx(e.clientX, e.clientY, items);
    return;
  }
  if (!ce) return; e.preventDefault();
  const c = clipById(ce.dataset.id); if (!selSet.has(c.id)) select(c.id);
  showCtx(e.clientX, e.clientY, clipMenu(c));
});
function setZoom(v) { pps = clamp(v, 4, 900); $('#zoom').value = Math.round(Math.log(pps / 4) / Math.log(225) * 100); renderTimeline(); }
