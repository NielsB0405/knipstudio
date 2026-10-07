'use strict';
/* =====================================================================
   Export & persistence
   - realtime video (MediaRecorder, MP4/WebM)
   - offline frame-accurate rendering → GIF (own LZW encoder in a Worker)
     and PNG sequence (own ZIP writer)
   - offline audio mixdown → WAV
   - project package (.ksp = ZIP with project.json + media)
   - IndexedDB autosave + named versions
   ===================================================================== */

/* ---------------- CRC32 + ZIP (store) writer / reader ---------------- */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8, crc = 0) { crc = crc ^ -1; for (let i = 0; i < u8.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ u8[i]) & 0xFF]; return (crc ^ -1) >>> 0; }
/** files: [{name, blob}] → Blob (ZIP, stored/uncompressed, UTF-8 names). */
async function zipStore(files, onProg) {
  const parts = [], central = []; let offset = 0;
  const enc = new TextEncoder(), now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (let i = 0; i < files.length; i++) {
    const f = files[i], name = enc.encode(f.name), size = f.blob.size;
    const crc = crc32(new Uint8Array(await f.blob.arrayBuffer()));
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, f.blob);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + size;
    onProg && onProg((i + 1) / files.length);
  }
  const cdSize = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
/** Read a stored ZIP without loading big entries into memory: returns Map(name → Blob slice). */
async function unzip(blob) {
  const tailLen = Math.min(blob.size, 65557), tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
  let eocd = -1; for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Geen geldig ZIP-bestand');
  const count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer()), dec = new TextDecoder(), out = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('Beschadigde ZIP');
    const method = cd.getUint16(p + 10, true), csize = cd.getUint32(p + 20, true), nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true), lho = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nl));
    if (method !== 0) throw new Error('Gecomprimeerde ZIP wordt niet ondersteund');
    const lh = new DataView(await blob.slice(lho, lho + 30).arrayBuffer()), start = lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    out.set(name, blob.slice(start, start + csize));
    p += 46 + nl + xl + cl;
  }
  return out;
}

