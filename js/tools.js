'use strict';
/* =====================================================================
   Tools: video scopes, command palette, settings & themes,
   slideshow generator, built-in self tests.
   ===================================================================== */

/* ---------------- scopes: histogram / waveform / vectorscope ---------------- */
const scopeSrc = document.createElement('canvas'); scopeSrc.width = 160; scopeSrc.height = 90;
const scopeG = scopeSrc.getContext('2d', { willReadFrequently: true });
function drawScopes() {
  const sc = $('#scope'); sc.classList.toggle('hidden', S.scopes === 'none'); if (S.scopes === 'none') return;
  const g = sc.getContext('2d'), W = sc.width, H = sc.height;
  scopeG.drawImage(cv, 0, 0, 160, 90); const d = scopeG.getImageData(0, 0, 160, 90).data;
  g.globalCompositeOperation = 'source-over'; g.fillStyle = 'rgba(8,8,12,.92)'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#9a9ab0'; g.font = '10px Segoe UI'; g.fillText({ hist: 'Histogram', wave: 'Golfvorm (luma)', vector: 'Vectorscoop', parade: 'RGB-parade' }[S.scopes], 6, 12);
  g.globalCompositeOperation = 'lighter';
  if (S.scopes === 'hist') {
    const hs = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    for (let i = 0; i < d.length; i += 4) { hs[0][d[i]]++; hs[1][d[i + 1]]++; hs[2][d[i + 2]]++; }
    const mx = Math.max(...hs.map(a => Math.max(...a.slice(2, 254)))) || 1;
    ['rgba(255,70,70,.8)', 'rgba(70,255,120,.8)', 'rgba(80,140,255,.8)'].forEach((col, ch) => { g.fillStyle = col; for (let x = 0; x < 256; x++) { const bh = Math.min(1, hs[ch][x] / mx) * (H - 18); g.fillRect(x * W / 256, H - bh, W / 256 + .5, bh); } });
  } else if (S.scopes === 'wave' || S.scopes === 'parade') {
    const parade = S.scopes === 'parade';
    for (let y = 0; y < 90; y++) for (let x = 0; x < 160; x++) {
      const i = (y * 160 + x) * 4;
      if (parade) { for (let ch = 0; ch < 3; ch++) { g.fillStyle = ['rgba(255,60,60,.25)', 'rgba(60,255,100,.25)', 'rgba(70,130,255,.25)'][ch]; g.fillRect(ch * W / 3 + x * W / 480, H - 4 - d[i + ch] / 255 * (H - 20), 1.2, 1.2); } }
      else { const l = .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]; g.fillStyle = 'rgba(120,255,160,.25)'; g.fillRect(x * W / 160, H - 4 - l / 255 * (H - 20), 1.4, 1.4); }
    }
  } else if (S.scopes === 'vector') {
    const cx = W / 2, cy = H / 2 + 6, R = Math.min(W, H) / 2 - 12;
    g.strokeStyle = 'rgba(255,255,255,.2)'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
    g.fillStyle = 'rgba(255,220,120,.35)';
    for (let i = 0; i < d.length; i += 8) { const r = d[i], gg = d[i + 1], b = d[i + 2]; const cb = (-0.169 * r - 0.331 * gg + 0.5 * b) / 128, cr = (0.5 * r - 0.419 * gg - 0.081 * b) / 128; g.fillRect(cx + cb * R, cy - cr * R, 1.4, 1.4); }
  }
  g.globalCompositeOperation = 'source-over';
}

