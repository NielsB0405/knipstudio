'use strict';
/* =====================================================================
   Privacy: automatic face detection & anonymisation.
   - Detector: Google MediaPipe BlazeFace (WebAssembly, runs 100% locally)
   - Every video is scanned in the background after import; results are
     cached per media in 1/15 s buckets (normalised boxes 0..1).
   - While rendering, boxes from a short time window are merged so a face
     stays hidden even if the detector misses it for a few frames.
   - Live detection fills gaps (scrubbing, export) synchronously.
   ===================================================================== */
const FACE = { status: 'laden', detector: null, err: null, queue: [], busy: false, ready: null };
const FACE_BUCKETS = 15;
secOpen.faces = true;
const detCv = document.createElement('canvas'), detG = detCv.getContext('2d', { willReadFrequently: true });
const faceTmp = document.createElement('canvas'), faceTmpG = faceTmp.getContext('2d');

FACE.ready = (async function initFaceDetector() {
  if (location.protocol === 'file:') { FACE.status = 'fout'; FACE.err = 'Open dit programma via het webadres (server), niet als bestand.'; updateFaceStatus(); return false; }
  try {
    const vision = await import(new URL('vendor/mediapipe/vision_bundle.mjs', location.href).href);
    const files = await vision.FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm', location.href).href);
    FACE.detector = await vision.FaceDetector.createFromOptions(files, {
      baseOptions: { modelAssetBuffer: Uint8Array.from(atob((await (await fetch(new URL('vendor/mediapipe/blaze_face_short_range.b64.txt', location.href).href)).text()).trim()), c => c.charCodeAt(0)), delegate: 'CPU' },
      runningMode: 'IMAGE', minDetectionConfidence: 0.25, minSuppressionThreshold: 0.3,
    });
    FACE.status = 'actief';
  } catch (e) { console.warn(e); FACE.status = 'fout'; FACE.err = e.message || String(e); }
  updateFaceStatus(); requestDraw();
  for (const m of media.values()) queueFaceScan(m);
  return !!FACE.detector;
})();
async function faceReady(ms = 20000) { return await Promise.race([FACE.ready, sleep(ms).then(() => false)]); }

/* ---------------- detection ---------------- */
function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return { iou: inter / (a.w * a.h + b.w * b.h - inter || 1), contain: inter / Math.min(a.w * a.h, b.w * b.h || 1) };
}
/** Merge overlapping boxes into their union (greedy, biggest first). */
function mergeBoxes(list) {
  const out = [];
  for (const b of [...list].sort((p, q) => q.w * q.h - p.w * p.h)) {
    const hit = out.find(o => { const r = iou(o, b); return r.iou > .2 || r.contain > .5; });
    if (hit) { const x2 = Math.max(hit.x + hit.w, b.x + b.w), y2 = Math.max(hit.y + hit.h, b.y + b.h); hit.x = Math.min(hit.x, b.x); hit.y = Math.min(hit.y, b.y); hit.w = x2 - hit.x; hit.h = y2 - hit.y; hit.s = Math.max(hit.s || 0, b.s || 0); }
    else out.push({ ...b });
  }
  return out;
}
/** Detect faces in a region of the source; returns boxes normalised to the full source. */
function detectRegion(src, sw, sh, rx, ry, rw, rh, maxW) {
  const k = Math.min(1, maxW / rw), w = Math.max(16, Math.round(rw * k)), hh = Math.max(16, Math.round(rh * k));
  if (detCv.width !== w || detCv.height !== hh) { detCv.width = w; detCv.height = hh; }
  detG.drawImage(src, rx, ry, rw, rh, 0, 0, w, hh);
  const res = FACE.detector.detect(detCv), out = [];
  for (const d of res.detections || []) {
    const s = d.categories && d.categories[0] ? d.categories[0].score : 1;
    if (s < P.face.conf) continue;
    const bb = d.boundingBox;
    out.push({ x: (rx + bb.originX * rw / w) / sw, y: (ry + bb.originY * rh / hh) / sh, w: bb.width * rw / w / sw, h: bb.height * rh / hh / sh, s });
  }
  return out;
}
function detectFrame(src, sw, sh) {
  if (!FACE.detector || !sw || !sh) return null;
  try {
    let boxes = detectRegion(src, sw, sh, 0, 0, sw, sh, 640);
    if (P.face.small) {
      // overlapping tiles so small / distant faces become big enough for the short-range model
      const tw = sw * .6, th = sh * .6;
      for (const [fx, fy] of [[0, 0], [.4, 0], [0, .4], [.4, .4], [.2, .2]]) boxes = boxes.concat(detectRegion(src, sw, sh, fx * sw, fy * sh, tw, th, 640));
    }
    return mergeBoxes(boxes);
  } catch (e) { console.warn('detectie mislukt', e); return null; }
}
/** Faces for a clip at the frame currently shown by `src`, merged over the hold window. */
function facesFor(c, src, sw, sh) {
  const m = media.get(c.mediaId); if (!m) return [];
  if (!m.faces) m.faces = new Map();
  const isImg = c.type === 'image';
  const t = isImg ? 0 : (src.currentTime || 0), b = Math.round(t * FACE_BUCKETS);
  if (!m.faces.has(b) && FACE.detector && (isImg || (src.readyState >= 2 && !src.seeking))) {
    const r = detectFrame(src, sw, sh); if (r) m.faces.set(b, r);
  }
  if (isImg) return m.faces.get(0) || [];
  const hb = Math.round(P.face.hold * FACE_BUCKETS); let all = [];
  for (let i = b - hb; i <= b + hb; i++) { const r = m.faces.get(i); if (r) all = all.concat(r); }
  return mergeBoxes(all);
}
const faceModeOf = c => c.faceMode === 'off' ? null : (c.faceMode === 'on' || P.face.on) ? (c.faceStyle && c.faceStyle !== 'project' ? c.faceStyle : P.face.mode) : null;

