/* Local-only still-image compositor. No photo data leaves this browser. */
(function () {
  'use strict';
  const cache = new Map();
  const editScriptURL = document.currentScript && document.currentScript.src;
  let editLibrary;
  const loadEditLibrary = () => editLibrary || (editLibrary = import(new URL('../vendor/mediabunny/mediabunny-1.61.3.min.mjs', editScriptURL || new URL('js/ghost-engine.js', location.href)).href).catch(e => { editLibrary = null; throw e; }));
  let state = { ready: false, segmentation: false }, initializing, worker, sequence = 0;
  const pending = new Map();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pause = () => new Promise(r => setTimeout(r, 0));
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function pixels(c) { return c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height); }
  function draw(image, w = image.width, h = image.height) { const c = canvas(w, h); c.getContext('2d').drawImage(image, 0, 0, w, h); return c; }
  function encode(c, type = 'image/jpeg', quality = .92) { return new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('이미지 저장 실패')), type, quality)); }
  async function decode(blob) {
    const url = URL.createObjectURL(blob), img = new Image();
    try { img.src = url; await img.decode(); return draw(img, img.naturalWidth, img.naturalHeight); }
    finally { URL.revokeObjectURL(url); }
  }
  function stopWorker(message) {
    if (worker) worker.terminate(); worker = null;
    state.segmentation = false; state.error = message;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); } pending.clear();
  }
  function request(type, data = {}, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => stopWorker('인물 분할 응답 시간 초과'), type === 'init' ? 25000 : 5000);
      pending.set(id, { resolve, reject, timer }); worker.postMessage({ id, type, ...data }, transfer);
    });
  }
  async function init({ base = './' } = {}) {
    if (initializing) return initializing;
    initializing = (async () => {
      try {
        const root = new URL('vendor/mediapipe/', new URL(base, location.href)).href;
        if (new URL(root).origin !== location.origin) throw new Error('모델은 같은 서버에서 제공해야 합니다');
        const source = `let segmenter; self.onmessage = async ({data:m}) => { try {
          if(m.type==='init') {
            const vision=await import(m.root+'vision_bundle.mjs');
            const files=await vision.FilesetResolver.forVisionTasks(m.root+'wasm');
            segmenter=await vision.ImageSegmenter.createFromOptions(files,{baseOptions:{modelAssetPath:m.root+'selfie_segmenter.tflite',delegate:'CPU'},runningMode:'IMAGE',outputConfidenceMasks:true,outputCategoryMask:false});
            self.postMessage({id:m.id,ok:true});
          } else {
            try { segmenter.segment(m.bitmap, result => {
              const mask=result.confidenceMasks[0], values=new Float32Array(mask.getAsFloat32Array());
              self.postMessage({id:m.id,ok:true,width:mask.width,height:mask.height,values},[values.buffer]);
            }); } finally { m.bitmap.close(); }
          }
        } catch(e) { self.postMessage({id:m.id,ok:false,error:String(e.message||e)}); } };`;
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        try { worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
        worker.onmessage = ({ data }) => { const p = pending.get(data.id); if (!p) return; pending.delete(data.id); clearTimeout(p.timer); data.ok ? p.resolve(data) : p.reject(new Error(data.error)); };
        worker.onerror = e => stopWorker(e.message || '인물 분할 워커 실패');
        await request('init', { root }); state = { ready: true, segmentation: true };
      } catch (e) { stopWorker(String(e.message || e)); state.ready = true; }
      return status();
    })();
    return initializing;
  }
  function status() { return { ...state }; }
  function validate(asset) {
    const m = asset.meta, b = m && m.bbox;
    if (!m || m.version !== 1 || !Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 1 || m.height < 1 || m.width * m.height > 16000000 || !Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite) || b[0] < 0 || b[1] < 0 || b[2] <= 0 || b[3] <= 0 || b[0] + b[2] > m.width || b[1] + b[3] > m.height) throw new Error('소재 meta.json 규격 오류');
    for (const i of [asset.background, asset.ghost]) if ((i.naturalWidth || i.width) !== m.width || (i.naturalHeight || i.height) !== m.height) throw new Error('배경·귀신·메타의 크기가 다릅니다');
    return asset;
  }
  async function loadAsset(path) {
    const url = new URL(path.endsWith('/') ? path : path + '/', location.href);
    if (url.origin !== location.origin) throw new Error('소재는 같은 서버에서 제공해야 합니다');
    if (!cache.has(url.href)) {
      const promise = (async () => {
        const fetchFile = async name => { const r = await fetch(new URL(name, url)); if (!r.ok) throw new Error(name + ': HTTP ' + r.status); return r; };
        const [meta, background, ghost] = await Promise.all([fetchFile('meta.json').then(r => r.json()), fetchFile('background.jpg').then(r => r.blob()).then(decode), fetchFile('ghost.png').then(r => r.blob()).then(decode)]);
        return validate({ meta, background, ghost });
      })();
      cache.set(url.href, promise); promise.catch(() => cache.delete(url.href));
    }
    return cache.get(url.href);
  }
  const luma = (d, i) => .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2];
  const median = a => { a.sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };
  // Trimmed gradient matching rejects people and tolerates exposure changes.
  async function align(background, photo, bbox, person) {
    const w = 192, h = Math.max(32, Math.round(w * photo.height / photo.width));
    const a = pixels(draw(background, w, h)).data, b = pixels(draw(photo, w, h)).data;
    const box = bbox.map((v, i) => v * (i % 2 ? h / background.height : w / background.width));
    const p = person ? pixels(draw(person, w, h)).data : null;
    let best = { score: Infinity, dx: 0, dy: 0, texture: 0 };
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const errors = []; let texture = 0;
        for (let y = 8; y < h - 8; y += 3) for (let x = 8; x < w - 8; x += 3) {
          if (x >= box[0] - 4 && x <= box[0] + box[2] + 4 && y >= box[1] - 4 && y <= box[1] + box[3] + 4) continue;
          const i = (y * w + x) * 4, j = ((y + dy) * w + x + dx) * 4;
          if (p && p[j + 3] > 30) continue;
          const ax = luma(a, i + 4) - luma(a, i - 4), ay = luma(a, i + w * 4) - luma(a, i - w * 4);
          if (Math.abs(ax) + Math.abs(ay) < 6) continue;
          texture++;
          errors.push(Math.min(100, Math.abs(ax - (luma(b, j + 4) - luma(b, j - 4))) + Math.abs(ay - (luma(b, j + w * 4) - luma(b, j - w * 4)))));
        }
        errors.sort((a, b) => a - b); const n = Math.floor(errors.length * .7);
        const score = n > 30 ? errors.slice(0, n).reduce((s, v) => s + v, 0) / n + (Math.abs(dx) + Math.abs(dy)) * .015 : Infinity;
        if (score < best.score) best = { score, dx, dy, texture };
      }
      await pause();
    }
    return { ...best, dx: best.dx * photo.width / w, dy: best.dy * photo.height / h, boundary: Math.abs(best.dx) === 5 || Math.abs(best.dy) === 5 };
  }
  async function personMask(photo) {
    if (!state.segmentation || !worker) return null;
    try {
      const small = draw(photo, Math.min(768, photo.width), Math.round(photo.height * Math.min(768, photo.width) / photo.width));
      const bitmap = await createImageBitmap(small), r = await request('segment', { bitmap }, [bitmap]);
      const c = canvas(r.width, r.height), d = c.getContext('2d').createImageData(r.width, r.height); let sum = 0;
      for (let i = 0; i < r.values.length; i++) { const v = r.values[i]; if (!Number.isFinite(v)) return null; const alpha = clamp((v - .15) / .65, 0, 1); d.data[i * 4 + 3] = alpha * 255; sum += alpha; }
      if (sum < 2 || sum > r.values.length * .97) return null;
      c.getContext('2d').putImageData(d, 0, 0);
      const full = canvas(photo.width, photo.height), ctx = full.getContext('2d'); ctx.filter = 'blur(1px)'; ctx.drawImage(c, 0, 0, full.width, full.height); return full;
    } catch (e) { state.error = String(e.message || e); return null; }
  }
  // Robust local RGB fit; moving foreground and clipped lamps are rejected.
  function fit(background, photo, ghost, person) {
    const w = Math.min(384, photo.width), h = Math.round(photo.height * w / photo.width);
    const b = pixels(draw(background, w, h)).data, p = pixels(draw(photo, w, h)).data, g = pixels(draw(ghost, w, h)).data;
    const m = person ? pixels(draw(person, w, h)).data : null;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let i = 0; i < w * h; i++) if (g[i * 4 + 3] > 4) { minX = Math.min(minX, i % w); maxX = Math.max(maxX, i % w); minY = Math.min(minY, Math.floor(i / w)); maxY = Math.max(maxY, Math.floor(i / w)); }
    const ratios = [[], [], []], samples = [];
    for (let y = Math.max(1, minY - 32); y < Math.min(h - 1, maxY + 32); y += 2) for (let x = Math.max(1, minX - 32); x < Math.min(w - 1, maxX + 32); x += 2) {
      const i = (y * w + x) * 4;
      if (g[i + 3] > 2 || (m && m[i + 3] > 20) || b[i + 3] < 250) continue;
      if ([0, 1, 2].some(k => b[i + k] < 20 || b[i + k] > 235 || p[i + k] < 8 || p[i + k] > 247)) continue;
      samples.push(i); for (let k = 0; k < 3; k++) ratios[k].push(p[i + k] / b[i + k]);
    }
    const gain = ratios.map(a => clamp(a.length > 24 ? median(a) : 1, .65, 1.45));
    const noise = [], sharpB = [], sharpP = [];
    for (const i of samples) {
      if (Math.max(...gain.map((v, k) => Math.abs(p[i + k] - b[i + k] * v))) > 18) continue;
      const lb = luma(b, i), lp = luma(p, i), db = Math.abs(lb - luma(b, i + 4)), dp = Math.abs(lp - luma(p, i + 4));
      if (db < 8) noise.push(Math.abs(lp - (luma(p, i - 4) + luma(p, i + 4) + luma(p, i - w * 4) + luma(p, i + w * 4)) / 4));
      if (db > 10) { sharpB.push(db); sharpP.push(dp); }
    }
    return { gain, noise: clamp(median(noise) * .6, 0, 2.5), blur: sharpB.length > 15 && median(sharpP) < median(sharpB) * .78 ? .55 : .2, b, p, g, w, h };
  }
  async function composite(input, asset, { quality = .92 } = {}) {
    const started = performance.now(), photo = input instanceof Blob ? await decode(input) : draw(input);
    const q = Number.isFinite(quality) ? clamp(quality, .1, 1) : .92;
    const result = async (applied, reason, output = photo) => ({ blob: !applied && input instanceof Blob && input.type === 'image/jpeg' ? input : await encode(output, 'image/jpeg', q), applied, ...(reason ? { reason } : {}), ms: Math.round(performance.now() - started) });
    try {
      validate(asset);
      if (photo.width * photo.height > 12000000 || Math.max(photo.width, photo.height) > 4096) return result(false, 'photo-too-large');
      if (Math.abs(photo.width / photo.height / (asset.meta.width / asset.meta.height) - 1) > .025) return result(false, 'aspect-ratio-mismatch');
      await pause(); const person = await personMask(photo);
      const registration = await align(asset.background, photo, asset.meta.bbox, person);
      if (registration.score > 18 || registration.boundary) return result(false, 'background-alignment-uncertain');
      const bg = canvas(photo.width, photo.height), layer = canvas(photo.width, photo.height);
      bg.getContext('2d').drawImage(asset.background, registration.dx, registration.dy, photo.width, photo.height);
      layer.getContext('2d').drawImage(asset.ghost, registration.dx, registration.dy, photo.width, photo.height);
      const bx = asset.meta.bbox, sx = photo.width / asset.meta.width, sy = photo.height / asset.meta.height;
      if (bx[0] * sx + registration.dx < 0 || bx[1] * sy + registration.dy < 0 || (bx[0] + bx[2]) * sx + registration.dx > photo.width || (bx[1] + bx[3]) * sy + registration.dy > photo.height) return result(false, 'ghost-out-of-frame');
      const tuning = fit(bg, photo, layer, person);
      if (!person) {
        let changed = 0, count = 0;
        // Compare the whole bounding rectangle (including holes) with a safety margin.
        const x0 = (bx[0] * sx + registration.dx) * tuning.w / photo.width, y0 = (bx[1] * sy + registration.dy) * tuning.h / photo.height;
        const x1 = x0 + bx[2] * tuning.w / asset.meta.width, y1 = y0 + bx[3] * tuning.h / asset.meta.height;
        for (let y = Math.max(0, Math.floor(y0 - 3)); y < Math.min(tuning.h, y1 + 3); y++) for (let x = Math.max(0, Math.floor(x0 - 3)); x < Math.min(tuning.w, x1 + 3); x++) {
          const i = (y * tuning.w + x) * 4; count++;
          if (Math.max(...tuning.gain.map((v, k) => Math.abs(tuning.p[i + k] - tuning.b[i + k] * v))) > 22) changed++;
        }
        if (!count || changed / count > .015) return result(false, 'segmentation-unavailable-overlap-uncertain');
      }
      const data = pixels(layer); let seed = 123456789;
      for (let y = 0; y < layer.height; y++) {
        for (let x = 0; x < layer.width; x++) { const i = (y * layer.width + x) * 4; if (!data.data[i + 3]) continue;
          seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
          const n = ((seed >>> 0) / 4294967296 - .5) * tuning.noise * 3.46;
          for (let k = 0; k < 3; k++) data.data[i + k] = clamp(data.data[i + k] * tuning.gain[k] + n, 0, 255);
        }
        if (y % 128 === 0) await pause();
      }
      layer.getContext('2d').putImageData(data, 0, 0);
      const out = draw(photo), ctx = out.getContext('2d'); ctx.filter = `blur(${tuning.blur}px)`; ctx.drawImage(layer, 0, 0); ctx.filter = 'none';
      if (person) { const foreground = draw(photo), f = foreground.getContext('2d'); f.globalCompositeOperation = 'destination-in'; f.drawImage(person, 0, 0); ctx.drawImage(foreground, 0, 0); }
      return result(true, person ? undefined : 'background-verified-without-segmentation', out);
    } catch (e) { return result(false, 'composite-error: ' + String(e.message || e)); }
  }
  function videoSupport() {
    if (typeof MediaRecorder === 'undefined' || typeof MediaStream === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return { ok: false, mime: '', reason: 'video-recording-unavailable' };
    // Explicit H.264 first; never assume an arbitrary MP4 encoder is H.264.
    const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'];
    const mime = types.find(t => MediaRecorder.isTypeSupported(t));
    return mime ? { ok: true, mime: mime.split(';')[0], recorderMime: mime } : { ok: false, mime: '', reason: 'video-codec-unavailable' };
  }

  async function startVideo(video, { asset = null, audioTrack = null, maxMs = 60000, ghostAtMs = [3000, 9000], overlay } = {}) {
    const support = videoSupport();
    if (!support.ok) throw new Error(support.reason);
    if (!video || video.readyState < 2 || !video.videoWidth || video.paused || video.ended) throw new Error('camera-not-playing');
    if (!Number.isFinite(maxMs) || maxMs <= 0 || maxMs > 60000) throw new Error('maxMs-must-be-between-0-and-60000');
    if (!Array.isArray(ghostAtMs) || ghostAtMs.length !== 2 || !ghostAtMs.every(Number.isFinite) || ghostAtMs[0] < 0 || ghostAtMs[1] < ghostAtMs[0]) throw new Error('invalid-ghost-time-range');
    if (overlay != null && typeof overlay !== 'function') throw new Error('invalid-overlay');
    if (audioTrack && (audioTrack.kind !== 'audio' || audioTrack.readyState !== 'live')) throw new Error('invalid-audio-track');
    if (document.hidden) throw new Error('document-hidden');
    if (asset) validate(asset);
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight), 720 / Math.min(video.videoWidth, video.videoHeight));
    const sourceWidth = video.videoWidth, sourceHeight = video.videoHeight;
    const w = Math.max(2, Math.floor(sourceWidth * scale / 2) * 2), h = Math.max(2, Math.floor(sourceHeight * scale / 2) * 2);
    const original = canvas(w, h), oc = original.getContext('2d');
    const edited = asset ? canvas(w, h) : null, ec = edited && edited.getContext('2d');
    // Overlay is rendered once, then copied onto both outputs at identical timestamps.
    const hud = overlay ? canvas(w, h) : null, hc = hud && hud.getContext('2d');
    oc.drawImage(video, 0, 0, w, h);
    let reason = asset ? 'ghost-time-not-reached' : 'no-asset';
    let background, layer, probe, pc, reference, box, tuned = false, eligible = !!asset;
    if (asset) {
      if (Math.abs(w / h / (asset.meta.width / asset.meta.height) - 1) > .025) { eligible = false; reason = 'aspect-ratio-mismatch'; }
      if (eligible) {
        const registration = await align(asset.background, original, asset.meta.bbox, null);
        if (registration.score > 18 || registration.boundary) { eligible = false; reason = 'background-alignment-uncertain'; }
        else {
          background = canvas(w, h); layer = canvas(w, h);
          background.getContext('2d').drawImage(asset.background, registration.dx, registration.dy, w, h);
          layer.getContext('2d').drawImage(asset.ghost, registration.dx, registration.dy, w, h);
          const b = asset.meta.bbox, sx = w / asset.meta.width, sy = h / asset.meta.height;
          const bounds = [b[0] * sx + registration.dx, b[1] * sy + registration.dy, b[2] * sx, b[3] * sy];
          if (bounds[0] < 0 || bounds[1] < 0 || bounds[0] + bounds[2] > w || bounds[1] + bounds[3] > h) { eligible = false; reason = 'ghost-out-of-frame'; }
          probe = canvas(192, Math.max(2, Math.round(192 * h / w))); pc = probe.getContext('2d', { willReadFrequently: true });
          reference = pixels(draw(background, probe.width, probe.height)).data;
          box = bounds.map((v, i) => v * (i % 2 ? probe.height / h : probe.width / w));
        }
      }
    }
    if (document.hidden || video.paused || video.ended) throw new Error('camera-interrupted-during-setup');
    function spaceClear() {
      pc.drawImage(original, 0, 0, probe.width, probe.height);
      const current = pc.getImageData(0, 0, probe.width, probe.height).data;
      const ratios = [[], [], []];
      // Exposure estimate from the rest of the room, not from a person covering the ghost.
      for (let y = 2; y < probe.height - 2; y += 4) for (let x = 2; x < probe.width - 2; x += 4) {
        if (x >= box[0] - 3 && x <= box[0] + box[2] + 3 && y >= box[1] - 3 && y <= box[1] + box[3] + 3) continue;
        const i = (y * probe.width + x) * 4;
        for (let k = 0; k < 3; k++) if (reference[i + k] > 20 && reference[i + k] < 235) ratios[k].push(current[i + k] / reference[i + k]);
      }
      const gain = ratios.map(a => clamp(a.length ? median(a) : 1, .65, 1.45));
      let changed = 0, count = 0;
      for (let y = Math.max(0, Math.floor(box[1] - 3)); y < Math.min(probe.height, box[1] + box[3] + 3); y++) for (let x = Math.max(0, Math.floor(box[0] - 3)); x < Math.min(probe.width, box[0] + box[2] + 3); x++) {
        const i = (y * probe.width + x) * 4; count++;
        if (Math.max(...gain.map((v, k) => Math.abs(current[i + k] - reference[i + k] * v))) > 22) changed++;
      }
      return count > 0 && changed / count <= .015;
    }
    function tuneLayer() {
      const tuning = fit(background, original, layer, null), data = pixels(layer);
      let seed = 123456789;
      for (let i = 0; i < data.data.length; i += 4) {
        if (!data.data[i + 3]) continue;
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        const n = ((seed >>> 0) / 4294967296 - .5) * tuning.noise * 3.46;
        for (let k = 0; k < 3; k++) data.data[i + k] = clamp(data.data[i + k] * tuning.gain[k] + n, 0, 255);
      }
      layer.getContext('2d').putImageData(data, 0, 0);
      const softened = canvas(w, h), ctx = softened.getContext('2d');
      ctx.filter = `blur(${tuning.blur}px)`; ctx.drawImage(layer, 0, 0); layer = softened; tuned = true;
    }
    const entries = [], ownedTracks = [], removers = [];
    let started = null, ended = null, stopping = false, stopPromise, frameTimer, limitTimer, lastFrame = 0, lastComposite = -Infinity;
    let appearance, finished = false, applied = false, frames = 0, compositeFrames = 0, missed = 0, windowMissed = 0, windowFrames = 0, windowStart = 0, compositeFps = 24;
    const downgrades = [];
    let finishReason = 'manual', recordingError;
    const chosenTime = ghostAtMs[0] + Math.random() * (ghostAtMs[1] - ghostAtMs[0]);
    const elapsed = () => started === null ? 0 : Math.max(0, (ended === null ? performance.now() : ended) - started);
    const rec = { elapsed, stop: () => stop('manual'), onautostop: null, onstop: null };
    function listen(target, name, fn) { target.addEventListener(name, fn); removers.push(() => target.removeEventListener(name, fn)); }
    function cleanup() {
      clearTimeout(frameTimer); clearTimeout(limitTimer);
      for (const remove of removers.splice(0)) remove();
      for (const track of ownedTracks) track.stop();
    }
    function stop(cause) {
      if (stopPromise) return stopPromise;
      stopping = true; ended = performance.now(); finishReason = cause;
      clearTimeout(frameTimer); clearTimeout(limitTimer);
      // Install the promise before calling stop: errors/stop events may re-enter here.
      stopPromise = Promise.all(entries.map(e => e.done)).then(blobs => {
        cleanup();
        const r = { original: blobs[0], composite: edited ? blobs[1] : null, mime: support.mime, ext: support.mime === 'video/mp4' ? 'mp4' : 'webm', durationMs: Math.round(elapsed()), applied,
          ...(reason ? { reason } : {}), ...(appearance !== undefined ? { ghostAtMs: Math.round(appearance) } : {}),
          stats: { width: w, height: h, targetFps: 24, compositeFps: edited ? compositeFps : 0, frames, compositeFrames, droppedFrameRatio: frames + missed ? missed / (frames + missed) : 0, dropMetric: 'render-scheduler-estimate', downgrades, stopReason: finishReason, ...(recordingError ? { error: recordingError } : {}) } };
        if (blobs.some(b => !b.size)) { r.reason = 'empty-recording'; r.applied = false; }
        else if (recordingError) r.reason = 'recording-interrupted: ' + recordingError;
        // Callback failures cannot discard the successfully finalized recording.
        for (const cb of [rec.onstop, cause === 'maxMs' ? rec.onautostop : null]) if (typeof cb === 'function') { try { cb(r); } catch (e) { console.error(e); } }
        return r;
      });
      for (const e of entries) if (e.recorder.state !== 'inactive') { try { e.recorder.stop(); } catch (error) { recordingError = String(error.message || error); e.settle(); } }
      return stopPromise;
    }
    function paint(t) {
      oc.drawImage(video, 0, 0, w, h);
      const updateComposite = !!edited && t - lastComposite >= 1000 / compositeFps - 2;
      if (updateComposite) {
        lastComposite = t; compositeFrames++;
        ec.drawImage(original, 0, 0);
        if (eligible && !finished && t >= chosenTime) {
          if (appearance === undefined) {
            if (t > maxMs - 1500) { finished = true; reason = 'ghost-space-never-clear'; }
            else if (spaceClear()) { if (!tuned) tuneLayer(); appearance = t; reason = undefined; }
            else reason = 'ghost-space-occupied';
          }
          if (appearance !== undefined) {
            const age = t - appearance;
            if (age >= 1000) finished = true;
            else if (!spaceClear()) { finished = true; reason = 'ghost-ended-on-occlusion'; }
            else {
              ec.save(); ec.globalAlpha = clamp(Math.min((age + 1000 / compositeFps) / 120, (1000 - age) / 160), 0, 1); ec.drawImage(layer, 0, 0); ec.restore(); applied = true;
            }
          }
        }
      }
      if (overlay) {
        hc.clearRect(0, 0, w, h); hc.save();
        try { overlay(hc, w, h, t); } finally { hc.restore(); }
        oc.drawImage(hud, 0, 0);
        if (updateComposite) ec.drawImage(hud, 0, 0);
      }
      for (const e of entries) if ((!e.composite || updateComposite) && e.track.requestFrame) e.track.requestFrame();
    }
    function tick() {
      if (stopping) return;
      const now = performance.now(), t = now - started;
      if (t >= maxMs) { stop('maxMs'); return; }
      if (video.ended || video.paused || video.readyState < 2) { stop('camera-interrupted'); return; }
      if (video.videoWidth !== sourceWidth || video.videoHeight !== sourceHeight) { stop('camera-size-changed'); return; }
      const gap = now - lastFrame, lost = Math.max(0, Math.round(gap / (1000 / 24)) - 1);
      missed += lost; windowMissed += lost; frames++; windowFrames++; lastFrame = now;
      try { paint(t); } catch (e) { recordingError = String(e.message || e); stop('render-error'); return; }
      if (edited && t - windowStart >= 2000) {
        const ratio = windowMissed / Math.max(1, windowFrames + windowMissed);
        if (ratio > .15 && compositeFps > 12) { compositeFps = compositeFps === 24 ? 18 : 12; downgrades.push({ atMs: Math.round(t), compositeFps, droppedFrameRatio: ratio }); }
        windowStart = t; windowFrames = 0; windowMissed = 0;
      }
      frameTimer = setTimeout(tick, Math.max(0, 1000 / 24 - (performance.now() - now)));
    }
    try {
      paint(0);
      for (const c of [original, edited].filter(Boolean)) {
        // Manual capture permits reducing composite frame rate without resizing an active encoder.
        const stream = c.captureStream(0), track = stream.getVideoTracks()[0]; ownedTracks.push(track);
        if (!track.requestFrame) { ownedTracks.pop(); track.stop(); const fallback = c.captureStream(24); stream.removeTrack(track); stream.addTrack(fallback.getVideoTracks()[0]); ownedTracks.push(...fallback.getTracks()); }
        if (audioTrack) { const clone = audioTrack.clone(); ownedTracks.push(clone); stream.addTrack(clone); }
        const recorder = new MediaRecorder(stream, { mimeType: support.recorderMime, videoBitsPerSecond: 2000000, audioBitsPerSecond: 96000 });
        const chunks = []; let settle;
        const done = new Promise(resolve => { settle = () => resolve(new Blob(chunks, { type: recorder.mimeType || support.mime })); });
        const entry = { recorder, done, settle, track: stream.getVideoTracks()[0], composite: c === edited }; entries.push(entry);
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.onstop = () => { settle(); if (!stopping) stop('recorder-stopped'); };
        recorder.onerror = event => { recordingError = event.error ? event.error.message : 'media-recorder-error'; stop('recorder-error'); };
      }
      for (const e of entries) e.recorder.start(1000);
      started = performance.now(); lastFrame = started;
      listen(document, 'visibilitychange', () => { if (document.hidden) stop('document-hidden'); });
      listen(window, 'pagehide', () => stop('pagehide'));
      listen(video, 'pause', () => stop('camera-paused'));
      listen(video, 'ended', () => stop('camera-ended'));
      if (video.srcObject && video.srcObject.getVideoTracks) for (const track of video.srcObject.getVideoTracks()) { listen(track, 'ended', () => stop('camera-ended')); listen(track, 'mute', () => stop('camera-muted')); }
      limitTimer = setTimeout(() => stop('maxMs'), maxMs);
      tick();
      return rec;
    } catch (e) {
      stopping = true;
      for (const entry of entries) if (entry.recorder.state !== 'inactive') entry.recorder.stop();
      cleanup(); throw e;
    }
  }
  function editSupport() {
    const webcodecs = typeof VideoDecoder !== 'undefined' && typeof VideoEncoder !== 'undefined';
    const realtime = videoSupport().ok && typeof HTMLVideoElement !== 'undefined' &&
      !!(HTMLVideoElement.prototype.captureStream || HTMLVideoElement.prototype.mozCaptureStream);
    return { webcodecs, realtime, ...(!webcodecs && !realtime ? { reason: 'video-edit-unavailable' } : {}) };
  }

  // One low-resolution image and scalar clear intervals, never a collection of decoded frames.
  function editAnalysis(asset, width, height, range, duration) {
    if (Math.abs(width / height / (asset.meta.width / asset.meta.height) - 1) > .025) throw Error('aspect-ratio-mismatch');
    const w = 192, h = Math.max(32, Math.round(w * height / width));
    const probe = canvas(w, h), ctx = probe.getContext('2d', { willReadFrequently: true });
    let registration, background, reference, box, previous, lastAlign = -Infinity, clearStart = null, lastEnd = 0;
    const runs = [];
    function clear(image) {
      ctx.drawImage(image, 0, 0, w, h);
      const current = ctx.getImageData(0, 0, w, h).data, ratios = [[], [], []];
      for (let y = 2; y < h - 2; y += 4) for (let x = 2; x < w - 2; x += 4) {
        if (x >= box[0] - 3 && x <= box[0] + box[2] + 3 && y >= box[1] - 3 && y <= box[1] + box[3] + 3) continue;
        const i = (y * w + x) * 4;
        for (let k = 0; k < 3; k++) if (reference[i + k] > 20 && reference[i + k] < 235) ratios[k].push(current[i + k] / reference[i + k]);
      }
      const gain = ratios.map(a => clamp(a.length ? median(a) : 1, .65, 1.45));
      let changed = 0, count = 0;
      for (let y = Math.max(0, Math.floor(box[1] - 3)); y < Math.min(h, box[1] + box[3] + 3); y++) for (let x = Math.max(0, Math.floor(box[0] - 3)); x < Math.min(w, box[0] + box[2] + 3); x++) {
        const i = (y * w + x) * 4; count++;
        if (Math.max(...gain.map((v, k) => Math.abs(current[i + k] - reference[i + k] * v))) > 22) changed++;
      }
      return count > 0 && changed / count <= .015;
    }
    function closeRun() { if (clearStart !== null) runs.push([clearStart, lastEnd]); clearStart = null; }
    return {
      async inspect(image, time, end) {
        ctx.drawImage(image, 0, 0, w, h);
        const current = ctx.getImageData(0, 0, w, h).data;
        let edges = 0, changedEdges = 0;
        if (previous) for (let y = 3; y < h - 3; y += 3) for (let x = 3; x < w - 3; x += 3) {
          if (box && x >= box[0] - 3 && x <= box[0] + box[2] + 3 && y >= box[1] - 3 && y <= box[1] + box[3] + 3) continue;
          const i = (y * w + x) * 4;
          const gx = luma(previous, i + 4) - luma(previous, i - 4), gy = luma(previous, i + w * 4) - luma(previous, i - w * 4);
          if (Math.abs(gx) + Math.abs(gy) < 6) continue;
          edges++;
          if (Math.abs(gx - luma(current, i + 4) + luma(current, i - 4)) + Math.abs(gy - luma(current, i + w * 4) + luma(current, i - w * 4)) > 25) changedEdges++;
        }
        previous = current;
        if (time - lastAlign >= .5 || !registration || (edges > 30 && changedEdges / edges > .3)) {
          const r = await align(asset.background, probe, asset.meta.bbox, null); lastAlign = time;
          if (r.boundary || r.score > 18 || (registration && (Math.abs(r.dx - registration.dx) > 1 || Math.abs(r.dy - registration.dy) > 1))) throw Error('camera-moved');
          if (!registration) {
            registration = r; background = canvas(w, h);
            background.getContext('2d').drawImage(asset.background, r.dx, r.dy, w, h);
            reference = pixels(background).data;
            const b = asset.meta.bbox;
            box = [b[0] * w / asset.meta.width + r.dx, b[1] * h / asset.meta.height + r.dy, b[2] * w / asset.meta.width, b[3] * h / asset.meta.height];
            if (box[0] < 0 || box[1] < 0 || box[0] + box[2] > w || box[1] + box[3] > h) throw Error('ghost-out-of-frame');
          }
        }
        if (time > lastEnd + .15) closeRun();
        if (clear(image)) { if (clearStart === null) clearStart = time; } else closeRun();
        lastEnd = end;
      },
      choose() {
        closeRun();
        const candidates = runs.map(([a, b]) => [Math.max(a, range[0]), Math.min(b - duration, range[1])]).filter(([a, b]) => b >= a);
        if (!candidates.length) throw Error('ghost-space-never-clear');
        const c = candidates[Math.floor(Math.random() * candidates.length)];
        return c[0] + Math.random() * (c[1] - c[0]);
      },
      clear,
      layer(image, outWidth, outHeight) {
        const bg = canvas(outWidth, outHeight), raw = canvas(outWidth, outHeight);
        const dx = registration.dx * outWidth / w, dy = registration.dy * outHeight / h;
        bg.getContext('2d').drawImage(asset.background, dx, dy, outWidth, outHeight);
        raw.getContext('2d').drawImage(asset.ghost, dx, dy, outWidth, outHeight);
        const tuning = fit(bg, image, raw, null), data = pixels(raw); let seed = 123456789;
        for (let i = 0; i < data.data.length; i += 4) if (data.data[i + 3]) {
          seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
          const noise = ((seed >>> 0) / 4294967296 - .5) * tuning.noise * 3.46;
          for (let k = 0; k < 3; k++) data.data[i + k] = clamp(data.data[i + k] * tuning.gain[k] + noise, 0, 255);
        }
        raw.getContext('2d').putImageData(data, 0, 0);
        const softened = canvas(outWidth, outHeight), sc = softened.getContext('2d');
        sc.filter = `blur(${tuning.blur}px)`; sc.drawImage(raw, 0, 0); return softened;
      }
    };
  }
  function editPainter(analysis, w, h, at, duration) {
    const surface = canvas(w, h), ctx = surface.getContext('2d'); let layer, frames = 0;
    return { surface, get frames() { return frames; }, paint(image, time) {
      ctx.drawImage(image, 0, 0, w, h);
      const age = time - at;
      if (age >= 0 && age < duration) {
        if (!analysis.clear(image)) throw Error('ghost-space-occupied');
        if (!layer) layer = analysis.layer(surface, w, h);
        ctx.save(); ctx.globalAlpha = clamp(Math.min(age / .12, (duration - age) / .16), 0, 1);
        ctx.drawImage(layer, 0, 0); ctx.restore(); frames++;
      }
    } };
  }
  const editSemanticError = e => /^(camera-moved|aspect-ratio-mismatch|ghost-out-of-frame|ghost-space-|invalid-|video-too-|no-video)/.test(e.message);

  async function editFast(blob, asset, options, progress) {
    const M = await loadEditLibrary(), input = new M.Input({ source: new M.BlobSource(blob), formats: M.ALL_FORMATS });
    let output;
    try {
      const video = await input.getPrimaryVideoTrack(); if (!video) throw Error('no-video-track');
      const end = await video.computeDuration(), start = await video.getFirstTimestamp(), length = end - start;
      if (!Number.isFinite(length) || length <= 0 || length > 61) throw Error('video-too-long-or-invalid');
      const w = video.displayWidth, h = video.displayHeight;
      if (w * h > 2560 * 1440) throw Error('video-too-large');
      const analysis = editAnalysis(asset, w, h, options.range.map(t => t + start), options.duration);
      const scan = new M.CanvasSink(video, { width: 192, height: Math.max(32, Math.round(192 * h / w)), fit: 'fill', poolSize: 1 });
      let scanned = 0;
      for await (const frame of scan.canvases()) {
        await analysis.inspect(frame.canvas, frame.timestamp, frame.timestamp + frame.duration); scanned++;
        progress(.4 * clamp((frame.timestamp - start) / length, 0, 1));
      }
      const at = analysis.choose(), audioTracks = await input.getAudioTracks();
      const audio = await Promise.all(audioTracks.map(async track => ({ track, codec: await track.getCodec(), config: await track.getDecoderConfig() })));
      const mp4 = audio.every(a => a.codec === 'aac' || a.codec === 'mp3');
      const format = mp4 ? new M.Mp4OutputFormat({ fastStart: 'in-memory' }) : new M.WebMOutputFormat();
      if (audio.some(a => !a.config || !format.getSupportedAudioCodecs().includes(a.codec))) throw Error('audio-copy-codec-unavailable');
      const codec = mp4 ? 'avc' : 'vp8';
      const bitrate = clamp(blob.size * 8 / length, 2000000, 8000000);
      if (!await M.canEncodeVideo(codec, { width: w, height: h, bitrate })) throw Error('video-encoder-unavailable');
      const painter = editPainter(analysis, w, h, at, options.duration), target = new M.BufferTarget();
      output = new M.Output({ format, target });
      const source = new M.CanvasSource(painter.surface, { codec, bitrate, keyFrameInterval: 2, latencyMode: 'realtime', hardwareAcceleration: 'no-preference' });
      output.addVideoTrack(source);
      for (const a of audio) { a.source = new M.EncodedAudioPacketSource(a.codec); output.addAudioTrack(a.source); }
      await output.start();
      // Await each encoder submission: bounded decoder/encoder queues and native frame disposal.
      const sink = new M.CanvasSink(video, { poolSize: 1 }); let frames = 0;
      for await (const frame of sink.canvases()) {
        painter.paint(frame.canvas, frame.timestamp);
        await source.add(frame.timestamp, frame.duration); frames++;
        progress(.4 + .5 * clamp((frame.timestamp - start) / length, 0, 1));
      }
      source.close();
      let audioPackets = 0;
      for (const a of audio) {
        for await (const packet of new M.EncodedPacketSink(a.track).packets()) {
          await a.source.add(packet, { decoderConfig: a.config }); audioPackets++;
        }
        a.source.close();
      }
      if (!painter.frames) throw Error('ghost-space-not-rendered');
      await output.finalize();
      const mime = mp4 ? 'video/mp4' : 'video/webm';
      return { blob: new Blob([target.buffer], { type: mime }), mime, ext: mp4 ? 'mp4' : 'webm', applied: true, ghostAtMs: Math.round((at - start) * 1000),
        stats: { width: w, height: h, durationMs: Math.round(length * 1000), frames, scanned, compositeFrames: painter.frames, audioTracks: audio.length, audioPackets, audio: 'packet-copy', bitrate, reencodedVideo: true, alignmentIntervalMs: 500 } };
    } catch (e) { if (output) { try { await output.cancel(); } catch (_) {} } throw e; }
    finally { input.dispose(); }
  }

  function videoEvent(video, event, action, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const clean = () => { clearTimeout(timer); video.removeEventListener(event, ok); video.removeEventListener('error', bad); };
      const ok = () => { clean(); resolve(); }, bad = () => { clean(); reject(Error('video-decode-error')); };
      const timer = setTimeout(() => { clean(); reject(Error('video-' + event + '-timeout')); }, timeout);
      video.addEventListener(event, ok, { once: true }); video.addEventListener('error', bad, { once: true });
      try { action(); } catch (e) { clean(); reject(e); }
    });
  }
  async function editRealtime(blob, asset, options, progress) {
    const video = document.createElement('video'), url = URL.createObjectURL(blob), tracks = [];
    let recorder, timer, frameId, failure;
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    const seek = async time => { if (Math.abs(video.currentTime - time) > .001) await videoEvent(video, 'seeked', () => { video.currentTime = time; }); };
    try {
      await videoEvent(video, 'loadeddata', () => { video.src = url; });
      if (!Number.isFinite(video.duration)) { await seek(1e10); await seek(0); }
      const length = video.duration;
      if (!Number.isFinite(length) || length <= 0 || length > 61) throw Error('video-too-long-or-invalid');
      const w = video.videoWidth, h = video.videoHeight;
      if (w * h > 2560 * 1440) throw Error('video-too-large');
      const analysis = editAnalysis(asset, w, h, options.range, options.duration);
      for (let t = 0; t < length; t += .1) {
        await seek(t); await analysis.inspect(video, t, Math.min(t + .1, length)); progress(.4 * t / length);
      }
      const at = analysis.choose(), painter = editPainter(analysis, w, h, at, options.duration);
      await seek(0); painter.paint(video, 0);
      const captured = (video.captureStream || video.mozCaptureStream).call(video); tracks.push(...captured.getTracks());
      // Muting the element prevents speaker playback; captureStream keeps its audio content.
      await video.play(); video.pause(); await seek(0);
      const audio = captured.getAudioTracks(); tracks.push(...audio.filter(t => !tracks.includes(t)));
      // Never silently deliver a muted result if the browser has failed to expose the input audio.
      try {
        const M = await loadEditLibrary(), input = new M.Input({ source: new M.BlobSource(blob), formats: M.ALL_FORMATS });
        try { if ((await input.getAudioTracks()).length && !audio.length) throw Error('audio-capture-unavailable'); }
        finally { input.dispose(); }
      } catch (e) { if (e.message === 'audio-capture-unavailable') throw e; }
      const stream = painter.surface.captureStream(30); tracks.push(...stream.getTracks()); audio.forEach(t => stream.addTrack(t));
      const support = videoSupport(), chunks = [];
      recorder = new MediaRecorder(stream, { mimeType: support.recorderMime, videoBitsPerSecond: clamp(blob.size * 8 / length, 2000000, 8000000), audioBitsPerSecond: 128000 });
      const done = new Promise((resolve, reject) => {
        recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        recorder.onerror = () => { failure = Error('media-recorder-error'); reject(failure); if (recorder.state !== 'inactive') recorder.stop(); };
        recorder.onstop = () => failure ? reject(failure) : resolve(new Blob(chunks, { type: recorder.mimeType }));
      });
      const stop = () => { if (recorder.state !== 'inactive') recorder.stop(); };
      const interrupted = () => { if (document.hidden) { failure = Error('document-hidden'); stop(); } };
      document.addEventListener('visibilitychange', interrupted);
      video.onended = stop;
      const tick = () => {
        if (recorder.state === 'inactive') return;
        try { painter.paint(video, video.currentTime); progress(.4 + .55 * video.currentTime / length); }
        catch (e) { failure = e; stop(); return; }
        if (video.requestVideoFrameCallback) frameId = video.requestVideoFrameCallback(tick);
        else timer = setTimeout(tick, 1000 / 30);
      };
      let watchdog;
      try {
        recorder.start(1000);
        watchdog = setTimeout(() => { failure = Error('realtime-playback-timeout'); stop(); }, length * 1000 + 15000);
        try { await video.play(); tick(); } catch (e) { failure = e; stop(); }
        const result = await done;
        if (!result.size || !painter.frames) throw Error('ghost-space-not-rendered');
        return { blob: result, mime: support.mime, ext: support.mime === 'video/mp4' ? 'mp4' : 'webm', applied: true, ghostAtMs: Math.round(at * 1000),
          stats: { width: w, height: h, durationMs: Math.round(length * 1000), compositeFrames: painter.frames, audioTracks: audio.length, audio: 'capture-stream-reencoded', scanIntervalMs: 100, alignmentIntervalMs: 500 } };
      } finally { clearTimeout(watchdog); document.removeEventListener('visibilitychange', interrupted); }
    } finally {
      clearTimeout(timer); if (frameId !== undefined) video.cancelVideoFrameCallback(frameId);
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      video.pause(); tracks.forEach(t => t.stop()); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
    }
  }
  async function editVideo(blob, asset, { ghostAtMs = [3000, 40000], durationMs = 1000, onProgress, forceRealtime = false } = {}) {
    const started = performance.now(); let path = 'webcodecs', fallbackReason, ratio = 0;
    const progress = value => { ratio = Math.max(ratio, clamp(value, 0, 1)); if (typeof onProgress === 'function') { try { onProgress(ratio); } catch (_) {} } };
    try {
      if (!(blob instanceof Blob) || !blob.size) throw Error('invalid-video-blob');
      validate(asset);
      if (!Array.isArray(ghostAtMs) || ghostAtMs.length !== 2 || !ghostAtMs.every(Number.isFinite) || ghostAtMs[0] < 0 || ghostAtMs[1] < ghostAtMs[0]) throw Error('invalid-ghost-time-range');
      if (!Number.isFinite(durationMs) || durationMs < 200 || durationMs > 5000) throw Error('invalid-ghost-duration');
      if (document.hidden) throw Error('document-hidden');
      const options = { range: ghostAtMs.map(t => t / 1000), duration: durationMs / 1000 }, support = editSupport();
      let result; progress(0);
      if (support.webcodecs && !forceRealtime) {
        try { result = await editFast(blob, asset, options, progress); }
        catch (e) { if (editSemanticError(e)) throw e; fallbackReason = String(e.message || e); }
      }
      if (!result) {
        path = 'realtime'; if (!support.realtime) throw Error(fallbackReason || 'video-edit-unavailable');
        result = await editRealtime(blob, asset, options, progress);
      }
      progress(1);
      return { ...result, path, ms: Math.round(performance.now() - started), stats: { ...result.stats, ...(fallbackReason ? { fallbackReason } : {}) } };
    } catch (e) {
      return { blob: null, mime: '', ext: '', applied: false, reason: String(e.message || e), path, ms: Math.round(performance.now() - started), ...(fallbackReason ? { stats: { fallbackReason } } : {}) };
    }
  }
  window.GhostEngine = { init, status, loadAsset, composite, startVideo, videoSupport, editVideo, editSupport, utils: { canvas, draw, pixels, encode, decode, validate, align, clamp, median, pause } };
})();
