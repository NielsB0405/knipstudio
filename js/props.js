'use strict';
/* =====================================================================
   Properties inspector (right panel). Controls are generated from
   small builder functions; animatable properties get a ◆ keyframe
   button and update live while the playhead moves.
   ===================================================================== */
const secOpen = { clip: true, transform: true, text: true, shape: true, color: true, audio: true, proj: true, master: true, stats: true, tips: true, particles: true, viz: true, gpu: true, kf: true, multi: true };
let liveCtl = [];
function section(box, key, title, fn, badge) {
  const d = h('details', 'sec'); d.open = !!secOpen[key];
  d.addEventListener('toggle', () => secOpen[key] = d.open);
  d.append(h('summary', '', title + (badge ? ` <span class="badge">${badge}</span>` : ''))); const body = h('div', 'body'); d.append(body); fn(body); box.append(d); return body;
}
function bind(inp, c, path, parse, o = {}) {
  const apply = () => {
    if (!pend) { pend = snap(); pendLabel = o.label || 'Eigenschap gewijzigd'; }
    const v = parse(inp);
    if (o.set) o.set(v); else if (o.kf) setAnimated(c, path, v); else setP(c, path, v);
    if (o.after) o.after(v); requestDraw(); if (o.tl) updateClipEl(c);
  };
  inp.addEventListener('input', apply);
  inp.addEventListener('change', () => { if (!pend) apply(); const b = pend; pend = null; commit(b, pendLabel); });
}
function rng(box, c, label, path, min, max, step, o = {}) {
  const kfOk = o.kf && c && c.kf !== undefined;
  const cur = () => kfOk ? A(c, path, localT(c)) : getP(c, path);
  const show = o.disp || (x => +(+x).toFixed(2));
  const r = h('div', 'row', `<label title="Dubbelklik om te resetten">${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${cur()}"><span class="val">${show(cur())}</span>${kfOk ? `<button class="kfb${kfAt(c, path, localT(c)) ? ' on' : hasKf(c, path) ? ' anim' : ''}" title="Keyframe op afspeelkop (aan/uit)">◆</button>` : ''}`);
  const inp = $('input', r), val = $('.val', r), kb = $('.kfb', r);
  bind(inp, c, path, i => +i.value, Object.assign({ label: label + ' gewijzigd' }, o, { after: x => { val.textContent = show(x); o.after && o.after(x); } }));
  $('label', r).ondblclick = () => { const d = o.def ?? getP(DEF, path); if (d == null) return; edit(() => { if (o.set) o.set(d); else if (kfOk) setAnimated(c, path, d); else setP(c, path, d); }, label + ' gereset'); };
  if (kb) {
    kb.onclick = () => { edit(() => toggleKf(c, path), 'Keyframe ' + label); };
    liveCtl.push({ c, path, inp, val, show, kb });
  }
  box.append(r); return r;
}
function refreshLiveProps() {
  if (pend || !liveCtl.length) return;
  for (const L of liveCtl) {
    if (!hasKf(L.c, L.path) && !L.kb.classList.contains('on')) continue;
    const lt = localT(L.c), v = A(L.c, L.path, lt);
    if (document.activeElement !== L.inp) L.inp.value = v;
    L.val.textContent = L.show(v);
    L.kb.classList.toggle('on', !!kfAt(L.c, L.path, lt)); L.kb.classList.toggle('anim', hasKf(L.c, L.path));
  }
}
function chk(box, c, label, path, o = {}) { const r = h('label', 'chk', `<input type="checkbox" ${getP(c, path) ? 'checked' : ''}> ${label}`); bind($('input', r), c, path, i => i.checked, Object.assign({ label }, o)); box.append(r); return r; }
function col(box, c, label, path, o = {}) { const r = h('div', 'row', `<label>${label}</label><input type="color" value="${getP(c, path)}">`); bind($('input', r), c, path, i => i.value, Object.assign({ label }, o)); box.append(r); return r; }
function sel_(box, c, label, path, opts, o = {}) {
  const r = h('div', 'row', `<label>${label}</label><select>${opts.map(([v, n]) => `<option value="${esc(v)}" ${String(getP(c, path)) === String(v) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`);
  bind($('select', r), c, path, i => o.num ? +i.value : i.value, Object.assign({ label }, o)); box.append(r); return r;
}
function num(box, c, label, path, o = {}) {
  const r = h('div', 'row', `<label>${label}</label><input type="number" step="${o.step || 0.1}" value="${(+getP(c, path)).toFixed(o.dec ?? 2)}"> ${o.unit || ''}`);
  bind($('input', r), c, path, i => Math.max(o.min ?? -1e9, +i.value || 0), Object.assign({ label }, o)); box.append(r); return r;
}
function txt(box, c, label, path) { const r = h('div', 'row', `<label>${label}</label><input type="text" value="${esc(getP(c, path))}">`); bind($('input', r), c, path, i => i.value, { label }); box.append(r); return r; }
function btns(box, list) { const r = h('div', 'btnrow'); for (const [n, f, t] of list) { const b = h('button', '', n); if (t) b.title = t; b.onclick = f; r.append(b); } box.append(r); return r; }
const pct = x => Math.round(x * 100) + '%';
const deg = x => Math.round(x) + '°';
function renderProps() {
  const box = $('#propsBody'), st = $('#props').scrollTop; box.innerHTML = ''; liveCtl = [];
  if (selSet.size > 1) { multiProps(box); $('#props').scrollTop = st; return; }
  const c = sel && clipById(sel);
  if (!c) { projectProps(box); $('#props').scrollTop = st; return; }
  const m = media.get(c.mediaId), vis = kindOf(c) === 'visual';
  box.append(h('div', 'ptitle', `${TYPE_ICONS[c.type]} ${esc(c.type === 'text' ? c.text.split('\n')[0] : (c.name || TYPE_NAMES[c.type]))}`));
  box.append(h('div', 'psub', `${TYPE_NAMES[c.type]} · ${fmt(c.start)} – ${fmt(c.start + c.dur)}${m && m.w ? ` · ${m.w}×${m.h}` : ''}`));
  section(box, 'clip', '🎬 Clip', b => {
    if (c.type !== 'text') txt(b, c, 'Naam', 'name');
    num(b, c, 'Start', 'start', { unit: 's', min: 0, tl: true });
    num(b, c, 'Duur', 'dur', { unit: 's', min: 0.1, tl: true, set: v => { const mx = isAV(c) && m && isFinite(m.duration) ? (m.duration - c.in) / c.speed : 1e6; c.dur = clamp(v, 0.1, mx); } });
    if (isAV(c)) {
      rng(b, c, 'Snelheid', 'speed', 0.1, 8, 0.05, { disp: x => (+x).toFixed(2) + '×', def: 1, tl: true, set: v => { const src = c.dur * c.speed; c.speed = v; c.dur = src / v; } });
      const sp = v => () => edit(() => { const s = c.dur * c.speed; c.speed = v; c.dur = s / v; }, 'Snelheid ' + v + '×');
      btns(b, [['¼×', sp(.25)], ['½×', sp(.5)], ['1×', sp(1)], ['1,5×', sp(1.5)], ['2×', sp(2)], ['4×', sp(4)], ['8×', sp(8)]]);
      chk(b, c, 'Toonhoogte behouden bij snelheid', 'keepPitch');
    }
    const acts = [['✂️ Splitsen', actSplit], ['⧉ Dupliceren', actDup], ['🗑 Verwijderen', actDelete]];
    if (c.type === 'video') acts.push(['🔊 Audio loskoppelen', () => actDetach(c)], ['🧊 Freeze frame', () => actFreeze(c)], ['🎬 Scènes splitsen', () => actScenes(c)]);
    if (isAV(c)) acts.push(['🤫 Stiltes wegknippen', () => actSilence(c)], ['📈 Normaliseren', () => actNormalize(c)], ['🥁 Beats', () => actBeats(c)]);
    if (isMediaVis(c)) acts.push(['⛶ Beeldvullend', () => edit(() => { c.fit = 'cover'; c.scale = 1; c.x = c.y = .5; c.rot = 0; delete c.kf.x; delete c.kf.y; delete c.kf.scale; delete c.kf.rot; }, 'Beeldvullend')]);
    btns(b, acts);
  });
  if (c.type === 'text') section(box, 'text', '🅣 Tekst', b => {
    const ta = h('textarea'); ta.value = c.text; bind(ta, c, 'text', i => i.value, { label: 'Tekst gewijzigd' }); b.append(ta);
    b.append(h('div', 'hint', 'Variabelen: {aftellen} {tijd} {rest} {procent} {teller} {datum} {klok}'));
    sel_(b, c, 'Lettertype', 'font', FONTS.map(f => [f, f]));
    rng(b, c, 'Grootte', 'size', 8, 300, 1);
    const r = h('div', 'btnrow');
    for (const [k, n] of [['bold', '<b>B</b>'], ['italic', '<i>I</i>'], ['shadow', 'Schaduw'], ['glow', 'Gloed'], ['gradFill', 'Verloop']]) { const bt = h('button', c[k] ? 'on' : '', n); bt.onclick = () => edit(() => c[k] = !c[k], n.replace(/<[^>]+>/g, '')); r.append(bt); }
    for (const [a, n] of [['left', '⯇'], ['center', '≡'], ['right', '⯈']]) { const bt = h('button', c.align === a ? 'on' : '', n); bt.onclick = () => edit(() => c.align = a, 'Uitlijning'); r.append(bt); }
    b.append(r);
    col(b, c, 'Kleur', 'color'); col(b, c, 'Kleur 2', 'color2');
    rng(b, c, 'Letterafstand', 'spacing', -10, 60, 1); rng(b, c, 'Regelafstand', 'lineH', .8, 2.5, .05);
    rng(b, c, 'Rand dikte', 'strokeW', 0, 15, .5); col(b, c, 'Randkleur', 'stroke');
    rng(b, c, 'Achtergrond', 'bgOpacity', 0, 1, .01, { disp: pct }); col(b, c, 'Achtergr. kleur', 'bgColor'); rng(b, c, 'Opvulling', 'pad', 0, 80, 1);
    sel_(b, c, 'Tekstanimatie', 'tanim', TANIMS);
    if (/\{teller\}/.test(c.text)) { num(b, c, 'Teller van', 'countFrom', { step: 1, dec: 0 }); num(b, c, 'Teller tot', 'countTo', { step: 1, dec: 0 }); num(b, c, 'Decimalen', 'dec', { step: 1, dec: 0, min: 0 }); }
  });
  if (c.type === 'shape') section(box, 'shape', '◆ Vorm', b => {
    sel_(b, c, 'Vorm', 'shape', [['rect', 'Rechthoek'], ['ellipse', 'Ellips/cirkel'], ['triangle', 'Driehoek'], ['star', 'Ster'], ['arrow', 'Pijl'], ['heart', 'Hart'], ['hexagon', 'Zeshoek'], ['bubble', 'Tekstballon'], ['line', 'Lijn'], ['progress', 'Voortgangsbalk']]);
    col(b, c, 'Vulkleur', 'fill'); col(b, c, 'Randkleur', 'strokeC'); rng(b, c, 'Rand dikte', 'strokeW2', 0, 30, .5);
    rng(b, c, 'Breedte', 'w', .01, 1.5, .01, { disp: pct }); rng(b, c, 'Hoogte', 'h', .005, 1.5, .005, { disp: pct });
    if (c.shape === 'rect') rng(b, c, 'Hoekradius', 'cr', 0, 200, 1);
  });
  if (c.type === 'color') section(box, 'color', '🎨 Achtergrond', b => {
    col(b, c, 'Kleur 1', 'color'); chk(b, c, 'Verloop gebruiken', 'grad'); col(b, c, 'Kleur 2', 'color2'); rng(b, c, 'Hoek', 'angle', 0, 360, 1, { disp: deg }); chk(b, c, 'Verloop laten draaien', 'animGrad');
  });
  if (c.type === 'particles') section(box, 'particles', '❄ Deeltjes', b => {
    sel_(b, c, 'Soort', 'pkind', PARTICLES.map(([k, n]) => [k, n]));
    rng(b, c, 'Aantal', 'count', 5, 600, 1); rng(b, c, 'Snelheid', 'pspeed', .1, 4, .05); rng(b, c, 'Grootte', 'psize', .2, 4, .05); rng(b, c, 'Wind', 'wind', -2, 2, .05);
    chk(b, c, 'Meerdere kleuren', 'multi'); col(b, c, 'Kleur', 'pcolor');
    if (c.pkind === 'emoji') txt(b, c, 'Emoji', 'emoji');
    btns(b, [['🎲 Nieuwe variatie', () => edit(() => c.seed = Math.floor(Math.random() * 1000), 'Variatie')]]);
  });
  if (c.type === 'viz') section(box, 'viz', '📊 Visualizer', b => {
    b.append(h('div', 'hint', 'Reageert live op het geluid tijdens afspelen en exporteren.'));
    sel_(b, c, 'Stijl', 'vstyle', VIZ.map(([k, n]) => [k, n])); rng(b, c, 'Staven', 'bars', 8, 128, 1); rng(b, c, 'Gevoeligheid', 'sens', .2, 4, .05);
    col(b, c, 'Kleur onder', 'color'); col(b, c, 'Kleur boven', 'color2');
    rng(b, c, 'Breedte', 'w', .1, 1.5, .01, { disp: pct }); rng(b, c, 'Hoogte', 'h', .05, 1.2, .01, { disp: pct });
  });
  if (c.type === 'adjust') box.append(h('p', 'hint', '🎚 Een aanpassingslaag past filters, kleur, GPU-effecten en maskers toe op alles wat eronder zichtbaar is, zolang deze clip loopt.'));
  if (vis) section(box, 'transform', '⤢ Positie & formaat', b => {
    rng(b, c, 'Horizontaal', 'x', -0.5, 1.5, .001, { disp: pct, kf: true }); rng(b, c, 'Verticaal', 'y', -0.5, 1.5, .001, { disp: pct, kf: true });
    rng(b, c, 'Schaal', 'scale', .02, 4, .01, { disp: pct, kf: true }); rng(b, c, 'Draaiing', 'rot', -180, 180, 1, { disp: deg, kf: true });
    rng(b, c, 'Dekking', 'opacity', 0, 1, .01, { disp: pct, kf: true });
    const r = h('div', 'btnrow');
    for (const [k, n] of [['flipH', '⇋ Spiegel H'], ['flipV', '⇵ Spiegel V']]) { const bt = h('button', c[k] ? 'on' : '', n); bt.onclick = () => edit(() => c[k] = !c[k], n); r.append(bt); }
    const rs = h('button', '', '↺ Reset'); rs.onclick = () => edit(() => { Object.assign(c, { x: .5, y: .5, scale: 1, rot: 0, opacity: 1, flipH: false, flipV: false }); for (const k of ['x', 'y', 'scale', 'rot', 'opacity']) delete c.kf[k]; }, 'Transformatie gereset'); r.append(rs);
    b.append(r);
    b.append(h('div', 'muted', 'Beeld-in-beeld snelkeuze:'));
    const pos = [['↖', .2, .2], ['↗', .8, .2], ['↙', .2, .8], ['↘', .8, .8]];
    btns(b, [...pos.map(([n, x, y]) => [n, () => edit(() => { c.x = x; c.y = y; c.scale = .35; delete c.kf.x; delete c.kf.y; delete c.kf.scale; }, 'Beeld-in-beeld')]), ['⊙ Midden', () => edit(() => { c.x = c.y = .5; delete c.kf.x; delete c.kf.y; }, 'Gecentreerd')]]);
    if (isMediaVis(c)) {
      sel_(b, c, 'Passen', 'fit', [['contain', 'Passend (balken)'], ['cover', 'Vullen (bijsnijden)'], ['fill', 'Uitrekken']]);
      chk(b, c, 'Vervaagde achtergrond i.p.v. zwarte balken', 'bgFill');
      b.append(h('div', 'muted', 'Bijsnijden:'));
      rng(b, c, 'Links', 'crop.l', 0, .45, .005, { disp: pct }); rng(b, c, 'Rechts', 'crop.r', 0, .45, .005, { disp: pct });
      rng(b, c, 'Boven', 'crop.t', 0, .45, .005, { disp: pct }); rng(b, c, 'Onder', 'crop.b', 0, .45, .005, { disp: pct });
      rng(b, c, 'Hoekradius', 'radius', 0, 200, 1); rng(b, c, 'Kader', 'border', 0, 30, .5); col(b, c, 'Kaderkleur', 'borderColor'); chk(b, c, 'Slagschaduw', 'shadow');
    }
    sel_(b, c, 'Overvloeimodus', 'blend', [['source-over', 'Normaal'], ['multiply', 'Vermenigvuldigen'], ['screen', 'Bleken'], ['overlay', 'Bedekken'], ['darken', 'Donkerder'], ['lighten', 'Lichter'], ['color-dodge', 'Kleur tegenhouden'], ['color-burn', 'Kleur doordrukken'], ['hard-light', 'Fel licht'], ['soft-light', 'Zacht licht'], ['difference', 'Verschil'], ['exclusion', 'Uitsluiting'], ['hue', 'Kleurtoon'], ['saturation', 'Verzadiging'], ['color', 'Kleur'], ['luminosity', 'Helderheid']]);
  });
  section(box, 'kf', '◆ Keyframes & beweging', b => kfSection(b, c), allKfTimes(c).length || '');
  if (vis) section(box, 'mask', '◐ Masker', b => {
    sel_(b, c, 'Vorm', 'mask.type', [['none', 'Geen'], ['ellipse', 'Ellips/cirkel'], ['rect', 'Rechthoek'], ['rounded', 'Afgeronde rechthoek'], ['heart', 'Hart'], ['star', 'Ster'], ['triangle', 'Driehoek'], ['hexagon', 'Zeshoek'], ['linear', 'Lineair verloop']]);
    if (c.mask.type !== 'none') {
      rng(b, c, 'Breedte', 'mask.w', .05, 2, .01, { disp: pct, kf: true }); rng(b, c, 'Hoogte', 'mask.h', .05, 2, .01, { disp: pct, kf: true });
      rng(b, c, 'Positie X', 'mask.x', -1, 1, .005, { disp: pct, kf: true }); rng(b, c, 'Positie Y', 'mask.y', -1, 1, .005, { disp: pct, kf: true });
      rng(b, c, 'Draaiing', 'mask.rot', -180, 180, 1, { disp: deg }); rng(b, c, 'Zachte rand', 'mask.feather', 0, 120, 1);
      chk(b, c, 'Masker omkeren', 'mask.invert');
    }
  }, c.mask.type !== 'none' ? 'aan' : '');
  if (vis) section(box, 'filters', '🌈 Kleur & filters', b => {
    const g = h('div', 'pgrid');
    Object.entries(PRESETS).forEach(([n, p]) => { const d = h('div', '', `<div class="pv" style="filter:${presetCss(p)};${m && m.thumb ? `background-image:url(${m.thumb})` : ''}"></div>${n}`); d.onclick = () => applyPreset(c, p); g.append(d); });
    b.append(g);
    rng(b, c, 'Helderheid', 'f.brightness', 0, 200, 1, { disp: x => Math.round(x) + '%', kf: true }); rng(b, c, 'Contrast', 'f.contrast', 0, 200, 1, { disp: x => x + '%' });
    rng(b, c, 'Verzadiging', 'f.saturate', 0, 300, 1, { disp: x => Math.round(x) + '%', kf: true }); rng(b, c, 'Kleurtoon', 'f.hue', -180, 180, 1, { disp: deg, kf: true });
    rng(b, c, 'Vervaging', 'f.blur', 0, 30, .1, { disp: x => (+x).toFixed(1) + 'px', kf: true }); rng(b, c, 'Zwart-wit', 'f.grayscale', 0, 100, 1, { disp: x => x + '%' });
    rng(b, c, 'Sepia', 'f.sepia', 0, 100, 1, { disp: x => x + '%' }); rng(b, c, 'Negatief', 'f.invert', 0, 100, 1, { disp: x => x + '%' });
    col(b, c, 'Tintkleur', 'tint.color'); rng(b, c, 'Tint sterkte', 'tint.amt', 0, 1, .01, { disp: pct }); rng(b, c, 'Vignet', 'vignette', 0, 1, .01, { disp: pct });
    btns(b, [['↺ Filters resetten', () => applyPreset(c, {})]]);
  });
  if (vis) section(box, 'gpu', '✨ GPU-effecten', b => gpuSection(b, c), c.fx.length || '');
  if (vis) section(box, 'effects', '🎞 Animatie & green screen', b => {
    sel_(b, c, 'Doorlopende animatie', 'anim', ANIMS);
    if (isMediaVis(c)) {
      b.append(h('div', 'muted', 'Green screen (chroma key, GPU):'));
      chk(b, c, 'Achtergrondkleur verwijderen', 'chroma.on'); col(b, c, 'Sleutelkleur', 'chroma.color');
      btns(b, [['🟩 Groen', () => edit(() => { c.chroma.color = '#00ff00'; c.chroma.on = true; }, 'Green screen')], ['🟦 Blauw', () => edit(() => { c.chroma.color = '#0047ff'; c.chroma.on = true; }, 'Blue screen')], ['🎯 Pipet (links)', () => pickKey(c)]]);
      rng(b, c, 'Tolerantie', 'chroma.tol', 0, 120, 1); rng(b, c, 'Zachtheid', 'chroma.soft', 0, 100, 1);
    }
  });
  if (vis) section(box, 'trans', '🔀 Overgangen', b => {
    sel_(b, c, 'In', 'tin.type', TRANS.map(t => [t[0], t[1]]), { after: () => renderTimeline() }); rng(b, c, 'Duur in', 'tin.dur', .1, 3, .1, { disp: x => x + 's' });
    sel_(b, c, 'Uit', 'tout.type', TRANS.map(t => [t[0], t[1]]), { after: () => renderTimeline() }); rng(b, c, 'Duur uit', 'tout.dur', .1, 3, .1, { disp: x => x + 's' });
  });
  if (isAV(c)) section(box, 'audio', '🔊 Audio', b => {
    if (c.type === 'video' && m && m.hasAudio === false) b.append(h('p', 'hint', 'Deze video heeft geen geluidsspoor.'));
    rng(b, c, 'Volume', 'vol', 0, 3, .01, { disp: pct, kf: true, after: () => renderWaveOf(c) }); chk(b, c, 'Dempen', 'muted', { after: () => renderTimeline() });
    rng(b, c, 'Balans (L/R)', 'pan', -1, 1, .01, { kf: true, disp: x => Math.abs(x) < .005 ? 'C' : (x < 0 ? 'L' : 'R') + Math.round(Math.abs(x) * 100) });
    rng(b, c, 'Fade-in', 'fadeIn', 0, 10, .1, { disp: x => x + 's', after: () => renderWaveOf(c) }); rng(b, c, 'Fade-out', 'fadeOut', 0, 10, .1, { disp: x => x + 's', after: () => renderWaveOf(c) });
    b.append(h('div', 'muted', 'Equalizer & filters:'));
    const dB = x => (x > 0 ? '+' : '') + x + 'dB', hz = x => +x === 0 ? 'uit' : (x >= 1000 ? (x / 1000).toFixed(1) + 'k' : x) + 'Hz';
    rng(b, c, 'Bas', 'bass', -15, 15, .5, { disp: dB }); rng(b, c, 'Midden', 'mid', -15, 15, .5, { disp: dB }); rng(b, c, 'Hoge tonen', 'treble', -15, 15, .5, { disp: dB });
    rng(b, c, 'Laag afsnijden', 'lowcut', 0, 1000, 10, { disp: hz }); rng(b, c, 'Hoog afsnijden', 'highcut', 0, 20000, 100, { disp: hz });
    b.append(h('div', 'muted', 'Effecten:'));
    rng(b, c, 'Vervorming', 'drive', 0, 1, .01, { disp: pct });
    rng(b, c, 'Echo mix', 'echo.mix', 0, 1, .01, { disp: pct }); rng(b, c, 'Echo tijd', 'echo.time', .02, 1.5, .01, { disp: x => (+x).toFixed(2) + 's' }); rng(b, c, 'Echo herhaling', 'echo.fb', 0, .9, .01, { disp: pct });
    rng(b, c, 'Galm mix', 'reverb.mix', 0, 1, .01, { disp: pct }); rng(b, c, 'Galm ruimte', 'reverb.size', .3, 6, .1, { disp: x => (+x).toFixed(1) + 's' });
    b.append(h('div', 'muted', 'Voorinstellingen:'));
    btns(b, Object.keys(AUDIO_PRESETS).map(n => [n, () => edit(() => applyAudioPreset(c, AUDIO_PRESETS[n]), 'Audio: ' + n)]));
  });
  $('#props').scrollTop = st;
}
function kfSection(b, c) {
  const lt = localT(c);
  b.append(h('div', 'hint', `Afspeelkop in clip: ${fmt(lt)}. Klik ◆ naast een schuifje om een keyframe te zetten; daarna maakt elke wijziging automatisch keyframes. Slepen in het voorbeeld werkt ook.`));
  btns(b, [['⏮ Vorige', () => { const t = kfNeighbour(c, null, -1); if (t != null) setPlayhead(c.start + t); }], ['Volgende ⏭', () => { const t = kfNeighbour(c, null, 1); if (t != null) setPlayhead(c.start + t); }], ['🗑 Alles wissen', () => edit(() => c.kf = {}, 'Keyframes gewist')]]);
  const ps = h('div', 'row', `<label>Bewegingspreset</label><select><option value="">Kies…</option>${Object.keys(KF_PRESETS).map(k => `<option>${k}</option>`).join('')}</select>`);
  $('select', ps).onchange = e => { const k = e.target.value; if (!k) return; edit(() => KF_PRESETS[k](c), 'Beweging: ' + k); };
  b.append(ps);
  for (const [path, list] of Object.entries(c.kf || {})) {
    if (!list.length) continue;
    const g = h('div', 'kfgroup'); g.append(h('div', 'kfname', `◆ ${ANIMATABLE[path] || path}`));
    list.forEach(k => {
      const row = h('div', 'kfrow', `<button class="kft" title="Ga naar keyframe">${fmt(k.t)}</button><span class="kfv">${(+k.v).toFixed(path === 'rot' || path.startsWith('f.') ? 0 : 2)}</span><select>${Object.entries(EASES).map(([e, [n]]) => `<option value="${e}" ${k.e === e ? 'selected' : ''}>${n}</option>`).join('')}</select><button class="kfdel" title="Verwijderen">✕</button>`);
      $('.kft', row).onclick = () => setPlayhead(c.start + k.t);
      $('select', row).onchange = e => edit(() => k.e = e.target.value, 'Easing');
      $('.kfdel', row).onclick = () => edit(() => delKf(c, path, k.t), 'Keyframe verwijderd');
      g.append(row);
    });
    b.append(g);
  }
}
function gpuSection(b, c) {
  const r = h('div', 'row', `<label>Effect toevoegen</label><select><option value="">Kies…</option>${FX_CATS.map(cat => `<optgroup label="${cat}">${Object.values(FX).filter(f => f.cat === cat).map(f => `<option value="${f.key}">${f.icon} ${f.name}</option>`).join('')}</optgroup>`).join('')}</select>`);
  $('select', r).onchange = e => { if (e.target.value) addFxTo(c, e.target.value); };
  b.append(r);
  if (!c.fx.length) { b.append(h('div', 'hint', 'Nog geen effecten. Kies er een hierboven of uit het tabblad ✨ Effecten.')); return; }
  c.fx.forEach((f, i) => {
    const def = FX[f.type]; if (!def) return;
    const box = h('div', 'fxbox' + (f.on ? '' : ' off'));
    const hd = h('div', 'fxhead', `<label class="chk"><input type="checkbox" ${f.on ? 'checked' : ''}> ${def.icon} ${def.name}</label><span class="grow"></span><button title="Omhoog">▲</button><button title="Omlaag">▼</button><button title="Verwijderen">✕</button>`);
    $('input', hd).onchange = e => edit(() => f.on = e.target.checked, def.name + (f.on ? ' uit' : ' aan'));
    const [up, dn, del] = $$('button', hd);
    up.onclick = () => { if (i > 0) edit(() => { c.fx.splice(i, 1); c.fx.splice(i - 1, 0, f); }, 'Effectvolgorde'); };
    dn.onclick = () => { if (i < c.fx.length - 1) edit(() => { c.fx.splice(i, 1); c.fx.splice(i + 1, 0, f); }, 'Effectvolgorde'); };
    del.onclick = () => edit(() => c.fx.splice(i, 1), 'Effect verwijderd');
    box.append(hd);
    for (const [k, p] of Object.entries(def.params)) {
      if (p[0] === 'color') col(box, c, p[1], `fx.${i}.p.${k}`);
      else rng(box, c, p[0], `fx.${i}.p.${k}`, p[1], p[2], p[3], { def: p[4] });
    }
    b.append(box);
  });
}
function renderWaveOf(c) { const d = tracksEl.querySelector(`.clip[data-id="${c.id}"] canvas.wf`), m = media.get(c.mediaId); if (d && m && m.peaks) drawWave(d, c, m); }
function pickKey(c) {
  const el = getEl(c), m = media.get(c.mediaId); const src = c.type === 'video' ? el : m && m.img; if (!src) return;
  const k = document.createElement('canvas'); k.width = 8; k.height = 8; const g = k.getContext('2d', { willReadFrequently: true });
  const sw = c.type === 'video' ? el.videoWidth : m.w, sh = c.type === 'video' ? el.videoHeight : m.h;
  g.drawImage(src, sw * .03, sh * .45, sw * .04, sh * .1, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
  const hx = v => Math.round(v / 64).toString(16).padStart(2, '0');
  edit(() => { c.chroma.color = '#' + hx(r) + hx(gg) + hx(b); c.chroma.on = true; }, 'Sleutelkleur gekozen');
}
function multiProps(box) {
  const list = selectedClips();
  box.append(h('div', 'ptitle', `🗂 ${list.length} clips geselecteerd`));
  box.append(h('div', 'psub', `${fmt(Math.min(...list.map(c => c.start)))} – ${fmt(Math.max(...list.map(c => c.start + c.dur)))}`));
  section(box, 'multi', '⚙ Bewerk alles tegelijk', b => {
    btns(b, [['🗑 Verwijderen', actDelete], ['⇤ Ripple', actRipple], ['⧉ Dupliceren', actDup], ['↔ Achter elkaar', actSequence], ['◐ Fades op alles', actCrossfadeAll], ['🥁 Knippen op beats', actCutOnBeats]]);
    const dr = h('div', 'row', `<label>Zelfde duur</label><input type="number" step="0.1" min="0.1" value="${S.imgDur}"><button>Toepassen</button>`);
    $('button', dr).onclick = () => { const d = +$('input', dr).value || S.imgDur; edit(() => list.forEach(c => { if (!isAV(c)) c.dur = d; }), 'Duur gelijk gemaakt'); };
    b.append(dr);
    const fp = h('div', 'row', `<label>Filter op alles</label><select><option value="">Kies…</option>${Object.keys(PRESETS).map(k => `<option>${k}</option>`).join('')}</select>`);
    $('select', fp).onchange = e => { const p = PRESETS[e.target.value]; if (p) list.filter(c => kindOf(c) === 'visual').forEach(c => applyPreset(c, p)); };
    b.append(fp);
    const vr = h('div', 'row', `<label>Volume op alles</label><input type="range" min="0" max="2" step="0.01" value="1"><span class="val">100%</span>`);
    bind($('input', vr), null, '', i => +i.value, { label: 'Volume (meerdere)', set: v => { list.filter(isAV).forEach(c => c.vol = v); $('.val', vr).textContent = pct(v); } });
    b.append(vr);
  });
}
function projectProps(box) {
  box.append(h('div', 'ptitle', '🎞 Project'));
  box.append(h('div', 'psub', 'Selecteer een clip om die te bewerken (Shift+klik of Shift+slepen voor meerdere).'));
  section(box, 'proj', '⚙️ Instellingen', b => {
    txt(b, P, 'Naam', 'name');
    sel_(b, P, 'Beeldverhouding', 'ratio', [...$('#ratioSel').options].map(o => [o.value, o.text]), { after: () => ensureCanvasDims() });
    col(b, P, 'Achtergrond', 'bg');
  });
  section(box, 'master', '🎚 Master-audio', b => {
    rng(b, P, 'Mastervolume', 'masterVol', 0, 2, .01, { disp: pct, after: () => routeMaster() });
    chk(b, P, 'Limiter (voorkomt oversturing)', 'limiter', { after: () => routeMaster() });
    b.append(h('div', 'hint', 'Ducking: markeer een audiotrack met 🎙 als spraak en de muziektrack met 🦆; de muziek wordt dan automatisch zachter als er gesproken wordt.'));
  });
  const d = projectDur();
  section(box, 'stats', '📊 Overzicht', b => {
    const fxn = P.clips.reduce((n, c) => n + (c.fx ? c.fx.length : 0), 0), kfn = P.clips.reduce((n, c) => n + allKfTimes(c).length, 0);
    b.innerHTML = `<div class="keys"><span class="muted">Duur</span><span>${fmt(d)}</span><span class="muted">Clips</span><span>${P.clips.length}</span><span class="muted">Tracks</span><span>${P.tracks.length}</span><span class="muted">Media</span><span>${media.size}</span><span class="muted">Markeringen</span><span>${P.markers.length}</span><span class="muted">GPU-effecten</span><span>${fxn}</span><span class="muted">Keyframes</span><span>${kfn}</span><span class="muted">Ongedaan-stappen</span><span>${undoStack.length}</span></div>`;
  });
  section(box, 'tips', '💡 Tips', b => {
    b.innerHTML = `<p class="hint">• <b>Ctrl+K</b> opent het commandopalet: typ wat je wilt doen.<br>• <b>Knippen:</b> afspeelkop zetten en <span class="kbd">S</span>.<br>• <b>Keyframes:</b> klik ◆ naast een schuifje, verplaats de afspeelkop en wijzig de waarde.<br>• <b>Meerdere clips:</b> Shift+klik of Shift+slepen over de tijdlijn.<br>• <b>GPU-effecten</b> zet je ook op een <b>Aanpassingslaag</b> (Elementen) om alles eronder te beïnvloeden.<br>• <b>Rechtsklik</b> op een clip voor beats, scènes, stiltes en meer.<br>• <b>Projectpakket (.ksp)</b> bewaart project én media in één bestand.</p>`;
  });
}
