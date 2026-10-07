'use strict';
/* =====================================================================
   Wiring: buttons, keyboard, drag & drop, clipboard, boot.
   ===================================================================== */
$('#fileIn').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; const wasEmpty = !P.clips.length; const ms = await importFiles(fs); if (ms.length && wasEmpty) ms.forEach(addMediaToEnd); };
$('#projIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openProjectFile(f); };
$('#srtIn').onchange = async e => { const f = e.target.files[0]; if (!f) return; const items = parseSRT(await f.text()); if (!items.length) toast('Geen ondertitels gevonden'); else addSubtitles(items); e.target.value = ''; };
$('#bNew').onclick = newProj; $('#bOpen').onclick = () => $('#projIn').click(); $('#bSave').onclick = saveProjectFile;
$('#bUndo').onclick = undo; $('#bRedo').onclick = redo;
$('#bExport').onclick = openExport; $('#bHelp').onclick = () => $('#helpModal').classList.remove('hidden');
$('#bPal').onclick = openPalette; $('#bSettings').onclick = openSettings;
$('#projName').onchange = e => edit(() => P.name = e.target.value || 'Mijn video', 'Projectnaam');
$('#ratioSel').onchange = e => edit(() => P.ratio = e.target.value, 'Beeldverhouding');
$('#playBtn').onclick = togglePlay;
$('#tStart').onclick = () => setPlayhead(0); $('#tEnd').onclick = () => setPlayhead(projectDur());
$('#tBack').onclick = () => setPlayhead(playhead - 1 / FPS); $('#tFwd').onclick = () => setPlayhead(playhead + 1 / FPS);
$('#tLoop').onclick = e => { looping = !looping; e.currentTarget.classList.toggle('on', looping); };
$('#monVol').oninput = e => { if (monitor) monitor.gain.value = +e.target.value; };
$('#tSnap').onclick = actSnapshot;
$('#tGrid').onclick = e => { const st = (S.thirds ? 1 : 0) + (S.safe ? 2 : 0), n = (st + 1) % 4; S.thirds = !!(n & 1); S.safe = !!(n & 2); saveSettings(); e.currentTarget.classList.toggle('on', n > 0); requestDraw(); toast(['Hulplijnen uit', 'Raster (derden)', 'Veilige zones', 'Raster + veilige zones'][n], 1200); };
$('#tScope').onclick = () => { const order = ['none', 'hist', 'wave', 'parade', 'vector']; setScopes(order[(order.indexOf(S.scopes) + 1) % order.length]); };
$('#tFull').onclick = () => { const w = $('#stageWrap'); document.fullscreenElement ? document.exitFullscreen() : w.requestFullscreen(); };
document.addEventListener('fullscreenchange', () => setTimeout(fitStage, 50));
$('#aSplit').onclick = actSplit; $('#aDup').onclick = actDup; $('#aDel').onclick = actDelete; $('#aRipple').onclick = actRipple; $('#aMarker').onclick = actMarker;
$('#aSnap').onclick = e => { snapOn = !snapOn; e.currentTarget.classList.toggle('on', snapOn); };
$('#aAddV').onclick = () => edit(() => newTrack('visual'), 'Track toegevoegd'); $('#aAddA').onclick = () => edit(() => newTrack('audio'), 'Track toegevoegd');
$('#zoom').addEventListener('input', e => { const center = (tlScroll.scrollLeft + (tlScroll.clientWidth - HEAD) / 2) / pps; pps = 4 * Math.pow(225, e.target.value / 100); renderTimeline(); tlScroll.scrollLeft = center * pps - (tlScroll.clientWidth - HEAD) / 2; });
$('#zIn').onclick = () => setZoom(pps * 1.4); $('#zOut').onclick = () => setZoom(pps / 1.4);
$('#zFit').onclick = () => { setZoom((tlScroll.clientWidth - HEAD - 40) / Math.max(5, projectDur())); tlScroll.scrollLeft = 0; };
$$('#side button').forEach(b => b.onclick = () => showPanel(b.dataset.panel));
$$('.modal [data-close]').forEach(b => b.onclick = () => b.closest('.modal').classList.add('hidden'));
$('#splitter').addEventListener('pointerdown', e => {
  const y0 = e.clientY, h0 = $('#tl').getBoundingClientRect().height;
  const mv = ev => { const nh = clamp(h0 - (ev.clientY - y0), 150, innerHeight - 250); document.documentElement.style.setProperty('--tlh', nh + 'px'); fitStage(); };
  const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); renderTimeline(); };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
});
new ResizeObserver(() => { fitStage(); drawRuler(); }).observe($('#stageWrap'));
window.addEventListener('resize', () => renderTimeline());
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; $('#dropOverlay').classList.remove('hidden'); } });
window.addEventListener('dragleave', e => { if (e.dataTransfer.types.includes('Files') && --dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').classList.add('hidden'); } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; $('#dropOverlay').classList.add('hidden');
  const fs = [...e.dataTransfer.files]; if (!fs.length) return;
  const pk = fs.find(f => /\.(ksp|json)$/i.test(f.name)); if (pk) return openProjectFile(pk);
  const wasEmpty = !P.clips.length; const ms = await importFiles(fs); if (ms.length && wasEmpty) ms.forEach(addMediaToEnd);
});
document.addEventListener('paste', async e => {
  const tag = (e.target.tagName || '').toLowerCase(); if (tag === 'input' || tag === 'textarea') return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); const ms = await importFiles(files.map((f, i) => f.name && f.name !== 'image.png' ? f : new File([f], `Geplakt ${new Date().toLocaleTimeString('nl-NL').replace(/:/g, '.')}${i ? '-' + i : ''}.png`, { type: f.type }))); ms.forEach(m => addAtPlayhead(clipFromMedia(m))); return; }
  const text = e.clipboardData?.getData('text/plain');
  if (text && !clipboard && text.length < 500) { e.preventDefault(); addAtPlayhead(textClip({ text: text.trim(), size: 60 })); }
});
window.addEventListener('pointerdown', e => { ensureAudio(); if (!e.target.closest('#ctx')) hideCtx(); }, { capture: true });
window.addEventListener('keydown', e => {
  ensureAudio();
  const tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'textarea' || tag === 'select' || (tag === 'input' && !['range', 'checkbox', 'color'].includes(e.target.type));
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && (k === 'k' || (e.shiftKey && k === 'p'))) { e.preventDefault(); openPalette(); return; }
  if (e.key === 'Escape') { hideCtx(); $$('.modal').forEach(m => { if (m.id !== 'exportModal' || !exporting) m.classList.add('hidden'); }); if (!typing) select(null); return; }
  if (typing || exporting || !$('#palModal').classList.contains('hidden')) return;
  if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (ctrl && k === 'y') { e.preventDefault(); redo(); }
  else if (ctrl && k === 'c') { e.preventDefault(); actCopy(); }
  else if (ctrl && k === 'v') { if (clipboard) { e.preventDefault(); actPaste(); } }
  else if (ctrl && k === 'd') { e.preventDefault(); actDup(); }
  else if (ctrl && k === 'a') { e.preventDefault(); selectMany(P.clips.map(c => c.id)); }
  else if (ctrl && k === 's') { e.preventDefault(); saveProjectFile(); }
  else if (ctrl && k === 'o') { e.preventDefault(); $('#projIn').click(); }
  else if (ctrl && k === 'e') { e.preventDefault(); openExport(); }
  else if (ctrl) return;
  else if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 's') actSplit();
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); e.shiftKey ? actRipple() : actDelete(); }
  else if (k === 'arrowleft') { e.preventDefault(); if (e.altKey && sel) { const c = clipById(sel), t = kfNeighbour(c, null, -1); if (t != null) setPlayhead(c.start + t); } else setPlayhead(playhead - (e.shiftKey ? 1 : 1 / FPS)); }
  else if (k === 'arrowright') { e.preventDefault(); if (e.altKey && sel) { const c = clipById(sel), t = kfNeighbour(c, null, 1); if (t != null) setPlayhead(c.start + t); } else setPlayhead(playhead + (e.shiftKey ? 1 : 1 / FPS)); }
  else if (k === 'home') setPlayhead(0);
  else if (k === 'end') setPlayhead(projectDur());
  else if (k === 'j') setPlayhead(playhead - 5);
  else if (k === 'k') pause();
  else if (k === 'l') setPlayhead(playhead + 5);
  else if (k === 'm') actMarker();
  else if (k === ']') jumpMarker(1);
  else if (k === '[') jumpMarker(-1);
  else if (k === 'i') $('#fileIn').click();
  else if (k === 't') addAtPlayhead(textClip({}));
  else if (k === '+' || k === '=') setZoom(pps * 1.3);
  else if (k === '-') setZoom(pps / 1.3);
  else if (k === '?') $('#helpModal').classList.remove('hidden');
});
window.addEventListener('beforeunload', e => { if (exporting || rec) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('error', e => console.warn('Fout:', e.message));

(async function boot() {
  applyTheme(); updateFaceStatus();
  $('#tGrid').classList.toggle('on', S.thirds || S.safe); $('#tScope').classList.toggle('on', S.scopes !== 'none'); $('#scope').classList.toggle('hidden', S.scopes === 'none');
  ensureCanvasDims(); fitStage(); setZoom(60); renderPanel(); changed();
  requestAnimationFrame(loop);
  await restoreSession();
  undoStack.length = 0; $('#bUndo').disabled = true; booted = true;
  if (!P.clips.length) $('#saveState').textContent = '';
})();
