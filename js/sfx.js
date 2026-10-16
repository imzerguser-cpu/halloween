/* 효과음 — 녹음 파일 없이 Web Audio 로 합성한다 (저작권·인터넷 걱정 없음).
 * 은은한 소리: 노크 · 문 삐걱 · 심장 소리 · 숨소리(속삭임)
 * 큰 소리(LOUD, 시트 설정 큰소리=예 인 단계만): 문 쾅 · 벽 쾅쾅 · 낮은 굉음 · 쨍그랑 · 비명
 * 사람·귀신 목소리 대사는 app.js 의 spookVoice (나레이션 목소리로 읽음)
 * window.Sfx.unlock() 은 화면을 처음 누를 때 불러야 소리가 난다(브라우저 규칙).
 */
(function () {
  'use strict';
  let ctx = null;
  function ac() {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function noiseBuffer(c, sec) {
    const b = c.createBuffer(1, Math.ceil(c.sampleRate * sec), c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // 큰 소리도 찢어지지 않게 압축기를 거친다
  const live = new Set();   // 지금 나는 소리 (stopAll 로 끊는다)
  function out(c, vol) {
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -6; comp.ratio.value = 8; comp.connect(c.destination);
    const g = c.createGain(); g.gain.value = vol; g.connect(comp);
    live.add(comp); setTimeout(() => live.delete(comp), 8000);
    return g;
  }

  // 나무 문 두드리는 소리 (똑똑똑 … 똑똑)
  function knock(c, dst, t0) {
    const hits = [0, 0.26, 0.52, 1.5, 1.76];
    hits.forEach((dt) => {
      const t = t0 + dt;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(dst); o.start(t); o.stop(t + 0.2);
      const n = c.createBufferSource(), f = c.createBiquadFilter(), ng = c.createGain();
      n.buffer = noiseBuffer(c, 0.08); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.2;
      ng.gain.setValueAtTime(0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      n.connect(f).connect(ng).connect(dst); n.start(t);
    });
    return 2.2;
  }
  // 문이 천천히 삐걱 열리는 소리
  function creak(c, dst, t0) {
    const dur = 2.4, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain(), am = c.createOscillator(), amg = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(95, t0);
    for (let i = 1; i <= 12; i++) o.frequency.linearRampToValueAtTime(90 + Math.random() * 70 + i * 3, t0 + (dur * i) / 12);
    f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 4;
    am.type = 'square'; am.frequency.setValueAtTime(18, t0); am.frequency.linearRampToValueAtTime(34, t0 + dur);
    amg.gain.value = 0.5; am.connect(amg).connect(g.gain);
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.5, t0 + 0.3); g.gain.setValueAtTime(0.5, t0 + dur - 0.4); g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o.connect(f).connect(g).connect(dst);
    o.start(t0); am.start(t0); o.stop(t0 + dur); am.stop(t0 + dur);
    return dur;
  }
  // 낮은 심장 소리 (쿵쿵 … 4번)
  function heartbeat(c, dst, t0) {
    for (let i = 0; i < 4; i++) {
      [0, 0.22].forEach((dt, k) => {
        const t = t0 + i * 0.95 + dt, o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(k ? 55 : 65, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.15);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(k ? 0.6 : 0.9, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        o.connect(g).connect(dst); o.start(t); o.stop(t + 0.3);
      });
    }
    return 4;
  }
  // 귓가에 스치는 숨소리·속삭임 같은 바람 소리
  function whisper(c, dst, t0) {
    const dur = 2.8, n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    n.buffer = noiseBuffer(c, dur);
    f.type = 'bandpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(700, t0); f.frequency.linearRampToValueAtTime(2200, t0 + dur * 0.45); f.frequency.linearRampToValueAtTime(900, t0 + dur);
    lfo.frequency.value = 5.5; lg.gain.value = 0.25; lfo.connect(lg).connect(g.gain);
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.5, t0 + 0.5); g.gain.linearRampToValueAtTime(0.35, t0 + dur - 0.6); g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    n.connect(f).connect(g).connect(dst); n.start(t0); lfo.start(t0); lfo.stop(t0 + dur);
    return dur;
  }
  // 문이 세게 쾅 닫히는 소리
  function slam(c, dst, t0) {
    const n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    n.buffer = noiseBuffer(c, 0.9); f.type = 'lowpass'; f.frequency.setValueAtTime(2500, t0); f.frequency.exponentialRampToValueAtTime(300, t0 + 0.5);
    g.gain.setValueAtTime(1, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
    n.connect(f).connect(g).connect(dst); n.start(t0);
    const o = c.createOscillator(), og = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(90, t0); o.frequency.exponentialRampToValueAtTime(35, t0 + 0.6);
    og.gain.setValueAtTime(1, t0); og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    o.connect(og).connect(dst); o.start(t0); o.stop(t0 + 1);
    return 1;
  }
  // 벽을 마구 세게 두드리는 소리
  function pound(c, dst, t0) {
    for (let i = 0; i < 7; i++) {
      const t = t0 + i * 0.17 + (i > 3 ? 0.25 : 0);
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
      g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(dst); o.start(t); o.stop(t + 0.25);
      const n = c.createBufferSource(), f = c.createBiquadFilter(), ng = c.createGain();
      n.buffer = noiseBuffer(c, 0.12); f.type = 'lowpass'; f.frequency.value = 1500;
      ng.gain.setValueAtTime(0.9, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      n.connect(f).connect(ng).connect(dst); n.start(t);
    }
    return 1.6;
  }
  // 바닥이 울리는 낮은 굉음
  function boom(c, dst, t0) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t0); o.frequency.exponentialRampToValueAtTime(28, t0 + 1.6);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(1, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);
    o.connect(f).connect(g).connect(dst); o.start(t0); o.stop(t0 + 1.9);
    const n = c.createBufferSource(), nf = c.createBiquadFilter(), ng = c.createGain();
    n.buffer = noiseBuffer(c, 1.5); nf.type = 'lowpass'; nf.frequency.value = 600;
    ng.gain.setValueAtTime(0.8, t0); ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
    n.connect(nf).connect(ng).connect(dst); n.start(t0);
    return 1.9;
  }
  // 쨍그랑: 유리가 깨지며 파편이 흩어지는 소리
  function glass(c, dst, t0) {
    const n = c.createBufferSource(), hp = c.createBiquadFilter(), ng = c.createGain();
    n.buffer = noiseBuffer(c, 0.5); hp.type = 'highpass'; hp.frequency.value = 1800;
    ng.gain.setValueAtTime(0.0001, t0); ng.gain.exponentialRampToValueAtTime(1, t0 + 0.005); ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
    n.connect(hp).connect(ng).connect(dst); n.start(t0);
    for (let i = 0; i < 26; i++) {                                            // 파편 딸랑딸랑
      const t = t0 + 0.02 + Math.pow(Math.random(), 1.6) * 1.1, o = c.createOscillator(), g = c.createGain();
      o.type = Math.random() < 0.5 ? 'sine' : 'triangle'; o.frequency.value = 2200 + Math.random() * 5200;
      const v = 0.12 + Math.random() * 0.3;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08 + Math.random() * 0.25);
      o.connect(g).connect(dst); o.start(t); o.stop(t + 0.4);
    }
    return 1.4;
  }
  // 날카로운 비명 같은 소리 (끼야아—)
  function shriek(c, dst, t0) {
    const o = c.createOscillator(), o2 = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
    o.type = 'sawtooth'; o2.type = 'square';
    o.frequency.setValueAtTime(700, t0); o.frequency.exponentialRampToValueAtTime(1500, t0 + 0.25); o.frequency.exponentialRampToValueAtTime(1100, t0 + 1.3);
    o2.frequency.setValueAtTime(710, t0); o2.frequency.exponentialRampToValueAtTime(1490, t0 + 0.25); o2.frequency.exponentialRampToValueAtTime(1080, t0 + 1.3);
    lfo.frequency.value = 7; lg.gain.value = 40; lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    const f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter(), mix = c.createGain();
    f1.type = 'bandpass'; f1.frequency.value = 1300; f1.Q.value = 4; f2.type = 'bandpass'; f2.frequency.value = 2900; f2.Q.value = 5;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.9, t0 + 0.06); g.gain.setValueAtTime(0.9, t0 + 1.0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
    o.connect(f1); o2.connect(f2); f1.connect(mix); f2.connect(mix); mix.connect(g).connect(dst);
    const n = c.createBufferSource(), nf = c.createBiquadFilter(), ng = c.createGain();     // 거친 숨
    n.buffer = noiseBuffer(c, 1.5); nf.type = 'bandpass'; nf.frequency.value = 3000; nf.Q.value = 0.8;
    ng.gain.setValueAtTime(0.0001, t0); ng.gain.exponentialRampToValueAtTime(0.35, t0 + 0.05); ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
    n.connect(nf).connect(ng).connect(dst);
    [o, o2, lfo].forEach((x) => { x.start(t0); x.stop(t0 + 1.6); }); n.start(t0);
    return 1.6;
  }
  // 깜짝 얼굴용 임팩트: 몸이 울리는 저음 쿵 + 날카로운 타격음 + 금속성 울림
  function impact(c, dst, t0) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(120, t0); o.frequency.exponentialRampToValueAtTime(32, t0 + 0.6);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(1, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
    o.connect(g).connect(dst); o.start(t0); o.stop(t0 + 1.2);
    const n = c.createBufferSource(), nf = c.createBiquadFilter(), ng = c.createGain();
    n.buffer = noiseBuffer(c, 0.4); nf.type = 'lowpass'; nf.frequency.setValueAtTime(9000, t0); nf.frequency.exponentialRampToValueAtTime(300, t0 + 0.35);
    ng.gain.setValueAtTime(0.0001, t0); ng.gain.exponentialRampToValueAtTime(1, t0 + 0.002); ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.38);
    n.connect(nf).connect(ng).connect(dst); n.start(t0);
    [220, 331, 467, 690].forEach((f, i) => {                                 // 금속성 울림 (징—)
      const m = c.createOscillator(), mg = c.createGain();
      m.type = 'triangle'; m.frequency.value = f * (1 + (Math.random() - 0.5) * 0.02);
      mg.gain.setValueAtTime(0.0001, t0); mg.gain.exponentialRampToValueAtTime(0.25 / (i + 1), t0 + 0.01); mg.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
      m.connect(mg).connect(dst); m.start(t0); m.stop(t0 + 1.7);
    });
    return 1.7;
  }
  const SOUNDS = { knock, creak, heartbeat, whisper };
  const LOUD = { slam, pound, boom, glass, shriek, impact };

  window.Sfx = {
    unlock() { try { ac(); } catch (e) {} },
    /** 나고 있는 소리를 모두 끊는다 */
    stopAll() { live.forEach((n) => { try { n.disconnect(); } catch (e) {} }); live.clear(); },
    names: Object.keys(SOUNDS),
    loudNames: Object.keys(LOUD),
    /** 은은한 소리. name 이 없으면 무작위. vol 0~1 */
    play(name, vol) {
      const c = ac(); if (!c) return 0;
      const fn = SOUNDS[name] || SOUNDS[this.names[Math.floor(Math.random() * this.names.length)]];
      return fn(c, out(c, Math.max(0, Math.min(1, vol == null ? 0.6 : vol))), c.currentTime + 0.05);
    },
    /** 큰 소리. name 이 없으면 무작위 */
    loud(name, vol) {
      const c = ac(); if (!c) return 0;
      const fn = LOUD[name] || LOUD[this.loudNames[Math.floor(Math.random() * this.loudNames.length)]];
      return fn(c, out(c, Math.max(0, Math.min(1, vol == null ? 1 : vol))), c.currentTime + 0.05);
    }
  };
})();