/* ---------------- anonymisation (called from drawMedia) ---------------- */
function applyFaceBlur(g, c, src, sw, sh, sx, sy, cw, ch, dw, dh, u) {
  const mode = faceModeOf(c); if (!mode) return 0;
  const boxes = facesFor(c, src, sw, sh); if (!boxes.length) return 0;
  const F = P.face;
  for (const bx of boxes) {
    const pw = bx.w * (1 + F.pad * 2), ph = bx.h * (1 + F.pad * 2) * 1.15;
    const fx = (bx.x + bx.w / 2) * sw, fy = (bx.y + bx.h / 2 - bx.h * .1) * sh, fw = pw * sw, fh = ph * sh;
    const X = -dw / 2 + (fx - sx) / cw * dw, Y = -dh / 2 + (fy - sy) / ch * dh, Wd = fw / cw * dw, Hd = fh / ch * dh;
    if (Wd < 2 || Hd < 2) continue;
    g.save();
    g.beginPath(); g.rect(-dw / 2, -dh / 2, dw, dh); g.clip();
    g.beginPath();
    if (F.shape === 'rect') g.roundRect(X - Wd / 2, Y - Hd / 2, Wd, Hd, Math.min(Wd, Hd) * .12); else g.ellipse(X, Y, Wd / 2, Hd / 2, 0, 0, Math.PI * 2);
    g.clip();
    // source rectangle around the face (with margin so the blur has pixels to sample)
    const mx = fw * .35, my = fh * .35, rsx = clamp(fx - fw / 2 - mx, 0, sw), rsy = clamp(fy - fh / 2 - my, 0, sh);
    const rsw = Math.min(sw - rsx, fw + mx * 2), rsh = Math.min(sh - rsy, fh + my * 2);
    const rdx = -dw / 2 + (rsx - sx) / cw * dw, rdy = -dh / 2 + (rsy - sy) / ch * dh, rdw = rsw / cw * dw, rdh = rsh / ch * dh;
    if (mode === 'blur') {
      const base = g.filter, rad = Math.max(4, Wd * F.strength / 160);
      g.filter = (base === 'none' ? '' : base + ' ') + `blur(${rad.toFixed(1)}px)`;
      if (rsw > 1 && rsh > 1) { g.drawImage(src, rsx, rsy, rsw, rsh, rdx, rdy, rdw, rdh); g.drawImage(src, rsx, rsy, rsw, rsh, rdx, rdy, rdw, rdh); }
    } else if (mode === 'pixel') {
      const n = Math.round(clamp(18 - F.strength / 7, 3, 18));
      faceTmp.width = n; faceTmp.height = Math.max(2, Math.round(n * rsh / Math.max(1, rsw)));
      faceTmpG.drawImage(src, rsx, rsy, Math.max(1, rsw), Math.max(1, rsh), 0, 0, faceTmp.width, faceTmp.height);
      const sm = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
      g.drawImage(faceTmp, 0, 0, faceTmp.width, faceTmp.height, rdx, rdy, rdw, rdh); g.imageSmoothingEnabled = sm;
    } else if (mode === 'black') { g.fillStyle = F.color || '#000'; g.fillRect(X - Wd, Y - Hd, Wd * 2, Hd * 2); }
    else if (mode === 'emoji') {
      g.restore(); g.save();
      g.font = `${Hd * .95}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(F.emoji || '😊', X, Y + Hd * .05);
    }
    g.restore();
    if (F.boxes && !exporting) { g.save(); g.strokeStyle = '#3ddc97'; g.lineWidth = 2 * u; g.setLineDash([6 * u, 4 * u]); g.strokeRect(X - Wd / 2, Y - Hd / 2, Wd, Hd); g.fillStyle = '#3ddc97'; g.font = `${12 * u}px Segoe UI`; g.fillText(`gezicht ${Math.round((bx.s || 1) * 100)}%`, X - Wd / 2, Y - Hd / 2 - 4 * u); g.restore(); }
  }
  return boxes.length;
}

/* ---------------- background scanning of whole videos ---------------- */
function queueFaceScan(m, force) {
  if (!m || m.missing || !m.url || (m.type !== 'video' && m.type !== 'image')) return;
  if (force) { m.faces = new Map(); m.faceScan = 0; }
  if (m.faceScan === 1 && !force) return;
  if (!FACE.queue.includes(m)) FACE.queue.push(m);
  pumpFaceScan();
}
async function pumpFaceScan() {
  if (FACE.busy || !FACE.detector) return;
  FACE.busy = true;
  while (FACE.queue.length) {
    const m = FACE.queue.shift();
    try { await scanMedia(m); } catch (e) { console.warn('scan mislukt', m.name, e); m.faceScan = -1; }
    refreshFaceUI();
  }
  FACE.busy = false;
}
async function scanMedia(m) {
  m.faces = m.faces || new Map();
  if (m.type === 'image') {
    if (!m.img) return; m.faces.set(0, detectFrame(m.img, m.w, m.h) || []); m.faceScan = 1; m.faceMax = m.faces.get(0).length; requestDraw(); return;
  }
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = m.url;
  await once(v, 'loadeddata', 15000);
  const dur = isFinite(m.duration) && m.duration > 0 ? m.duration : v.duration, step = 1 / 8;
  let max = 0, last = 0;
  for (let t = 0; t < dur; t += step) {
    if (!FACE.detector) break;
    const b = Math.round(t * FACE_BUCKETS);
    if (!m.faces.has(b)) {
      v.currentTime = Math.min(t, dur - .02);
      try { await once(v, 'seeked', 5000); } catch (e) { continue; }
      const r = detectFrame(v, v.videoWidth, v.videoHeight) || [];
      m.faces.set(b, r); max = Math.max(max, r.length);
    }
    m.faceScan = Math.min(.999, t / dur); m.faceMax = Math.max(m.faceMax || 0, max);
    if (performance.now() - last > 400) { last = performance.now(); refreshFaceUI(); }
    await sleep(0);
  }
  v.removeAttribute('src'); v.load();
  m.faceScan = 1; requestDraw();
}
function faceCountOf(m) { let n = 0; if (m.faces) for (const r of m.faces.values()) if (r.length) n++; return n; }

/* ---------------- UI ---------------- */
function updateFaceStatus() {
  const el = $('#faceStatus'); if (!el) return;
  const map = { laden: ['⏳', 'Gezichtsdetectie laden…'], actief: [P.face.on ? '🙂' : '😐', P.face.on ? 'Gezichtsvervaging aan' : 'Gezichtsvervaging uit'], fout: ['⚠', 'Gezichtsdetectie niet beschikbaar'] };
  const [i, t] = map[FACE.status]; el.textContent = `${i} ${t}`; el.title = FACE.err || 'Klik voor privacy-instellingen';
  el.classList.toggle('on', FACE.status === 'actief' && P.face.on); el.classList.toggle('bad', FACE.status === 'fout');
}
function refreshFaceUI() {
  updateFaceStatus();
  if (curPanel === 'privacy') renderPanel();
  else for (const m of media.values()) { const el = document.querySelector(`[data-facescan="${m.id}"]`); if (el) el.textContent = faceLabel(m); }
}
function faceLabel(m) {
  if (m.type === 'audio') return '';
  if (m.faceScan === 1) { const n = m.type === 'image' ? (m.faceMax || 0) : faceCountOf(m); return n ? (m.type === 'image' ? `🙂 ${n} gezicht(en)` : `🙂 gezichten in beeld`) : '✓ geen gezichten'; }
  if (m.faceScan === -1) return '⚠ scan mislukt';
  if (m.faceScan > 0) return `🔍 scannen ${Math.round(m.faceScan * 100)}%`;
  return FACE.status === 'actief' ? '🔍 in wachtrij' : '';
}
PANELS.privacy = box => {
  box.append(h('h3', '', '🙂 Privacy: gezichten vervagen'));
  box.append(h('p', 'hint', 'Gezichten in je video’s en foto’s worden automatisch herkend en onherkenbaar gemaakt — in het voorbeeld én in elke export. Alles gebeurt lokaal op je computer; er gaat niets naar internet.'));
  const st = h('div', 'facestat ' + FACE.status, FACE.status === 'actief' ? '✅ Gezichtsdetectie actief (MediaPipe BlazeFace)' : FACE.status === 'laden' ? '⏳ Detector laden…' : '⚠ ' + esc(FACE.err || 'Niet beschikbaar'));
  box.append(st);
  const on = h('label', 'chk big-chk', `<input type="checkbox" ${P.face.on ? 'checked' : ''}> <b>Gezichten automatisch vervagen</b>`);
  bind($('input', on), P, 'face.on', i => i.checked, { label: 'Gezichtsvervaging', after: updateFaceStatus }); box.append(on);
  box.append(h('h4', '', 'Stijl'));
  const r = h('div', 'filters');
  [['blur', '🌫 Vervagen'], ['pixel', '🟪 Pixelen'], ['black', '⬛ Balk'], ['emoji', '😊 Emoji']].forEach(([k, n]) => { const b = h('button', P.face.mode === k ? 'on' : '', n); b.onclick = () => edit(() => P.face.mode = k, 'Vervagingsstijl'); r.append(b); });
  box.append(r);
  rng(box, P, 'Sterkte', 'face.strength', 5, 100, 1, { disp: x => Math.round(x) + '%' });
  rng(box, P, 'Extra marge', 'face.pad', 0, 1, .01, { disp: x => Math.round(x * 100) + '%' });
  sel_(box, P, 'Vorm', 'face.shape', [['ellipse', 'Ovaal'], ['rect', 'Rechthoek']]);
  if (P.face.mode === 'emoji') txt(box, P, 'Emoji', 'face.emoji');
  if (P.face.mode === 'black') col(box, P, 'Kleur', 'face.color');
  box.append(h('h4', '', 'Detectie'));
  rng(box, P, 'Zekerheid', 'face.conf', .2, .95, .01, { disp: x => Math.round(x * 100) + '%', after: () => clearFaceCaches() });
  box.append(h('div', 'hint', 'Lager = meer gezichten gevonden (maar soms ook iets dat geen gezicht is). Bij twijfel lager zetten: liever te veel vervaagd dan te weinig.'));
  rng(box, P, 'Vasthouden', 'face.hold', 0, 1.5, .05, { disp: x => (+x).toFixed(2) + 's' });
  box.append(h('div', 'hint', 'Houdt de vervaging even vast als de detector een gezicht kort kwijt is (bij snelle bewegingen of wegdraaien).'));
  chk(box, P, 'Ook kleine / verre gezichten zoeken (grondiger, trager)', 'face.small', { after: () => clearFaceCaches() });
  chk(box, P, 'Detectiekaders tonen in voorbeeld', 'face.boxes');
  box.append(h('h4', '', 'Media'));
  const list = [...media.values()].filter(m => m.type === 'video' || m.type === 'image');
  if (!list.length) box.append(h('p', 'hint', 'Nog geen video’s of foto’s geïmporteerd.'));
  for (const m of list) {
    const it = h('div', 'si', `<span>${TYPE_ICONS[m.type]} ${esc(m.name)}</span><span class="muted" style="flex:0 0 auto" data-facescan="${m.id}">${faceLabel(m)}</span>`);
    const rb = h('button', 'icon', '↻'); rb.title = 'Opnieuw scannen'; rb.onclick = () => queueFaceScan(m, true); it.append(rb);
    box.append(it);
  }
  if (list.length) { const all = h('button', 'big', '↻ Alles opnieuw scannen'); all.onclick = () => clearFaceCaches(); box.append(all); }
  box.append(h('p', 'hint', 'Per clip kun je de vervaging aan- of uitzetten in het rechterpaneel onder “🙂 Gezichten”. Controleer je export altijd zelf: automatische detectie is nooit 100% perfect (vooral bij profielen, maskers of heel kleine gezichten).'));
};
function clearFaceCaches() { for (const m of media.values()) if (m.type === 'video' || m.type === 'image') queueFaceScan(m, true); requestDraw(); }
function faceSection(box, c) {
  section(box, 'faces', '🙂 Gezichten', b => {
    sel_(b, c, 'Vervagen', 'faceMode', [['auto', `Volgens project (${P.face.on ? 'aan' : 'uit'})`], ['on', 'Altijd aan'], ['off', 'Uit voor deze clip']], { after: () => renderProps() });
    sel_(b, c, 'Stijl', 'faceStyle', [['project', 'Volgens project'], ['blur', 'Vervagen'], ['pixel', 'Pixelen'], ['black', 'Balk'], ['emoji', 'Emoji']]);
    const m = media.get(c.mediaId); if (m) b.append(h('div', 'hint', 'Scan: ' + (faceLabel(m) || '—')));
    btns(b, [['⚙ Privacy-instellingen', () => showPanel('privacy')], ['↻ Opnieuw scannen', () => queueFaceScan(media.get(c.mediaId), true)]]);
  }, faceModeOf(c) ? 'aan' : 'uit');
}
$('#faceStatus').onclick = () => showPanel('privacy');
