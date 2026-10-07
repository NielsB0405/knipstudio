'use strict';
/* =====================================================================
   Media import & analysis. Heavy number crunching (peak extraction,
   beat/onset detection, silence detection) runs in a Web Worker.
   ===================================================================== */
function analysisWorker(self) {
  self.onmessage = e => {
    const d = e.data;
    try {
      if (d.op === 'ping') return self.postMessage({ id: d.id, res: 'pong' });
      if (d.op === 'peaks') {
        const chs = d.chs.map(b => new Float32Array(b)), len = chs[0].length, block = d.sr / 100, n = Math.ceil(len / block), out = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          let mx = 0; const s = Math.floor(i * block), en = Math.min(len, Math.floor((i + 1) * block));
          for (const ch of chs) for (let j = s; j < en; j += 2) { const v = ch[j] < 0 ? -ch[j] : ch[j]; if (v > mx) mx = v; }
          out[i] = mx;
          if (i % 20000 === 0) self.postMessage({ id: d.id, progress: i / n });
        }
        return self.postMessage({ id: d.id, res: out }, [out.buffer]);
      }
      if (d.op === 'beats') {
        // spectral-flux-like onset detection on the 100 Hz amplitude envelope
        const p = d.peaks, a = Math.max(0, Math.floor(d.from * 100)), b = Math.min(p.length, Math.ceil(d.to * 100));
        const flux = new Float32Array(b - a);
        for (let i = a + 1; i < b; i++) flux[i - a] = Math.max(0, p[i] - p[i - 1]);
        const W = 20, onsets = [], cs = new Float64Array(flux.length + 1);
        for (let i = 0; i < flux.length; i++) cs[i + 1] = cs[i] + flux[i];
        for (let i = 1; i < flux.length - 1; i++) {
          const lo = Math.max(0, i - W), hi = Math.min(flux.length, i + W);
          const avg = (cs[hi] - cs[lo]) / (hi - lo), thr = avg * d.sens + 0.01;
          if (flux[i] > thr && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1]) {
            const t = (a + i) / 100;
            if (!onsets.length || t - onsets[onsets.length - 1] > d.minGap) onsets.push(t);
          }
        }
        // tempo estimate: histogram of inter-onset intervals folded into 70..180 BPM
        const hist = new Float32Array(181);
        for (let i = 0; i < onsets.length; i++) for (let j = i + 1; j < Math.min(onsets.length, i + 6); j++) {
          let bpm = 60 / (onsets[j] - onsets[i]); if (!isFinite(bpm) || bpm <= 0) continue;
          while (bpm < 70) bpm *= 2; while (bpm > 180) bpm /= 2;
          const k = Math.round(bpm); hist[k] += 1; if (k > 70) hist[k - 1] += .5; if (k < 180) hist[k + 1] += .5;
        }
        let best = 0, bpm = 0; for (let k = 70; k <= 180; k++) if (hist[k] > best) { best = hist[k]; bpm = k; }
        return self.postMessage({ id: d.id, res: { onsets, bpm } });
      }
      if (d.op === 'silence') {
        const p = d.peaks, sil = []; let run = null;
        for (let t = d.a; t < d.b; t += 0.01) {
          const v = p[Math.floor(t * 100)] || 0;
          if (v < d.thr) { if (run === null) run = t; }
          else if (run !== null) { if (t - run >= d.minSil) sil.push([run, t]); run = null; }
        }
        if (run !== null && d.b - run >= d.minSil) sil.push([run, d.b]);
        return self.postMessage({ id: d.id, res: sil });
      }
      self.postMessage({ id: d.id, error: 'onbekende opdracht' });
    } catch (err) { self.postMessage({ id: d.id, error: String(err) }); }
  };
}
const analysis = createRpc(analysisWorker);

