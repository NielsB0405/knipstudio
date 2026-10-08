'use strict';
/* =====================================================================
   Left side panels (media, record, text, audio, elements, …)
   ===================================================================== */
const ITEMS = new Map();
async function makeFromKey(key) {
  if (key.startsWith('m:')) { const m = media.get(key.slice(2)); return m ? clipFromMedia(m) : null; }
  const f = ITEMS.get(key); return f ? await f() : null;
}
function addAtPlayhead(c) {
  if (!c) return; edit(() => { c.start = playhead; addClip(c); select(c.id); }, 'Toegevoegd: ' + (c.name || TYPE_NAMES[c.type]));
  if (c.type === 'text') focusTextBox();
}
function focusTextBox() { secOpen.text = true; renderProps(); setTimeout(() => { const t = $('#propsBody textarea'); if (t) { $('#props').scrollTop = 0; t.focus(); t.select(); } }, 30); }
function regItem(el, key, make) {
  ITEMS.set(key, make); el.draggable = true;
  el.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', 'kn:' + key));
  el.addEventListener('click', async e => { if (e.target.closest('button')) return; addAtPlayhead(await make()); });
}
function addMediaToEnd(m) {
  edit(() => {
    const c = clipFromMedia(m), tr = mainTrack(kindOf(c));
    c.start = kindOf(c) === 'audio' ? playhead : (tr ? trackEnd(tr.id) : 0);
    addClip(c, tr && tr.id); select(c.id);
  }, 'Toegevoegd: ' + m.name);
}
const soundMedia = {};
async function soundClip(s) {
  let m = soundMedia[s.k] && media.get(soundMedia[s.k]);
  if (!m) { toast('Geluid genereren…'); const ab = await renderSound(s); [m] = await importFiles([new File([wavBlob(ab)], s.n + '.wav', { type: 'audio/wav' })]); soundMedia[s.k] = m.id; }
  return clipFromMedia(m);
}
let previewSrc = null;
async function previewSound(s) {
  ensureAudio(); if (previewSrc) { try { previewSrc.stop(); } catch (e) { } }
  const ab = await renderSound(s); previewSrc = AC.createBufferSource(); previewSrc.buffer = ab; previewSrc.connect(AC.destination); previewSrc.start();
}

let curPanel = 'media', mediaFilter = 'all', mediaSearch = '', fxCat = 'Alle';
function renderPanelIfMedia() { if (curPanel === 'media') renderPanel(); }
function renderPanel() { const box = $('#panelBody'); box.innerHTML = ''; PANELS[curPanel](box); $$('#side button').forEach(x => x.classList.toggle('act', x.dataset.panel === curPanel)); }
function showPanel(k) { curPanel = k; renderPanel(); }