/* ---------------- GIF encoder (runs in a Worker) ---------------- */
function gifWorker(self) {
  let W = 0, H = 0, bytes = null, len = 0, dither = true, frames = 0;
  const grow = n => { if (len + n <= bytes.length) return; const b = new Uint8Array(Math.max(bytes.length * 2, len + n)); b.set(bytes.subarray(0, len)); bytes = b; };
  const put = (...a) => { grow(a.length); for (const x of a) bytes[len++] = x; };
  const u16 = v => put(v & 255, (v >> 8) & 255);
  const str = s => { for (const ch of s) put(ch.charCodeAt(0)); };
  /** median-cut quantizer on a 15-bit (5:5:5) histogram */
  function quantize(px) {
    const hist = new Uint32Array(32768);
    for (let i = 0; i < px.length; i += 4) hist[((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3)]++;
    const colors = []; for (let i = 0; i < 32768; i++) if (hist[i]) colors.push(i);
    let boxes = [colors];
    while (boxes.length < 256) {
      let bi = -1, bestRange = 0, bestCh = 0;
      boxes.forEach((b, i) => {
        if (b.length < 2) return;
        for (let ch = 0; ch < 3; ch++) { let mn = 31, mx = 0; for (const c of b) { const v = (c >> (10 - ch * 5)) & 31; if (v < mn) mn = v; if (v > mx) mx = v; } if (mx - mn > bestRange) { bestRange = mx - mn; bi = i; bestCh = ch; } }
      });
      if (bi < 0) break;
      const b = boxes[bi], sh = 10 - bestCh * 5; b.sort((x, y) => ((x >> sh) & 31) - ((y >> sh) & 31));
      let total = 0; for (const c of b) total += hist[c]; let acc = 0, cut = 1;
      for (let i = 0; i < b.length - 1; i++) { acc += hist[b[i]]; if (acc >= total / 2) { cut = i + 1; break; } }
      boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
    }
    const pal = new Uint8Array(768);
    boxes.forEach((b, i) => { let r = 0, g = 0, bl = 0, n = 0; for (const c of b) { const w = hist[c]; r += ((c >> 10) & 31) * w; g += ((c >> 5) & 31) * w; bl += (c & 31) * w; n += w; } if (n) { pal[i * 3] = r / n * 8.2; pal[i * 3 + 1] = g / n * 8.2; pal[i * 3 + 2] = bl / n * 8.2; } });
    return { pal, n: boxes.length };
  }
  function nearestFactory(pal, n) {
    const cache = new Int16Array(32768).fill(-1);
    return (r, g, b) => {
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); let v = cache[key]; if (v >= 0) return v;
      let best = 1e9; for (let i = 0; i < n; i++) { const dr = pal[i * 3] - r, dg = pal[i * 3 + 1] - g, db = pal[i * 3 + 2] - b, d = dr * dr * 2 + dg * dg * 4 + db * db * 3; if (d < best) { best = d; v = i; } }
      cache[key] = v; return v;
    };
  }
  function lzw(idx, minCode) {
    const out = []; const clear = 1 << minCode, eoi = clear + 1;
    let codeSize = minCode + 1, next = eoi + 1, cur = 0, shift = 0, table = new Map();
    const emit = c => { cur |= c << shift; shift += codeSize; while (shift >= 8) { out.push(cur & 255); cur >>>= 8; shift -= 8; } };
    emit(clear);
    let prefix = idx[0];
    for (let i = 1; i < idx.length; i++) {
      const k = idx[i], key = (prefix << 8) | k, code = table.get(key);
      if (code !== undefined) { prefix = code; continue; }
      emit(prefix);
      if (next === 4096) { emit(clear); next = eoi + 1; codeSize = minCode + 1; table = new Map(); }
      else { if (next >= (1 << codeSize)) codeSize++; table.set(key, next++); }
      prefix = k;
    }
    emit(prefix); emit(eoi); if (shift > 0) out.push(cur & 255);
    return out;
  }
  self.onmessage = e => {
    const d = e.data;
    try {
      if (d.op === 'start') {
        W = d.w; H = d.h; dither = d.dither; bytes = new Uint8Array(1 << 20); len = 0; frames = 0;
        str('GIF89a'); u16(W); u16(H); put(0, 0, 0);
        put(0x21, 0xFF, 11); str('NETSCAPE2.0'); put(3, 1); u16(0); put(0);
        return self.postMessage({ id: d.id, res: true });
      }
      if (d.op === 'frame') {
        const px = new Uint8ClampedArray(d.buf), { pal, n } = quantize(px), near = nearestFactory(pal, n), idx = new Uint8Array(W * H);
        if (dither) {
          const err = new Float32Array(px.length); for (let i = 0; i < px.length; i++) err[i] = px[i];
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4, r = clamp8(err[i]), g = clamp8(err[i + 1]), b = clamp8(err[i + 2]), p = near(r, g, b); idx[y * W + x] = p;
            const er = r - pal[p * 3], eg = g - pal[p * 3 + 1], eb = b - pal[p * 3 + 2];
            const spread = (dx, dy, f) => { const xx = x + dx, yy = y + dy; if (xx < 0 || xx >= W || yy >= H) return; const j = (yy * W + xx) * 4; err[j] += er * f; err[j + 1] += eg * f; err[j + 2] += eb * f; };
            spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
          }
        } else for (let i = 0, j = 0; i < px.length; i += 4, j++) idx[j] = near(px[i], px[i + 1], px[i + 2]);
        put(0x21, 0xF9, 4, 0x04); u16(d.delay); put(0, 0);
        put(0x2C); u16(0); u16(0); u16(W); u16(H); put(0x87);
        grow(768); bytes.set(pal, len); len += 768;
        put(8); const data = lzw(idx, 8);
        for (let i = 0; i < data.length; i += 255) { const n2 = Math.min(255, data.length - i); grow(n2 + 1); bytes[len++] = n2; for (let k = 0; k < n2; k++) bytes[len++] = data[i + k]; }
        put(0); frames++;
        return self.postMessage({ id: d.id, res: frames });
      }
      if (d.op === 'finish') { put(0x3B); const out = bytes.slice(0, len); return self.postMessage({ id: d.id, res: out }, [out.buffer]); }
    } catch (err) { self.postMessage({ id: d.id, error: String(err && err.stack || err) }); }
    function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
  };
  function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
}