function guessType(f) {
  if (f.type.startsWith('video')) return 'video'; if (f.type.startsWith('audio')) return 'audio'; if (f.type.startsWith('image')) return 'image';
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  if (['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'ogv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'weba'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) return 'image';
  return null;
}
async function importFiles(files, opts = {}) {
  const out = [];
  for (const f of files) {
    const type = guessType(f); if (!type) { toast('Niet ondersteund: ' + f.name); continue; }
    let m = [...media.values()].find(x => x.missing && x.name === f.name && x.type === type);
    if (m) { m.missing = false; m.blob = f; m.url = URL.createObjectURL(f); toast('Media opnieuw gekoppeld: ' + f.name); }
    else { m = { id: opts.id || uid(), name: f.name, type, blob: f, url: URL.createObjectURL(f), duration: type === 'image' ? S.imgDur : 0, w: 0, h: 0, durHint: opts.durHint }; media.set(m.id, m); }
    m.busy = true; renderPanelIfMedia();
    await analyze(m); m.busy = false;
    out.push(m); renderPanelIfMedia(); renderTimeline(); requestDraw();
    if (!opts.noSave) dbPutMedia(m);
  }
  return out;
}
async function analyze(m) {
  try {
    if (m.type === 'image') {
      const img = new Image(); img.src = m.url; await img.decode();
      m.img = img; m.w = img.naturalWidth || 800; m.h = img.naturalHeight || 600; m.thumb = thumbOf(img, m.w, m.h, 240, 135);
      queueFaceScan(m);
      return;
    }
    const v = document.createElement(m.type === 'video' ? 'video' : 'audio'); v.preload = 'auto'; v.muted = true; v.src = m.url;
    await once(v, 'loadedmetadata');
    if (!isFinite(v.duration)) { v.currentTime = 1e7; await Promise.race([once(v, 'durationchange', 4000).catch(() => { }), sleep(4000)]); }
    m.duration = isFinite(v.duration) && v.duration > 0 ? v.duration : (m.durHint || 5);
    if (m.type === 'video' && v.videoWidth) {
      m.w = v.videoWidth; m.h = v.videoHeight;
      const N = 10, fw = 96, fh = 54, sc = document.createElement('canvas'); sc.width = fw * N; sc.height = fh; const g = sc.getContext('2d');
      for (let i = 0; i < N; i++) {
        v.currentTime = Math.min(m.duration - 0.05, m.duration * (i + .5) / N);
        try { await once(v, 'seeked', 4000); } catch (e) { break; }
        const k = Math.max(fw / m.w, fh / m.h); g.drawImage(v, (fw - m.w * k) / 2 + i * fw, (fh - m.h * k) / 2, m.w * k, m.h * k);
        if (i === 1) m.thumb = thumbOf(v, m.w, m.h, 240, 135);
      }
      m.strip = sc.toDataURL('image/jpeg', .7); m.stripN = N;
      if (!m.thumb) m.thumb = m.strip;
      m.thumbImg = new Image(); m.thumbImg.src = m.thumb;
    }
    v.removeAttribute('src'); v.load();
    if (m.blob && m.blob.size < 600e6) {
      try {
        const ab = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await m.blob.arrayBuffer());
        const chs = []; for (let c = 0; c < ab.numberOfChannels; c++) chs.push(ab.getChannelData(c).slice().buffer);
        m.peaks = await analysis({ op: 'peaks', chs, sr: ab.sampleRate }, chs);
        m.hasAudio = true;
        if (m.type === 'audio' && (!m.duration || m.duration === m.durHint)) m.duration = ab.duration;
      } catch (e) { m.hasAudio = false; }
    }
    queueFaceScan(m);
  } catch (e) { console.warn('analyse mislukt', m.name, e); m.error = true; }
}
function thumbOf(src, w, hh, tw, th) {
  const c = document.createElement('canvas'); c.width = tw; c.height = th; const g = c.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, tw, th);
  const k = Math.max(tw / w, th / hh); g.drawImage(src, (tw - w * k) / 2, (th - hh * k) / 2, w * k, hh * k);
  return c.toDataURL('image/jpeg', .75);
}
function clipFromMedia(m) {
  const type = m.type === 'audio' ? 'audio' : m.type === 'video' ? 'video' : 'image';
  return baseClip(type, { mediaId: m.id, name: m.name, dur: type === 'image' ? S.imgDur : (isFinite(m.duration) && m.duration > 0 ? m.duration : 5) });
}
function removeMedia(m) {
  const n = P.clips.filter(c => c.mediaId === m.id).length;
  if (!confirm(n ? `"${m.name}" wordt gebruikt in ${n} clip(s). Media en clips verwijderen?` : `"${m.name}" verwijderen uit je media?`)) return;
  edit(() => { P.clips = P.clips.filter(c => c.mediaId !== m.id); for (const id of [...selSet]) if (!clipById(id)) selSet.delete(id); if (sel && !clipById(sel)) sel = null; }, 'Media verwijderd');
  media.delete(m.id); cleanupEls(); dbDelMedia(m.id); renderPanel();
}
/** Detect scene cuts by comparing colour histograms of downscaled frames. */
async function detectScenes(c, thr = .35, onProg) {
  const m = media.get(c.mediaId); if (!m || !m.url) return [];
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = m.url;
  await once(v, 'loadeddata');
  const k = document.createElement('canvas'); k.width = 64; k.height = 36; const g = k.getContext('2d', { willReadFrequently: true });
  const a = c.in, b = c.in + c.dur * c.speed, step = Math.max(.1, (b - a) / 600), cuts = []; let prev = null;
  for (let t = a; t < b; t += step) {
    v.currentTime = t; try { await once(v, 'seeked', 4000); } catch (e) { continue; }
    g.drawImage(v, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data, hst = new Float32Array(48);
    for (let i = 0; i < d.length; i += 4) { hst[d[i] >> 4]++; hst[16 + (d[i + 1] >> 4)]++; hst[32 + (d[i + 2] >> 4)]++; }
    if (prev) { let diff = 0; for (let i = 0; i < 48; i++) diff += Math.abs(hst[i] - prev[i]); diff /= 64 * 36 * 6; if (diff > thr && (!cuts.length || t - cuts[cuts.length - 1] > .6)) cuts.push(t); }
    prev = hst; onProg && onProg((t - a) / (b - a));
  }
  v.removeAttribute('src'); v.load();
  return cuts;
}
