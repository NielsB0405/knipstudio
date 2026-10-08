'use strict';
/* =====================================================================
   Voorbeeldversies (proxy's): zware video's (groter dan 720p of hoge
   bitrate) krijgen op de achtergrond een lichte kopie (360p, keyframe
   elke 0,5 s) voor afspelen en scrubben. Exporteren gebruikt altijd het
   origineel. Proxy's worden in IndexedDB bewaard, zodat ze maar één
   keer gemaakt hoeven te worden.
   ===================================================================== */
const PROXY = { queue: [], busy: false };
const needsProxy = m => m.type === 'video' && m.blob && m.w && m.duration > 0 &&
  (m.w * m.h > 1280 * 720 * 1.05 || m.blob.size * 8 / m.duration > 10e6);
/** Welke bron een clip gebruikt: proxy voor het voorbeeld, origineel bij exporteren. */
function mediaSrc(m, c) { return c.type === 'video' && m.proxyUrl && !exporting ? m.proxyUrl : m.url; }

async function queueProxy(m) {
  if (!window.VideoEncoder || !window.Mp4Muxer || !needsProxy(m) || m.proxyUrl || PROXY.queue.includes(m)) return;
  try {
    const saved = await idbReq('kv', 'readonly', s => s.get('proxy:' + m.id));
    if (saved && saved.blob && saved.size === m.blob.size) { setProxy(m, saved.blob); return; }
  } catch (e) { }
  PROXY.queue.push(m); pumpProxy();
}
function setProxy(m, blob) {
  m.proxyBlob = blob; m.proxyUrl = URL.createObjectURL(blob); m.proxyState = 'klaar';
  renderPanelIfMedia(); requestDraw();
}
async function pumpProxy() {
  if (PROXY.busy) return; PROXY.busy = true;
  while (PROXY.queue.length) {
    const m = PROXY.queue.shift();
    try {
      // niet tegelijk met exporteren rekenen
      while (exporting) await sleep(500);
      const blob = await buildProxy(m);
      if (blob) {
        setProxy(m, blob);
        idbReq('kv', 'readwrite', s => s.put({ blob, size: m.blob.size }, 'proxy:' + m.id)).catch(() => { });
        toast(`Voorbeeldversie klaar: ${m.name} — afspelen gaat nu soepeler`, 3500);
      }
    } catch (e) {
      if (e && e.message === 'export') { PROXY.queue.push(m); m.proxyState = 'wacht'; continue; }
      console.warn('proxy mislukt', m.name, e); m.proxyState = 'mislukt'; renderPanelIfMedia();
    }
  }
  PROXY.busy = false;
}
async function buildProxy(m) {
  const k = Math.min(1, 360 / Math.min(m.w, m.h));
  const w = Math.max(2, Math.round(m.w * k / 2) * 2), hh = Math.max(2, Math.round(m.h * k / 2) * 2);
  let vcfg = null;
  for (const codec of ['avc1.42001f', 'avc1.4d001f', 'avc1.640028']) {
    const cfg = { codec, width: w, height: hh, bitrate: 1.2e6, framerate: 30, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) { vcfg = cfg; break; } } catch (e) { }
  }
  if (!vcfg) return null;
  // geluid: origineel decoderen en als AAC/Opus meenemen (voorbeeld speelt dan alles uit de proxy)
  let ab = null, acfg = null;
  try { ab = await decodeMedia(m); acfg = ab && await pickAudioConfig(ab.sampleRate, ab.numberOfChannels); } catch (e) { ab = null; }
  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(), fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: 'avc', width: w, height: hh, frameRate: 30 },
    audio: acfg ? { codec: acfg.mux, numberOfChannels: ab.numberOfChannels, sampleRate: ab.sampleRate } : undefined,
  });
  if (acfg) await encodeAudioInto(ab, acfg.cfg, muxer);

  let err = null;
  const enc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: e => err = e });
  enc.configure(vcfg);
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = m.url;
  await once(v, 'loadeddata', 15000);
  const cvs = document.createElement('canvas'); cvs.width = w; cvs.height = hh; const g = cvs.getContext('2d', { alpha: false });
  let lastKey = -1, n = 0, lastT = -1;
  m.proxyState = '0%'; renderPanelIfMedia();
  try { await new Promise((res, rej) => {
    let watchdog = setTimeout(() => res(), 15000);
    const onFrame = (now, md) => {
      clearTimeout(watchdog); watchdog = setTimeout(() => res(), 5000);
      if (err) return rej(err);
      if (exporting) { clearTimeout(watchdog); return rej(new Error('export')); } // later opnieuw
      const t = md.mediaTime;
      if (t > lastT + 1e-4) {
        lastT = t;
        g.drawImage(v, 0, 0, w, hh);
        const fr = new VideoFrame(cvs, { timestamp: Math.round(t * 1e6) });
        const key = Math.floor(t * 2) !== lastKey; if (key) lastKey = Math.floor(t * 2);
        enc.encode(fr, { keyFrame: key }); fr.close(); n++;
        const pct = Math.min(99, Math.floor(t / m.duration * 100)) + '%';
        if (pct !== m.proxyState) { m.proxyState = pct; if (n % 15 === 0) renderPanelIfMedia(); }
      }
      if (v.ended) { clearTimeout(watchdog); res(); } else v.requestVideoFrameCallback(onFrame);
    };
    v.addEventListener('ended', () => { clearTimeout(watchdog); setTimeout(res, 200); }, { once: true });
    v.requestVideoFrameCallback(onFrame);
    // zo snel als de laptop toelaat, maar niet zo snel dat er beelden wegvallen
    v.playbackRate = 2; v.play().catch(rej);
  }); } catch (e) { try { enc.close(); } catch (x) { } throw e; }
  finally { v.pause(); v.removeAttribute('src'); v.load(); }
  await enc.flush(); enc.close();
  if (err) throw err;
  if (n < 2) return null;
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}