/* ---------------- export dialog ---------------- */
const EXPORT_TYPES = [
  { k: 'video', n: '🎬 Video (MP4/WebM)', d: 'Realtime opname, met audio. Beste kwaliteit.' },
  { k: 'gif', n: '🖼 Geanimeerde GIF', d: 'Frame-voor-frame gerenderd, eigen GIF-encoder in een Web Worker.' },
  { k: 'wav', n: '🎵 Audio (WAV, offline)', d: 'Exacte mixdown, sneller dan realtime.' },
  { k: 'audio', n: '🎧 Audio (WebM/M4A)', d: 'Gecomprimeerde audio, realtime.' },
  { k: 'png', n: '🗂 PNG-reeks (ZIP)', d: 'Elk frame als afbeelding in een ZIP-bestand.' },
  { k: 'frame', n: '📷 Huidig frame (PNG)', d: 'Momentopname in exportresolutie.' },
  { k: 'pkg', n: '📦 Projectpakket (.ksp)', d: 'Project + alle media in één bestand.' },
];
let exType = 'video';
function videoFormats() {
  const list = [
    ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'MP4 (H.264 + AAC)', 'mp4'], ['video/mp4;codecs=avc1,mp4a', 'MP4 (H.264)', 'mp4'], ['video/mp4', 'MP4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'WebM (VP9)', 'webm'], ['video/webm;codecs=vp8,opus', 'WebM (VP8)', 'webm'], ['video/webm', 'WebM', 'webm'],
  ].filter(f => window.MediaRecorder && MediaRecorder.isTypeSupported(f[0]));
  const seen = new Set(); return list.filter(f => { const k = f[2] + f[0].includes('vp9'); if (seen.has(k)) return false; seen.add(k); return true; });
}
function audioFormats() { return [['audio/webm;codecs=opus', 'WebM/Opus', 'weba'], ['audio/mp4', 'M4A (AAC)', 'm4a']].filter(f => window.MediaRecorder && MediaRecorder.isTypeSupported(f[0])); }
const EX_PRESETS = { 'YouTube 1080p': { res: 1080, fps: 30, q: 1.8, ratio: '16:9' }, 'TikTok / Reels': { res: 1080, fps: 30, q: 1.4, ratio: '9:16' }, 'Instagram (4:5)': { res: 1080, fps: 30, q: 1.4, ratio: '4:5' }, 'Snel concept 480p': { res: 480, fps: 24, q: .5 } };
function openExport() {
  if (!projectDur() && exType !== 'pkg') return toast('De tijdlijn is leeg');
  $('#exList').innerHTML = '';
  EXPORT_TYPES.forEach(t => { const b = h('div', 'extype' + (t.k === exType ? ' on' : ''), `<b>${t.n}</b><span>${t.d}</span>`); b.onclick = () => { exType = t.k; openExport(); }; $('#exList').append(b); });
  const o = $('#exOpts'); o.innerHTML = '';
  const row = (label, html) => { const r = h('div', 'row', `<label>${label}</label>${html}`); o.append(r); return r; };
  const res = `<select id="exRes"><option value="360">360p</option><option value="480">480p</option><option value="720">720p (HD)</option><option value="1080" selected>1080p (Full HD)</option><option value="1440">1440p (2K)</option><option value="2160">2160p (4K)</option></select>`;
  const range = `<select id="exRange"><option value="all">Hele project</option><option value="sel">Alleen selectie</option><option value="markers">Tussen eerste twee markeringen</option></select>`;
  if (exType === 'video') {
    const pr = row('Voorinstelling', `<select id="exPreset"><option value="">Eigen instellingen</option>${Object.keys(EX_PRESETS).map(k => `<option>${k}</option>`).join('')}</select>`);
    row('Resolutie', res); row('Framerate', `<select id="exFps"><option>24</option><option selected>30</option><option>60</option></select>`);
    row('Kwaliteit', `<select id="exQ"><option value="0.5">Klein bestand</option><option value="1" selected>Standaard</option><option value="1.8">Hoog</option><option value="3">Maximaal</option></select>`);
    row('Formaat', `<select id="exFmt">${videoFormats().map((f, i) => `<option value="${i}">${f[1]}</option>`).join('')}</select>`); row('Bereik', range);
    $('select', pr).onchange = e => { const p = EX_PRESETS[e.target.value]; if (!p) return; $('#exRes').value = p.res; $('#exFps').value = p.fps; $('#exQ').value = p.q; if (p.ratio && p.ratio !== P.ratio && confirm(`Beeldverhouding van het project naar ${p.ratio} zetten?`)) edit(() => P.ratio = p.ratio, 'Beeldverhouding'); };
    o.append(h('p', 'hint', 'Realtime: een video van 1 minuut duurt ±1 minuut. Houd dit tabblad zichtbaar.'));
  } else if (exType === 'gif') {
    row('Breedte', `<select id="exGW"><option>240</option><option>320</option><option selected>480</option><option>640</option><option>800</option></select>`);
    row('Framerate', `<select id="exFps"><option>8</option><option>10</option><option selected>15</option><option>20</option><option>25</option></select>`);
    row('Dithering', `<select id="exDither"><option value="1" selected>Aan (vloeiender kleuren)</option><option value="0">Uit (kleiner bestand)</option></select>`); row('Bereik', range);
    o.append(h('p', 'hint', 'Tip: GIF’s worden snel groot. Houd ze kort (< 15 s). Er zit geen geluid in.'));
  } else if (exType === 'png') {
    row('Resolutie', res); row('Framerate', `<select id="exFps"><option>1</option><option>5</option><option>12</option><option>24</option><option selected>30</option></select>`); row('Bereik', range);
  } else if (exType === 'audio') { row('Formaat', `<select id="exFmt">${audioFormats().map((f, i) => `<option value="${i}">${f[1]}</option>`).join('')}</select>`); row('Bereik', range); }
  else if (exType === 'wav') row('Bereik', range);
  else if (exType === 'frame') row('Resolutie', res);
  else if (exType === 'pkg') o.append(h('p', 'hint', `Bevat het project en ${[...media.values()].filter(m => m.blob).length} mediabestand(en). Open het later met “Openen”.`));
  $('#exForm').classList.remove('hidden'); $('#exProg').classList.add('hidden'); $('#exDone').classList.add('hidden'); $('#exDl').classList.add('hidden'); $('#exStart').classList.remove('hidden');
  $('#exCancel').textContent = 'Sluiten';
  $('#exportModal').classList.remove('hidden');
}
function exportRange() {
  const rg = $('#exRange') ? $('#exRange').value : 'all';
  if (rg === 'sel') { const l = selectedClips(); if (!l.length) throw new Error('Selecteer eerst een clip'); return [Math.min(...l.map(c => c.start)), Math.max(...l.map(c => c.start + c.dur))]; }
  if (rg === 'markers') { const ms = P.markers.filter(m => !m.beat); if (ms.length < 2) throw new Error('Plaats eerst twee markeringen (M)'); return [ms[0].t, ms[1].t]; }
  return [0, projectDur()];
}
function exportProgress(p, text) { $('#exBar').value = clamp(p, 0, 1); if (text) $('#exStatus').textContent = text; }
function exportDone(blob, name, info, previewKind) {
  const url = URL.createObjectURL(blob);
  $('#exProg').classList.add('hidden'); $('#exDone').classList.remove('hidden');
  $('#exInfo').textContent = `${(blob.size / 1048576).toFixed(2)} MB${info ? ' · ' + info : ''}`;
  const pv = $('#exPreview'); pv.innerHTML = '';
  if (previewKind === 'video') { const v = h('video'); v.controls = true; v.src = url; pv.append(v); }
  else if (previewKind === 'img') { const i = h('img'); i.src = url; pv.append(i); }
  else if (previewKind === 'audio') { const a = h('audio'); a.controls = true; a.src = url; pv.append(a); }
  const a = $('#exDl'); a.href = url; a.download = name; a.classList.remove('hidden');
  $('#exCancel').textContent = 'Sluiten';
}
async function startExport() {
  let range;
  try { range = exType === 'pkg' || exType === 'frame' ? [0, 0] : exportRange(); } catch (e) { return toast(e.message); }
  $('#exForm').classList.add('hidden'); $('#exProg').classList.remove('hidden'); $('#exStart').classList.add('hidden'); $('#exCancel').textContent = 'Annuleren';
  exportProgress(0, 'Voorbereiden…');
  try {
    if (exType === 'video' || exType === 'audio') await exportRealtime(range);
    else if (exType === 'gif') await exportGif(range);
    else if (exType === 'png') await exportPngZip(range);
    else if (exType === 'wav') { const ab = await renderMixdown(range[0], range[1], p => exportProgress(p, 'Audio mixen…')); exportDone(wavBlob(ab), safeName(P.name) + '.wav', fmt(range[1] - range[0]), 'audio'); }
    else if (exType === 'frame') { await withExportSize(+$('#exRes').value, async () => { await renderFrameAt(playhead); const b = await new Promise(r => cv.toBlob(r, 'image/png')); exportDone(b, `${safeName(P.name)}_${fmt(playhead).replace(/[:.]/g, '-')}.png`, `${cv.width}×${cv.height}`, 'img'); }); }
    else if (exType === 'pkg') { const b = await buildPackage(p => exportProgress(p, 'Pakket maken…')); exportDone(b, safeName(P.name) + '.ksp', 'project + media'); }
  } catch (e) {
    console.error(e); if (!(exporting && exporting.cancelled)) toast('Export mislukt: ' + e.message, 5000);
    exporting = null; restoreCanvas(); $('#exportModal').classList.add('hidden');
  }
}
function restoreCanvas() { const [w, hh] = dims(S.quality || 720); cv.width = w; cv.height = hh; fitStage(); requestDraw(); }
async function withExportSize(res, fn) {
  pause(); const keepSel = [...selSet]; selSet.clear(); const keepPrim = sel; sel = null;
  const [w, hh] = dims(res); cv.width = w; cv.height = hh;
  exporting = exporting || { offline: true };
  try { await fn(); } finally { exporting = null; sel = keepPrim; keepSel.forEach(i => selSet.add(i)); restoreCanvas(); }
}
async function waitMediaReady(t) {
  for (let i = 0; i < 300; i++) {
    const busy = P.clips.some(c => c.type === 'video' && isActiveAt(c, t) && (() => { const el = els.get(c.id); return el && (el.seeking || el.readyState < 2); })());
    if (!busy) return; await sleep(10);
  }
}
async function renderFrameAt(t) { playhead = t; syncMedia(t); await waitMediaReady(t); draw(t); }
async function exportRealtime([start, end]) {
  ensureAudio(); await AC.resume();
  const audioOnly = exType === 'audio';
  const f = (audioOnly ? audioFormats() : videoFormats())[+$('#exFmt').value];
  if (!f) throw new Error('Formaat niet ondersteund');
  const res = audioOnly ? (S.quality || 720) : +$('#exRes').value, fps = audioOnly ? 30 : +$('#exFps').value, q = audioOnly ? 1 : +$('#exQ').value;
  pause(); selSet.clear(); sel = null; renderProps();
  const [w, hh] = dims(res);
  exporting = { start, end, chunks: [], cancelled: false, ext: f[2], mime: f[0] };
  cv.width = w; cv.height = hh;
  setPlayhead(start); syncMedia(start); await waitMediaReady(start); draw(start); await sleep(250);
  const tracks = [];
  if (!audioOnly) tracks.push(...cv.captureStream(fps).getVideoTracks());
  tracks.push(...exportDest.stream.getAudioTracks());
  const mr = new MediaRecorder(new MediaStream(tracks), { mimeType: f[0], videoBitsPerSecond: Math.round(5e6 * (w * hh) / (1280 * 720) * (fps / 30) * q), audioBitsPerSecond: 192000 });
  exporting.mr = mr;
  mr.ondataavailable = e => e.data.size && exporting && exporting.chunks.push(e.data);
  mr.onstop = () => {
    const ex = exporting; exporting = null; restoreCanvas();
    if (!ex || ex.cancelled) { $('#exportModal').classList.add('hidden'); toast('Export geannuleerd'); return; }
    exportDone(new Blob(ex.chunks, { type: ex.mime.split(';')[0] }), `${safeName(P.name)}.${ex.ext}`, `${audioOnly ? '' : w + '×' + hh + ' · '}${fmt(ex.end - ex.start)}`, audioOnly ? 'audio' : 'video');
  };
  mr.start(500); play();
}
function finishRealtimeExport() { if (!exporting || !exporting.mr) return; playing = false; pauseAllEls(); $('#playBtn').textContent = '▶'; if (exporting.mr.state !== 'inactive') exporting.mr.stop(); }
async function offlineFrames([start, end], fps, res, onFrame) {
  pause(); const keep = [...selSet]; selSet.clear(); const kp = sel; sel = null;
  const [w, hh] = dims(res); cv.width = w; cv.height = hh;
  exporting = { offline: true, cancelled: false };
  const n = Math.max(1, Math.round((end - start) * fps));
  try {
    for (let i = 0; i < n; i++) {
      if (exporting.cancelled) throw new Error('geannuleerd');
      await renderFrameAt(start + i / fps);
      await onFrame(i, n);
      exportProgress((i + 1) / n, `Frame ${i + 1} / ${n} renderen…`);
    }
  } finally { exporting = null; sel = kp; keep.forEach(i => selSet.add(i)); restoreCanvas(); pauseAllEls(); }
  return n;
}
async function exportGif(range) {
  const gw = +$('#exGW').value, fps = +$('#exFps').value, dither = $('#exDither').value === '1';
  const [bw, bh] = dims(720), gh = Math.round(gw * bh / bw / 2) * 2;
  const enc = createRpc(gifWorker), k = document.createElement('canvas'); k.width = gw; k.height = gh; const g = k.getContext('2d', { willReadFrequently: true });
  await enc({ op: 'start', w: gw, h: gh, dither });
  const jobs = [];
  await offlineFrames(range, fps, Math.min(720, Math.max(gw, gh)), async () => {
    g.drawImage(cv, 0, 0, gw, gh); const id = g.getImageData(0, 0, gw, gh);
    jobs.push(enc({ op: 'frame', buf: id.data.buffer, delay: Math.round(100 / fps) }, [id.data.buffer]));
    if (jobs.length % 8 === 0) await Promise.all(jobs.slice(-8));
  });
  exportProgress(1, 'GIF afronden…'); await Promise.all(jobs);
  const bytes = await enc({ op: 'finish' });
  exportDone(new Blob([bytes], { type: 'image/gif' }), safeName(P.name) + '.gif', `${gw}×${gh} · ${fps} fps · encoder: ${enc.kind()}`, 'img');
}
async function exportPngZip(range) {
  const fps = +$('#exFps').value, res = +$('#exRes').value, files = [];
  await offlineFrames(range, fps, res, async (i) => { const b = await new Promise(r => cv.toBlob(r, 'image/png')); files.push({ name: `frame_${String(i).padStart(5, '0')}.png`, blob: b }); });
  exportProgress(1, 'ZIP maken…');
  const zip = await zipStore(files);
  exportDone(zip, safeName(P.name) + '_frames.zip', `${files.length} frames`);
}
$('#exStart').onclick = startExport;
$('#exCancel').onclick = () => {
  if (exporting) { exporting.cancelled = true; if (exporting.mr) finishRealtimeExport(); }
  else { $('#exportModal').classList.add('hidden'); $$('#exPreview video, #exPreview audio').forEach(v => v.pause()); }
};