/* ---------------- command palette (Ctrl+K) ---------------- */
function commands() {
  const c = sel && clipById(sel);
  const list = [
    ['Afspelen / pauzeren', 'Spatie', togglePlay], ['Splitsen op afspeelkop', 'S', actSplit], ['Verwijderen', 'Del', actDelete], ['Ripple-verwijderen', 'Shift+Del', actRipple],
    ['Dupliceren', 'Ctrl+D', actDup], ['Kopiëren', 'Ctrl+C', actCopy], ['Plakken', 'Ctrl+V', actPaste], ['Ongedaan maken', 'Ctrl+Z', undo], ['Opnieuw', 'Ctrl+Y', redo],
    ['Markering toevoegen', 'M', actMarker], ['Naar volgende markering', ']', () => jumpMarker(1)], ['Naar vorige markering', '[', () => jumpMarker(-1)],
    ['Alles selecteren', 'Ctrl+A', () => selectMany(P.clips.map(x => x.id))], ['Selectie opheffen', 'Esc', () => select(null)],
    ['Exporteren…', 'Ctrl+E', openExport], ['Project opslaan (JSON)', 'Ctrl+S', saveProjectFile], ['Projectpakket exporteren (.ksp)', '', () => { exType = 'pkg'; openExport(); }], ['GIF exporteren', '', () => { exType = 'gif'; openExport(); }], ['Audio exporteren als WAV', '', () => { exType = 'wav'; openExport(); }],
    ['Project openen', 'Ctrl+O', () => $('#projIn').click()], ['Media importeren', 'I', () => $('#fileIn').click()], ['Nieuw project', '', newProj],
    ['Momentopname (PNG)', '', actSnapshot], ['Instellingen', '', openSettings], ['Sneltoetsen tonen', '?', () => $('#helpModal').classList.remove('hidden')], ['Zelftest uitvoeren', '', runSelfTests],
    ['Diavoorstelling maken', '', openSlideshow], ['Versie bewaren', '', saveVersion], ['Geschiedenis tonen', '', () => showPanel('history')],
    ['Herhalen aan/uit', 'L', () => $('#tLoop').click()], ['Uitlijnen (snap) aan/uit', '', () => $('#aSnap').click()], ['Ripple-modus aan/uit', '', () => { S.rippleMode = !S.rippleMode; saveSettings(); toast('Ripple-modus ' + (S.rippleMode ? 'aan' : 'uit')); }],
    ['Raster (derden) aan/uit', '', () => { S.thirds = !S.thirds; saveSettings(); requestDraw(); }], ['Veilige zones aan/uit', '', () => { S.safe = !S.safe; saveSettings(); requestDraw(); }],
    ['Scopes: histogram', '', () => setScopes('hist')], ['Scopes: golfvorm', '', () => setScopes('wave')], ['Scopes: RGB-parade', '', () => setScopes('parade')], ['Scopes: vectorscoop', '', () => setScopes('vector')], ['Scopes uit', '', () => setScopes('none')],
    ['Track toevoegen (video)', '', () => edit(() => newTrack('visual'), 'Track toegevoegd')], ['Track toevoegen (audio)', '', () => edit(() => newTrack('audio'), 'Track toegevoegd')],
    ['Inzoomen tijdlijn', '+', () => setZoom(pps * 1.3)], ['Uitzoomen tijdlijn', '-', () => setZoom(pps / 1.3)], ['Tijdlijn passend', '', () => $('#zFit').click()],
    ['Knippen op beats', '', actCutOnBeats], ['Clips achter elkaar zetten', '', actSequence], ['Fade-overgangen op selectie', '', actCrossfadeAll],
    ['Aanpassingslaag toevoegen', '', () => addAtPlayhead(adjustClip({}))], ['Tekst toevoegen', 'T', () => addAtPlayhead(textClip({}))], ['Confetti toevoegen', '', () => addAtPlayhead(particlesClip({ pkind: 'confetti' }))], ['Audiovisualizer toevoegen', '', () => addAtPlayhead(vizClip({}))],
    ...Object.keys(PANELS).map(k => ['Paneel: ' + $(`#side button[data-panel="${k}"]`)?.textContent.trim(), '', () => showPanel(k)]),
    ...Object.values(FX).map(f => [`Effect toevoegen: ${f.name}`, '', () => addFxTo(sel && clipById(sel), f.key)]),
    ...TRANS.slice(1).map(t => [`Overgang (in): ${t[1]}`, '', () => { const l = selectedClips().filter(x => kindOf(x) === 'visual'); if (l.length) edit(() => l.forEach(x => x.tin = { type: t[0], dur: S.transDur }), 'Overgang'); }]),
    ...Object.keys(PRESETS).map(p => [`Filter: ${p}`, '', () => selectedClips().filter(x => kindOf(x) === 'visual').forEach(x => applyPreset(x, PRESETS[p]))]),
  ];
  if (c && isAV(c)) list.push(['Stiltes wegknippen', '', () => actSilence(c)], ['Beats detecteren', '', () => actBeats(c)], ['Volume normaliseren', '', () => actNormalize(c)]);
  if (c && c.type === 'video') list.push(['Scènes detecteren', '', () => actScenes(c)], ['Freeze frame', '', () => actFreeze(c)], ['Audio loskoppelen', '', () => actDetach(c)]);
  if (c) list.push(...Object.keys(KF_PRESETS).map(k => [`Beweging: ${k}`, '', () => edit(() => KF_PRESETS[k](c), 'Beweging')]));
  return list;
}
function fuzzy(q, s) {
  q = q.toLowerCase(); s = s.toLowerCase(); if (!q) return 1;
  if (s.includes(q)) return 100 - s.indexOf(q);
  let i = 0, score = 0; for (const ch of s) { if (ch === q[i]) { i++; score++; } if (i === q.length) return score; }
  return 0;
}
let palSel = 0, palItems = [];
function openPalette() {
  $('#palModal').classList.remove('hidden'); const inp = $('#palIn'); inp.value = ''; palSel = 0; renderPalette(); inp.focus();
}
function renderPalette() {
  const q = $('#palIn').value; palItems = commands().map(c => ({ c, s: fuzzy(q, c[0]) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 14).map(x => x.c);
  palSel = clamp(palSel, 0, Math.max(0, palItems.length - 1));
  $('#palList').innerHTML = palItems.map((c, i) => `<div class="pi${i === palSel ? ' on' : ''}" data-i="${i}"><span>${esc(c[0])}</span>${c[1] ? `<span class="kbd">${c[1]}</span>` : ''}</div>`).join('') || '<div class="hint">Niets gevonden</div>';
}
function runPalette(i) { const c = palItems[i]; $('#palModal').classList.add('hidden'); if (c) setTimeout(() => c[2](), 10); }
$('#palIn').addEventListener('input', () => { palSel = 0; renderPalette(); });
$('#palIn').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { palSel++; renderPalette(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { palSel--; renderPalette(); e.preventDefault(); }
  else if (e.key === 'Enter') runPalette(palSel);
  else if (e.key === 'Escape') $('#palModal').classList.add('hidden');
});
$('#palList').addEventListener('click', e => { const it = e.target.closest('.pi'); if (it) runPalette(+it.dataset.i); });
$('#palModal').addEventListener('pointerdown', e => { if (e.target.id === 'palModal') $('#palModal').classList.add('hidden'); });

/* ---------------- settings & themes ---------------- */
const THEMES = {
  dark: { '--bg': '#0e0e13', '--panel': '#16161e', '--panel2': '#1d1d27', '--panel3': '#262633', '--line': '#2c2c3a', '--text': '#ececf3', '--muted': '#9a9ab0' },
  midnight: { '--bg': '#070b16', '--panel': '#0d1424', '--panel2': '#121b30', '--panel3': '#1a2540', '--line': '#24314f', '--text': '#e6ecff', '--muted': '#8b98bd' },
  ocean: { '--bg': '#061517', '--panel': '#0b2024', '--panel2': '#0f2a2f', '--panel3': '#16383e', '--line': '#1f4a51', '--text': '#e3fbf8', '--muted': '#86b5b0' },
  light: { '--bg': '#e9e9f0', '--panel': '#f7f7fb', '--panel2': '#ffffff', '--panel3': '#ececf3', '--line': '#d6d6e2', '--text': '#1b1b26', '--muted': '#6a6a80' },
  contrast: { '--bg': '#000000', '--panel': '#000000', '--panel2': '#0a0a0a', '--panel3': '#1a1a1a', '--line': '#ffffff', '--text': '#ffffff', '--muted': '#dddddd' },
};
function applyTheme() {
  const root = document.documentElement, t = THEMES[S.theme] || THEMES.dark;
  for (const [k, v] of Object.entries(t)) root.style.setProperty(k, v);
  root.style.setProperty('--accent', S.accent); root.dataset.theme = S.theme;
}
function openSettings() {
  const b = $('#setBody'); b.innerHTML = '';
  const row = (label, html, on) => { const r = h('div', 'row', `<label>${label}</label>${html}`); b.append(r); const i = $('input,select', r); i.addEventListener(i.type === 'checkbox' ? 'change' : 'input', () => { on(i.type === 'checkbox' ? i.checked : i.value); saveSettings(); }); return r; };
  row('Thema', `<select>${Object.entries({ dark: 'Donker', midnight: 'Middernacht', ocean: 'Oceaan', light: 'Licht', contrast: 'Hoog contrast' }).map(([k, n]) => `<option value="${k}" ${S.theme === k ? 'selected' : ''}>${n}</option>`).join('')}</select>`, v => { S.theme = v; applyTheme(); drawRuler(); });
  row('Accentkleur', `<input type="color" value="${S.accent}">`, v => { S.accent = v; applyTheme(); });
  row('Voorbeeldkwaliteit', `<select>${[[1080, 'Volledig (1080p)'], [720, 'Hoog (720p)'], [480, 'Half (480p)'], [270, 'Snel (270p)']].map(([v, n]) => `<option value="${v}" ${+S.quality === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`, v => { S.quality = +v; ensureCanvasDims(); });
  row('Standaardduur foto’s', `<input type="number" min="0.5" max="60" step="0.5" value="${S.imgDur}">`, v => S.imgDur = +v || 5);
  row('Uitlijn-afstand (px)', `<input type="number" min="0" max="40" step="1" value="${S.snapPx}">`, v => S.snapPx = +v);
  row('Golfvormen tonen', `<input type="checkbox" ${S.waveforms ? 'checked' : ''}>`, v => { S.waveforms = v; renderTimeline(); });
  row('Ripple-modus (Delete dicht gaten)', `<input type="checkbox" ${S.rippleMode ? 'checked' : ''}>`, v => S.rippleMode = v);
  row('Automatisch opslaan', `<input type="checkbox" ${S.autosave ? 'checked' : ''}>`, v => S.autosave = v);
  b.append(h('p', 'hint', `WebGL: ${GL.available() ? '✅ beschikbaar' : '❌ niet beschikbaar'} · Analyse-worker: ${analysis.kind() === 'worker' ? '✅ Web Worker' : '⚠ hoofdthread'} · MP4-opname: ${videoFormats().some(f => f[2] === 'mp4') ? '✅' : '❌'} · Gezichtsdetectie: ${FACE.status} · Versie ${KS_VERSION}`));
  $('#setModal').classList.remove('hidden');
}

/* ---------------- slideshow generator ---------------- */
function openSlideshow() {
  const imgs = [...media.values()].filter(m => m.type === 'image' && !m.missing), music = [...media.values()].filter(m => m.type === 'audio' && !m.missing);
  if (!imgs.length) return toast('Importeer eerst een paar foto’s');
  const b = $('#ssBody'); b.innerHTML = '';
  const grid = h('div', 'ssgrid'); imgs.forEach(m => grid.append(h('label', 'ssi', `<input type="checkbox" checked value="${m.id}"><img src="${m.thumb}"><span>${esc(m.name)}</span>`))); b.append(grid);
  b.append(h('div', 'row', `<label>Duur per foto</label><input id="ssDur" type="number" min="0.5" step="0.5" value="3"> s`));
  b.append(h('div', 'row', `<label>Overgang</label><select id="ssTr">${TRANS.map(t => `<option value="${t[0]}" ${t[0] === 'fade' ? 'selected' : ''}>${t[1]}</option>`).join('')}<option value="random">🎲 Willekeurig</option></select>`));
  b.append(h('label', 'chk', '<input id="ssKb" type="checkbox" checked> Ken Burns-beweging (langzaam in-/uitzoomen)'));
  b.append(h('label', 'chk', '<input id="ssFill" type="checkbox" checked> Vervaagde achtergrond bij afwijkende verhouding'));
  b.append(h('div', 'row', `<label>Muziek</label><select id="ssMusic"><option value="">Geen</option>${music.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}${SOUNDS.filter(s => s.cat === 'Muziek').map(s => `<option value="snd:${s.k}">🎵 ${s.n}</option>`).join('')}</select>`));
  b.append(h('label', 'chk', '<input id="ssBeat" type="checkbox"> Wissel op de beat (beatdetectie)'));
  b.append(h('div', 'row', `<label>Titel</label><input id="ssTitle" type="text" placeholder="(optioneel)">`));
  $('#ssModal').classList.remove('hidden');
}
async function buildSlideshow() {
  const ids = $$('#ssBody .ssi input:checked').map(i => i.value); if (!ids.length) return toast('Kies minstens één foto');
  const dur = +$('#ssDur').value || 3, tr = $('#ssTr').value, kb = $('#ssKb').checked, fill = $('#ssFill').checked, mv = $('#ssMusic').value, title = $('#ssTitle').value.trim();
  $('#ssModal').classList.add('hidden');
  let musicClip = null;
  if (mv) musicClip = mv.startsWith('snd:') ? await soundClip(SOUNDS.find(s => s.k === mv.slice(4))) : clipFromMedia(media.get(mv));
  let cuts = null;
  if (musicClip && $('#ssBeat').checked) {
    const m = media.get(musicClip.mediaId);
    if (m && m.peaks) { const r = await analysis({ op: 'beats', peaks: m.peaks, from: 0, to: m.duration, sens: 1.6, minGap: Math.max(.4, dur * .6) }); cuts = r.onsets; }
  }
  const t0 = playhead, keys = TRANS.slice(1).map(t => t[0]);
  edit(() => {
    const track_ = newTrack('visual', P.tracks.findIndex(t => t.kind === 'visual' && t === mainTrack('visual')) + 1); track_.name = 'Diavoorstelling';
    let cur = t0; const ids2 = [];
    ids.forEach((id, i) => {
      let d = dur;
      if (cuts && cuts.length) { const next = cuts.find(t => t > cur - t0 + dur * .6); if (next) d = Math.max(.5, next - (cur - t0)); }
      const c = clipFromMedia(media.get(id)); c.start = cur; c.dur = d; c.bgFill = fill; c.anim = kb ? (i % 2 ? 'kb-out' : 'kb-in') : 'none';
      const type = tr === 'random' ? keys[Math.floor(Math.random() * keys.length)] : tr;
      if (i > 0 && type !== 'none') c.tin = { type, dur: Math.min(.8, d / 3) };
      c.trackId = track_.id; P.clips.push(c); ids2.push(c.id); cur += d;
    });
    if (title) { const tc = textClip({ text: title, size: 100, tanim: 'pop', start: t0, dur: Math.min(4, cur - t0), glow: false }); addClip(tc); }
    if (musicClip) { musicClip.start = t0; musicClip.dur = Math.min(musicClip.dur, cur - t0); musicClip.fadeOut = Math.min(2, musicClip.dur / 3); addClip(musicClip); }
    selectMany(ids2);
  }, 'Diavoorstelling');
  toast(`Diavoorstelling met ${ids.length} foto’s gemaakt`);
}
$('#ssGo').onclick = buildSlideshow;
function setScopes(v) { S.scopes = v; saveSettings(); $('#scope').classList.toggle('hidden', v === 'none'); $('#tScope').classList.toggle('on', v !== 'none'); requestDraw(); }

/* ---------------- self tests ---------------- */
async function runSelfTests() {
  const res = []; const t = async (name, fn) => { try { const r = await fn(); res.push([true, name, r === true || r == null ? '' : String(r)]); } catch (e) { res.push([false, name, e.message]); } };
  const eq = (a, b, msg) => { if (Math.abs(a - b) > 1e-6) throw new Error(`${msg || ''} verwacht ${b}, kreeg ${a}`); };
  const saved = snap(), savedU = undoStack.length;
  await t('Keyframe-interpolatie (lineair)', () => { const c = baseClip('shape'); setKf(c, 'x', 0, 0, 'linear'); setKf(c, 'x', 2, 1); eq(A(c, 'x', 1), .5); eq(A(c, 'x', 5), 1); eq(A(c, 'x', -1), 0); });
  await t('Keyframe hold-easing', () => { const c = baseClip('shape'); setKf(c, 'x', 0, 0, 'hold'); setKf(c, 'x', 1, 1); eq(A(c, 'x', .99), 0); });
  await t('Clip splitsen behoudt bronpositie', () => { const c = baseClip('video', { start: 2, dur: 4, in: 1, speed: 2 }); P.clips.push(c); const b = splitAt(c, 3); P.clips = P.clips.filter(x => x !== c && x !== b); eq(c.dur, 1); eq(b.start, 3); eq(b.in, 3); eq(b.dur, 3); });
  await t('Keyframes verschuiven bij splitsen', () => { const c = baseClip('shape', { start: 0, dur: 4 }); setKf(c, 'x', 3, .9); P.clips.push(c); const b = splitAt(c, 2); P.clips = P.clips.filter(x => x !== c && x !== b); eq(b.kf.x[0].t, 1); });
  await t('Overlapdetectie', () => { const tr = P.tracks[0].id, a = baseClip('shape', { start: 0, dur: 2, trackId: tr }), b = baseClip('shape', { start: 1.5, dur: 2, trackId: tr }); P.clips.push(a); const r = overlaps(b, tr); P.clips = P.clips.filter(x => x !== a); if (!r) throw new Error('overlap gemist'); });
  await t('SRT parser', () => { const r = parseSRT('1\n00:00:01,500 --> 00:00:03,000\nHallo\n\n2\n00:01:00.000 --> 00:01:02.250\nDoei <i>daar</i>\n'); eq(r.length, 2); eq(r[0].s, 1.5); eq(r[1].e, 62.25); if (r[1].t !== 'Doei daar') throw new Error(r[1].t); });
  await t('SRT export ↔ import round-trip', () => { const r = parseSRT(srtText([{ start: 1.25, dur: 2, text: 'Test' }])); eq(r[0].s, 1.25); eq(r[0].e, 3.25); });
  await t('CRC32 (bekende waarde)', () => { eq(crc32(new TextEncoder().encode('123456789')), 0xCBF43926); });
  await t('ZIP schrijven en lezen', async () => { const z = await zipStore([{ name: 'a.txt', blob: new Blob(['hallo']) }, { name: 'map/b.txt', blob: new Blob(['wereld!']) }]); const m = await unzip(z); if (await m.get('map/b.txt').text() !== 'wereld!') throw new Error('inhoud klopt niet'); return `${z.size} bytes`; });
  await t('WAV-encoder header', async () => { const oc = new OfflineAudioContext(2, 441, 44100), ab = oc.createBuffer(2, 441, 44100); const b = wavBlob(ab), dv = new DataView(await b.arrayBuffer()); eq(dv.getUint32(24, true), 44100); eq(b.size, 44 + 441 * 4); });
  await t('Analyse-worker: piekdetectie', async () => { const a = new Float32Array(4410); a[2000] = .8; const p = await analysis({ op: 'peaks', chs: [a.buffer], sr: 44100 }); eq(p.length, 10); if (Math.abs(p[4] - .8) > 1e-6 && Math.abs(p[5] - .8) > 1e-6) throw new Error('piek niet gevonden'); return analysis.kind(); });
  await t('Analyse-worker: beatdetectie', async () => { const p = new Float32Array(1000); for (let i = 0; i < 1000; i += 50) p[i] = 1; const r = await analysis({ op: 'beats', peaks: p, from: 0, to: 10, sens: 1.5, minGap: .2 }); if (r.onsets.length < 15) throw new Error(r.onsets.length + ' beats'); return `${r.onsets.length} beats, ${r.bpm} BPM`; });
  await t('GIF-encoder (worker)', async () => { const enc = createRpc(gifWorker); await enc({ op: 'start', w: 8, h: 8, dither: true }); const px = new Uint8ClampedArray(256); for (let i = 0; i < 256; i += 4) { px[i] = i; px[i + 3] = 255; } await enc({ op: 'frame', buf: px.buffer, delay: 10 }); const out = await enc({ op: 'finish' }); const img = new Image(); img.src = URL.createObjectURL(new Blob([out], { type: 'image/gif' })); await img.decode(); eq(img.naturalWidth, 8); return `${out.length} bytes, decodeerbaar`; });
  await t('WebGL-shaders compileren', () => { if (!GL.available()) return 'overgeslagen (geen WebGL)'; const k = document.createElement('canvas'); k.width = 4; k.height = 4; let n = 0; for (const f of Object.values(FX)) { if (!GL.run(k, 4, 4, [{ key: 'fx:' + f.key, frag: f.frag, u: fxUniforms(f.key, fxDefaults(f.key)) }], 0)) throw new Error(f.name); n++; } for (const [k2, fr] of Object.entries(FX_BUILTIN)) if (!GL.run(k, 4, 4, [{ key: 'b:' + k2, frag: fr, u: {} }], 0)) throw new Error(k2); return n + ' effecten OK'; });
  await t('Gezichtskaders samenvoegen', () => { const r = mergeBoxes([{ x: .1, y: .1, w: .2, h: .2 }, { x: .15, y: .12, w: .2, h: .2 }, { x: .7, y: .7, w: .1, h: .1 }]); eq(r.length, 2); eq(r[0].x, .1); eq(+(r[0].w).toFixed(4), .25); });
  await t('Gezichtsdetector geladen', async () => { const ok = await faceReady(15000); if (!ok) throw new Error(FACE.err || 'niet geladen'); return 'MediaPipe BlazeFace'; });
  await t('Undo/redo', () => { const b = snap(); edit(() => P.name = '__test__', 'test'); undo(); if (P.name === '__test__') throw new Error('undo werkte niet'); redo(); if (P.name !== '__test__') throw new Error('redo werkte niet'); undo(); });
  await t('Compositor rendert alle cliptypes', () => { const types = [textClip({ tanim: 'wave' }), shapeClip({ shape: 'star' }), colorClip({ grad: true }), particlesClip({ pkind: 'fireworks' }), vizClip({}), adjustClip({ fx: [{ id: 'a', type: 'glitch', on: true, p: fxDefaults('glitch') }] })]; types.forEach(c => { c.mask.type = 'ellipse'; drawClip(c, 1, cv.width, cv.height); }); requestDraw(); return types.length + ' types'; });
  P = JSON.parse(saved); while (undoStack.length > savedU) undoStack.pop(); redoStack.length = 0; changed();
  const ok = res.filter(r => r[0]).length;
  $('#testBody').innerHTML = `<p><b>${ok} / ${res.length} geslaagd</b></p>` + res.map(([p, n, i]) => `<div class="trs ${p ? 'ok' : 'bad'}">${p ? '✅' : '❌'} ${esc(n)} <span class="muted">${esc(i)}</span></div>`).join('');
  $('#testModal').classList.remove('hidden');
  return res;
}
