/* 자유 배치 귀신 — 빈 배경 없이(태블릿을 들고 찍은 사진) 사진의 어두운 곳을 찾아 투명 귀신 그림을 얹는다.
 * 모든 처리는 이 브라우저 안에서만 한다. 귀신 그림: ghosts/free/manifest.json
 *   { "ghosts": [ { "file": "g1.png", "kind": "full|half|face", "height": [0.35, 0.55], "stations": ["stairs"] } ] }
 *   height = 사진 높이 대비 귀신 높이 범위, stations 가 있으면 그 장소에서 우선 쓴다.
 */
(function () {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });
  const KIND_H = { full: [0.36, 0.52], half: [0.28, 0.4], face: [0.14, 0.22] };

  async function loadImage(url) {
    const img = new Image(); img.src = url; await img.decode();
    return img;
  }
  /** 투명 그림을 알파 경계로 잘라 내고 밝기 평균을 잰다 */
  function prepare(img) {
    const c = canvas(img.naturalWidth, img.naturalHeight), x = ctx2d(c);
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0, sum = 0, n = 0;
    for (let y = 0; y < c.height; y++) for (let i = 0; i < c.width; i++) {
      const k = (y * c.width + i) * 4, a = d[k + 3];
      if (a < 24) continue;
      if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y;
      sum += (0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]) * a / 255; n += a / 255;
    }
    if (x1 <= x0 || y1 <= y0) throw new Error('빈 귀신 그림');
    const out = canvas(x1 - x0 + 1, y1 - y0 + 1);
    out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return { image: out, lum: n ? sum / n / 255 : 0.6 };
  }

  async function load(base) {
    base = (base || './') + 'ghosts/free/';
    const r = await fetch(base + 'manifest.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('자유 배치 귀신 그림 없음');
    const m = await r.json();
    const ghosts = [];
    for (const g of m.ghosts || []) {
      try { ghosts.push(Object.assign({}, g, prepare(await loadImage(base + g.file)))); } catch (e) { /* 깨진 그림은 건너뜀 */ }
    }
    if (!ghosts.length) throw new Error('자유 배치 귀신 그림 없음');
    return { ghosts };
  }

  // 작은 사진으로 밝기 적분 영상 + 사람 가림 적분 영상
  function analyse(photo, mask) {
    const W = 192, H = Math.max(8, Math.round(photo.height * W / photo.width));
    const c = canvas(W, H), x = ctx2d(c); x.drawImage(photo, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data;
    let md = null;
    if (mask) { const mc = canvas(W, H), mx = ctx2d(mc); mx.drawImage(mask, 0, 0, W, H); md = mx.getImageData(0, 0, W, H).data; }
    const L = new Float64Array((W + 1) * (H + 1)), P = new Float64Array((W + 1) * (H + 1)), lums = [];
    for (let y = 0; y < H; y++) {
      let rl = 0, rp = 0;
      for (let i = 0; i < W; i++) {
        const k = (y * W + i) * 4, l = (0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]) / 255;
        rl += l; rp += md ? md[k + 3] / 255 : 0; lums.push(l);
        L[(y + 1) * (W + 1) + i + 1] = L[y * (W + 1) + i + 1] + rl;
        P[(y + 1) * (W + 1) + i + 1] = P[y * (W + 1) + i + 1] + rp;
      }
    }
    lums.sort((a, b) => a - b);
    const box = (T, x0, y0, w, h) => (T[(y0 + h) * (W + 1) + x0 + w] - T[y0 * (W + 1) + x0 + w] - T[(y0 + h) * (W + 1) + x0] + T[y0 * (W + 1) + x0]) / (w * h);
    return { W, H, d, mean: (x0, y0, w, h) => box(L, x0, y0, w, h), person: (x0, y0, w, h) => box(P, x0, y0, w, h), median: lums[lums.length >> 1] };
  }

  /** 귀신 하나를 놓을 자리: 어둡고, 사람과 안 겹치고, 가장자리에 너무 붙지 않은 곳 */
  // 셀카 화면: 얼굴 귀신을 학생 얼굴만 하게(화면 높이 40~55%), 학생 옆·뒤에서 들여다보듯
  const SELFIE_H = { face: [0.4, 0.55], half: [0.5, 0.7], full: [0.62, 0.86] };
  function place(a, g, rnd, selfie, anyLight) {
    const range = selfie ? (SELFIE_H[g.kind] || SELFIE_H.full) : g.height || KIND_H[g.kind] || KIND_H.full;
    const best = [];
    for (const f of [1, 0.85, 0.7]) {
      const h = Math.round(a.H * (range[0] + (range[1] - range[0]) * rnd()) * f), w = Math.max(4, Math.round(h * g.image.width / g.image.height));
      if (w >= a.W * (selfie ? 0.75 : 0.6) || h >= a.H * 0.9) continue;
      const step = 3, yMin = g.kind === 'full' ? Math.round(a.H * 0.12) : Math.round(a.H * (selfie ? 0.02 : 0.04));
      for (let y = yMin; y + h <= a.H - 2; y += step) for (let x = 2; x + w <= a.W - 2; x += step) {
        if (g.kind === 'full' && y + h < a.H * 0.5) continue;              // 서 있는 귀신은 발이 화면 아래쪽에
        if (!selfie && g.kind !== 'full' && y + h > a.H * 0.6) continue;   // 얼굴·상반신은 창문 높이(화면 위쪽)에
        if (selfie && y > a.H * 0.35) continue;                              // 셀카: 얼굴이 학생 얼굴 높이쯤
        if (selfie && g.kind === 'full' && y + h < a.H * 0.8) continue;      // 셀카: 서 있는 귀신은 학생들 뒤에 선 것처럼 아래까지
        const p = a.person(x, y, w, h);
        if (p > (anyLight ? 0.7 : selfie ? 0.35 : 0.02)) continue;                            // 셀카: 학생 뒤에 조금 가려져도 됨
        const m = a.mean(x, y, w, h);
        const cx = (x + w / 2) / a.W, edge = !selfie && (cx < 0.12 || cx > 0.88) ? 0.04 : 0;
        best.push({ x, y, w, h, m, score: m + edge + p * (selfie ? 0.6 : 3) });
      }
      if (best.length) break;
    }
    if (!best.length) return null;
    best.sort((p, q) => p.score - q.score);
    const top = best[0], pool = best.filter((b) => b.score <= top.score + 0.03 && Math.abs(b.x - top.x) + Math.abs(b.y - top.y) > 0).slice(0, 40);
    const pick = pool.length && rnd() < 0.6 ? pool[Math.floor(rnd() * pool.length)] : top;
    if (!anyLight && pick.m > (selfie ? Math.max(0.6, a.median * 1.2) : Math.max(0.42, a.median * 1.05))) return null;   // 어두운 곳이 없으면 넣지 않는다
    return pick;
  }

  /** 귀신 자리와 그 빛에 맞춘 귀신 그림을 만든다 → { layer, gx, gy, alpha, mask, file } 또는 { reason } */
  async function plan(photo, lib, opts) {
    opts = opts || {};
    const rnd = opts.random || Math.random;
    if (!lib || !lib.ghosts || !lib.ghosts.length) return { reason: 'free-no-ghosts' };
    let mask = null;
    if (opts.mask !== false && window.GhostEngine && GhostEngine.utils && GhostEngine.utils.personMask) {
      try { await GhostEngine.init({ base: opts.base || './' }); mask = await GhostEngine.utils.personMask(photo); } catch (e) { mask = null; }
    }
    const a = analyse(photo, mask);
    // 장소 이야기에 맞는 귀신(stations 에 그 장소가 있거나 stations 가 없는 귀신) 중에서 고른다
    const pref = lib.ghosts.filter((g) => !g.stations || (opts.stationId && g.stations.includes(opts.stationId)));
    const pool = (pref.length ? pref : lib.ghosts).slice().sort(() => rnd() - 0.5);
    let g = null, spot = null;
    for (const cand of pool) { spot = place(a, cand, rnd, !!opts.selfie, !!opts.anyLight); if (spot) { g = cand; break; } }
    if (!spot) return { reason: 'free-no-dark-spot' };

    const sx = photo.width / a.W, sy = photo.height / a.H;
    const gx = spot.x * sx, gy = spot.y * sy, gw = spot.w * sx, gh = spot.h * sy;
    // 그 자리의 평균 색 → 귀신을 그 빛에 맞춘다
    let r = 0, gg = 0, b = 0, n = 0;
    for (let y = spot.y; y < spot.y + spot.h; y++) for (let x = spot.x; x < spot.x + spot.w; x++) { const k = (y * a.W + x) * 4; r += a.d[k]; gg += a.d[k + 1]; b += a.d[k + 2]; n++; }
    r /= n; gg /= n; b /= n;
    const target = opts.visible ? clamp(spot.m * 1.5 + 0.3, 0.34, 0.66) : clamp(spot.m * 1.35 + 0.06, 0.1, 0.5);
    const bright = clamp(target / Math.max(0.05, g.lum), 0.2, 1.3);
    const blur = Math.max(0.8, photo.width / 1000) * (g.kind === 'face' ? 1 : 1.4) * (opts.visible ? 0.7 : 1);

    const layer = canvas(gw, gh), lx = layer.getContext('2d');
    lx.filter = `grayscale(0.9) brightness(${bright.toFixed(3)}) contrast(${opts.visible ? 1.05 : 0.72}) blur(${blur.toFixed(2)}px)`;   // 화면용은 머리카락이 까맣게 남도록
    lx.drawImage(g.image, 0, 0, gw, gh);
    lx.filter = 'none';
    lx.globalCompositeOperation = 'source-atop';                       // 주변 빛 색으로 물들이기
    lx.fillStyle = `rgba(${r | 0},${gg | 0},${b | 0},${opts.visible ? 0.06 : 0.38})`; lx.fillRect(0, 0, gw, gh);
    {                                                                   // 아래쪽(발끝·어깨)은 흐릿하게 사라지게
      lx.globalCompositeOperation = 'destination-out';
      const grad = lx.createLinearGradient(0, gh * (g.kind === 'full' ? 0.78 : 0.6), 0, gh);
      grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.85)');
      lx.fillStyle = grad; lx.fillRect(0, 0, gw, gh);
    }
    lx.globalCompositeOperation = 'source-over';
    // 사진과 비슷한 잡티
    const id = lx.getImageData(0, 0, layer.width, layer.height), px = id.data, amp = 9;
    for (let k = 0; k < px.length; k += 4) {
      if (!px[k + 3]) continue;
      const e = (Math.random() + Math.random() - 1) * amp;
      px[k] = clamp(px[k] + e, 0, 255); px[k + 1] = clamp(px[k + 1] + e, 0, 255); px[k + 2] = clamp(px[k + 2] + e, 0, 255);
    }
    lx.putImageData(id, 0, 0);
    if (opts.selfie && mask) {                                          // 학생과 겹친 부분은 귀신을 지워 학생 뒤에 있는 것처럼
      lx.globalCompositeOperation = 'destination-out';
      lx.drawImage(mask, gx, gy, gw, gh, 0, 0, gw, gh);
      lx.globalCompositeOperation = 'source-over';
    }
    return { layer, gx, gy, alpha: 0.38 + rnd() * 0.17, mask, file: g.file, box: [gx, gy, gw, gh].map(Math.round) };
  }

  /** 사진(canvas)에 귀신을 얹는다 → { blob, applied, reason, file } */
  async function composite(photo, lib, opts) {
    opts = opts || {};
    const p = await plan(photo, lib, opts);
    if (!p.layer) return { blob: null, applied: false, reason: p.reason };
    const { layer, gx, gy, mask } = p;
    const out = canvas(photo.width, photo.height), ox = out.getContext('2d');
    ox.drawImage(photo, 0, 0);
    ox.globalAlpha = p.alpha;
    ox.drawImage(layer, gx, gy);
    ox.globalAlpha = 1;
    if (mask) {                                                          // 사람은 귀신보다 앞에
      const front = canvas(photo.width, photo.height), fx = front.getContext('2d');
      fx.drawImage(mask, 0, 0, photo.width, photo.height);
      fx.globalCompositeOperation = 'source-in'; fx.drawImage(photo, 0, 0);
      ox.drawImage(front, 0, 0);
    }
    const blob = await new Promise((res) => out.toBlob(res, 'image/jpeg', opts.quality || 0.92));
    return { blob, applied: !!blob, reason: blob ? '' : 'free-encode-failed', file: p.file, box: p.box };
  }

  /** 깜짝 얼굴: 얼굴 귀신 그림을 화면 가득 쓸 수 있게 흑백·고대비로 만든다 */
  function jumpFace(lib, stationId) {
    const all = (lib && lib.ghosts) || [], faces = all.filter((x) => x.kind === 'face');
    const mine = faces.filter((x) => !x.stations || (stationId && x.stations.includes(stationId)));
    const pool = mine.length ? mine : faces.length ? faces : all;
    const g = pool[Math.floor(Math.random() * pool.length)];
    if (!g) return null;
    const c = canvas(g.image.width, g.image.height), x = c.getContext('2d');
    x.filter = 'grayscale(1) contrast(1.45) brightness(0.92)';
    x.drawImage(g.image, 0, 0);
    x.filter = 'none';
    x.globalCompositeOperation = 'destination-out';                       // 어깨 쪽은 어둠 속으로
    const grad = x.createLinearGradient(0, c.height * 0.55, 0, c.height);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,1)');
    x.fillStyle = grad; x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  window.GhostFree = { load, plan, composite, jumpFace };
})();
