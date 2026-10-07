'use strict';
/* =====================================================================
   Compositor: draws every visual clip onto the preview/export canvas.
   Simple clips draw directly; clips with masks / GPU effects / keying /
   adjustment layers are rendered into an offscreen layer first.
   ===================================================================== */
const cv = $('#cv'), ctx = cv.getContext('2d', { alpha: false }), ov = $('#ov');
const layerCv = document.createElement('canvas'), lctx = layerCv.getContext('2d');
function dims(short) {
  const [a, b] = P.ratio.split(':').map(Number);
  return a >= b ? [Math.round(short * a / b / 2) * 2, short] : [short, Math.round(short * b / a / 2) * 2];
}
function ensureCanvasDims() {
  if (exporting) return;
  const [w, hh] = dims(S.quality || 720);
  if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; fitStage(); }
}
function fitStage() {
  const wrap = $('#stageWrap'), st = $('#stage');
  const W = wrap.clientWidth - 24, H = wrap.clientHeight - 24; if (W < 10 || H < 10) return;
  const [bw, bh] = dims(720), ar = bw / bh;
  const w = Math.min(W, H * ar), hh = w / ar;
  st.style.width = w + 'px'; st.style.height = hh + 'px';
  ov.width = Math.round(w * dpr()); ov.height = Math.round(hh * dpr());
  requestDraw();
}
function filterStr(c, lt, u, blurAdd, bright) {
  const f = c.f || DEF.f, parts = [];
  const b = A(c, 'f.brightness', lt) * bright, sat = A(c, 'f.saturate', lt), hue = A(c, 'f.hue', lt);
  if (b !== 100) parts.push(`brightness(${b}%)`);
  if (f.contrast !== 100) parts.push(`contrast(${f.contrast}%)`);
  if (sat !== 100) parts.push(`saturate(${sat}%)`);
  if (hue) parts.push(`hue-rotate(${hue}deg)`);
  if (f.grayscale) parts.push(`grayscale(${f.grayscale}%)`);
  if (f.sepia) parts.push(`sepia(${f.sepia}%)`);
  if (f.invert) parts.push(`invert(${f.invert}%)`);
  const bl = (A(c, 'f.blur', lt) + blurAdd) * u;
  if (bl > 0.05) parts.push(`blur(${bl.toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}
function draw(t) {
  const W = cv.width, H = cv.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
  const vis = P.tracks.filter(tr => tr.kind === 'visual');
  for (let i = vis.length - 1; i >= 0; i--) {
    const tr = vis[i]; if (tr.hidden) continue;
    const cs = P.clips.filter(c => c.trackId === tr.id && isActiveAt(c, t)).sort((a, b) => a.start - b.start);
    for (const c of cs) { try { drawClip(c, t - c.start, W, H); } catch (e) { console.warn(e); } }
  }
}
/** Compute the animated transform state of a clip (keyframes + transitions + motion presets). */
function clipState(c, lt, W, H) {
  const u = Math.min(W, H) / 720;
  const X = { u, a: A(c, 'opacity', lt), dx: 0, dy: 0, sc: A(c, 'scale', lt), rot: A(c, 'rot', lt), blur: 0, bright: 1, regions: [] };
  const tr = (type, p, isIn) => {
    if (!type || type === 'none' || p >= 1) return;
    p = ease(clamp(p, 0, 1)); const q = 1 - p;
    switch (type) {
      case 'fade': X.a *= p; break;
      case 'dip': X.bright *= p; break;
      case 'flash': X.bright *= 1 + q * 5; break;
      case 'slide-left': X.dx += isIn ? q * W : -q * W; break;
      case 'slide-right': X.dx += isIn ? -q * W : q * W; break;
      case 'slide-up': X.dy += isIn ? q * H : -q * H; break;
      case 'slide-down': X.dy += isIn ? -q * H : q * H; break;
      case 'zoom-in': X.sc *= isIn ? (0.3 + 0.7 * p) : (1 + q * 1.5); X.a *= p; break;
      case 'zoom-out': X.sc *= isIn ? (1 + q * 1.5) : (0.3 + 0.7 * p); X.a *= p; break;
      case 'wipe-right': X.regions.push(isIn ? [0, 0, p * W, H] : [q * W, 0, p * W, H]); break;
      case 'wipe-left': X.regions.push(isIn ? [q * W, 0, p * W, H] : [0, 0, p * W, H]); break;
      case 'wipe-down': X.regions.push(isIn ? [0, 0, W, p * H] : [0, q * H, W, p * H]); break;
      case 'wipe-up': X.regions.push(isIn ? [0, q * H, W, p * H] : [0, 0, W, p * H]); break;
      case 'circle': X.regions.push(['c', p]); break;
      case 'diamond': X.regions.push(['d', p]); break;
      case 'blinds': X.regions.push(['b', p]); break;
      case 'blur': X.blur += q * 40; X.a *= Math.min(1, p * 1.5); break;
      case 'spin': X.rot += (isIn ? -1 : 1) * q * 360; X.sc *= Math.max(.01, p); break;
      case 'bounce': X.dy += (isIn ? -1 : 1) * (1 - (isIn ? bounceOut(p) : p)) * H; break;
      case 'glitch': if (q > 0) { X.dx += (srand(Math.floor(q * 20), 1) - .5) * q * W * .3; X.a *= srand(Math.floor(q * 30), 2) > q * .6 ? 1 : 0; } break;
    }
  };
  if (c.tin && c.tin.dur > 0) tr(c.tin.type, lt / c.tin.dur, true);
  if (c.tout && c.tout.dur > 0) tr(c.tout.type, (c.dur - lt) / c.tout.dur, false);
  const k = lt / Math.max(.01, c.dur);
  switch (c.anim) {
    case 'kb-in': X.sc *= 1 + .2 * k; break;
    case 'kb-out': X.sc *= 1.2 - .2 * k; break;
    case 'pan-l': X.sc *= 1.15; X.dx += (.5 - k) * .12 * W; break;
    case 'pan-r': X.sc *= 1.15; X.dx -= (.5 - k) * .12 * W; break;
    case 'shake': X.dx += Math.sin(lt * 47) * 6 * u; X.dy += Math.cos(lt * 39) * 6 * u; break;
    case 'pulse': X.sc *= 1 + .06 * Math.sin(lt * Math.PI * 2); break;
    case 'float': X.dy += Math.sin(lt * 2) * 14 * u; break;
    case 'spin': X.rot += lt * 60; break;
    case 'wobble': X.rot += Math.sin(lt * 6) * 6; break;
    case 'heartbeat': { const ph = (lt * 1.2) % 1; X.sc *= 1 + .08 * (Math.exp(-((ph - .1) ** 2) / .002) + .6 * Math.exp(-((ph - .3) ** 2) / .002)); break; }
    case 'swing': X.rot += Math.sin(lt * 3) * 12; break;
  }
  if (c.type === 'text') {
    const ta = c.tanim;
    if (ta === 'fade') X.a *= clamp(Math.min(lt / .5, (c.dur - lt) / .5), 0, 1);
    else if (ta === 'pop') X.sc *= lt < .45 ? Math.max(.01, backOut(lt / .45)) : 1;
    else if (ta === 'slide-up') { const kk = ease(clamp(lt / .6, 0, 1)); X.dy += (1 - kk) * 70 * u; X.a *= kk; }
    else if (ta === 'bounce') X.dy -= Math.abs(Math.sin(lt * 4)) * 30 * u;
  }
  X.cx = A(c, 'x', lt) * W + X.dx; X.cy = A(c, 'y', lt) * H + X.dy;
  return X;
}
function needsLayer(c) {
  return c.type === 'adjust' || (c.mask && c.mask.type !== 'none') || (c.fx && c.fx.some(f => f.on)) || (c.chroma && c.chroma.on) || c.tint.amt > 0 || c.vignette > 0;
}
function applyRegions(g, regions, W, H) {
  for (const r of regions) {
    g.beginPath();
    if (r[0] === 'c') g.arc(W / 2, H / 2, Math.max(.1, r[1] * Math.hypot(W, H) / 2), 0, Math.PI * 2);
    else if (r[0] === 'd') { const s = r[1] * (W + H) / 2 + 1; g.moveTo(W / 2, H / 2 - s); g.lineTo(W / 2 + s, H / 2); g.lineTo(W / 2, H / 2 + s); g.lineTo(W / 2 - s, H / 2); g.closePath(); }
    else if (r[0] === 'b') { const n = 10, bh = H / n; for (let i = 0; i < n; i++) g.rect(0, i * bh, W, Math.max(0, bh * r[1])); }
    else g.rect(r[0], r[1], Math.max(0, r[2]), Math.max(0, r[3]));
    g.clip();
  }
}
function setXform(g, c, X) { g.translate(X.cx, X.cy); g.rotate(X.rot * Math.PI / 180); g.scale(X.sc * (c.flipH ? -1 : 1), X.sc * (c.flipV ? -1 : 1)); }
function drawContent(g, c, lt, W, H, u) {
  switch (c.type) {
    case 'video': case 'image': return drawMedia(g, c, W, H, u);
    case 'text': return drawText(g, c, lt, W, H, u);
    case 'shape': return drawShape(g, c, lt, W, H, u);
    case 'color': return drawColor(g, c, lt, W, H);
    case 'particles': return drawParticles(g, c, lt, W, H, u);
    case 'viz': return drawViz(g, c, lt, W, H, u);
  }
  return null;
}
function buildPasses(c, lt) {
  const ps = [];
  if (c.chroma.on) ps.push({ key: 'b:chroma', frag: FX_BUILTIN.chroma, u: { u_key: hex2vec(c.chroma.color), u_tol: c.chroma.tol * 1.2 / 255, u_soft: Math.max(1, c.chroma.soft) * 1.2 / 255 } });
  for (const f of c.fx || []) if (f.on && FX[f.type]) ps.push({ key: 'fx:' + f.type, frag: FX[f.type].frag, u: fxUniforms(f.type, f.p) });
  if (c.tint.amt > 0) ps.push({ key: 'b:tint', frag: FX_BUILTIN.tint, u: { u_col: hex2vec(c.tint.color), u_amt: c.tint.amt } });
  if (c.vignette > 0) ps.push({ key: 'b:vig', frag: FX_BUILTIN.vignette, u: { u_amt: c.vignette } });
  return ps;
}
let glWarned = false;
function drawClip(c, lt, W, H) {
  const X = clipState(c, lt, W, H), u = X.u;
  ctx.save();
  applyRegions(ctx, X.regions, W, H);
  let sz = null;
  if (!needsLayer(c)) {
    ctx.globalAlpha = clamp(X.a, 0, 1); ctx.globalCompositeOperation = c.blend || 'source-over';
    ctx.filter = filterStr(c, lt, u, X.blur, X.bright);
    setXform(ctx, c, X);
    sz = drawContent(ctx, c, lt, W, H, u);
  } else {
    if (layerCv.width !== W || layerCv.height !== H) { layerCv.width = W; layerCv.height = H; }
    const L = lctx; L.setTransform(1, 0, 0, 1, 0, 0); L.globalAlpha = 1; L.filter = 'none'; L.globalCompositeOperation = 'source-over'; L.clearRect(0, 0, W, H);
    if (c.type === 'adjust') { L.drawImage(cv, 0, 0); sz = [W, H]; }
    else { L.save(); setXform(L, c, X); sz = drawContent(L, c, lt, W, H, u); L.restore(); }
    if (sz && c.mask.type !== 'none') applyMask(L, c, X, sz, lt, u);
    const passes = buildPasses(c, lt);
    let out = layerCv;
    if (passes.length) {
      const r = GL.run(layerCv, W, H, passes, lt);
      if (r) out = r; else { if (!glWarned) { glWarned = true; toast('WebGL niet beschikbaar: GPU-effecten worden overgeslagen'); } }
    }
    ctx.globalAlpha = clamp(X.a, 0, 1); ctx.globalCompositeOperation = c.blend || 'source-over';
    ctx.filter = filterStr(c, lt, u, X.blur, X.bright);
    ctx.drawImage(out, 0, 0, W, H);
  }
  ctx.restore();
  if (sz) bbs.set(c.id, { cx: X.cx, cy: X.cy, w: sz[0] * Math.abs(X.sc), h: sz[1] * Math.abs(X.sc), rot: X.rot });
}
/** Shape path helper shared by shapes and masks (centered at 0,0). */
function pathShape(g, shape, w, hh, r = 0) {
  g.beginPath();
  switch (shape) {
    case 'rect': g.rect(-w / 2, -hh / 2, w, hh); break;
    case 'rounded': g.roundRect(-w / 2, -hh / 2, w, hh, Math.min(r || Math.min(w, hh) * .2, w / 2, hh / 2)); break;
    case 'ellipse': case 'circle': g.ellipse(0, 0, Math.abs(w / 2), Math.abs(hh / 2), 0, 0, Math.PI * 2); break;
    case 'triangle': g.moveTo(0, -hh / 2); g.lineTo(w / 2, hh / 2); g.lineTo(-w / 2, hh / 2); g.closePath(); break;
    case 'star': for (let i = 0; i < 10; i++) { const rr = i % 2 ? .45 : 1, an = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(Math.cos(an) * w / 2 * rr, Math.sin(an) * hh / 2 * rr); } g.closePath(); break;
    case 'arrow': g.moveTo(-w / 2, -hh * .18); g.lineTo(w * .15, -hh * .18); g.lineTo(w * .15, -hh / 2); g.lineTo(w / 2, 0); g.lineTo(w * .15, hh / 2); g.lineTo(w * .15, hh * .18); g.lineTo(-w / 2, hh * .18); g.closePath(); break;
    case 'heart': g.moveTo(0, hh * .35); g.bezierCurveTo(-w * .6, -hh * .1, -w * .3, -hh * .65, 0, -hh * .25); g.bezierCurveTo(w * .3, -hh * .65, w * .6, -hh * .1, 0, hh * .35); g.closePath(); break;
    case 'hexagon': for (let i = 0; i < 6; i++) { const an = Math.PI / 6 + i * Math.PI / 3; g.lineTo(Math.cos(an) * w / 2, Math.sin(an) * hh / 2); } g.closePath(); break;
    case 'bubble': g.roundRect(-w / 2, -hh / 2, w, hh * .8, Math.min(w, hh) * .15); g.moveTo(-w * .2, hh * .3); g.lineTo(-w * .3, hh / 2); g.lineTo(-w * .05, hh * .3); break;
    case 'line': g.rect(-w / 2, -Math.max(2, hh * .04) / 2, w, Math.max(2, hh * .04)); break;
  }
}
function applyMask(L, c, X, sz, lt, u) {
  const m = c.mask;
  L.save(); setXform(L, c, X);
  const mw = sz[0] * A(c, 'mask.w', lt), mh = sz[1] * A(c, 'mask.h', lt);
  L.translate(A(c, 'mask.x', lt) * sz[0], A(c, 'mask.y', lt) * sz[1]); L.rotate((m.rot || 0) * Math.PI / 180);
  L.globalCompositeOperation = m.invert ? 'destination-out' : 'destination-in';
  if (m.feather > 0) L.filter = `blur(${(m.feather * u).toFixed(1)}px)`;
  if (m.type === 'linear') {
    const gr = L.createLinearGradient(-mw / 2, 0, mw / 2, 0); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    L.fillStyle = gr; L.fillRect(-sz[0] * 2, -sz[1] * 2, sz[0] * 4, sz[1] * 4);
  } else {
    L.fillStyle = '#000'; pathShape(L, m.type, mw, mh); L.fill();
  }
  L.restore();
}
function drawMedia(g, c, W, H, u) {
  const m = media.get(c.mediaId);
  let src = null, sw = 0, sh = 0;
  if (c.type === 'video') { const el = getEl(c); if (el && el.readyState >= 2 && el.videoWidth) { src = el; sw = el.videoWidth; sh = el.videoHeight; } }
  else if (m && m.img) { src = m.img; sw = m.w; sh = m.h; }
  if (!src) {
    if (!m || m.missing) {
      g.fillStyle = '#2a1520'; g.fillRect(-W * .3, -H * .2, W * .6, H * .4);
      g.fillStyle = '#ff7a95'; g.font = `${22 * u}px Segoe UI`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('⚠ Media ontbreekt: ' + (m ? m.name : '?'), 0, 0); return [W * .6, H * .4];
    }
    const bb = bbs.get(c.id); return bb ? [bb.w / Math.max(.01, c.scale), bb.h / Math.max(.01, c.scale)] : null;
  }
  const cr = c.crop;
  const sx = sw * cr.l, sy = sh * cr.t, cw = Math.max(1, sw * (1 - cr.l - cr.r)), ch = Math.max(1, sh * (1 - cr.t - cr.b));
  let dw, dh;
  if (c.fit === 'fill') { dw = W; dh = H; }
  else { const k = c.fit === 'cover' ? Math.max(W / cw, H / ch) : Math.min(W / cw, H / ch); dw = cw * k; dh = ch * k; }
  if (c.bgFill && c.fit === 'contain' && (dw < W - 2 || dh < H - 2)) {
    g.save(); const k2 = Math.max(W / cw, H / ch) * 1.08; const f = g.filter;
    g.filter = (f === 'none' ? '' : f + ' ') + `blur(${28 * u}px) brightness(65%)`;
    g.drawImage(src, sx, sy, cw, ch, -cw * k2 / 2, -ch * k2 / 2, cw * k2, ch * k2); g.restore();
  }
  const rr = Math.min(c.radius * u, dw / 2, dh / 2);
  if (c.shadow) { g.save(); g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = 30 * u; g.shadowOffsetY = 10 * u; g.fillStyle = '#000'; g.beginPath(); g.roundRect(-dw / 2, -dh / 2, dw, dh, rr); g.fill(); g.restore(); }
  if (rr > 0) { g.save(); g.beginPath(); g.roundRect(-dw / 2, -dh / 2, dw, dh, rr); g.clip(); g.drawImage(src, sx, sy, cw, ch, -dw / 2, -dh / 2, dw, dh); g.restore(); }
  else g.drawImage(src, sx, sy, cw, ch, -dw / 2, -dh / 2, dw, dh);
  if (c.border > 0) { g.lineWidth = c.border * u; g.strokeStyle = c.borderColor; g.beginPath(); g.roundRect(-dw / 2, -dh / 2, dw, dh, rr); g.stroke(); }
  return [dw, dh];
}
/* ---------- text ---------- */
const CHAR_ANIMS = new Set(['wave', 'drop', 'letters', 'karaoke', 'scramble', 'glitchtext', 'zoomletters', 'rainbow']);
function textVars(s, c, lt) {
  if (s.indexOf('{') < 0) return s;
  const k = clamp(lt / Math.max(.01, c.dur), 0, 1);
  return s.replace(/\{(tijd|rest|aftellen|procent|datum|klok|teller)\}/g, (_, v) => {
    switch (v) {
      case 'tijd': return fmtS(lt);
      case 'rest': return fmtS(c.dur - lt);
      case 'aftellen': return String(Math.max(0, Math.ceil(c.dur - lt)));
      case 'procent': return Math.round(k * 100) + '%';
      case 'datum': return new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
      case 'klok': return new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
      case 'teller': return (lerp(c.countFrom, c.countTo, ease(k))).toLocaleString('nl-NL', { minimumFractionDigits: c.dec || 0, maximumFractionDigits: c.dec || 0 });
    }
  });
}
function drawText(g, c, lt, W, H, u) {
  const fs = Math.max(1, c.size * u);
  g.font = `${c.italic ? 'italic ' : ''}${c.bold ? 'bold ' : ''}${fs}px "${c.font}", "Segoe UI", sans-serif`;
  if ('letterSpacing' in g) g.letterSpacing = (c.spacing || 0) * u + 'px';
  const text = textVars(String(c.text), c, lt);
  const lines = text.split('\n'), lh = fs * c.lineH;
  const ws = lines.map(l => g.measureText(l).width);
  const mw = Math.max(1, ...ws), th = lines.length * lh, pad = c.pad * u;
  let shown = Infinity; const total = lines.join('').length;
  if (c.tanim === 'typewriter') { const T = Math.min(c.dur * 0.75, Math.max(.3, total * 0.07)); shown = Math.floor(clamp(lt / T, 0, 1) * total); }
  if (c.tanim === 'credits') { const k = lt / Math.max(.1, c.dur); g.translate(0, (1 - 2 * k) * (H / 2 + th / 2 + pad) / Math.max(.01, c.scale) - (c.y * H - H / 2)); }
  if (c.bgOpacity > 0) {
    g.save(); g.globalAlpha *= c.bgOpacity; g.fillStyle = c.bgColor; g.beginPath();
    g.roundRect(-mw / 2 - pad, -th / 2 - pad * .6, mw + pad * 2, th + pad * 1.2, 10 * u); g.fill(); g.restore();
  }
  g.textBaseline = 'middle'; g.textAlign = 'left'; g.lineJoin = 'round';
  let fill = c.color;
  if (c.gradFill) { const gr = g.createLinearGradient(0, -th / 2, 0, th / 2); gr.addColorStop(0, c.color); gr.addColorStop(1, c.color2); fill = gr; }
  const shadowOn = () => { if (c.glow) { g.shadowColor = c.color; g.shadowBlur = 28 * u; } else if (c.shadow && !(c.strokeW > 0)) { g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 10 * u; g.shadowOffsetY = 3 * u; } };
  const paint = (s, x, y, color) => {
    if (c.strokeW > 0) { g.save(); g.strokeStyle = c.stroke; g.lineWidth = c.strokeW * 2 * u; if (c.shadow) { g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 10 * u; g.shadowOffsetY = 3 * u; } g.strokeText(s, x, y); g.restore(); }
    g.save(); shadowOn(); g.fillStyle = color || fill; g.fillText(s, x, y); if (c.glow) g.fillText(s, x, y); g.restore();
  };
  const charMode = CHAR_ANIMS.has(c.tanim);
  let used = 0, gi = 0;
  const kProg = clamp(lt / Math.max(.1, c.dur * .9), 0, 1);
  for (let i = 0; i < lines.length; i++) {
    let s = lines[i];
    const x0 = c.align === 'left' ? -mw / 2 : c.align === 'right' ? mw / 2 - ws[i] : -ws[i] / 2;
    const y = -th / 2 + lh * (i + .5);
    if (!charMode) {
      if (shown < Infinity) { const rem = shown - used; s = rem <= 0 ? '' : s.slice(0, rem); used += lines[i].length; }
      if (s) paint(s, x0, y);
      continue;
    }
    const chars = [...s];
    let prefix = '';
    for (let j = 0; j < chars.length; j++, gi++) {
      const ch = chars[j], x = x0 + g.measureText(prefix).width, cw = g.measureText(ch).width; prefix += ch;
      if (ch === ' ') continue;
      let dy = 0, a = 1, sc = 1, color = null, txt = ch, dx = 0;
      switch (c.tanim) {
        case 'wave': dy = Math.sin(lt * 5 + gi * .45) * fs * .15; break;
        case 'drop': { const p = clamp((lt - gi * .05) / .5, 0, 1); dy = -(1 - bounceOut(p)) * fs * 1.6; a = p > 0 ? 1 : 0; break; }
        case 'letters': a = clamp((lt - gi * .04) / .3, 0, 1); dy = (1 - a) * fs * .3; break;
        case 'zoomletters': { const p = clamp((lt - gi * .05) / .35, 0, 1); sc = 1 + (1 - ease(p)) * 2.5; a = p; break; }
        case 'karaoke': if (gi / Math.max(1, total) < kProg) color = c.color2; break;
        case 'rainbow': color = `hsl(${(gi * 25 + lt * 120) % 360},90%,60%)`; break;
        case 'scramble': if (lt < gi * .035 + .4) { const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%&@'; txt = pool[Math.floor(srand(gi, Math.floor(lt * 25)) * pool.length)]; } break;
        case 'glitchtext': { const b = Math.floor(lt * 12); if (srand(gi, b) > .82) { dx = (srand(gi, b, 1) - .5) * fs * .3; dy = (srand(gi, b, 2) - .5) * fs * .2; } break; }
      }
      if (a <= 0) continue;
      g.save(); g.globalAlpha *= a; g.translate(x + cw / 2 + dx, y + dy); if (sc !== 1) g.scale(sc, sc);
      if (c.tanim === 'glitchtext' && srand(gi, Math.floor(lt * 12), 3) > .7) { g.save(); g.globalAlpha *= .7; g.fillStyle = '#ff004c'; g.fillText(txt, -cw / 2 - fs * .04, 0); g.fillStyle = '#00e5ff'; g.fillText(txt, -cw / 2 + fs * .04, 0); g.restore(); }
      paint(txt, -cw / 2, 0, color); g.restore();
    }
  }
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  return [mw + pad * 2, th + pad * 1.2];
}
function drawShape(g, c, lt, W, H, u) {
  const w = c.w * W, hh = c.h * H;
  g.fillStyle = c.fill; g.strokeStyle = c.strokeC; g.lineWidth = c.strokeW2 * u; g.lineJoin = 'round';
  if (c.shape === 'progress') {
    const r = hh / 2; g.save(); g.globalAlpha *= .3; g.fillStyle = c.strokeC; g.beginPath(); g.roundRect(-w / 2, -hh / 2, w, hh, r); g.fill(); g.restore();
    g.beginPath(); g.roundRect(-w / 2, -hh / 2, Math.max(hh, w * clamp(lt / c.dur, 0, 1)), hh, r); g.fill(); return [w, hh];
  }
  if (c.shape === 'rect') { g.beginPath(); g.roundRect(-w / 2, -hh / 2, w, hh, Math.min(c.cr * u, w / 2, hh / 2)); }
  else pathShape(g, c.shape, w, hh);
  g.fill(); if (c.strokeW2 > 0) g.stroke();
  return [w, hh];
}
function drawColor(g, c, lt, W, H) {
  if (c.grad) {
    const ang = c.angle + (c.animGrad ? lt * 40 : 0), r = ang * Math.PI / 180, x = Math.cos(r) * W / 2, y = Math.sin(r) * H / 2;
    const gr = g.createLinearGradient(-x, -y, x, y); gr.addColorStop(0, c.color); gr.addColorStop(1, c.color2); g.fillStyle = gr;
  } else g.fillStyle = c.color;
  g.fillRect(-W / 2, -H / 2, W, H);
  return [W, H];
}
/* ---------- particles (deterministic: same time → same frame) ---------- */
const CONFETTI = ['#ff5c7a', '#ffd84d', '#3ddc97', '#4db8ff', '#c77dff', '#ff9f43'];
function drawParticles(g, c, lt, W, H, u) {
  const n = Math.round(c.count), sp = c.pspeed, sz = c.psize * u, sd = c.seed || 1, wind = c.wind;
  const colorOf = i => c.multi ? CONFETTI[Math.floor(srand(i, sd, 9) * CONFETTI.length)] : c.pcolor;
  const wrap = (v, m) => ((v % m) + m) % m;
  g.save();
  for (let i = 0; i < n; i++) {
    const r1 = srand(i, sd, 1), r2 = srand(i, sd, 2), r3 = srand(i, sd, 3), r4 = srand(i, sd, 4);
    switch (c.pkind) {
      case 'confetti': {
        const y = wrap(r2 * H * 1.2 + lt * (120 + r3 * 160) * sp * u, H * 1.2) - H * .6 - H * .0;
        const x = wrap(r1 * W + Math.sin(lt * 2 + i) * 30 * u + wind * lt * 100 * u, W) - W / 2;
        g.save(); g.translate(x, y); g.rotate(lt * (2 + r4 * 6) + i); g.scale(1, Math.cos(lt * 5 + i));
        g.fillStyle = colorOf(i); g.fillRect(-6 * sz, -3 * sz, 12 * sz, 6 * sz); g.restore(); break;
      }
      case 'snow': {
        const y = wrap(r2 * H + lt * (30 + r3 * 50) * sp * u, H) - H / 2, x = wrap(r1 * W + Math.sin(lt + i) * 25 * u + wind * lt * 60 * u, W) - W / 2;
        g.globalAlpha = .5 + r4 * .5; g.fillStyle = c.multi ? '#ffffff' : c.pcolor; g.beginPath(); g.arc(x, y, (1.5 + r3 * 3.5) * sz, 0, Math.PI * 2); g.fill(); break;
      }
      case 'rain': {
        const y = wrap(r2 * H + lt * (700 + r3 * 400) * sp * u, H + 60 * u) - H / 2 - 30 * u, x = wrap(r1 * W + wind * lt * 300 * u, W) - W / 2;
        g.strokeStyle = c.multi ? 'rgba(170,200,255,.6)' : c.pcolor; g.lineWidth = 1.2 * sz; g.beginPath(); g.moveTo(x, y); g.lineTo(x + wind * 10 * u, y + 22 * sz); g.stroke(); break;
      }
      case 'sparkles': {
        const x = (r1 - .5) * W, y = (r2 - .5) * H, tw = Math.max(0, Math.sin(lt * (2 + r3 * 4) * sp + r4 * 6.28)); if (tw < .05) break;
        g.globalAlpha = tw; g.fillStyle = colorOf(i); const s = (4 + r3 * 8) * sz * tw;
        g.beginPath(); for (let k = 0; k < 8; k++) { const rr = k % 2 ? s * .25 : s, an = k * Math.PI / 4; g.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr); } g.closePath(); g.fill(); break;
      }
      case 'hearts': case 'bubbles': case 'emoji': {
        const y = H / 2 - wrap(r2 * H * 1.2 + lt * (60 + r3 * 80) * sp * u, H * 1.2) + H * .1, x = wrap(r1 * W + Math.sin(lt * 1.5 + i) * 30 * u, W) - W / 2;
        g.globalAlpha = .85; const s = (10 + r4 * 14) * sz;
        if (c.pkind === 'hearts') { g.fillStyle = c.multi ? `hsl(${330 + r3 * 40},90%,62%)` : c.pcolor; g.save(); g.translate(x, y); pathShape(g, 'heart', s * 2, s * 2); g.fill(); g.restore(); }
        else if (c.pkind === 'bubbles') { g.strokeStyle = c.multi ? 'rgba(200,240,255,.8)' : c.pcolor; g.lineWidth = 1.5 * u; g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.stroke(); g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.arc(x - s * .35, y - s * .35, s * .2, 0, Math.PI * 2); g.fill(); }
        else { g.font = `${s * 2}px "Segoe UI Emoji"`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(c.emoji || '❤️', x, y); }
        break;
      }
      case 'fireflies': {
        const x = (r1 - .5) * W + Math.sin(lt * .7 * sp + i) * 60 * u + Math.sin(lt * 1.3 * sp + i * 2) * 30 * u, y = (r2 - .5) * H + Math.cos(lt * .6 * sp + i * 1.7) * 50 * u;
        const a = .3 + .7 * Math.max(0, Math.sin(lt * 2 + r3 * 6.28)); const gr = g.createRadialGradient(x, y, 0, x, y, 10 * sz);
        gr.addColorStop(0, c.multi ? 'rgba(255,240,120,1)' : c.pcolor); gr.addColorStop(1, 'rgba(255,240,120,0)'); g.globalAlpha = a; g.fillStyle = gr; g.beginPath(); g.arc(x, y, 10 * sz, 0, Math.PI * 2); g.fill(); break;
      }
      case 'warp': {
        const ph = wrap(r3 + lt * .35 * sp, 1), an = r1 * Math.PI * 2, d = Math.pow(ph, 2.2) * Math.hypot(W, H) * .6;
        const x = Math.cos(an) * d, y = Math.sin(an) * d, l = 3 + ph * 25 * sz;
        g.globalAlpha = ph; g.strokeStyle = colorOf(i); g.lineWidth = (.5 + ph * 2.5) * sz; g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.cos(an) * l, y - Math.sin(an) * l); g.stroke(); break;
      }
      case 'fireworks': {
        const burst = i % 8, bp = 1.6 / sp, t0 = burst * bp * .37, bt = wrap(lt - t0, bp * 3), j = Math.floor(i / 8);
        if (bt > bp) break;
        const cyc = Math.floor((lt - t0) / (bp * 3)), bx = (srand(burst, cyc, sd) - .5) * W * .8, by = (srand(burst, cyc, sd + 1) - .5) * H * .5 - H * .1;
        const an = srand(j, burst, 5) * Math.PI * 2, spd = (80 + srand(j, burst, 6) * 160) * u, p = bt / bp;
        const x = bx + Math.cos(an) * spd * bt, y = by + Math.sin(an) * spd * bt + 120 * u * bt * bt;
        g.globalAlpha = 1 - p; g.fillStyle = c.multi ? `hsl(${srand(burst, cyc) * 360},95%,65%)` : c.pcolor; g.beginPath(); g.arc(x, y, 2.4 * sz, 0, Math.PI * 2); g.fill(); break;
      }
    }
    g.globalAlpha = 1;
  }
  g.restore();
  return [W, H];
}
/* ---------- audio visualizer ---------- */
let vizBuf = null, vizLast = null;
function vizData(n, t) {
  const out = new Float32Array(n);
  if (vizAnalyser && playing) {
    if (!vizBuf) vizBuf = new Uint8Array(vizAnalyser.frequencyBinCount);
    vizAnalyser.getByteFrequencyData(vizBuf);
    const N = vizBuf.length;
    for (let i = 0; i < n; i++) {
      const a = Math.floor(Math.pow(i / n, 2) * N * .7) + 1, b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / n, 2) * N * .7) + 1);
      let m = 0; for (let k = a; k < b && k < N; k++) m = Math.max(m, vizBuf[k]); out[i] = m / 255;
    }
    vizLast = out; return out;
  }
  // paused / scrubbing: synthesise from the audio peaks at time t (deterministic)
  let lvl = 0; for (const c of P.clips) if (isAV(c) && !c.muted) lvl = Math.max(lvl, clipLevelAt(c, t, .05));
  for (let i = 0; i < n; i++) out[i] = clamp(lvl * (.35 + .65 * srand(i, Math.floor(t * 12))) * (1 - i / n * .5), 0, 1);
  return out;
}
function drawViz(g, c, lt, W, H, u) {
  const w = c.w * W, hh = c.h * H, n = Math.round(c.bars), d = vizData(n, c.start + lt);
  const gr = g.createLinearGradient(0, hh / 2, 0, -hh / 2); gr.addColorStop(0, c.color); gr.addColorStop(1, c.color2);
  g.fillStyle = gr; g.strokeStyle = gr;
  const v = i => clamp(d[i] * c.sens, 0, 1);
  if (c.vstyle === 'bars' || c.vstyle === 'mirror') {
    const bw = w / n;
    for (let i = 0; i < n; i++) {
      const bh = Math.max(2 * u, v(i) * hh), x = -w / 2 + i * bw + bw * .15;
      g.beginPath(); if (c.vstyle === 'bars') g.roundRect(x, hh / 2 - bh, bw * .7, bh, bw * .3); else g.roundRect(x, -bh / 2, bw * .7, bh, bw * .3); g.fill();
    }
  } else if (c.vstyle === 'wave') {
    g.lineWidth = 4 * u; g.lineJoin = 'round'; g.beginPath();
    for (let i = 0; i < n; i++) { const x = -w / 2 + i / (n - 1) * w, y = Math.sin(i * .9 + lt * 6) * v(i) * hh / 2; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  } else if (c.vstyle === 'circle') {
    const r = Math.min(w, hh) * .3;
    for (let i = 0; i < n; i++) {
      const an = i / n * Math.PI * 2 - Math.PI / 2, l = 4 * u + v(i) * r;
      g.save(); g.rotate(an); g.fillRect(r, -Math.PI * r / n * .6, l, Math.PI * r / n * 1.2); g.restore();
    }
    g.beginPath(); g.arc(0, 0, r * .92, 0, Math.PI * 2); g.lineWidth = 3 * u; g.stroke();
  } else if (c.vstyle === 'dots') {
    const bw = w / n, rows = 12;
    for (let i = 0; i < n; i++) for (let r = 0; r < rows; r++) if (r / rows < v(i)) { g.beginPath(); g.arc(-w / 2 + (i + .5) * bw, hh / 2 - (r + .5) * hh / rows, Math.min(bw, hh / rows) * .35, 0, Math.PI * 2); g.fill(); }
  }
  return [w, hh];
}

/* ---------- overlay: selection handles, guides, safe zones ---------- */
let guide = null;
function drawOverlay() {
  const g = ov.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, ov.width, ov.height);
  if (exporting) return;
  const k = ov.width / cv.width, D = dpr(), OW = ov.width, OH = ov.height;
  g.lineWidth = 1;
  if (S.thirds) { g.strokeStyle = 'rgba(255,255,255,.35)'; g.beginPath(); for (const f of [1 / 3, 2 / 3]) { g.moveTo(OW * f, 0); g.lineTo(OW * f, OH); g.moveTo(0, OH * f); g.lineTo(OW, OH * f); } g.stroke(); }
  if (S.safe) { g.setLineDash([4 * D, 4 * D]); g.strokeStyle = 'rgba(255,216,77,.6)'; g.strokeRect(OW * .05, OH * .05, OW * .9, OH * .9); g.strokeStyle = 'rgba(77,184,255,.6)'; g.strokeRect(OW * .1, OH * .1, OW * .8, OH * .8); g.setLineDash([]); }
  if (guide) { g.strokeStyle = '#ffd84d'; g.beginPath(); if (guide.x) { g.moveTo(OW / 2, 0); g.lineTo(OW / 2, OH); } if (guide.y) { g.moveTo(0, OH / 2); g.lineTo(OW, OH / 2); } g.stroke(); }
  for (const id of selSet) {
    const c = clipById(id); if (!c || kindOf(c) !== 'visual' || !isActiveAt(c, playhead)) continue;
    const tr = track(c.trackId); if (!tr || tr.hidden) continue;
    const bb = bbs.get(c.id); if (!bb) continue;
    g.save(); g.translate(bb.cx * k, bb.cy * k); g.rotate(bb.rot * Math.PI / 180);
    const w = bb.w * k, hh = bb.h * k;
    g.strokeStyle = '#a48bff'; g.lineWidth = 1.5 * D; g.setLineDash([6 * D, 4 * D]); g.strokeRect(-w / 2, -hh / 2, w, hh); g.setLineDash([]);
    if (id === sel) {
      g.fillStyle = '#fff'; g.strokeStyle = '#7c5cff'; g.lineWidth = 2 * D; const hs = 10 * D;
      for (const [x, y] of [[-w / 2, -hh / 2], [w / 2, -hh / 2], [-w / 2, hh / 2], [w / 2, hh / 2]]) { g.fillRect(x - hs / 2, y - hs / 2, hs, hs); g.strokeRect(x - hs / 2, y - hs / 2, hs, hs); }
      g.beginPath(); g.moveTo(0, -hh / 2); g.lineTo(0, -hh / 2 - 24 * D); g.stroke();
      g.beginPath(); g.arc(0, -hh / 2 - 24 * D, 6 * D, 0, Math.PI * 2); g.fill(); g.stroke();
      if (allKfTimes(c).length) { g.fillStyle = '#ffd84d'; g.font = `${11 * D}px Segoe UI`; g.fillText('◆ keyframes', -w / 2, -hh / 2 - 6 * D); }
    }
    g.restore();
  }
}