/* ---------------- project package (.ksp) ---------------- */
async function buildPackage(onProg) {
  const list = [...media.values()].filter(m => m.blob);
  const meta = list.map(m => ({ id: m.id, name: m.name, type: m.type, mime: m.blob.type, duration: m.duration, file: `media/${m.id}_${safeName(m.name)}` }));
  const proj = new Blob([JSON.stringify({ app: 'KnipStudio', version: KS_VERSION, P, media: meta, sounds: soundMedia }, null, 1)], { type: 'application/json' });
  return zipStore([{ name: 'project.json', blob: proj }, ...list.map((m, i) => ({ name: meta[i].file, blob: m.blob }))], onProg);
}
async function openPackage(file) {
  const entries = await unzip(file); const pj = entries.get('project.json'); if (!pj) throw new Error('Geen project.json in pakket');
  const data = JSON.parse(await pj.text());
  pause();
  for (const mm of data.media || []) {
    if (media.has(mm.id) && !media.get(mm.id).missing) continue;
    const b = entries.get(mm.file); if (!b) continue;
    media.delete(mm.id);
    await importFiles([new File([b], mm.name, { type: mm.mime || '' })], { id: mm.id });
  }
  Object.assign(soundMedia, data.sounds || {});
  const before = snap(); P = migrateProject(data.P); selSet.clear(); sel = null; cleanupEls(); commit(before, 'Pakket geopend'); renderPanel();
  toast('Projectpakket geopend');
}
function saveProjectFile() {
  const data = { app: 'KnipStudio', version: KS_VERSION, P, media: [...media.values()].map(m => ({ id: m.id, name: m.name, type: m.type, duration: m.duration })) };
  download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), safeName(P.name) + '.knipstudio.json');
  toast('Project opgeslagen (zonder media — gebruik Exporteren → Projectpakket voor alles in één)', 4000);
}
async function openProjectFile(f) {
  try {
    if (/\.(ksp|zip)$/i.test(f.name)) return await openPackage(f);
    const data = JSON.parse(await f.text()); if (!data.P) throw new Error('Geen KnipStudio-project');
    const b = snap(); P = migrateProject(data.P);
    for (const mm of data.media || []) if (!media.has(mm.id)) {
      const same = [...media.values()].find(x => x.name === mm.name && x.type === mm.type && !x.missing);
      if (same) { for (const c of P.clips) if (c.mediaId === mm.id) c.mediaId = same.id; }
      else media.set(mm.id, { id: mm.id, name: mm.name, type: mm.type, duration: mm.duration, missing: true });
    }
    selSet.clear(); sel = null; cleanupEls(); commit(b, 'Project geopend'); renderPanel();
    const miss = [...media.values()].filter(m => m.missing).length;
    toast(miss ? `Project geopend: ${miss} mediabestand(en) ontbreken — importeer ze opnieuw om te koppelen` : 'Project geopend', 5000);
  } catch (e) { toast('Kan project niet openen: ' + e.message); }
}