const TEXT_TPL = [
  { n: 'Titel', p: { text: 'Grote titel', size: 110, tanim: 'pop' } },
  { n: 'Ondertitel', p: { text: 'Een ondertitel', size: 54, bold: false, y: .62, tanim: 'fade' } },
  { n: 'Lower third', p: { text: 'Naam Achternaam\nFunctie', size: 40, align: 'left', x: .26, y: .84, bgOpacity: .85, bgColor: '#7c5cff', tanim: 'slide-up', pad: 24, shadow: false } },
  { n: 'Neon', p: { text: 'NEON', font: 'Arial Black', size: 120, color: '#ff3df2', glow: true, shadow: false, tanim: 'fade' } },
  { n: 'Typemachine', p: { text: 'Er was eens…', font: 'Courier New', size: 64, tanim: 'typewriter', bold: false } },
  { n: 'Aftiteling', p: { text: 'REGIE\nJouw Naam\n\nMUZIEK\nJouw Naam\n\nBedankt voor het kijken!', size: 46, tanim: 'credits', dur: 10, lineH: 1.5 } },
  { n: 'Ondertiteling', p: { text: 'Dit is een ondertitel', size: 40, y: .88, bgOpacity: .6, pad: 14, bold: false, shadow: false } },
  { n: 'Citaat', p: { text: '"Een mooi citaat"\n— Iemand', font: 'Georgia', italic: true, size: 60, bold: false, tanim: 'letters' } },
  { n: 'Omlijnd', p: { text: 'OMLIJND', font: 'Impact', size: 130, color: '#ffdd00', strokeW: 5, bold: false } },
  { n: 'Golvend', p: { text: 'Golvende tekst', size: 90, tanim: 'wave', color: '#3ddc97', font: 'Arial Black' } },
  { n: 'Vallende letters', p: { text: 'BOEM!', size: 140, tanim: 'drop', font: 'Impact', color: '#ffd84d', bold: false, strokeW: 4 } },
  { n: 'Karaoke', p: { text: 'Zing maar mee met dit liedje', size: 56, tanim: 'karaoke', color: '#ffffff', color2: '#ff5c7a', strokeW: 3, y: .85 } },
  { n: 'Ontcijferen', p: { text: 'TOEGANG VERLEEND', font: 'Consolas', size: 64, tanim: 'scramble', color: '#3ddc97' } },
  { n: 'Glitch-tekst', p: { text: 'GLITCH', font: 'Arial Black', size: 130, tanim: 'glitchtext' } },
  { n: 'Regenboog', p: { text: 'Regenboog!', size: 110, tanim: 'rainbow', font: 'Arial Black' } },
  { n: 'Verloop', p: { text: 'VERLOOP', size: 130, font: 'Arial Black', gradFill: true, color: '#ffd84d', color2: '#ff3d6e', shadow: true } },
  { n: 'Label', p: { text: 'NIEUW', size: 44, bgOpacity: 1, bgColor: '#ff5c7a', pad: 18, x: .82, y: .14, rot: -6, shadow: false, tanim: 'pop' } },
  { n: 'Handschrift', p: { text: 'Mooie herinnering', font: 'Segoe Script', size: 72, bold: false, tanim: 'fade' } },
  { n: 'Aftellen', p: { text: '{aftellen}', size: 220, font: 'Arial Black', dur: 5, tanim: 'none' } },
  { n: 'Teller', p: { text: '{teller} volgers', size: 90, countFrom: 0, countTo: 10000, tanim: 'none' } },
  { n: 'Stopwatch', p: { text: '⏱ {tijd}', size: 70, x: .85, y: .1, font: 'Consolas', bgOpacity: .5, pad: 14, dur: 30 } },
  { n: 'Datum', p: { text: '{datum}', size: 48, x: .2, y: .1, bold: false, bgOpacity: .4, pad: 12 } },
];
const FONTS = ['Segoe UI', 'Arial', 'Arial Black', 'Impact', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS', 'Comic Sans MS', 'Tahoma', 'Consolas', 'Palatino Linotype', 'Bahnschrift', 'Segoe Script', 'Lucida Handwriting', 'Gabriola', 'Franklin Gothic Medium', 'Candara', 'Cambria', 'Ink Free', 'Segoe Print'];
const EMOJI = ['😀', '😂', '😍', '🥳', '😎', '🤯', '😱', '🤔', '😭', '👍', '👏', '🙌', '🔥', '💯', '⭐', '✨', '❤️', '💔', '🎉', '🎂', '🎵', '📌', '✅', '❌', '⚠️', '➡️', '⬅️', '⬆️', '⬇️', '💡', '📷', '🎬', '🚀', '🌈', '☀️', '🌙', '⚡', '💥', '💬', '👀', '🏆', '🎁', '🍕', '⚽', '🐶', '🐱', '🌍', '🎮', '💰', '📍'];
const SHAPES = [['rect', '▬ Rechthoek', {}], ['rect', '▢ Afgerond', { cr: 40 }], ['ellipse', '● Cirkel', { w: .25, h: .25 * 16 / 9 }], ['triangle', '▲ Driehoek', {}], ['star', '★ Ster', { fill: '#ffd84d' }], ['arrow', '➜ Pijl', { w: .3, h: .18, fill: '#ff5c7a' }], ['heart', '❤ Hart', { fill: '#ff3d6e' }], ['hexagon', '⬢ Zeshoek', { fill: '#3ddc97' }], ['bubble', '💬 Tekstballon', { fill: '#ffffff', w: .35, h: .25 }], ['line', '— Lijn', { w: .5, h: .1, fill: '#ffffff' }], ['progress', '▰ Voortgangsbalk', { w: .9, h: .025, y: .96, fill: '#7c5cff', strokeC: '#ffffff' }]];
const PARTICLES = [['confetti', '🎊 Confetti'], ['snow', '❄ Sneeuw'], ['rain', '🌧 Regen'], ['sparkles', '✨ Sterretjes'], ['hearts', '💕 Hartjes'], ['bubbles', '🫧 Bellen'], ['fireflies', '🪲 Vuurvliegjes'], ['warp', '🌌 Warp-sterren'], ['fireworks', '🎆 Vuurwerk'], ['emoji', '😀 Emoji-regen']];
const VIZ = [['bars', '📊 Staven'], ['mirror', '⏸ Gespiegeld'], ['wave', '〰 Golf'], ['circle', '⭕ Cirkel'], ['dots', '⠿ Stippen']];
const COLORS = ['#000000', '#ffffff', '#7c5cff', '#ff5c7a', '#3ddc97', '#ffb020', '#2d9cff', '#1e1e2e', '#ff7a00', '#00c2c7', '#f5e6c8', '#2e7d32'];
const GRADS = [['#7c5cff', '#ff5c7a'], ['#00c6ff', '#0072ff'], ['#f7971e', '#ffd200'], ['#11998e', '#38ef7d'], ['#fc466b', '#3f5efb'], ['#232526', '#414345'], ['#ee9ca7', '#ffdde1'], ['#0f2027', '#2c5364']];
const TRANS = [['none', 'Geen', '∅'], ['fade', 'Vervagen', '◐'], ['dip', 'Via zwart', '■'], ['flash', 'Via wit', '□'], ['slide-left', 'Schuif links', '⇠'], ['slide-right', 'Schuif rechts', '⇢'], ['slide-up', 'Schuif omhoog', '⇡'], ['slide-down', 'Schuif omlaag', '⇣'], ['zoom-in', 'Inzoomen', '⊕'], ['zoom-out', 'Uitzoomen', '⊖'], ['wipe-left', 'Veeg links', '◧'], ['wipe-right', 'Veeg rechts', '◨'], ['wipe-up', 'Veeg omhoog', '⬒'], ['wipe-down', 'Veeg omlaag', '⬓'], ['circle', 'Cirkel', '◯'], ['diamond', 'Ruit', '◇'], ['blinds', 'Jaloezie', '☰'], ['blur', 'Vervaging', '≋'], ['spin', 'Draaien', '↻'], ['bounce', 'Stuiteren', '⤓'], ['glitch', 'Glitch', '⚡']];
const ANIMS = [['none', 'Geen'], ['kb-in', 'Langzaam inzoomen (Ken Burns)'], ['kb-out', 'Langzaam uitzoomen'], ['pan-l', 'Pannen naar links'], ['pan-r', 'Pannen naar rechts'], ['shake', 'Schudden'], ['pulse', 'Pulseren'], ['heartbeat', 'Hartslag'], ['float', 'Zweven'], ['swing', 'Slingeren'], ['spin', 'Ronddraaien'], ['wobble', 'Wiebelen']];
const TANIMS = [['none', 'Geen'], ['fade', 'In-/uitfaden'], ['pop', 'Pop'], ['slide-up', 'Omhoog schuiven'], ['typewriter', 'Typemachine'], ['bounce', 'Stuiteren'], ['credits', 'Aftiteling (scrollen)'], ['letters', 'Letter voor letter'], ['wave', 'Golf (per letter)'], ['drop', 'Vallende letters'], ['zoomletters', 'Inzoomende letters'], ['karaoke', 'Karaoke-kleur'], ['rainbow', 'Regenboog'], ['scramble', 'Ontcijferen'], ['glitchtext', 'Glitch']];
const PRESETS = {
  'Origineel': {}, 'Zwart-wit': { f: { grayscale: 100, contrast: 110 } }, 'Vintage': { f: { sepia: 50, contrast: 90, saturate: 80, brightness: 105 }, vignette: .35 },
  'Warm': { f: { saturate: 115 }, tint: { color: '#ff8a00', amt: .15 } }, 'Koel': { f: { saturate: 95 }, tint: { color: '#2d7bff', amt: .18 } },
  'Levendig': { f: { saturate: 165, contrast: 112 } }, 'Dramatisch': { f: { contrast: 150, saturate: 80, brightness: 92 }, vignette: .55 },
  'Noir': { f: { grayscale: 100, contrast: 165, brightness: 90 }, vignette: .6 }, 'Vervaagd': { f: { contrast: 80, saturate: 70, brightness: 112 } },
  'Dromerig': { f: { blur: 1, brightness: 110, saturate: 120 }, tint: { color: '#ff7ad9', amt: .14 } }, 'Neon': { f: { saturate: 220, contrast: 130, hue: 20 } },
  'Zomer': { f: { saturate: 135, brightness: 108 }, tint: { color: '#ffb020', amt: .12 } }, 'Winter': { f: { saturate: 70, brightness: 106 }, tint: { color: '#8fd3ff', amt: .2 } },
  'Retro': { f: { sepia: 30, hue: -15, contrast: 120 }, vignette: .3 }, 'Sepia': { f: { sepia: 100 } }, 'Negatief': { f: { invert: 100 } },
  'Cinematisch': { f: { contrast: 120, saturate: 85 }, tint: { color: '#00a2a8', amt: .14 }, vignette: .4 }, 'Groen-tint': { tint: { color: '#29ff6a', amt: .2 } },
};
function presetCss(p) {
  const f = Object.assign({}, DEF.f, p.f || {});
  return `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%) hue-rotate(${f.hue}deg) grayscale(${f.grayscale}%) sepia(${f.sepia}%) invert(${f.invert}%)`;
}
function applyPreset(c, p) {
  edit(() => { c.f = Object.assign({}, DEF.f, deepClone(p.f || {})); c.tint = Object.assign({}, DEF.tint, p.tint || { amt: 0 }); c.vignette = p.vignette || 0; }, 'Filter');
}
let transTarget = 'in';
/* sample image used for effect previews */
function samplePreview() {
  const c = sel && clipById(sel), m = c && media.get(c.mediaId);
  const k = document.createElement('canvas'); k.width = 160; k.height = 90; const g = k.getContext('2d');
  if (m && (m.img || m.thumbImg)) { g.drawImage(m.img || m.thumbImg, 0, 0, 160, 90); return k; }
  const gr = g.createLinearGradient(0, 0, 160, 90); gr.addColorStop(0, '#ff9a3c'); gr.addColorStop(.4, '#ff3c6e'); gr.addColorStop(.75, '#3c8cff'); gr.addColorStop(1, '#3cff9a');
  g.fillStyle = gr; g.fillRect(0, 0, 160, 90); g.fillStyle = '#fff'; g.beginPath(); g.arc(60, 45, 22, 0, 7); g.fill(); g.fillStyle = '#111'; g.fillRect(95, 20, 40, 50);
  g.fillStyle = '#fff'; g.font = 'bold 14px Segoe UI'; g.fillText('Aa', 104, 50); return k;
}
const PANELS = {
  media(box) {
    box.append(h('h3', '', 'Jouw media'));
    const b = h('button', 'primary big', '＋ Media importeren'); b.onclick = () => $('#fileIn').click(); box.append(b);
    box.append(h('p', 'hint', 'Video, audio of afbeeldingen — ook slepen of plakken (Ctrl+V) kan. Klik om aan het eind toe te voegen of sleep naar een track.'));
    const s = h('input'); s.type = 'search'; s.placeholder = '🔍 Zoeken…'; s.value = mediaSearch; s.className = 'search'; s.oninput = () => { mediaSearch = s.value; renderPanel(); setTimeout(() => { const n = $('#panelBody .search'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }; box.append(s);
    const fl = h('div', 'filters');
    [['all', 'Alles'], ['video', 'Video'], ['audio', 'Audio'], ['image', 'Afbeeldingen']].forEach(([k, n]) => { const x = h('button', mediaFilter === k ? 'on' : '', n); x.onclick = () => { mediaFilter = k; renderPanel(); }; fl.append(x); });
    box.append(fl);
    const list = [...media.values()].filter(m => (mediaFilter === 'all' || m.type === mediaFilter) && m.name.toLowerCase().includes(mediaSearch.toLowerCase()));
    if (!list.length) box.append(h('p', 'hint', 'Nog geen media. Importeer iets, of probeer tekst, deeltjes, achtergronden en geluiden uit de andere tabbladen.'));
    const g = h('div', 'mgrid'); box.append(g);
    for (const m of list) {
      const used = P.clips.filter(c => c.mediaId === m.id).length;
      const card = h('div', 'mcard' + (m.missing ? ' missing' : ''));
      const th = h('div', 'mth');
      if (m.thumb) th.style.backgroundImage = `url(${m.thumb})`; else th.textContent = m.busy ? '⏳' : (TYPE_ICONS[m.type] || '?');
      if (m.type !== 'image' && m.duration) th.append(h('span', 'dur', fmtS(m.duration)));
      if (used) th.append(h('span', 'used', '✓' + (used > 1 ? used : '')));
      if (m.proxyState && m.proxyState !== 'klaar') { const pb = h('span', 'proxy', m.proxyState === 'mislukt' ? '⚠' : '⚙ ' + m.proxyState); pb.title = m.proxyState === 'mislukt' ? 'Voorbeeldversie maken mislukt (origineel wordt gebruikt)' : 'Lichte voorbeeldversie wordt gemaakt voor soepel afspelen'; th.append(pb); }
      const add = h('button', 'add', '+'); add.title = 'Toevoegen aan tijdlijn'; add.onclick = e => { e.stopPropagation(); if (!m.missing) addMediaToEnd(m); };
      const del = h('button', 'del', '✕'); del.title = 'Verwijderen'; del.onclick = e => { e.stopPropagation(); removeMedia(m); };
      th.append(add, del); card.append(th, h('div', 'mn', (m.missing ? '⚠ ' : '') + esc(m.name)));
      card.title = m.missing ? 'Ontbreekt: importeer dit bestand opnieuw om te koppelen' : `${m.name}${m.w ? ` · ${m.w}×${m.h}` : ''}${m.duration && m.type !== 'image' ? ' · ' + fmt(m.duration) : ''}`;
      card.draggable = !m.missing; card.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', 'kn:m:' + m.id));
      card.addEventListener('click', () => { if (!m.missing) addMediaToEnd(m); });
      g.append(card);
    }
    if ([...media.values()].some(m => m.type === 'image')) { const sb = h('button', 'big', '🖼 Diavoorstelling maken…'); sb.style.marginTop = '12px'; sb.onclick = openSlideshow; box.append(sb); }
  },
  record(box) {
    box.append(h('h3', '', 'Opnemen'));
    box.append(h('p', 'hint', 'Neem je webcam, je scherm of een voice-over op. De opname komt in je media en direct op de tijdlijn (op de afspeelkop).'));
    const r = h('div', 'btnrow');
    [['cam', '📷 Webcam'], ['screen', '🖥 Scherm'], ['mic', '🎙 Voice-over']].forEach(([k, n]) => { const b = h('button', 'big', n); b.style.flex = '1 1 100%'; b.onclick = () => startRecord(k); r.append(b); });
    box.append(r);
    const opt = (id, key, label) => { const l = h('label', 'chk', `<input type="checkbox" ${recOpts[key] ? 'checked' : ''}> ${label}`); $('input', l).onchange = e => recOpts[key] = e.target.checked; box.append(l); };
    opt('m', 'mic', 'Microfoon toevoegen bij schermopname'); opt('p', 'play', 'Tijdlijn afspelen tijdens voice-over'); opt('c', 'countdown', 'Aftellen (3-2-1)');
    opt('s', 'subs', 'Automatische ondertitels tijdens voice-over (spraakherkenning, Chrome/Edge, NL)'); opt('v', 'voice', 'Voice-over als spraaktrack markeren (ducking)');
    const rb = h('div', 'recbox' + (rec ? '' : ' hidden')); rb.id = 'recBox';
    rb.innerHTML = `<video id="recVid" muted autoplay playsinline></video><canvas id="recLvl" width="240" height="10"></canvas><div class="rectime" id="recTime">● 00:00</div><button class="primary big" id="recStop">⏹ Stoppen</button>`;
    box.append(rb);
    $('#recStop', box).onclick = stopRecord;
    if (rec && rec.stream) $('#recVid', box).srcObject = rec.stream;
  },
  text(box) {
    box.append(h('h3', '', 'Tekst & titels'));
    box.append(h('p', 'hint', 'Klik om toe te voegen op de afspeelkop, of sleep naar de tijdlijn. Variabelen: {aftellen} {tijd} {rest} {procent} {teller} {datum} {klok}.'));
    const g = h('div', 'tgrid'); box.append(g);
    TEXT_TPL.forEach((tp, i) => {
      const p = Object.assign({}, textClip({}), tp.p);
      const style = `font-family:'${p.font}';font-weight:${p.bold ? 700 : 400};font-style:${p.italic ? 'italic' : 'normal'};color:${p.color};font-size:16px;${p.bgOpacity ? `background:${p.bgColor};padding:2px 8px;border-radius:4px;` : ''}${p.glow ? `text-shadow:0 0 8px ${p.color};` : ''}${p.strokeW ? '-webkit-text-stroke:1px #000;' : ''}${p.gradFill ? `background:linear-gradient(${p.color},${p.color2});-webkit-background-clip:text;color:transparent;` : ''}`;
      const card = h('div', 'tcard', `<span style="${style}">${esc(p.text.split('\n')[0].replace(/\{(\w+)\}/g, (m, v) => ({ aftellen: '5', teller: '1.234', tijd: '0:12', datum: '5 okt', klok: '12:00' }[v] || m)))}</span><small>${tp.n}</small>`);
      regItem(card, 'txt' + i, () => textClip(Object.assign({ name: tp.n }, deepClone(tp.p))));
      g.append(card);
    });
  },
  audio(box) {
    box.append(h('h3', '', 'Muziek & geluidseffecten'));
    const b = h('button', 'big', '＋ Eigen audio importeren'); b.onclick = () => $('#fileIn').click(); box.append(b);
    box.append(h('p', 'hint', 'Alle geluiden worden ter plekke gegenereerd met Web Audio (rechtenvrij). ▶ = voorbeluisteren.'));
    for (const cat of ['Muziek', 'Effect', 'Overgang', 'Sfeer']) {
      box.append(h('h4', '', cat));
      const l = h('div', 'slist'); box.append(l);
      SOUNDS.filter(s => s.cat === cat).forEach(s => {
        const it = h('div', 'si', `<span>🎵 ${s.n}</span><span class="muted" style="flex:0">${s.d}s</span>`);
        const pb = h('button', 'icon', '▶'); pb.onclick = e => { e.stopPropagation(); previewSound(s); }; it.prepend(pb);
        regItem(it, 'snd:' + s.k, () => soundClip(s)); l.append(it);
      });
    }
  },
  elements(box) {
    box.append(h('h3', '', 'Elementen'));
    box.append(h('h4', '', 'Deeltjes-effecten'));
    const pg = h('div', 'tgrid'); box.append(pg);
    PARTICLES.forEach(([k, n]) => { const d = h('div', 'tcard', `<span style="font-size:14px">${n}</span>`); regItem(d, 'par:' + k, () => particlesClip({ name: n.slice(2).trim(), pkind: k, count: k === 'fireworks' ? 240 : k === 'rain' ? 250 : 120, multi: true })); pg.append(d); });
    box.append(h('h4', '', 'Audiovisualizers'));
    const vg = h('div', 'tgrid'); box.append(vg);
    VIZ.forEach(([k, n]) => { const d = h('div', 'tcard', `<span style="font-size:14px">${n}</span>`); regItem(d, 'viz:' + k, () => vizClip({ vstyle: k, name: 'Visualizer ' + n.slice(2).trim(), y: k === 'circle' ? .5 : .75, h: k === 'circle' ? .6 : .35, dur: Math.max(5, projectDur() - playhead) })); vg.append(d); });
    box.append(h('h4', '', 'Speciaal'));
    const sg2 = h('div', 'tgrid'); box.append(sg2);
    const adj = h('div', 'tcard', '<span>🎚 Aanpassingslaag</span><small>effecten op alles eronder</small>'); regItem(adj, 'adjust', () => adjustClip({ dur: 5 })); sg2.append(adj);
    box.append(h('h4', '', 'Stickers'));
    const g = h('div', 'egrid'); box.append(g);
    EMOJI.forEach((em, i) => { const d = h('div', '', em); regItem(d, 'emo' + i, () => textClip({ name: 'Sticker ' + em, text: em, size: 180, bold: false, shadow: false, tanim: 'pop' })); g.append(d); });
    box.append(h('h4', '', 'Vormen'));
    const sg = h('div', 'tgrid'); box.append(sg);
    SHAPES.forEach(([sh, n, p], i) => { const d = h('div', 'tcard', `<span style="font-size:14px">${n}</span>`); regItem(d, 'shp' + i, () => shapeClip(Object.assign({ name: n.slice(2), shape: sh }, p))); sg.append(d); });
  },
  bg(box) {
    box.append(h('h3', '', 'Achtergronden'));
    box.append(h('p', 'hint', 'Gekleurde of verloop-achtergronden als clip. Komt op de onderste track.'));
    box.append(h('h4', '', 'Effen kleuren'));
    const g = h('div', 'cgrid'); box.append(g);
    COLORS.forEach((c, i) => { const d = h('div'); d.style.background = c; regItem(d, 'col' + i, () => colorClip({ color: c, name: 'Kleur ' + c })); g.append(d); });
    box.append(h('h4', '', 'Verlopen (ook geanimeerd)'));
    const g2 = h('div', 'cgrid'); box.append(g2);
    GRADS.forEach(([a, b], i) => { const d = h('div'); d.style.background = `linear-gradient(135deg,${a},${b})`; regItem(d, 'grd' + i, () => colorClip({ color: a, color2: b, grad: true, animGrad: i % 2 === 1, name: 'Verloop' })); g2.append(d); });
    box.append(h('h4', '', 'Projectachtergrond'));
    const r = h('div', 'row', `<label>Kleur achter alles</label><input type="color" value="${P.bg}">`);
    const ci = $('input', r); ci.oninput = () => { if (!pend) pend = snap(); P.bg = ci.value; requestDraw(); }; ci.onchange = () => { if (pend) { const b = pend; pend = null; commit(b, 'Achtergrondkleur'); } };
    box.append(r);
  },
  trans(box) {
    box.append(h('h3', '', 'Overgangen'));
    box.append(h('p', 'hint', 'Selecteer een of meer clips en kies een overgang. Voor een echte kruisovergang: laat twee clips op verschillende tracks overlappen en geef de bovenste een “in”-overgang.'));
    const r = h('div', 'filters');
    [['in', 'Begin (in)'], ['out', 'Einde (uit)'], ['both', 'Beide']].forEach(([k, n]) => { const b = h('button', transTarget === k ? 'on' : '', n); b.onclick = () => { transTarget = k; renderPanel(); }; r.append(b); });
    box.append(r);
    const dr = h('div', 'row', `<label>Duur</label><input type="range" min="0.1" max="3" step="0.1" value="${S.transDur}"><span class="val">${S.transDur}s</span>`);
    $('input', dr).oninput = e => { S.transDur = +e.target.value; $('.val', dr).textContent = S.transDur + 's'; saveSettings(); }; box.append(dr);
    const g = h('div', 'tgrid'); box.append(g);
    TRANS.forEach(([k, n, ic]) => {
      const d = h('div', 'tcard', `<span style="font-size:24px">${ic}</span><small>${n}</small>`); d.style.cursor = 'pointer';
      d.onclick = () => {
        const list = selectedClips().filter(c => kindOf(c) === 'visual'); if (!list.length) return toast('Selecteer eerst een visuele clip');
        edit(() => list.forEach(c => { if (transTarget !== 'out') c.tin = { type: k, dur: S.transDur }; if (transTarget !== 'in') c.tout = { type: k, dur: S.transDur }; }), 'Overgang: ' + n);
        toast('Overgang toegepast: ' + n);
      };
      g.append(d);
    });
  },
  filters(box) {
    box.append(h('h3', '', 'Filters'));
    box.append(h('p', 'hint', 'Snelle kleurfilters. Voor GPU-shader-effecten zie het tabblad “Effecten”.'));
    const c = sel && clipById(sel), m = c && media.get(c.mediaId);
    const g = h('div', 'tgrid'); box.append(g);
    Object.entries(PRESETS).forEach(([n, p]) => {
      const d = h('div', 'tcard'); d.style.cursor = 'pointer'; d.style.padding = '0';
      const pv = h('div'); pv.style.cssText = `position:absolute;inset:0;background:${m && m.thumb ? `url(${m.thumb}) center/cover` : 'linear-gradient(135deg,#ff9a3c,#ff3c6e 40%,#3c8cff 75%,#3cff9a)'};filter:${presetCss(p)}`;
      d.append(pv);
      if (p.tint) { const t = h('div'); t.style.cssText = `position:absolute;inset:0;background:${p.tint.color};opacity:${p.tint.amt}`; d.append(t); }
      const sm = h('small', '', n); sm.style.cssText = 'background:rgba(0,0,0,.6);color:#fff;padding:2px 0'; d.append(sm);
      d.onclick = () => { const list = selectedClips().filter(x => kindOf(x) === 'visual'); if (!list.length) return toast('Selecteer eerst een clip'); list.forEach(x => applyPreset(x, p)); toast('Filter: ' + n); };
      g.append(d);
    });
  },
  effects(box) {
    box.append(h('h3', '', 'GPU-effecten (WebGL)'));
    if (!GL.available()) { box.append(h('p', 'hint', '⚠ WebGL is niet beschikbaar in deze browser.')); return; }
    box.append(h('p', 'hint', 'Shader-effecten die op de grafische kaart draaien. Klik om toe te voegen aan de geselecteerde clip, of sleep op een clip. Stapel er zoveel als je wilt; volgorde en instellingen pas je rechts aan. Tip: zet ze op een Aanpassingslaag om alles eronder te beïnvloeden.'));
    const fl = h('div', 'filters');
    ['Alle', ...FX_CATS].forEach(k => { const x = h('button', fxCat === k ? 'on' : '', k); x.onclick = () => { fxCat = k; renderPanel(); }; fl.append(x); });
    box.append(fl);
    const g = h('div', 'tgrid'); box.append(g);
    const sample = samplePreview();
    for (const f of Object.values(FX)) {
      if (fxCat !== 'Alle' && f.cat !== fxCat) continue;
      const d = h('div', 'tcard fxcard'); d.style.padding = '0';
      const pc = h('canvas'); pc.width = 160; pc.height = 90; d.append(pc);
      const out = GL.run(sample, 160, 90, [{ key: 'fx:' + f.key, frag: f.frag, u: fxUniforms(f.key, fxDefaults(f.key)) }], 1.3);
      if (out) pc.getContext('2d').drawImage(out, 0, 0);
      const sm = h('small', '', `${f.icon} ${f.name}`); d.append(sm);
      d.draggable = true; d.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', 'fx:' + f.key));
      d.onclick = () => { const list = selectedClips().filter(x => kindOf(x) === 'visual'); if (!list.length) return toast('Selecteer eerst een visuele clip (of voeg een Aanpassingslaag toe)'); list.forEach(x => addFxTo(x, f.key)); };
      g.append(d);
    }
  },
  subs(box) {
    box.append(h('h3', '', 'Ondertitels'));
    const b1 = h('button', 'big', '📂 SRT / VTT importeren'); b1.onclick = () => $('#srtIn').click();
    const b2 = h('button', 'big', '💾 Ondertitels exporteren (.srt)'); b2.onclick = exportSRT; b2.style.marginTop = '6px';
    box.append(b1, b2);
    box.append(h('h4', '', 'Snel ondertitels typen'));
    box.append(h('p', 'hint', 'Eén regel = één ondertitel. Ze worden achter elkaar geplaatst vanaf de afspeelkop.'));
    const ta = h('textarea'); ta.placeholder = 'Hallo allemaal!\nWelkom bij mijn video.\nVandaag laat ik zien…'; ta.rows = 6; box.append(ta);
    const dr = h('div', 'row', `<label>Duur per regel</label><input type="number" min="0.5" max="20" step="0.5" value="2.5"> s`); box.append(dr);
    const auto = h('label', 'chk', '<input type="checkbox" checked> Duur afstemmen op leessnelheid'); box.append(auto);
    const go = h('button', 'primary big', 'Ondertitels plaatsen'); go.style.marginTop = '6px';
    go.onclick = () => {
      const lines = ta.value.split('\n').map(s => s.trim()).filter(Boolean); if (!lines.length) return; const d = +$('input', dr).value || 2.5;
      let t = playhead; const items = lines.map(s => { const dd = $('input', auto).checked ? clamp(s.length / 15, 1.2, 7) : d; const it = { s: t, e: t + dd, t: s }; t += dd; return it; });
      addSubtitles(items); ta.value = '';
    };
    box.append(go);
    box.append(h('h4', '', 'Stijl van alle ondertitels'));
    btns(box, [['Klassiek', () => styleSubs({ bgOpacity: .6, color: '#ffffff', strokeW: 0, font: 'Segoe UI', bold: false })], ['Geel omlijnd', () => styleSubs({ bgOpacity: 0, color: '#ffe14d', strokeW: 3, font: 'Arial', bold: true })], ['TikTok', () => styleSubs({ bgOpacity: 0, color: '#ffffff', strokeW: 4, font: 'Arial Black', bold: false, size: 54, y: .7, tanim: 'pop' })], ['Karaoke', () => styleSubs({ tanim: 'karaoke', color2: '#3ddc97', strokeW: 3, bgOpacity: 0 })]]);
  },
  history(box) {
    box.append(h('h3', '', 'Geschiedenis'));
    box.append(h('p', 'hint', 'Klik op een stap om ernaar terug te springen.'));
    const l = h('div', 'hlist'); box.append(l);
    const now = h('div', 'hi cur', `<b>● Huidige staat</b>`); l.append(now);
    [...redoStack].forEach((e, i) => { const it = h('div', 'hi redo', `↷ ${esc(e.label)} <span class="muted">${new Date(e.time).toLocaleTimeString('nl-NL')}</span>`); it.onclick = () => { for (let k = redoStack.length - 1; k >= i; k--) redo(); }; l.prepend(it); });
    [...undoStack].reverse().forEach((e, i) => { const it = h('div', 'hi', `${esc(e.label)} <span class="muted">${new Date(e.time).toLocaleTimeString('nl-NL')}</span>`); it.onclick = () => { for (let k = 0; k <= i; k++) undo(); }; l.append(it); });
    box.append(h('h4', '', 'Versies (snapshots)'));
    const sv = h('button', 'big', '💾 Huidige versie bewaren'); sv.onclick = saveVersion; box.append(sv);
    const vl = h('div', 'hlist'); vl.id = 'versionList'; box.append(vl); listVersions(vl);
  },
};
function styleSubs(p) {
  const tr = P.tracks.find(t => t.name === 'Ondertitels'); const list = P.clips.filter(c => c.type === 'text' && (!tr || c.trackId === tr.id));
  if (!list.length) return toast('Geen ondertitels gevonden');
  edit(() => list.forEach(c => Object.assign(c, p)), 'Ondertitelstijl');
}

/* ---------------- subtitles ---------------- */
function subTrack() { let tr = P.tracks.find(t => t.kind === 'visual' && t.name === 'Ondertitels'); if (!tr) { tr = mkTrack('visual', 'Ondertitels'); P.tracks.unshift(tr); } return tr; }
function addSubtitles(items) {
  edit(() => {
    const tr = subTrack();
    for (const it of items) {
      const c = textClip({ name: 'Ondertitel', text: it.t, size: 40, y: .88, bgOpacity: .6, pad: 14, bold: false, shadow: false, start: it.s, dur: Math.max(.3, it.e - it.s) });
      if (overlaps(c, tr.id)) addClip(c); else { c.trackId = tr.id; P.clips.push(c); }
    }
  }, 'Ondertitels');
  toast(`${items.length} ondertitel(s) toegevoegd`);
}
function parseSRT(txt) {
  const out = [], re = /(\d+):(\d\d):(\d\d)[,.](\d{1,3})\s*-->\s*(\d+):(\d\d):(\d\d)[,.](\d{1,3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;
  const ts = (a, b, c, d) => +a * 3600 + +b * 60 + +c + +d.padEnd(3, '0') / 1000;
  let m; const s = txt.replace(/\r/g, '');
  while ((m = re.exec(s))) out.push({ s: ts(m[1], m[2], m[3], m[4]), e: ts(m[5], m[6], m[7], m[8]), t: m[9].replace(/<[^>]+>/g, '').trim() });
  return out.filter(x => x.t);
}
function srtText(list) {
  const ts = t => { const ms = Math.round(t * 1000), hh = Math.floor(ms / 3600000), mm = Math.floor(ms / 60000) % 60, ss = Math.floor(ms / 1000) % 60; return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  return list.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.start + c.dur)}\n${c.text}\n`).join('\n');
}
function exportSRT() {
  const cs = P.clips.filter(c => c.type === 'text' && track(c.trackId)?.name === 'Ondertitels');
  const list = (cs.length ? cs : P.clips.filter(c => c.type === 'text')).sort((a, b) => a.start - b.start);
  if (!list.length) return toast('Geen tekstclips om te exporteren');
  download(new Blob([srtText(list)], { type: 'text/plain' }), safeName(P.name) + '.srt');
}

/* ---------------- recording ---------------- */
const recOpts = { mic: true, play: false, countdown: true, subs: false, voice: true };
let rec = null;
async function startRecord(kind) {
  ensureAudio(); if (rec) return toast('Er loopt al een opname');
  let stream;
  try {
    if (kind === 'screen') {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      if (recOpts.mic) { try { const mic = await navigator.mediaDevices.getUserMedia({ audio: true }); const ctxA = new AudioContext(), dst = ctxA.createMediaStreamDestination(); ctxA.createMediaStreamSource(mic).connect(dst); if (stream.getAudioTracks().length) ctxA.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(dst); stream = new MediaStream([...stream.getVideoTracks(), ...dst.stream.getAudioTracks()]); stream._extra = [mic, ctxA]; } catch (e) { toast('Microfoon niet beschikbaar'); } }
    } else if (kind === 'cam') stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
    else stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) { return toast('Geen toegang: ' + (e.message || e.name)); }
  rec = { kind, stream, chunks: [], startT: playhead, subs: [] };
  showPanel('record');
  // live input level meter
  try { const la = AC.createMediaStreamSource(stream), an = AC.createAnalyser(); an.fftSize = 512; la.connect(an); rec.lvl = an; } catch (e) { }
  if (recOpts.countdown) for (let i = 3; i > 0; i--) { const el = $('#recTime'); if (el) el.textContent = `Start over ${i}…`; await sleep(800); }
  if (!rec) return;
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t) && (kind !== 'mic' || t.startsWith('audio')));
  rec.mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  rec.mr.ondataavailable = e => e.data.size && rec.chunks.push(e.data);
  rec.mr.onstop = finishRecord;
  stream.getVideoTracks().forEach(t => t.onended = () => stopRecord());
  rec.mr.start(500); rec.wall = performance.now(); rec.startT = playhead;
  if (kind === 'mic' && recOpts.play) play();
  if (kind === 'mic' && recOpts.subs) startSpeech();
  const buf = new Float32Array(512);
  rec.timer = setInterval(() => {
    const s = (performance.now() - rec.wall) / 1000; const el = $('#recTime'); if (el) el.textContent = '● ' + fmtS(s);
    const lc = $('#recLvl'); if (lc && rec.lvl) { rec.lvl.getFloatTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v)); const g = lc.getContext('2d'); g.clearRect(0, 0, 240, 10); g.fillStyle = m > .9 ? '#ff4d6d' : '#3ddc97'; g.fillRect(0, 0, 240 * Math.min(1, m * 1.3), 10); }
  }, 100);
}
function stopRecord() {
  if (!rec) return;
  if (!rec.mr) { rec.stream.getTracks().forEach(t => t.stop()); rec = null; renderPanel(); return; }
  if (rec.mr.state !== 'inactive') rec.mr.stop();
}
async function finishRecord() {
  const r = rec; rec = null; clearInterval(r.timer); stopSpeech(r);
  r.stream.getTracks().forEach(t => t.stop()); if (r.stream._extra) { r.stream._extra[0].getTracks().forEach(t => t.stop()); r.stream._extra[1].close(); }
  if (r.kind === 'mic' && recOpts.play) pause();
  const dur = (performance.now() - r.wall) / 1000;
  const type = r.mr.mimeType || (r.kind === 'mic' ? 'audio/webm' : 'video/webm');
  const names = { cam: 'Webcam', screen: 'Schermopname', mic: 'Voice-over' };
  const d = new Date(), stamp = `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}m${String(d.getSeconds()).padStart(2, '0')}`;
  const file = new File([new Blob(r.chunks, { type })], `${names[r.kind]} ${stamp}.${type.includes('mp4') ? 'm4a' : 'webm'}`, { type });
  renderPanel(); toast('Opname verwerken…');
  const [m] = await importFiles([file], { durHint: dur });
  if (!m) return;
  edit(() => {
    const c = clipFromMedia(m); c.start = r.startT;
    if (r.kind === 'mic') { addClip(c); if (recOpts.voice) { const tr = track(c.trackId); tr.voice = true; tr.duck = false; } } else addClip(c, mainTrack('visual')?.id);
    select(c.id);
  }, 'Opname: ' + names[r.kind]);
  if (r.subs.length) addSubtitles(r.subs.map(s => ({ s: r.startT + s.s, e: r.startT + s.e, t: s.t })));
  toast('Opname toegevoegd aan de tijdlijn');
}
function startSpeech() {
  const SRc = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SRc) return toast('Spraakherkenning niet beschikbaar in deze browser');
  const sr = new SRc(); sr.lang = 'nl-NL'; sr.continuous = true; sr.interimResults = true; rec.sr = sr; const starts = {};
  sr.onresult = ev => {
    const now = (performance.now() - rec.wall) / 1000;
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (starts[i] == null) starts[i] = Math.max(0, now - 0.6);
      if (ev.results[i].isFinal) {
        const words = ev.results[i][0].transcript.trim().split(/\s+/), s = starts[i], e = Math.max(now, s + 1), n = Math.ceil(words.length / 8);
        for (let k = 0; k < words.length; k += 8) { const j = k / 8; rec.subs.push({ s: s + (e - s) * j / n, e: s + (e - s) * (j + 1) / n, t: words.slice(k, k + 8).join(' ') }); }
      }
    }
  };
  sr.onerror = e => toast('Spraakherkenning: ' + e.error);
  sr.onend = () => { if (rec && rec.sr === sr) try { sr.start(); } catch (e) { } };
  try { sr.start(); } catch (e) { }
}
function stopSpeech(r) { if (r.sr) { const s = r.sr; r.sr = null; try { s.stop(); } catch (e) { } } }