/* ---------------- IndexedDB autosave & versions ---------------- */
let db = null, saveT = null, booted = false;
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('knipstudio2', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('media', { keyPath: 'id' }); r.result.createObjectStore('kv'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
function idbReq(store, mode, fn) {
  return new Promise((res, rej) => { if (!db) return res(null); const t = db.transaction(store, mode), r = fn(t.objectStore(store)); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
}
function dbPutMedia(m) { if (!m.blob) return; idbReq('media', 'readwrite', s => s.put({ id: m.id, name: m.name, type: m.type, blob: m.blob, duration: m.duration })).catch(e => { console.warn(e); toast('Automatisch opslaan van media mislukt (te groot?)'); }); }
function dbDelMedia(id) { idbReq('media', 'readwrite', s => s.delete(id)).catch(() => { }); }
function scheduleAutosave() {
  if (!booted || !S.autosave) return;
  clearTimeout(saveT); $('#saveState').textContent = '● niet opgeslagen';
  saveT = setTimeout(() => { idbReq('kv', 'readwrite', s => s.put({ P, sounds: soundMedia, time: Date.now() }, 'project')).then(() => $('#saveState').textContent = '✓ opgeslagen ' + new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })).catch(() => $('#saveState').textContent = '⚠ autosave mislukt'); }, 800);
}
async function saveVersion() {
  const name = prompt('Naam voor deze versie:', `${P.name} – ${new Date().toLocaleString('nl-NL')}`); if (!name) return;
  const list = (await idbReq('kv', 'readonly', s => s.get('versions'))) || [];
  list.unshift({ name, time: Date.now(), P: snap() }); if (list.length > 30) list.length = 30;
  await idbReq('kv', 'readwrite', s => s.put(list, 'versions')); toast('Versie bewaard'); if (curPanel === 'history') renderPanel();
}
async function listVersions(box) {
  const list = (await idbReq('kv', 'readonly', s => s.get('versions')).catch(() => null)) || [];
  if (!list.length) { box.append(h('div', 'hint', 'Nog geen versies bewaard.')); return; }
  list.forEach((v, i) => {
    const it = h('div', 'hi', `📌 ${esc(v.name)} <span class="muted">${new Date(v.time).toLocaleString('nl-NL')}</span>`);
    const del = h('button', 'icon', '✕'); del.onclick = async e => { e.stopPropagation(); list.splice(i, 1); await idbReq('kv', 'readwrite', s => s.put(list, 'versions')); renderPanel(); };
    it.append(del); it.onclick = () => { if (confirm(`Versie "${v.name}" terugzetten? (Je kunt dit ongedaan maken.)`)) { const b = snap(); P = migrateProject(JSON.parse(v.P)); selSet.clear(); sel = null; cleanupEls(); commit(b, 'Versie teruggezet'); } };
    box.append(it);
  });
}
async function restoreSession() {
  try { db = await idbOpen(); } catch (e) { console.warn('IndexedDB niet beschikbaar', e); return false; }
  try {
    const saved = await idbReq('kv', 'readonly', s => s.get('project'));
    const ms = await idbReq('media', 'readonly', s => s.getAll()) || [];
    for (const r of ms) media.set(r.id, { id: r.id, name: r.name, type: r.type, blob: r.blob, url: URL.createObjectURL(r.blob), duration: r.duration, busy: true });
    if (saved && saved.P) { P = migrateProject(saved.P); Object.assign(soundMedia, saved.sounds || {}); for (const c of P.clips) if (c.mediaId && !media.has(c.mediaId)) media.set(c.mediaId, { id: c.mediaId, name: c.name, type: c.type, missing: true, duration: 0 }); }
    changed(); renderPanel();
    if (saved && saved.P && P.clips.length) toast('Vorige sessie hersteld');
    for (const m of [...media.values()]) if (!m.missing && m.busy) { await analyze(m); m.busy = false; renderPanelIfMedia(); renderTimeline(); requestDraw(); }
    return true;
  } catch (e) { console.warn(e); return false; }
}
async function newProj() {
  if (!confirm('Nieuw project starten? Het huidige project en je media worden gewist uit de automatische opslag. (Bewaar eerst een versie of pakket als je het wilt houden.)')) return;
  pause(); P = newProject(); selSet.clear(); sel = null; undoStack.length = 0; redoStack.length = 0;
  for (const m of media.values()) if (m.url) URL.revokeObjectURL(m.url);
  media.clear(); for (const k in soundMedia) delete soundMedia[k]; cleanupEls(); playhead = 0;
  idbReq('media', 'readwrite', s => s.clear()).catch(() => { });
  changed(); renderPanel();
}
