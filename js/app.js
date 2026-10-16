/* 할로윈 귀신 방탈출 — 앱 흐름, 저장, 구글 시트·드라이브 연동
 * 개인정보 원칙: 학생 이름은 다루지 않는다. 조 번호·인원·1·2학년 여부만 쓴다.
 */
(function () {
  'use strict';

  // ---------- 상태 ----------
  const LS_CONF = 'hg_conf';    // { apiUrl, apiKey, stationId }
  const LS_CACHE = 'hg_cache';  // { stations, settings, fetchedAt }  ※ 이름 없음
  const DEFAULT_PIN = '1031';

  // 구글 시트 웹 앱 주소는 미리 넣어 둔다 (주소만으로는 아무것도 볼 수 없고, 비밀 키가 있어야 한다)
  const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbxTmQduDTWShxua_fxjRvedt5GN83AOcOgIOKbil9pqCMc__7CDCTP6IOS0IiiPVHoh/exec';
  // 2026-10-15 개인 계정 스크립트로 옮김: 예전 주소가 저장된 태블릿은 새 주소로 (비밀 키는 다시 넣어야 함)
  const OLD_API_URLS = ['https://script.google.com/macros/s/AKfycbymj5VOiN61_FIOvXO8tApwiUPoXAZ7hUUnIZRtvzyYd1gO8XSOQvJU-IGMGmJ74lq4gA/exec'];
  let conf = readLS(LS_CONF) || {};
  if (!conf.apiUrl || OLD_API_URLS.includes(conf.apiUrl)) conf.apiUrl = DEFAULT_API_URL;
  let cache = readLS(LS_CACHE) || { stations: [], settings: {} };
  // 운영방식(인증샷 투어 / 미션)에 맞는 장소 목록. raw = 시트 장소 탭 그대로
  const effStations = (raw, st) => (window.HG_TOUR ? HG_TOUR.stations(raw, st) : raw || []);
  if (!cache.raw) cache.raw = (cache.stations || []).filter((s) => !s.tour);
  cache.stations = effStations(cache.raw, cache.settings);
  let asset = null;             // 이 장소의 귀신 소재
  let assetState = '확인 전';
  let assetChecked = false;     // loadAsset 이 한 번 끝났는지
  let cur = { group: null, lastId: null };
  let stream = null;
  let camMode = 'student';      // student | video | scan | burst | background | test
  let wakeLock = null;

  const $ = (id) => document.getElementById(id);
  const station = () => cache.stations.find((s) => s.id === conf.stationId) || null;
  const setting = (k, d) => (cache.settings && cache.settings[k]) || d;

  function readLS(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---------- 화면 전환 ----------
  const SCREENS = ['scrSetup', 'scrHome', 'scrTeam', 'scrArrive', 'scrStory', 'scrMission', 'scrCamera', 'scrSaving', 'scrResult', 'scrPin', 'scrAdmin'];
  function show(id) {
    SCREENS.forEach((s) => { $(s).hidden = s !== id; });
    const ab = $('btnAdminEnter'); if (ab) ab.hidden = !(id === 'scrHome' || id === 'scrSetup');   // 첫 화면에서만 보이는 교사 모드 버튼
    window.scrollTo(0, 0);
  }
  function goHome() {
    stopNarration(); stopSfx(); if (recNow) stopRec();
    setTimeout(runEdits, 1500);
    releaseHolds();
    cur = { group: null, lastId: null };
    if (!station()) return show('scrSetup');
    renderHome();
    show('scrHome');
  }

  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms || 2500);
  }

  // ---------- IndexedDB ----------
  const db = (() => {
    let p;
    const open = () => p || (p = new Promise((res, rej) => {
      const r = indexedDB.open('halloween-ghost', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => {
      const d = await open();
      return new Promise((res, rej) => {
        const t = d.transaction('photos', mode);
        const out = fn(t.objectStore('photos'));
        t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    };
    return {
      put: (rec) => tx('readwrite', (s) => s.put(rec)),
      get: (id) => tx('readonly', (s) => s.get(id)),
      all: () => tx('readonly', (s) => s.getAll()),
      clear: () => tx('readwrite', (s) => s.clear())
    };
  })();

  // ---------- 조(팀): 출발 장소에서 번호를 붙이고, 다른 장소는 출발 순서를 따른다 ----------
  // 이름은 다루지 않는다. 조마다 {size 인원, young 1·2학년 있음, fear 0 너무 무서움·1 조금·2 안 무서움, time 출발 시각} 만 둔다.
  const LS_TEAMS = 'hg_teams', LS_COUNTER = 'hg_counter', LS_CHECKINS = 'hg_checkins';
  let teams = readLS(LS_TEAMS) || {};           // { [조]: {size, young, time} }
  const saveTeams = () => writeLS(LS_TEAMS, teams);
  const pickMode = () => setting('조선정', '자동') === '선택';     // 자동 = 출발 장소에서 번호 자동 / 선택 = 장소마다 조 번호 누르기
  const teamCount = () => Math.max(1, Math.min(40, parseInt(setting('조수', '12'), 10) || 12));
  const startStationId = () => setting('출발장소', '') || (cache.stations[0] && cache.stations[0].id) || '';
  const isStartStation = () => !!station() && station().id === startStationId();
  const visitedKey = () => 'hg_visited_' + (conf.stationId || '');
  const teamTag = (g) => g + '@' + ((teams[g] && teams[g].time) || '');      // 같은 번호라도 다시 출발하면 다른 조로 본다
  const visited = () => new Set(readLS(visitedKey()) || []);
  function markVisited(g) { const v = visited(); v.add(teamTag(g)); writeLS(visitedKey(), [...v]); }

  /** 다음에 올 조: 출발 순서에서 이 장소에 아직 안 온 가장 앞 번호 */
  function nextTeam() {
    const v = visited();
    return Object.keys(teams).map(Number).sort((a, b) => a - b).find((g) => !v.has(teamTag(g))) || null;
  }
  function mergeOrder(list) {
    // 시트가 기준. 단, 출발 장소 태블릿이 아직 못 올린 조는 지우지 않는다
    const pending = new Set((readLS(LS_CHECKINS) || []).map((c) => c.group));
    const next = {};
    list.forEach((t) => { next[t.group] = { size: t.size, young: !!t.young, fear: t.fear == null ? 1 : t.fear, time: t.time }; });
    Object.keys(teams).forEach((g) => { if (pending.has(Number(g)) && !next[g]) next[g] = teams[g]; });
    teams = next; saveTeams();
  }
  async function loadOrder() {
    if (!conf.apiUrl || !conf.apiKey || !navigator.onLine) return false;
    try {
      const r = await fetch(conf.apiUrl + (conf.apiUrl.includes('?') ? '&' : '?') + 'action=order&key=' + encodeURIComponent(conf.apiKey), { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) return false;
      mergeOrder(j.groups);
      return true;
    } catch (e) { return false; }
  }
  // 출발 등록은 인터넷이 끊겨도 잃지 않도록 쌓아 두었다가 보낸다
  async function flushCheckins() {
    let q = readLS(LS_CHECKINS) || [];
    if (!q.length || !conf.apiUrl || !conf.apiKey || !navigator.onLine) return;
    for (const c of q.slice()) {
      try {
        const r = await fetch(conf.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ key: conf.apiKey, action: 'checkin', group: c.group, size: c.size, young: c.young, fear: c.fear }) });
        const j = await r.json();
        if (!j.ok) break;
        q = q.filter((x) => x.group !== c.group); writeLS(LS_CHECKINS, q);
      } catch (e) { break; }
    }
  }
  function newTeam(size, young, fear, fixed) {
    const max = Math.max(0, readLS(LS_COUNTER) || 0, ...Object.keys(teams).map(Number));
    const g = Number.isInteger(fixed) && fixed > 0 ? fixed : max + 1;   // 직접 고르기 모드는 학생이 고른 번호
    writeLS(LS_COUNTER, Math.max(max, g));
    teams[g] = { size, young, fear, time: new Date().toISOString() }; saveTeams();
    const q = (readLS(LS_CHECKINS) || []).filter((c) => c.group !== g);
    q.push({ group: g, size, young, fear }); writeLS(LS_CHECKINS, q);
    flushCheckins();
    return g;
  }
  setInterval(flushCheckins, 20000);
  setInterval(() => { if (!$('scrHome').hidden) loadRoster(true); }, 60000);   // 관리자가 바꾼 강도 설정 반영
  window.addEventListener('online', flushCheckins);

  // ---------- 귀신 배정 ----------
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function ghostStations() {
    const off = window.Intensity ? Intensity.offIds(cache.settings) : [];
    return cache.stations.filter((s) => s.ghost && !off.includes(s.id)).map((s) => s.id).sort();
  }
  /** 이 조에 귀신이 나오는 장소 id 목록.
   *  1·2학년 있음 / 너무 무서움 / 귀신제외조 / 출발 기록을 모르는 조 → 없음
   *  장소 수는 무서움 정도별 강도 설정(귀신수_너무/조금/안무서움). 장소는 귀신시드로 섞어 모든 태블릿이 같은 답을 낸다 */
  function ghostStationsFor(group) {
    const t = teams[group];
    if (!t || t.young) return [];   // 1·2학년 있음 / 출발 기록을 모르는 조
    if (setting('귀신제외조', '').split(/[,\s]+/).map(Number).includes(group)) return [];
    const seed = setting('귀신시드', '0');
    const list = ghostStations().sort((a, b) => fnv1a(seed + ':' + group + ':' + a) - fnv1a(seed + ':' + group + ':' + b));
    return list.slice(0, window.Intensity ? Intensity.ghostCount(cache.settings, t.fear) : 1);
  }
  const teamFear = (group) => { const t = teams[group]; return !t || t.young ? null : t.fear == null ? 1 : t.fear; };

  // ---------- 효과음: 조의 무서움 정도별 강도 설정을 따른다 ----------
  let spookTimer = null, loudTimer = null;
  const sfxOn = () => { const f = teamFear(cur.group); return !!(window.Sfx && window.Intensity) && f != null && Intensity.softOn(cache.settings, f); };
  const loudOn = () => { const f = teamFear(cur.group); return !!(window.Sfx && window.Intensity) && f != null && Intensity.loudOn(cache.settings, f); };
  const sfxVol = () => (window.Intensity ? Intensity.softVol(cache.settings) : 0.6);
  const jumpOn = () => { const f = teamFear(cur.group); return !!window.Intensity && f != null && Intensity.jumpOn(cache.settings, f); };
  const loudVol = () => (window.Intensity ? Intensity.loudVol(cache.settings) : 1);
  // 사람·귀신 목소리 대사: 2단계(조금)는 사람 목소리, 3단계(안 무서움)는 귀신 목소리. 나레이션 방식(ElevenLabs 등)이면 그 목소리, 아니면 태블릿 음성
  const VOICE_LINES = { 1: ['거기 누구 있어?', '쉿… 조용히 해…', '누구야…?', '나가!'], 2: ['같이… 놀자…', '히히히히히…', '뒤를… 봐…', '여기서… 나가…', '찾았다…'] };
  // 실제 같은 효과음(여자 비명 등): Apps Script 가 ElevenLabs 로 한 번 만들어 둔 것을 받아 이 태블릿에 저장. 없으면 null
  const sfxClips = {};
  const SFX_PROMPTS = {"laughW": "A creepy woman laughing slowly and eerily in a dark empty school hallway, close, horror movie, no music", "laughM": "A deep creepy middle-aged man laughing menacingly, slow, close, horror movie, no music", "babyCry": "A baby crying in the distance inside an empty dark building, eerie echo, horror movie, no music", "catCry": "A cat yowling eerily at night, long creepy meow, close, no music", "girlCry": "A little girl sobbing and crying softly in a dark empty classroom, eerie, close, horror movie, no music", "steps2": "Clear close footsteps walking slowly on a hard school hallway floor, eerie, horror movie, no music", "rustle2": "Clear close sound of clothes rustling right behind the listener, eerie, horror movie, no music", "drag2": "Clear close sound of feet slowly dragging and scraping across a wooden floor, eerie, horror movie, no music", "desk2": "Loud clear sound of a heavy school desk being dragged and scraping across the floor, eerie, horror movie, no music", "door2": "Clear loud creak of an old wooden door slowly opening, eerie, horror movie, no music", "wind2": "Clear howling eerie wind blowing through a dark hallway, horror movie, no music", "murmur2": "Clear close whispering voices right next to the ear, eerie, horror movie, no music", "laughBoy": "A creepy little boy laughing in an empty dark school hallway, close, horror movie, no music", "owl": "Clear eerie owl hooting at night in the woods, close, no music", "crickets": "Clear crickets chirping on a quiet dark night outside a window, eerie, no music", "thunder": "Distant rolling thunder on a stormy night, deep rumble, eerie, no music", "crow": "Clear crows cawing eerily at dusk, close, no music", "knockWin": "Someone slowly knocking and tapping on a glass window at night, clear, close, eerie, horror movie, no music"};
  let sfxErr = '';
  const sfxPending = {};
  function sfxClip(name) {
    if (sfxClips[name]) return Promise.resolve(sfxClips[name]);
    return sfxPending[name] || (sfxPending[name] = sfxClip_(name).finally(() => { delete sfxPending[name]; }));
  }
  async function sfxClip_(name) {
    const k = 'sfx|' + name;
    let blob = await ttsDb.get(k).catch(() => null);
    if (!blob && conf.apiUrl && conf.apiKey && navigator.onLine) {
      try {
        // 시트 스크립트가 잠깐 오류(시간 초과 등)를 내면 3초 뒤 한 번 더
        let j = null;
        for (let attempt = 0; attempt < 2 && !j; attempt++) {
          if (attempt) await new Promise((res) => setTimeout(res, 3000));
          const r = await fetch(conf.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: conf.apiKey, action: 'sfx', name, prompt: SFX_PROMPTS[name] || '' }) });
          const txt = await r.text();
          try { j = JSON.parse(txt); } catch (e) { sfxErr = '시트 스크립트가 잠깐 오류를 냈어요. 잠시 뒤 다시 눌러 보세요.'; }
          if (j && !j.ok && j.error === 'server') { sfxErr = '시트 스크립트 오류: ' + (j.detail || ''); j = attempt ? j : null; }
        }
        if (!j) throw new Error(sfxErr);
        if (!j.ok && j.error !== 'server') sfxErr = j.error === 'key' ? '비밀 키가 맞지 않아요' : j.error === 'name' || j.error === 'action' ? '시트 스크립트가 예전 버전이에요(Code.gs 붙여 넣고 새 버전 배포)' : String(j.error || '') + (j.detail ? ' ' + String(j.detail).slice(0, 120) : '');
        if (j.ok && j.data) {
          const bin = atob(j.data), u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          blob = new Blob([u8], { type: j.mime || 'audio/mpeg' });
          await ttsDb.put(k, blob).catch(() => {});
        }
      } catch (e) { if (!/시트 스크립트/.test(e.message)) sfxErr = '인터넷 또는 시트 연결 오류: ' + e.message; }
    } else if (!blob) sfxErr = !conf.apiKey ? '연결 탭에 비밀 키가 없어요' : '인터넷 연결이 없어요';
    if (blob) sfxClips[name] = blob;
    return blob || null;
  }
  // 큰 소리: ElevenLabs 로 만든 실제 같은 소리 (사용자 요청 2026-10-15: 여자·아저씨 웃음, 아기·고양이·여자아이 울음)
  const LOUD_CLIPS = ['laughW', 'laughM', 'laughBoy', 'babyCry', 'catCry', 'girlCry'];
  // 은은한 소리 (사용자 요청 2026-10-15): 발자국·옷깃·발 끌기·책상 끌기·문·바람·속삭임 + 작은 목소리
  const SOFT_CLIPS = ['steps2', 'rustle2', 'drag2', 'desk2', 'door2', 'wind2', 'murmur2', 'owl', 'crickets', 'knockWin', 'thunder', 'crow'];   // 2: 또렷하게 다시 만든 소리
  // ElevenLabs 무료 요금제는 동시에 2개까지라 하나씩 차례로 받는다
  let prefetching = null;
  const prefetchSfx = () => prefetching || (prefetching = (async () => {
    for (const n of ['scream', 'scream2'].concat(LOUD_CLIPS, SOFT_CLIPS, ['laugh'])) await sfxClip(n).catch(() => null);
    prefetching = null;
  })());
  /** 은은한 소리: 실제 같은 소리 또는 작은 목소리, 아직 못 받았으면 합성 소리 */
  async function playSoft(vol) {
    const ready = SOFT_CLIPS.filter((n) => sfxClips[n]);
    if (ready.length) { const n = ready[Math.floor(Math.random() * ready.length)]; playClip(n, vol); return n; }
    if (window.Sfx) Sfx.play(null, vol);
    return '';
  }
  let clipCtx = null;
  const clipBufs = {};
  // 지금 나는 효과음 — 이야기를 넘기면 끊는다 (사용자 요청 2026-10-16)
  const liveSfx = new Set();
  function stopSfx() {
    liveSfx.forEach((x) => { try { if (x.stop) x.stop(); else x.pause(); } catch (e) {} });
    liveSfx.clear();
    if (window.Sfx && Sfx.stopAll) Sfx.stopAll();
  }
  function playClip(name, vol, blobOverride) {
    const blob = blobOverride || sfxClips[name];
    if (!blob) return false;
    vol = Math.max(0, Math.min(1, vol));
    (async () => {
      try {
        clipCtx = clipCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (clipCtx.state === 'suspended') await clipCtx.resume();
        let c = clipBufs[name];
        if (!c || c.blob !== blob) {
          const buf = await clipCtx.decodeAudioData(await blob.arrayBuffer());
          let peak = 0;
          for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i += 8) { const v = Math.abs(d[i]); if (v > peak) peak = v; } }
          c = clipBufs[name] = { blob, buf, boost: Math.min(12, 0.95 / Math.max(peak, 0.02)) };
        }
        const src = clipCtx.createBufferSource(), g = clipCtx.createGain();
        src.buffer = c.buf; g.gain.value = c.boost * vol;
        const comp = clipCtx.createDynamicsCompressor(); comp.threshold.value = -3; comp.ratio.value = 12;
        src.connect(g); g.connect(comp); comp.connect(clipCtx.destination); src.start();
        liveSfx.add(src); src.onended = () => liveSfx.delete(src);
      } catch (e) { const a = new Audio(URL.createObjectURL(blob)); a.volume = vol; a.play().catch(() => {}); liveSfx.add(a); a.onended = () => liveSfx.delete(a); }
    })();
    return true;
  }
  /** 여자 비명 → 없으면 합성 비명 */
  async function playScream(vol) {
    const blob = sfxClips.scream || sfxClips.scream2 ? (Math.random() < 0.5 ? sfxClips.scream || sfxClips.scream2 : sfxClips.scream2 || sfxClips.scream) : null;
    if (blob) { playClip(blob === sfxClips.scream ? 'scream' : 'scream2', vol, blob); return; }
    if (window.Sfx) Sfx.loud('shriek', vol);
  }
  async function spookVoice(fear, always) {
    const lines = VOICE_LINES[fear === 2 ? 2 : 1], text = lines[Math.floor(Math.random() * lines.length)];
    try {
      if (ttsProvider()) {
        const clip = await ttsClip(text, fear === 2 ? 2 : 1);
        if (clip && (stream || always)) { const a = new Audio(URL.createObjectURL(clip)); a.volume = loudVol(); a.play().catch(() => {}); liveSfx.add(a); a.onended = () => liveSfx.delete(a); return; }
      }
    } catch (e) {}
    if (!('speechSynthesis' in window) || !(stream || always)) return;
    const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.volume = 1;
    u.rate = fear === 2 ? 0.6 : 0.95; u.pitch = fear === 2 ? 0.2 : 0.9;
    try { speechSynthesis.resume(); speechSynthesis.speak(u); } catch (e) {}
  }
  /** 단계별 큰 소리: 2단계 = 쨍그랑·쾅·사람 목소리, 3단계 = 귀신 목소리·비명·굉음 */
  function playLoud(fear) {
    if (!window.Sfx) return;
    const pool = fear === 2 ? LOUD_CLIPS.concat(['scream']) : LOUD_CLIPS.slice();   // 귀신 목소리는 빼기로 함
    const ready = pool.filter((n) => n === 'voice' || (n === 'scream' ? sfxClips.scream || sfxClips.scream2 : sfxClips[n]));
    const pick = (ready.length ? ready : pool)[Math.floor(Math.random() * (ready.length ? ready : pool).length)];
    if (pick === 'voice') spookVoice(fear);
    else if (pick === 'scream') playScream(loudVol());
    else if (!playClip(pick, loudVol())) Sfx.loud(['glass', 'slam', 'pound'][Math.floor(Math.random() * 3)], loudVol());   // 아직 못 받았으면 합성 소리
  }
  /** 은은한 소리로 긴장시키고, 큰 소리가 켜져 있으면 3~6초 뒤 쾅! */
  function scheduleSpook(minMs, maxMs, name, softOnly) {
    clearTimeout(spookTimer); clearTimeout(loudTimer);
    const soft = sfxOn(), loud = !softOnly && loudOn();
    if (!soft && !loud) return;
    const at = minMs + Math.random() * Math.max(0, maxMs - minMs);
    if (soft) spookTimer = setTimeout(() => { if (stream) playSoft(sfxVol()); }, at);
    if (loud) loudTimer = setTimeout(() => { if (stream) playLoud(teamFear(cur.group)); }, soft ? at + 3000 + Math.random() * 3000 : at);
  }
  document.addEventListener('pointerdown', () => { if (window.Sfx) Sfx.unlock(); });

  // ---------- 구글 시트 ----------
  async function loadRoster(silent) {
    if (!conf.apiUrl || !conf.apiKey) return false;
    try {
      const url = conf.apiUrl + (conf.apiUrl.includes('?') ? '&' : '?') + 'action=roster&key=' + encodeURIComponent(conf.apiKey);
      const r = await fetch(url, { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error === 'key' ? '비밀 키가 맞지 않아요' : '시트 응답 오류');
      cache = { raw: j.stations, stations: effStations(j.stations, j.settings), settings: j.settings, fetchedAt: j.fetchedAt, roster: j.teams || [] };
      writeLS(LS_CACHE, cache);
      mergeOrder(j.groups || []);
      applySchoolName();
      if (station()) setTimeout(prefetchAll, 1500);   // 연결되면 효과음 → 나레이션·대사를 하나씩 차례로 모두 받아 둔다 (이미 받은 것은 건너뜀)
      if (!silent) setStatus('connStatus', `불러옴: 장소 ${j.stations.length}곳, 출발한 조 ${Object.keys(teams).length}개 (${new Date().toLocaleTimeString()})`, 'ok');
      return true;
    } catch (e) {
      setStatus('connStatus', '불러오기 실패: ' + e.message + (cache.fetchedAt ? ' — 저장된 설정으로 진행합니다' : ''), 'err');
      return false;
    }
  }

  // 학교 이름: 첫 화면 푯말 등 .school-name 자리에 넣는다 (관리자 설정에서 바꿈)
  function applySchoolName() {
    const name = setting('학교이름', '마동초등학교');
    document.querySelectorAll('.school-name').forEach((el) => { if (el.textContent !== name) el.textContent = name; });
  }
  function setStatus(id, msg, cls) { const el = $(id); el.textContent = msg; el.className = 'status' + (cls ? ' ' + cls : ''); }

  // ---------- 드라이브 업로드 ----------
  function blobToB64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => { const s = String(fr.result); res(s.slice(s.indexOf(';base64,') + 8)); };
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
  }
  async function postFile(kind, filename, blob, meta) {
    const body = JSON.stringify({ key: conf.apiKey, action: 'upload', kind, filename, mime: blob.type || 'image/jpeg', meta: meta || null, data: await blobToB64(blob) });
    const r = await fetch(conf.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'upload');
  }
  let uploading = false;
  let uploadAgain = false;
  async function uploadPending(report) {
    if (uploading) { uploadAgain = true; return 0; }                       // 올리는 중에 새로 찍은 것도 이어서 올린다
    if (!conf.apiUrl || !conf.apiKey || !navigator.onLine) return 0;
    uploading = true; uploadAgain = false;
    let n = 0, fail = 0;
    try {
      const recs = (await db.all()).filter(needsUpload);
      for (const rec of recs) {
        try {
          if (!rec.up.orig) { await postFile('원본', fileName(rec, '원본'), rec.original, uploadMeta(rec, true)); rec.up.orig = true; await db.put(rec); n++; }
          if (rec.composite && !rec.up.comp) { await postFile('수정본', fileName(rec, '수정본'), rec.composite, uploadMeta(rec, false)); rec.up.comp = true; await db.put(rec); n++; }
        } catch (e) { fail++; }
        if (report) setStatus('galStatus', `올리는 중... ${n}개 완료${fail ? `, ${fail}개 실패` : ''}`);
      }
    } finally { uploading = false; }
    if (uploadAgain) { uploadAgain = false; setTimeout(() => uploadPending(false), 300); }
    return { n, fail };
  }
  const needsUpload = (r) => !r.hold && (!r.up.orig || (r.composite && !r.up.comp));
  // 시트 "기록" 탭에 남길 정보 (이름 없음 — 조 번호만)
  function uploadMeta(rec, isOriginal) {
    const record = rec.timeMs != null ? (rec.timeMs / 1000).toFixed(1) + '초'
      : rec.count != null ? `공 ${rec.count}개` : rec.reaction ? '놀람 장면' + (rec.seq ? ` ${rec.seq}` : '') : rec.seq ? `${rec.seq}번째` : '';
    return {
      recId: rec.id, group: rec.group, stationId: rec.stationId, stationName: rec.stationName,
      media: rec.kind === 'video' ? '영상' : '사진',
      needsEdit: !!(isOriginal && rec.remoteEdit),
      result: rec.success == null ? '' : rec.success ? '성공' : '실패',
      record
    };
  }
  // 탁구공처럼 결과를 고른 뒤에 올릴 기록: 학생이 그냥 떠나면 대기 화면으로 갈 때 풀어 준다
  async function releaseHolds() {
    const held = (await db.all().catch(() => [])).filter((r) => r.hold);
    for (const r of held) { r.hold = false; await db.put(r); }
    if (held.length && setting('업로드', '자동') === '자동') uploadPending(false);
  }
  setInterval(() => { if (setting('업로드', '자동') === '자동') uploadPending(false); }, 60000);
  window.addEventListener('online', () => { if (setting('업로드', '자동') === '자동') uploadPending(false); });

  function pad(n) { return String(n).padStart(2, '0'); }
  function fileName(rec, kind) {
    const d = new Date(rec.takenAt);
    const t = `${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const seq = rec.seq ? '_' + pad(rec.seq) : '';
    return `${rec.group}조_${rec.stationName}_${t}${rec.reaction ? '_놀람' : ''}${seq}_${kind}.${rec.ext || 'jpg'}`;
  }

  // ---------- 귀신 소재 ----------
  async function loadAsset() {
    asset = null;
    const s = station();
    if (!s) { assetState = '장소 미설정'; return; }
    if (!window.GhostEngine) { assetState = '합성 엔진 없음'; return; }
    try {
      await GhostEngine.init({ base: './' });
      asset = await GhostEngine.loadAsset('ghosts/' + s.id + '/');
      assetState = '준비됨 ✅' + (s.ghost ? '' : ' (시트에서 귀신=아니오 → 학생 사진엔 안 나옴)');
    } catch (e) {
      assetState = s.ghost ? '⚠️ 소재 없음 — 이 장소가 배정된 조는 귀신이 안 나와요 (ghosts/' + s.id + '/)' : '없음 (귀신 없는 장소)';
    }
    assetChecked = true;
    const st = $('assetStatus'); if (st) st.textContent = '귀신 소재: ' + assetState;
  }

  // ---------- 학생 화면: 시작 ----------
  let orderTimer = null;
  async function renderHome() {
    const s = station();
    $('homeTitle').textContent = '📍 ' + s.name;
    $('homeStation').textContent = s.name;
    $('homeGrid').hidden = true;
    clearInterval(orderTimer);
    if (pickMode()) {
      // 조 번호 직접 고르기: 출발 장소는 번호 → 인원·질문, 다른 장소는 번호만
      $('homeStart').hidden = true; $('homeNext').hidden = true;
      $('homeLead').textContent = '';
      showTeamGrid(true);
      return;
    }
    if (isStartStation()) {
      $('homeStart').hidden = false; $('homeNext').hidden = true;
      $('homeLead').textContent = '모두 모였으면 시작해요!';
      return;
    }
    $('homeStart').hidden = true; $('homeNext').hidden = false;
    const draw = () => {
      if ($('scrHome').hidden) return;
      const g = nextTeam();
      if (g) {
        $('nextTeam').textContent = g + '조';
        $('nextSize').textContent = teams[g] && teams[g].size ? `${teams[g].size}명` : '';
        $('btnNextGo').hidden = false;
        $('homeLead').textContent = '우리 조가 맞으면 시작해요!';
      } else {
        $('nextTeam').textContent = '…';
        $('nextSize').textContent = '';
        $('btnNextGo').hidden = true;
        $('homeLead').textContent = '다음 조를 기다리고 있어요';
      }
    };
    draw();
    loadOrder().then(draw);
    orderTimer = setInterval(() => { if ($('scrHome').hidden) return clearInterval(orderTimer); loadOrder().then(draw); }, 5000);
  }
  // "다른 조예요": 알고 있는 조 번호(없으면 1~12)에서 고르기
  function showTeamGrid(all) {
    const grid = $('groupGrid'); grid.innerHTML = '';
    const v = visited();
    const known = Object.keys(teams).map(Number).sort((a, b) => a - b);
    const nums = rosterTeams().length ? rosterTeams().map((t) => t.group) : all || !known.length ? Array.from({ length: teamCount() }, (_, i) => i + 1) : known;
    nums.forEach((g) => {
      const b = document.createElement('button');
      b.className = 'gbtn' + (v.has(teamTag(g)) ? ' done' : '');
      b.innerHTML = `${g}<small>조</small>`;
      b.onclick = () => (pickMode() && isStartStation() ? openTeamSetup(g) : startTeam(g));
      grid.appendChild(b);
    });
    $('homeGrid').hidden = false;
  }
  async function startTeam(g) {
    clearInterval(orderTimer);
    cur.group = g;
    markVisited(g);
    if (!teams[g]) await loadOrder();                   // 출발 장소에서 등록한 정보(저학년·무서움)를 받아 둔다 (이야기 단계에 필요)
    openStories([stationStory(station())]);
  }

  // 출발 장소: 인원 → (1·2학년?) → 조 번호 안내 → 미션
  let teamDraft = {};
  const rosterTeams = () => (cache.roster || []).filter((t) => t && t.group);
  const rosterOf = (g) => rosterTeams().find((t) => t.group === g) || null;
  function openTeamSetup(fixed) {
    teamDraft = { fixed: fixed || null };
    $('teamAskRoster').hidden = true; $('teamAskSize').hidden = false; $('teamAskYoung').hidden = true; $('teamAskFear').hidden = true; $('teamDone').hidden = true;
    const roster = rosterTeams();
    if (roster.length) {                                                       // 명단이 있으면: 조를 고르면 인원·1·2학년이 정해진다
      if (fixed && rosterOf(fixed)) { show('scrTeam'); return pickRosterTeam(rosterOf(fixed)); }
      $('teamAskSize').hidden = true; $('teamAskRoster').hidden = false;
      const grid = $('rosterGrid'); grid.innerHTML = '';
      roster.forEach((t) => {
        const b = document.createElement('button'); b.type = 'button';
        b.className = teams[t.group] ? 'done' : '';
        b.innerHTML = `<b>${t.group}조</b><small>${t.size}명${teams[t.group] ? ' · 출발함' : ''}</small>`;
        b.onclick = () => pickRosterTeam(t);
        grid.appendChild(b);
      });
    }
    show('scrTeam');
  }
  function pickRosterTeam(t) {
    teamDraft = { fixed: t.group, size: t.size };
    $('teamAskRoster').hidden = true; $('teamAskSize').hidden = true;
    if (t.young) return finishTeam(true, null);                               // 1·2학년이 있는 조: 질문 없이 (귀신·소리 없음)
    answerYoung(false);
  }
  function pickSize(n) {
    teamDraft.size = n;
    if (setting('저학년질문', '예') === '아니오') return answerYoung(false);
    $('teamAskSize').hidden = true; $('teamAskYoung').hidden = false;
  }
  function answerYoung(young) {
    if (young || setting('무서움질문', '예') === '아니오') return finishTeam(young, young ? null : 1);
    $('teamAskYoung').hidden = true; $('teamAskFear').hidden = false;
  }
  async function finishTeam(young, fear) {
    const g = newTeam(teamDraft.size, young, fear, teamDraft.fixed);
    $('teamAskFear').hidden = true;
    cur.group = g; markVisited(g);
    $('teamAskSize').hidden = true; $('teamAskYoung').hidden = true; $('teamAskRoster').hidden = true; $('teamDone').hidden = false;
    $('teamNum').textContent = g + '조';
    $('teamSizeText').textContent = `${teamDraft.size}명`;
    $('teamStory').hidden = true; $('btnTeamGo').hidden = true;
    // 조 번호를 잠깐 보여 준 뒤 이야기 화면(프롤로그 → 이 장소 괴담) → 미션
    await sleep(2500);
    if ($('scrTeam').hidden) return;
    const pro = prologueText(young ? 0 : fear);
    openStories([pro ? { title: '오늘 밤의 이야기', text: pro } : null, stationStory(station())]);
  }

  // ---------- 이야기 화면 (전체 화면 + 나레이션) ----------
  let storyPages = [], storyIdx = 0;
  // ---------- 도착 반응: 도착 확인을 누르고 1~2초 뒤 소리 하나 → 카메라 화면 없이 연사 5장 + 영상 10초 ----------
  let arrival = null, narrTimer = null;
  const arrivalOn = () => !!(window.Intensity && Intensity.arrivalOn(cache.settings, teamFear(cur.group)));
  function startArrival() {
    stopArrival();
    if (!arrivalOn() || !navigator.mediaDevices) return 0;
    const delay = 1000 + Math.random() * 1000, fear = teamFear(cur.group), group = cur.group;
    const a = arrival = { stream: null, video: null, rec: null, chunks: [], frames: [], timers: [], mime: '', group, done: false };
    (async () => {
      try {
        const video = { facingMode: { ideal: camFacing() }, width: { ideal: 1280 }, height: { ideal: 720 } };
        try { a.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video }); }
        catch (e) { a.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video }); }
        if (a.done) return a.stream.getTracks().forEach((t) => t.stop());
        const v = a.video = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = a.stream; await v.play().catch(() => {});
      } catch (e) { a.stream = null; }
    })();
    a.timers.push(setTimeout(() => {
      if (a.done) return;
      if (loudOn()) playLoud(fear); else if (sfxOn()) playSoft(sfxVol());     // 표의 큰 소리 칸 → 큰 소리, 아니면 은은한 소리 칸 → 은은한 소리
      if (!a.stream || !a.video) return;
      const mime = pickVideoMime();
      if (mime) { try { a.rec = new MediaRecorder(a.stream, { mimeType: mime, videoBitsPerSecond: 2000000, audioBitsPerSecond: 96000 }); a.mime = mime; a.rec.ondataavailable = (e) => { if (e.data && e.data.size) a.chunks.push(e.data); }; a.rec.start(500); } catch (e) { a.rec = null; } }
      for (let i = 0; i < 5; i++) a.timers.push(setTimeout(() => {           // 놀라는 데 0.2~0.3초: 0.25초 뒤부터 0.2초 간격
        const vv = a.video; if (a.done || !vv || !vv.videoWidth) return;
        const c = document.createElement('canvas'); c.width = vv.videoWidth; c.height = vv.videoHeight; c.getContext('2d').drawImage(vv, 0, 0); a.frames.push(c);
      }, 250 + i * 200));
      a.timers.push(setTimeout(() => stopArrival(), 10000));                 // 영상 10초
    }, delay));
    return delay + 4500;                                                     // 이야기는 소리가 끝난 뒤에
  }
  function stopArrival() {
    const a = arrival; if (!a || a.done) return;
    a.done = true; arrival = null; a.timers.forEach(clearTimeout);
    const finish = async () => {
      if (a.stream) a.stream.getTracks().forEach((t) => t.stop());
      const recs = [], takenAt = Date.now();
      const saveGroup = cur.group; cur.group = a.group;                         // baseRecord 는 지금 조를 쓰므로 잠깐 맞춘다
      try {
        for (let i = 0; i < a.frames.length; i++) recs.push(baseRecord({ takenAt, seq: i + 1, reaction: true, original: await canvasToBlob(a.frames[i]), reason: '도착 반응' }));
        if (a.chunks.length) recs.push(baseRecord({ takenAt, kind: 'video', ext: /mp4/.test(a.mime) ? 'mp4' : 'webm', reaction: true, original: new Blob(a.chunks, { type: a.mime.split(';')[0] }), reason: '도착 반응' }));
      } finally { cur.group = saveGroup; }
      if (recs.length) await saveRecords(recs).catch(() => {});
    };
    if (a.rec && a.rec.state !== 'inactive') { a.rec.onstop = finish; try { a.rec.stop(); } catch (e) { finish(); } } else finish();
  }
  const boardArriveHere = () => !!(window.Intensity && station() && Intensity.boardArriveAt(cache.settings, station().id));
  // 조를 고르면 먼저 도착 확인 화면 → 버튼을 누르면 1~2초 뒤 소리(+칠판) → 소리가 끝나면 이야기·나레이션 (사용자 요청 2026-10-16: 소리와 나레이션이 겹치지 않게)
  let arriveTimer = null;
  function openStories(pages) {
    storyPages = pages.filter(Boolean);
    clearTimeout(arriveTimer); stopArrival();
    const s = station();
    $('arriveGroup').textContent = cur.group + '조';
    $('arrivePlace').textContent = '📍 ' + (s ? s.name : '도착!');
    $('arriveLead').textContent = '모두 다 모였나요? 다 모이면 버튼을 눌러요.';
    $('arriveBtns').hidden = false;
    show('scrArrive');
  }
  function confirmArrival() {
    $('arriveBtns').hidden = true;
    $('arriveLead').textContent = '쉿… 귀를 기울여 보세요…';
    // 칠판도착장소(과학실·6학년 교실): 칠판이 몇 초 뒤 소리와 함께 켜져 글씨를 쓰고 꺼진다
    if (boardArriveHere() && Intensity.boardOn(cache.settings, teamFear(cur.group))) sendCue('camera');   // 시트 스크립트가 아는 신호 이름 그대로
    const wait = startArrival();
    arriveTimer = setTimeout(() => {
      if ($('scrArrive').hidden) return;
      if (!storyPages.length) return openMission();
      storyIdx = 0; showStoryPage();
    }, wait);
  }
  function showStoryPage(narrDelay) {
    const pg = storyPages[storyIdx];
    $('storyGroup').textContent = cur.group + '조';
    $('storyTitle').textContent = pg.title ? (pg.title === '오늘 밤의 이야기' ? '📜 ' + pg.title : '「' + pg.title + '」') : '';
    $('storyText').textContent = pg.text;
    $('btnStoryNext').textContent = storyIdx < storyPages.length - 1 ? '다음 이야기 ▶' : isMissionPlace(station()) ? '미션 보기 ▶' : '인증샷 찍으러 가기 ▶';
    const box = $('storyText'); box.classList.remove('in'); void box.offsetWidth; box.classList.add('in');
    show('scrStory');
    clearTimeout(narrTimer);
    if (narrDelay) { stopNarration(); narrTimer = setTimeout(() => { if (!$('scrStory').hidden) narrate(pg.text); }, narrDelay); }   // 도착 소리 뒤에 나레이션
    else narrate(pg.text);
  }
  function nextStory() {
    stopNarration(); stopSfx();
    if (storyIdx < storyPages.length - 1) { storyIdx++; showStoryPage(); } else openMission();
  }

  // 나레이션: 태블릿의 한국어 음성(구글·삼성 TTS)으로 읽는다. 무서움 단계별 말투(속도·높이)
  const narrationOn = () => setting('나레이션', '예') !== '아니오';
  function koVoices() { return ('speechSynthesis' in window ? speechSynthesis.getVoices() : []).filter((v) => /^ko/i.test(v.lang)); }
  // 단계별 목소리(태블릿마다 저장): conf.voices[0..2]. 없으면 conf.voice → 자동 선택
  function pickVoice(lv) {
    const vs = koVoices(), want = (conf.voices && conf.voices[lv == null ? 1 : lv]) || conf.voice;
    return vs.find((v) => v.name === want) || vs.find((v) => /natural|neural|wavenet|online/i.test(v.name)) || vs.find((v) => /google/i.test(v.name)) || vs[0] || null;
  }
  // 외부 AI 목소리: 시트 스크립트가 만들어 준 mp3 를 태블릿에도 저장(IndexedDB)해 두고 재생. 실패하면 태블릿 음성
  const TTS_VOICE_KEY = { 'Google': '구글목소리_', 'Azure': '애저목소리_', '클로바': '클로바목소리_', 'ElevenLabs': '나레이션목소리_' };
  const ttsProvider = () => { const v = setting('나레이션방식', '태블릿'); return TTS_VOICE_KEY[v] ? v : ''; };
  const ttsDb = (() => {
    let p;
    const open = () => p || (p = new Promise((res, rej) => { const r = indexedDB.open('hg-tts', 1); r.onupgradeneeded = () => r.result.createObjectStore('clips'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
    return {
      get: async (k) => { const d = await open(); return new Promise((res) => { const q = d.transaction('clips').objectStore('clips').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); },
      put: async (k, v) => { const d = await open(); return new Promise((res) => { const t = d.transaction('clips', 'readwrite'); t.objectStore('clips').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); }); }
    };
  })();
  // 목소리·속도·높이 설정이 바뀌면 새로 만들도록 저장 키에 넣는다
  const ttsKey = (prov, lv, text) => {
    const pre = { 'Google': '구글', 'Azure': '애저', '클로바': '클로바' }[prov] || '';
    return [prov, lv, setting(TTS_VOICE_KEY[prov] + FEAR_KEY[lv], ''), setting('나레이션목소리', ''),
      pre ? setting(pre + '속도_' + FEAR_KEY[lv], '') : '', pre ? setting(pre + '높이_' + FEAR_KEY[lv], '') : '',
      prov === 'ElevenLabs' ? 'scary-v1:' + setting('나레이션모델', 'eleven_multilingual_v2') : '', text].join('|');
  };
  async function ttsClip(text, lv, previewVoice) {
    const prov = previewVoice ? 'ElevenLabs' : ttsProvider(); if (!prov) return null;
    const k = previewVoice ? ['ElevenLabs', 'scary-v1', 'eleven_multilingual_v2', previewVoice, lv, text].join('|') : ttsKey(prov, lv, text);
    const hit = await ttsDb.get(k).catch(() => null); if (hit) return hit;
    if (!conf.apiUrl || !conf.apiKey || !navigator.onLine) return null;
    const r = await fetch(conf.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key: conf.apiKey, action: 'tts', provider: prov, level: lv, text, ...(previewVoice ? { previewVoice } : {}) }) });
    const j = await r.json();
    if (!j.ok) { ttsError = j.error + (j.detail ? ' ' + j.detail : ''); return null; }
    if (previewVoice && (j.voice !== previewVoice || j.preview !== true)) throw new Error('Code.gs를 새 버전으로 배포한 뒤 다시 시험하세요.');
    const bin = atob(j.data), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const blob = new Blob([u8], { type: j.mime || 'audio/mpeg' });
    await ttsDb.put(k, blob).catch(() => {});
    return blob;
  }
  let ttsError = '', narrAudio = null, narrToken = 0;
  /** 이 장소에서 쓸 이야기(3단계, 출발 장소면 프롤로그도)를 미리 만들어 둔다 — 행사 중 와이파이가 끊겨도 재생 */
  // 효과음 → (ElevenLabs 등을 쓰면) 이 장소 나레이션·대사를 하나씩 차례로. 동시에 두 번 돌지 않게
  let prefetchAllRun = null;
  function prefetchAll() {
    return prefetchAllRun || (prefetchAllRun = (async () => {
      try { await prefetchSfx(); if (ttsProvider() && station()) await prefetchNarration(); } catch (e) {}
      prefetchAllRun = null;
    })());
  }
  async function prefetchNarration() {
    await prefetchSfx();
    if (!ttsProvider() || !station()) return;
    const s = station(), def = storyDef(s);
    for (let lv = 0; lv < 3; lv++) {
      const txt = ((s.stories && s.stories[lv]) || '').trim() || (def ? def.text[lv] : '');
      if (txt) await ttsClip(cleanSpeech(txt), lv).catch(() => {});
      if (isStartStation()) await ttsClip(cleanSpeech(prologueText(lv)), lv).catch(() => {});
    }
    for (const f of [1, 2]) for (const line of VOICE_LINES[f]) await ttsClip(line, f).catch(() => {});
  }
  const cleanSpeech = (t) => String(t || '').replace(/[「」📜😊]/g, '').trim();
  async function narrate(text, opts) {
    if (!narrationOn() || !text) return;
    stopNarration();
    const token = ++narrToken;
    const lv0 = opts && opts.level != null ? opts.level : storyLevel();
    const mine = await ttsDb.get(recKey(text)).catch(() => null);            // 선생님이 녹음해 둔 소리가 있으면 그것을 튼다
    if (token !== narrToken) return;
    if (mine) { narrAudio = new Audio(URL.createObjectURL(mine)); narrAudio.play().catch(() => {}); return; }
    if (ttsProvider()) {
      try {
        const clip = await ttsClip(cleanSpeech(text), lv0);
        if (token !== narrToken) return;
        if (clip) { narrAudio = new Audio(URL.createObjectURL(clip)); narrAudio.play().catch(() => {}); return; }
      } catch (e) { ttsError = e.message; }
      if (token !== narrToken) return;
    }
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text.replace(/[「」📜😊]/g, ''));
    u.lang = 'ko-KR';
    const v = pickVoice(lv0); if (v) u.voice = v;
    const lv = opts && opts.level != null ? opts.level : storyLevel();
    const base = parseFloat(setting('나레이션속도', '0.95')) || 0.95;
    u.rate = Math.max(0.5, Math.min(1.5, base * [1.0, 0.88, 0.78][lv]));
    u.pitch = [1.0, 0.85, 0.65][lv];
    u.volume = 1;
    try { speechSynthesis.resume(); } catch (e) {}
    speechSynthesis.speak(u);
  }
  // 안드로이드 크롬은 cancel 한 번으로 말하던 문장이 안 멈출 때가 있어 pause → cancel → 잠시 뒤 다시 cancel
  function hushSpeech() {
    if (!('speechSynthesis' in window)) return;
    const s = speechSynthesis;
    try { s.pause(); s.cancel(); } catch (e) {}
    setTimeout(() => { try { s.cancel(); s.resume(); } catch (e) {} }, 60);
    setTimeout(() => { try { if (s.speaking) s.cancel(); } catch (e) {} }, 300);
  }
  // ---------- 나레이션 녹음: 이 장소에서 읽을 이야기를 선생님 목소리로 녹음해 두면 그 소리를 튼다 (사용자 요청 2026-10-16: 태블릿 음성이 안 읽혀서) ----------
  const recKey = (text) => 'rec|' + String(text || '').trim();
  const REC_LV = ['😱 너무 무서워요 · 1·2학년', '😬 조금 무서워요', '😎 하나도 안 무서워요'];
  let recNow = null, recPlay = null;
  function recTexts() {
    const s = station(); if (!s) return [];
    const out = [];
    const add = (label, text) => {
      if (!text) return;
      const o = out.find((x) => x.text === text);
      if (o) o.label += ' / ' + label; else out.push({ label, text });
    };
    if (isStartStation()) [0, 1, 2].forEach((lv) => add('오늘 밤의 이야기 · ' + REC_LV[lv], prologueText(lv)));
    [0, 1, 2].forEach((lv) => { const st = stationStory(s, lv); if (st) add(s.name + ' 이야기 · ' + REC_LV[lv], st.text); });
    return out;
  }
  function pickAudioMime() {
    if (!window.MediaRecorder) return null;
    for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }
  async function renderRecs() {
    const box = $('recList'); if (!box) return;
    const list = recTexts();
    if (!list.length) { box.innerHTML = '<p class="help">먼저 연결·장소 탭에서 이 태블릿의 장소를 고르세요.</p>'; return; }
    const has = await Promise.all(list.map((it) => ttsDb.get(recKey(it.text)).catch(() => null)));
    box.innerHTML = '';
    list.forEach((it, i) => {
      const key = recKey(it.text), on = !!(recNow && recNow.key === key);
      const d = document.createElement('div');
      d.style.cssText = 'border-top:1px solid #2e3240;padding:12px 0';
      d.innerHTML = `<div style="font-weight:700;margin-bottom:4px">${esc(it.label)} ${has[i] ? '✅ 녹음됨' : '⚪ 아직 없음'}</div>
        <div class="help" style="white-space:pre-wrap;margin-bottom:8px">${esc(it.text)}</div>
        <div class="row"><button class="btn sm${on ? ' danger' : ''}" data-a="rec">${on ? '■ 멈추고 저장' : '🎙 녹음'}</button>
        <button class="btn sm ghost" data-a="play"${has[i] ? '' : ' disabled'}>▶ 듣기</button>
        <button class="btn sm ghost" data-a="del"${has[i] ? '' : ' disabled'}>🗑 지우기</button></div>`;
      d.querySelector('[data-a=rec]').onclick = () => (on ? stopRec() : startRec(key));
      d.querySelector('[data-a=play]').onclick = () => {
        if (recPlay) recPlay.pause();
        recPlay = new Audio(URL.createObjectURL(has[i])); recPlay.play().catch(() => {});
      };
      d.querySelector('[data-a=del]').onclick = async () => {
        if (!confirm('이 녹음을 지울까요?')) return;
        await ttsDb.put(key, null); renderRecs();
      };
      box.appendChild(d);
    });
  }
  async function startRec(key) {
    if (recNow) await stopRec();
    const mime = pickAudioMime();
    if (mime === null) return toast('이 기기에서는 녹음이 안 돼요', 5000);
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { return toast('마이크를 쓸 수 없어요: ' + e.message, 5000); }
    const chunks = [], mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { mr.onstop = res; });
    recNow = { key, mr, stream, chunks, done, type: mr.mimeType || mime || 'audio/webm' };
    mr.start(500);
    renderRecs();
    toast('🎙 녹음 중… 다 읽으면 "■ 멈추고 저장"을 눌러요', 4000);
  }
  async function stopRec() {
    const r = recNow; if (!r) return;
    recNow = null;
    try { if (r.mr.state !== 'inactive') r.mr.stop(); } catch (e) {}
    await r.done;
    r.stream.getTracks().forEach((t) => t.stop());
    if (r.chunks.length) { await ttsDb.put(r.key, new Blob(r.chunks, { type: r.type.split(';')[0] })); toast('녹음을 저장했어요'); }
    renderRecs();
  }
  function stopNarration() {
    narrToken++; clearTimeout(narrTimer);
    hushSpeech();
    if (narrAudio) { try { narrAudio.pause(); URL.revokeObjectURL(narrAudio.src); } catch (e) {} narrAudio = null; }
  }
  if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { if (!$('scrAdmin').hidden) renderVoices(); };
  function renderVoices() {
    const vs = koVoices();
    $('btnVoiceRefresh').onclick = () => { if ('speechSynthesis' in window) speechSynthesis.getVoices(); renderVoices(); toast(`한국어 목소리 ${koVoices().length}개를 찾았어요`); };
    document.querySelectorAll('#selVoice, .sel-voice-lv').forEach((sel) => {
      const lv = Number(sel.dataset.lv), cur0 = pickVoice(lv);
      sel.innerHTML = vs.length ? vs.map((v) => '<option value="' + esc(v.name) + '"' + (cur0 && v.name === cur0.name ? ' selected' : '') + '>' + esc(v.name) + (v.localService ? '' : ' (온라인)') + '</option>').join('')
        : '<option value="">이 기기에 한국어 음성이 없어요</option>';
    });
  }

  // ---------- 괴담 (무서움 단계별 문구) ----------
  const FEAR_KEY = ['너무', '조금', '안무서움'];
  const storyLevel = () => { const f = teamFear(cur.group); return f == null ? 0 : f; };   // 1·2학년·모르는 조는 가장 순한 글
  function prologueText(level) {
    const lv = level == null ? 1 : level;
    const custom = setting('프롤로그_' + FEAR_KEY[lv], '');
    const c = window.HG_TOUR && HG_TOUR.course(cache.settings), S = window.HG_STORIES;
    const list = S && ((c && S[c.prologue]) || S.prologue);
    return custom || ((list && list[lv]) || '');
  }
  const storyDef = (s) => (window.HG_STORIES && HG_STORIES.defFor ? HG_STORIES.defFor(s) : null);
  function stationStory(s, level) {
    const lv = level != null ? level : storyLevel(), def = storyDef(s);
    const title = (s.storyTitle || '').trim() || (def ? def.title : '');
    const custom = s.stories && s.stories[lv];
    const text = (custom || '').trim() || (def ? def.text[lv] : '');
    return text ? { title, text } : null;
  }

  // 장소 유형: 사진(기본) · 스태킹(영상+제한시간) · 탁구공(영상+개수 입력) · 책찾기(바코드→사진) · 연속사진(10초 뒤 여러 장)
  const TYPE = {
    '사진': { btn: '📸 사진 찍으러 가기', lead: '미션을 성공한 순간을 사진으로 남겨요!' },
    '스태킹': { btn: '🎬 영상 찍으러 가기', lead: '시작을 누르면 시간이 흘러요. 다 쌓고 내리면 "끝!"을 눌러요!' },
    '탁구공': { btn: '🎬 영상 찍으러 가기', lead: '공을 던지는 모습을 영상으로 남겨요!' },
    '영상': { btn: '🎬 영상 찍으러 가기', lead: '버튼을 누르면 3초 뒤에 녹화가 시작돼요. 미션을 끝내면 ■ 버튼을 눌러요!' },
    '책찾기': { btn: '🔍 찾은 책 바코드 찍기', lead: '책을 찾으면 바코드를 찍어 확인해요!' },
    '연속사진': { btn: '📸 인증사진 찍으러 가기', lead: '버튼을 누르고 10초 안에 자리를 잡아요! 사진을 몇 장 연달아 찍어요.' }
  };
  const tourOn = () => !!(window.HG_TOUR && HG_TOUR.on(cache.settings));
  const isMissionPlace = (s) => !tourOn() || (s && s.kind === 'mission');   // 코스의 미션 장소 / 예전 미션 방식
  const photoOnly = () => !!(window.Intensity && Intensity.photoOnly(cache.settings));
  const stType = () => {
    if (station().shoot === '영상') return '영상';                              // 마동 코스의 1·6학년 교실 (사용자 요청 2026-10-16)
    const t = String(station().type || '사진').trim();
    if (photoOnly() && t !== '책찾기') return '사진';   // 모든 장소 사진 인증샷 (책찾기는 바코드 확인 뒤 사진)
    return TYPE[t] ? t : '사진';
  };
  const stValue = (d) => { const v = parseFloat(station().value); return Number.isFinite(v) && v > 0 ? v : d; };
  // 귀신 보이는 방법: 화면(카운트다운 중 미리보기에만 잠깐, 사진은 그대로) · 사진(수정본) · 둘다
  const ghostView = () => (window.Intensity ? Intensity.ghostView(cache.settings) : '사진');
  const ghostOnScreen = () => ghostView() !== '사진';
  const ghostInPhoto = () => ghostView() !== '화면';
  const reactMode = () => (window.Intensity ? Intensity.reactMode(cache.settings) : '끔');
  const wantGhostHere = () => { const s = station(); return !!(s.ghost && ghostStationsFor(cur.group).includes(s.id)); };

  // 장소 안내 사진: places/<장소id>.jpg (밝을 때 찍은 사진). 없으면 숨김
  function showPlaceImg(img, id, box) {
    const wrap = box || img;
    wrap.hidden = true;
    if (!id) { img.removeAttribute('src'); return; }
    const mark = (on) => { if (img.id === 'resNextImg') $('scrResult').classList.toggle('has-next', on); };
    mark(false);
    img.onload = () => { wrap.hidden = false; mark(true); };
    img.onerror = () => { wrap.hidden = true; mark(false); };
    img.src = 'places/' + encodeURIComponent(id) + '.jpg';
  }
  function nextStationOf(s) {
    const off = window.Intensity ? Intensity.offIds(cache.settings) : [];
    const used = cache.stations.filter((x) => !off.includes(x.id)), i = used.findIndex((x) => x.id === s.id);
    return i >= 0 && i < used.length - 1 ? used[i + 1] : null;
  }
  function openMission() {
    const s = station(), t = stType();
    stopNarration();
    $('misStory').hidden = true;
    $('misStation').textContent = isMissionPlace(s) ? '🎯 ' + s.name + ' 미션' : '📸 ' + s.name + ' 인증샷';
    $('misText').textContent = s.mission || '미션 성공 장면을 사진으로 찍어요!';
    showPlaceImg($('misPlace'), s.id, $('misPlaceFig'));
    $('misGroup').textContent = cur.group + '조';
    $('misLead').textContent = t === '영상' ? TYPE[t].lead : tourOn() ? (isMissionPlace(s) ? '미션을 성공하면 모두 화면에 들어오게 모여 버튼을 눌러요. 5초 뒤에 찰칵!' : '모두 화면에 들어오게 모인 뒤 버튼을 눌러요. 5초 뒤에 찰칵!') : TYPE[t].lead;
    $('btnOpenCam').textContent = t === '영상' || !tourOn() ? TYPE[t].btn : '📸 인증샷 찍으러 가기';
    show('scrMission');
  }
  // 칠판 신호: 이 장소의 전자칠판(board.html)이 분필 글씨를 쓰게 한다 (기다리지 않음)
  function sendCue(kind, fear) {
    const s = station();
    if (!s || !conf.apiUrl || !conf.apiKey || !navigator.onLine) return Promise.resolve({ ok: false, error: !conf.apiKey ? 'nokey' : 'offline' });
    return fetch(conf.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key: conf.apiKey, action: 'cue', station: s.id, group: cur.group, fear: fear !== undefined ? fear : teamFear(cur.group), kind }) })
      .then((r) => r.json()).catch(() => ({ ok: false, error: 'net' }));
  }
  window.HG_softPreview = async (vol) => { const n = SOFT_CLIPS[Math.floor(Math.random() * SOFT_CLIPS.length)]; await sfxClip(n).catch(() => null); return playSoft(vol); };
  window.HG_loudPreview = async (vol) => {
    const n = LOUD_CLIPS[Math.floor(Math.random() * LOUD_CLIPS.length)];
    await sfxClip(n).catch(() => null);
    return playClip(n, vol) ? n : '';
  };
  function startStudentCamera() {
    if (!boardArriveHere() && (!window.Intensity || Intensity.boardOn(cache.settings, teamFear(cur.group)))) sendCue('camera');   // 단계별 칠판 글씨 설정 (도착 때 이미 쓴 장소는 빼고)
    const t = stType();
    openCamera(t === '스태킹' || t === '탁구공' || t === '영상' ? 'video' : t === '책찾기' ? 'scan' : t === '연속사진' ? 'burst' : 'student');
  }

  // ---------- 카메라 ----------
  const STUDENT_MODES = ['student', 'video', 'scan', 'burst'];
  // 이 태블릿의 카메라: 앞면(user, 기본) / 뒷면(environment). 앞면은 미리보기만 거울처럼 보여 주고 저장은 정상 방향
  const camFacing = () => (conf.facing === 'environment' ? 'environment' : 'user');
  async function openCamera(mode) {
    stopArrival(); clearTimeout(narrTimer);
    camMode = mode;
    $('camVideo').classList.toggle('mirror', camFacing() === 'user');
    $('scrCamera').classList.toggle('lit', camFacing() === 'user' && !!conf.screenLight);
    $('camHint').hidden = !STUDENT_MODES.includes(mode);
    const s = station();
    $('camTop').textContent = mode === 'background' ? '빈 배경 촬영 — 사람이 없게 해 주세요'
      : mode === 'test' ? '귀신 합성 시험 촬영'
      : mode === 'screentest' ? '화면 귀신 미리보기 — 버튼을 누르면 5초 카운트다운 (저장 안 함)'
      : mode === 'scan' ? `${cur.group}조 · ${s.name} · 책 확인`
      : `${cur.group}조 · ${s.name}`;
    $('camRec').hidden = true; $('camBurst').hidden = true; $('btnStop').hidden = true;
    $('camScan').hidden = mode !== 'scan';
    $('btnShutter').hidden = mode === 'scan';
    $('btnCamCancel').hidden = false;
    $('camTimerLabel').hidden = mode !== 'student' || photoOnly();
    show('scrCamera');
    try {
      const video = mode === 'video'
        ? { facingMode: { ideal: camFacing() }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: { ideal: camFacing() }, width: { ideal: 1920 }, height: { ideal: 1080 } };
      const wantMic = mode === 'video' || (['student', 'burst'].includes(mode) && ((['영상', '둘다'].includes(reactMode()) && wantGhostHere() && ghostOnScreen()) || boardRecHere()));
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: wantMic, video }); }
      catch (e) { if (!wantMic || mode === 'video') throw e; stream = await navigator.mediaDevices.getUserMedia({ audio: false, video }); }
      const v = $('camVideo'); v.srcObject = stream; await v.play();
    } catch (e) {
      closeCamera();
      toast('카메라를 열 수 없어요. 선생님께 알려 주세요.', 4000);
      return backFromCamera();
    }
    if (mode === 'scan') startScan();
    if (['student', 'burst', 'scan'].includes(mode) && !(mode === 'student' && photoOnly())) scheduleSpook(3000, 6000);   // 사진 인증샷은 도착 소리로 대신
    if (['student', 'burst', 'video', 'screentest'].includes(mode)) { prewarmScreenGhost(mode === 'screentest'); prefetchSfx(); }
    if (['student', 'burst'].includes(mode) && boardRecHere()) startBoardRec();
  }
  // ---------- 칠판 반응 녹화: 칠판 글씨가 나오는 장소에서 카메라를 켜면 14초(또는 카메라가 닫힐 때까지) 학생 반응을 녹화 ----------
  let boardRec = null;
  const boardRecHere = () => !!(window.Intensity && station() && Intensity.boardRecAt(cache.settings, station().id) && Intensity.boardOn(cache.settings, teamFear(cur.group)));   // 칠판 글씨가 나오는 조만
  function startBoardRec() {
    if (boardRec || !stream || typeof MediaRecorder === 'undefined') return;
    const mime = pickVideoMime(); if (!mime) return;
    let mr; try { mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2000000, audioBitsPerSecond: 96000 }); } catch (e) { return; }
    const r = boardRec = { mr, chunks: [], mime, group: cur.group, timer: null };
    mr.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
    mr.onstop = async () => {
      clearTimeout(r.timer); if (boardRec === r) boardRec = null;
      if (!r.chunks.length) return;
      const blob = new Blob(r.chunks, { type: r.mime.split(';')[0] });
      await saveRecords([baseRecord({ group: r.group, kind: 'video', ext: /mp4/.test(r.mime) ? 'mp4' : 'webm', reaction: true, original: blob, reason: '칠판 반응' })]).catch(() => {});
    };
    mr.start(500);
    r.timer = setTimeout(() => stopBoardRec(), 14000);
  }
  function stopBoardRec() { const r = boardRec; if (r && r.mr.state !== 'inactive') { try { r.mr.stop(); } catch (e) {} } }
  function closeCamera() {
    stopBoardRec();
    stopScan();
    stopScreenGhost();
    clearTimeout(spookTimer); clearTimeout(loudTimer); stopRecSpooks();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; $('camVideo').srcObject = null;
  }
  function backFromCamera() {
    if (STUDENT_MODES.includes(camMode)) show('scrMission'); else openAdmin('tools');
  }
  function grabFrame() {
    const v = $('camVideo');
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    return c;
  }
  // 뒷면 카메라 + 플래시: 사진 찍는 순간 플래시(지원하면 takePhoto, 아니면 손전등 켜고 한 장)
  const flashOn = () => camFacing() === 'environment' && conf.flash !== false;
  async function setTorch(on) {
    const tr = stream && stream.getVideoTracks()[0];
    try { if (tr && (tr.getCapabilities ? tr.getCapabilities().torch : false)) { await tr.applyConstraints({ advanced: [{ torch: on }] }); return true; } } catch (e) {}
    return false;
  }
  async function captureStill() {
    const tr = stream && stream.getVideoTracks()[0];
    if (!flashOn() || !tr) return grabFrame();
    try {
      if ('ImageCapture' in window) {
        const ic = new ImageCapture(tr), caps = await ic.getPhotoCapabilities();
        if (caps.fillLightMode && caps.fillLightMode.includes('flash')) {
          const blob = await ic.takePhoto({ fillLightMode: 'flash' });
          const bmp = await createImageBitmap(blob), k = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
          const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
          c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
          return c;
        }
      }
    } catch (e) { /* 손전등 방식으로 */ }
    if (await setTorch(true)) { await sleep(450); const c = grabFrame(); setTorch(false); return c; }
    return grabFrame();
  }
  const canvasToBlob = (c, q) => new Promise((res) => c.toBlob(res, 'image/jpeg', q || 0.92));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const newId = () => Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  function flash() { const fl = $('camFlash'); fl.classList.add('on'); setTimeout(() => fl.classList.remove('on'), 60); }
  // ---------- 화면 귀신: 카운트다운 중 미리보기에 1초 남짓 비쳤다 사라짐 (저장되는 사진에는 없음) ----------
  let screenGhostTimer = null, screenGhostTimer2 = null, screenGhostRaf = 0, screenGhostWhy = '';
  function prewarmScreenGhost(force) {
    if (!((force || (wantGhostHere() && ghostOnScreen())) && window.GhostFree)) return;
    loadFree().catch(() => {});
    if (window.GhostEngine) GhostEngine.init({ base: './' }).catch(() => {});
  }
  /** anyLight: 교사 미리보기 — 밝은 곳이어도 무조건 띄운다 */
  async function planScreenGhost(anyLight) {
    const v = $('camVideo');
    if (!stream || !v.videoWidth) { screenGhostWhy = '카메라 준비 전'; return null; }
    const p = await GhostFree.plan(grabFrame(), await loadFree(), { stationId: (station() || {}).id, visible: true, selfie: camFacing() === 'user', anyLight: !!anyLight });
    if (!p || !p.layer) { screenGhostWhy = p && p.reason === 'free-no-dark-spot' ? '화면에 어두운 곳이 없음' : (p && p.reason) || '귀신 그림 없음'; return null; }
    return p;
  }
  function stopScreenGhost() {
    clearTimeout(screenGhostTimer); clearTimeout(screenGhostTimer2); cancelAnimationFrame(screenGhostRaf);
    const c = $('camGhost'); if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    $('camVideo').classList.remove('glitch');
    $('camCount').style.visibility = '';
  }
  /** 귀신을 보여 준다: 0.25초 나타남 → hold 동안 흔들리며 머묾 → 0.35초 사라짐 */
  function playScreenGhost(p, hold) {
    const v = $('camVideo'), c = $('camGhost');
    if (!c || !stream) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.classList.toggle('mirror', v.classList.contains('mirror'));
    const x = c.getContext('2d'), base = Math.min(0.88, Math.max(0.66, p.alpha + 0.3)), t0 = performance.now(), fin = 250, fout = 350;
    const glitch = () => { v.classList.add('glitch'); setTimeout(() => v.classList.remove('glitch'), 140); };
    glitch();
    if (sfxOn() && !photoOnly()) playSoft(sfxVol());                         // 사진 인증샷에서는 귀신만 (소리는 도착 때)
    const frame = (now) => {
      const t = now - t0, total = fin + hold + fout;
      x.clearRect(0, 0, c.width, c.height);
      if (t >= total || !stream) { glitch(); return; }
      let a = t < fin ? t / fin : t > fin + hold ? 1 - (t - fin - hold) / fout : 1;
      a *= 0.86 + 0.14 * Math.sin(t / 37) * Math.sin(t / 91);           // 살짝 깜빡임
      x.globalAlpha = Math.max(0, a) * base;
      x.drawImage(p.layer, p.gx + Math.sin(t / 53) * 1.5, p.gy);
      screenGhostRaf = requestAnimationFrame(frame);
    };
    screenGhostRaf = requestAnimationFrame(frame);
  }
  // ---------- 놀람 촬영: 귀신이 나온 순간 학생 반응을 몰래 연사(5장)·영상으로 남긴다 ----------
  function startReaction(test) {
    const m = reactMode();
    if (m === '끔' && !test) return null;
    const r = { frames: [], chunks: [], test, photos: test || m !== '영상', video: !test && (m === '영상' || m === '둘다'), fired: false, done: null, rec: null, mime: '' };
    if (r.video && stream && typeof MediaRecorder !== 'undefined') {
      const mime = pickVideoMime();
      if (mime) {
        try {
          r.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2000000, audioBitsPerSecond: 96000 });
          r.rec.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
          r.rec.start(500); r.mime = mime;
        } catch (e) { r.rec = null; }
      }
    }
    return r;
  }
  function triggerReaction(r) {
    if (!r || r.fired) return;
    r.fired = true;
    if (!r.photos) return;
    r.done = (async () => {                                                  // 놀라는 데 0.2~0.3초 걸리므로 조금 뒤부터 0.2초 간격 5장
      await sleep(250);
      for (let i = 0; i < 5 && stream; i++) { r.frames.push(grabFrame()); if (i < 4) await sleep(200); }
    })();
  }
  async function finishReaction(r) {
    if (!r) return 0;
    if (r.done) await r.done.catch(() => {});
    let video = null;
    if (r.rec) {
      await new Promise((res) => { r.rec.onstop = res; try { r.rec.stop(); } catch (e) { res(); } setTimeout(res, 1500); });
      if (r.fired && r.chunks.length) video = new Blob(r.chunks, { type: r.mime.split(';')[0] });
    }
    if (r.test) {
      if (r.frames.length) openModal(await canvasToBlob(r.frames[Math.min(2, r.frames.length - 1)]), `놀람 연사 ${r.frames.length}장 중 3번째 (시험이라 저장 안 함)`);
      return r.frames.length;
    }
    const recs = [], takenAt = Date.now();
    for (let i = 0; i < r.frames.length; i++) recs.push(baseRecord({ takenAt, seq: i + 1, reaction: true, original: await canvasToBlob(r.frames[i]), reason: '놀람 장면' }));
    if (video) recs.push(baseRecord({ takenAt, kind: 'video', ext: /mp4/.test(r.mime) ? 'mp4' : 'webm', reaction: true, original: video, reason: '놀람 장면' }));
    if (recs.length) await saveRecords(recs);
    return recs.length;
  }
  /** 깜짝 얼굴: 화면 가득 큰 얼굴이 확 다가오며 흔들리고(0.7초) 큰 소리 */
  async function playJumpFace() {
    const v = $('camVideo'), c = $('camGhost');
    if (!c || !stream) return false;
    const face = GhostFree.jumpFace(await loadFree(), (station() || {}).id);
    if (!face || !stream) return false;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.classList.remove('mirror');
    const x = c.getContext('2d'), t0 = performance.now(), dur = 700;
    playScream(loudVol());                                                  // 여자 비명 (사용자 요청: 쾅보다 비명)
    v.classList.add('glitch');
    $('camCount').style.visibility = 'hidden';
    const frame = (now) => {
      const t = now - t0;
      x.clearRect(0, 0, c.width, c.height);
      if (t >= dur || !stream) { v.classList.remove('glitch'); $('camCount').style.visibility = ''; return; }
      const k = Math.min(1, t / 120), scale = 0.75 + 0.33 * k;               // 0.12초 만에 확 다가옴
      const h = c.height * 1.05 * scale, w = h * face.width / face.height;
      const jx = (Math.random() - 0.5) * c.width * 0.02, jy = (Math.random() - 0.5) * c.height * 0.02;
      x.globalAlpha = 1;
      x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(0, 0, c.width, c.height);
      x.globalAlpha = t > dur - 120 ? (dur - t) / 120 : 0.95;
      x.drawImage(face, (c.width - w) / 2 + jx, c.height * 0.02 + jy, w, h);
      screenGhostRaf = requestAnimationFrame(frame);
    };
    screenGhostRaf = requestAnimationFrame(frame);
    return true;
  }
  /** 카운트다운. 이 조·장소에 귀신이 있고 '화면' 방식이면(force 면 무조건) 그사이 귀신을 띄운다. 셔터 0.8초 전에는 사라짐 → 띄웠으면 true
   *  깜짝 얼굴을 켠 무서움 단계(또는 force === 'jump')면 귀신 뒤에 큰 얼굴 + 큰 소리 */
  async function photoCountdown(n, force) {
    const want = n >= 4 && (force || (wantGhostHere() && ghostOnScreen())) && !!window.GhostFree;
    const jump = want && (force === 'jump' || (!force && jumpOn()));
    let shown = false;
    screenGhostWhy = want ? '' : '귀신 없는 조·장소';
    const react = want ? startReaction(!!force) : null;
    const loudHere = !force && !jump && n >= 4 && loudOn() && !photoOnly();   // 사진 인증샷에서는 큰 소리를 도착 때로
    let loudDone = false;
    const fireLoud = () => { if (loudHere && !loudDone && stream) { loudDone = true; playLoud(teamFear(cur.group)); } };
    if (loudHere) { clearTimeout(loudTimer); loudTimer = setTimeout(fireLoud, want ? Math.max(2500, n * 1000 - 1800) : 2000); }   // 귀신이 안 나오면 이때
    if (jump) {
      clearTimeout(loudTimer);                                               // 큰 소리는 깜짝 얼굴과 함께
      const jumpAt = n * 1000 - 800 - 700;
      screenGhostTimer2 = setTimeout(() => { cancelAnimationFrame(screenGhostRaf); playJumpFace().then((ok) => { if (ok) { shown = true; triggerReaction(react); } }); }, jumpAt);
    }
    if (want) {
      // 귀신은 카운트다운 1초쯤 나타나 약 1초 머문다 (나타남·사라짐 0.6초 포함 1.5~1.8초). 준비가 늦으면 남은 시간만큼 줄이되 0.6초 미만이면 안 띄움
      const start = performance.now();
      const room = n * 1000 - 800 - (jump ? 700 + 300 : 0);                // 귀신이 사라져야 하는 때
      const appearAt = 900;
      planScreenGhost(!!force).then((p) => {
        if (!p) return;
        const wait = Math.max(0, start + appearAt - performance.now());
        const hold = Math.min(900 + Math.random() * 300, start + room - performance.now() - wait - 600);
        if (hold < 600) { screenGhostWhy = '준비가 늦어 건너뜀'; return; }
        screenGhostTimer = setTimeout(() => { shown = true; playScreenGhost(p, hold); if (!jump) triggerReaction(react); fireLoud(); }, wait);
      }).catch((e) => { screenGhostWhy = e.message; });
    }
    await countdown(n, 1000);
    stopScreenGhost();
    if (react) await finishReaction(react).catch(() => 0);
    return shown;
  }
  async function countdown(n, step) {
    for (let i = n; i > 0; i--) { $('camCount').textContent = i; await sleep(step || 900); }
    $('camCount').textContent = '';
  }

  let shooting = false;
  async function shoot() {
    if (shooting || !stream) return;
    shooting = true;
    try {
      if (camMode === 'video') return await startVideo();
      if (camMode === 'burst') return await shootBurst();
      if (camMode === 'screentest') {
        $('btnShutter').hidden = true; $('btnCamCancel').hidden = true;
        const shown = await photoCountdown(5, screenTestJump ? 'jump' : true);
        $('btnShutter').hidden = false; $('btnCamCancel').hidden = false;
        flash(); closeCamera(); openAdmin('tools');
        return toast(shown ? '화면 귀신 미리보기를 마쳤어요 (사진은 저장하지 않았어요)' : '이번엔 귀신이 안 나왔어요: ' + (screenGhostWhy || '어두운 곳을 못 찾음'), 5000);
      }
      if (camMode === 'student' && photoOnly()) { $('btnShutter').hidden = true; $('btnCamCancel').hidden = true; await photoCountdown(5); $('btnShutter').hidden = false; $('btnCamCancel').hidden = false; }
      else if ($('camTimer').checked && camMode === 'student') await photoCountdown(3);
      const frame = camMode === 'student' ? await captureStill() : grabFrame();
      flash();
      closeCamera();
      if (camMode === 'background') await saveBackground(frame);
      else if (camMode === 'test') await testComposite(frame);
      else await saveStudentPhoto(frame);
    } finally { if (!recorder) shooting = false; }
  }

  let freeLib = null;
  const loadFree = () => freeLib || (freeLib = window.GhostFree ? GhostFree.load('./').catch((e) => { freeLib = null; throw e; }) : Promise.reject(new Error('자유 배치 없음')));
  async function compose(frame) {
    let fixed = { blob: null, applied: false, reason: assetState };
    if (asset && window.GhostEngine) {
      try { fixed = await GhostEngine.composite(frame, asset, { quality: 0.92 }); }
      catch (e) { fixed = { blob: null, applied: false, reason: 'error: ' + e.message }; }
    }
    if (fixed.applied || !(window.Intensity && Intensity.freeGhost(cache.settings))) return fixed;
    try { return await GhostFree.composite(frame, await loadFree(), { stationId: (station() || {}).id, quality: 0.92 }); }
    catch (e) { return { blob: null, applied: false, reason: (fixed.reason || '') + ' / free: ' + e.message }; }
  }

  function baseRecord(extra) {
    const s = station();
    return Object.assign({
      id: newId(), group: cur.group, stationId: s.id, stationName: s.name, takenAt: Date.now(),
      kind: 'photo', ext: 'jpg', composite: null, ghost: false, reason: '', up: { orig: false, comp: false }
    }, extra);
  }
  async function saveRecords(recs) {
    for (const r of recs) await db.put(r);
    if (setting('업로드', '자동') === '자동') uploadPending(false);
  }
  async function minWait(t0, ms) { const w = ms - (Date.now() - t0); if (w > 0) await sleep(w); }

  // 사진 1장
  async function saveStudentPhoto(frame) {
    show('scrSaving'); setSaving('사진을 저장하고 있어요...', 0);
    const t0 = Date.now();
    const rec = baseRecord({ original: await canvasToBlob(frame), reason: 'not-assigned' });
    if (wantGhostHere() && ghostInPhoto()) {
      const r = await compose(frame);
      if (r.applied && r.blob) { rec.composite = r.blob; rec.ghost = true; rec.reason = ''; } else rec.reason = r.reason || 'not-applied';
    }
    await saveRecords([rec]);
    await minWait(t0, 1800); // 너무 빨리 끝나면 어색하므로 최소 대기
    showResult({ recs: [rec] });
  }

  // 연속사진: 10초 뒤 n장 (0.5초 간격), 귀신은 그중 한 장
  async function shootBurst() {
    const n = Math.min(20, Math.round(stValue(3)));
    $('btnShutter').hidden = true; $('btnCamCancel').hidden = true;
    await photoCountdown(10);
    const frames = [];
    const torch = flashOn() && await setTorch(true);
    if (torch) await sleep(400);
    $('camBurst').hidden = false;
    for (let i = 0; i < n; i++) {
      frames.push(grabFrame()); flash();
      $('camBurst').textContent = `📸 ${i + 1} / ${n}`;
      if (i < n - 1) await sleep(500);
    }
    $('camBurst').hidden = true; $('btnShutter').hidden = false; $('btnCamCancel').hidden = false;
    if (torch) await setTorch(false);
    closeCamera();
    show('scrSaving'); setSaving('사진을 저장하고 있어요...', 0);
    const t0 = Date.now(), takenAt = Date.now();
    const recs = [];
    for (let i = 0; i < n; i++) recs.push(baseRecord({ takenAt, seq: i + 1, original: await canvasToBlob(frames[i]), reason: 'not-assigned' }));
    if (wantGhostHere() && ghostInPhoto()) {
      // 앞쪽 몇 장은 비우고, 가운데~뒤쪽 중 무작위 한 장부터 차례로 시도
      const order = [];
      for (let i = n >= 6 ? 3 : Math.min(1, n - 1); i < n; i++) order.push(i);   // 첫 장은 비워 둔다
      const start = Math.floor(Math.random() * order.length);
      let reason = 'not-applied';
      for (const i of order.slice(start).concat(order.slice(0, start))) {
        const r = await compose(frames[i]);
        if (r.applied && r.blob) { recs[i].composite = r.blob; recs[i].ghost = true; reason = ''; break; }
        reason = r.reason || reason;
      }
      recs.forEach((r) => { r.reason = reason; });
    }
    await saveRecords(recs);
    await minWait(t0, 2000);
    showResult({ recs, burst: true });
  }

  // 영상 (스태킹·탁구공) — 카메라 영상을 그대로 녹화하고, 귀신 조만 녹화 후 GhostEngine.editVideo 로 수정본을 만든다
  let recorder = null, recTimer = null, recLimit = null, recStart = 0;
  function pickVideoMime() {
    if (!window.MediaRecorder) return null;
    for (const m of ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return null;
  }
  async function startVideo() {
    const mime = pickVideoMime();
    if (!mime) { shooting = false; return toast('이 기기에서는 영상 녹화가 안 돼요', 5000); }
    const t = stType();
    const limitMs = t === '스태킹' ? stValue(60) * 1000 : t === '영상' ? 120000 : 60000;   // 영상 미션은 최대 2분
    $('btnShutter').hidden = true; $('btnCamCancel').hidden = true;
    await countdown(3);
    if (wantGhostHere() && ghostOnScreen() && window.GhostFree) {
      const at = 4000 + Math.random() * Math.max(0, Math.min(limitMs - 8000, 8000));
      screenGhostTimer = setTimeout(() => { planScreenGhost().then((p) => { if (p && recorder) playScreenGhost(p, 1300); }).catch(() => {}); }, at);
    }
    const chunks = [];
    let mr;
    try { mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2500000, audioBitsPerSecond: 96000 }); }
    catch (e) {
      $('btnShutter').hidden = false; $('btnCamCancel').hidden = false; shooting = false;
      return toast('녹화를 시작할 수 없어요: ' + e.message, 5000);
    }
    const done = new Promise((res) => { mr.onstop = () => res(new Blob(chunks, { type: mr.mimeType || mime })); });
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder = { mr, done, limitMs, auto: false };
    mr.start(1000);
    recStart = performance.now();
    startRecSpooks();   // 녹화 중간중간 소리 → 영상에도 담긴다
    $('camRec').hidden = false; $('btnStop').hidden = false;
    const fmt = (ms) => (ms / 1000).toFixed(1);
    recTimer = setInterval(() => {
      const ms = performance.now() - recStart;
      if (t === '스태킹') {
        $('camRecTime').textContent = fmt(Math.min(ms, limitMs)) + ' / ' + Math.round(limitMs / 1000) + '초';
        $('camRec').classList.toggle('warn', limitMs - ms < 10000);
      } else $('camRecTime').textContent = fmt(ms) + '초';
    }, 100);
    recLimit = setTimeout(() => { if (recorder) { recorder.auto = true; finishVideo(); } }, limitMs);
  }
  /** 영상 미션(1학년 교실 컵 쌓기·6학년 교실 탁구공) 녹화 중 소리 2번: 4~7초에 은은한 소리, 그 8~12초 뒤 큰 소리.
   *  조의 무서움 단계 표를 따른다(큰 소리 칸이 꺼진 단계는 은은한 소리 2번, 1·2학년 조는 소리 없음). */
  let recSpookTimers = [];
  function startRecSpooks() {
    stopRecSpooks();
    clearTimeout(spookTimer); clearTimeout(loudTimer);
    const soft = sfxOn(), loud = loudOn();
    if (!soft && !loud) return;
    const first = 4000 + Math.random() * 3000, second = first + 8000 + Math.random() * 4000;
    const at = (ms, fn) => recSpookTimers.push(setTimeout(() => { if (recorder && stream) fn(); }, ms));
    at(first, () => (soft ? playSoft(sfxVol()) : playLoud(teamFear(cur.group))));
    at(second, () => (loud ? playLoud(teamFear(cur.group)) : playSoft(sfxVol())));
  }
  function stopRecSpooks() { recSpookTimers.forEach(clearTimeout); recSpookTimers = []; }
  document.addEventListener('visibilitychange', () => { if (document.hidden && recorder) finishVideo(); });

  let finishing = false;
  async function finishVideo() {
    if (finishing || !recorder) return;
    finishing = true;
    clearInterval(recTimer); clearTimeout(recLimit); stopRecSpooks();
    const r0 = recorder;
    const durationMs = Math.round(performance.now() - recStart);
    try { if (r0.mr.state !== 'inactive') r0.mr.stop(); } catch (e) {}
    $('camRec').hidden = true; $('btnStop').hidden = true; $('btnShutter').hidden = false; $('btnCamCancel').hidden = false;
    show('scrSaving'); setSaving('영상을 저장하고 있어요...', 0);
    const t0 = Date.now();
    try {
      const original = await r0.done;
      recorder = null;
      closeCamera();
      const t = stType();
      const ext = /mp4/.test(original.type) ? 'mp4' : 'webm';
      const rec = baseRecord({ kind: 'video', ext, original, durationMs, reason: 'not-assigned' });
      if (t === '스태킹') { rec.success = !r0.auto && durationMs <= r0.limitMs; rec.timeMs = Math.min(durationMs, r0.limitMs); }
      // 귀신 조는 수정본을 나중에(태블릿이 쉴 때) 만든다 → 학생은 기다리지 않는다
      if (wantGhostHere() && ghostInPhoto()) {
        if (setting('영상편집', '노트북') === '태블릿') { rec.needsEdit = true; rec.reason = '편집 대기'; }
        else { rec.remoteEdit = true; rec.reason = '노트북 편집'; }
      }
      if (t === '탁구공') rec.hold = true;              // 공 개수를 고른 뒤에 올린다
      await saveRecords([rec]);
      if (rec.needsEdit) setTimeout(runEdits, 500);   // 학생이 결과를 보고 이동하는 동안 바로 편집 시작
      await fakeProgress(t0, 1500);
      showResult({ recs: [rec], video: true, stacking: t === '스태킹', pingpong: t === '탁구공' });
    } catch (e) {
      recorder = null;
      toast('영상 저장에 실패했어요: ' + e.message, 5000);
      closeCamera(); show('scrMission');
    } finally { finishing = false; shooting = false; }
  }
  // ---------- 영상 편집 대기열 (귀신 조 영상 → 수정본) ----------
  // 카메라를 쓰지 않을 때만 한 개씩 처리. 태블릿을 다시 켜도 IndexedDB 에 남은 것부터 이어서 한다.
  let editing = false;
  async function runEdits() {
    if (editing || !window.GhostEngine || !GhostEngine.editVideo) return;
    editing = true;
    try {
      for (;;) {
        if (stream) break;                                   // 촬영 중이면 다음 기회에
        const rec = (await db.all()).filter((r) => r.needsEdit).sort((a, b) => a.takenAt - b.takenAt)[0];
        if (!rec) break;
        if (!assetChecked) break;                            // 소재 확인이 끝난 뒤에 처리
        if (!asset || rec.stationId !== conf.stationId) {
          rec.needsEdit = false; rec.reason = asset ? '다른 장소 영상' : assetState; await db.put(rec); continue;
        }
        try {
          const d = rec.durationMs || 10000;
          const r = await GhostEngine.editVideo(rec.original, asset, {
            ghostAtMs: [Math.min(3000, d * 0.2), Math.max(4000, d - 2000)], durationMs: 1000,
            forceRealtime: true   // 빠른 경로(WebCodecs)는 빈자리 판정 오류가 있어 검증된 재생·재녹화 방식만 사용 (뒤에서 처리하므로 속도 무관)
          });
          if (r.applied && r.blob) { rec.composite = r.blob; rec.ghost = true; rec.reason = ''; }
          else rec.reason = r.reason || 'not-applied';
        } catch (e) { rec.reason = 'error: ' + e.message; }
        rec.needsEdit = false;
        await db.put(rec);
        if (setting('업로드', '자동') === '자동') uploadPending(false);
      }
    } finally { editing = false; }
  }
  setInterval(runEdits, 20000);

  let savingShown = 0;
  function setSaving(msg, p) {
    if (msg) $('savingMsg').textContent = msg;
    if (p != null) { savingShown = Math.max(savingShown, Math.min(1, p)); $('savingBar').style.width = Math.round(savingShown * 100) + '%'; }
  }
  async function fakeProgress(t0, expectMs) {
    // 실제 편집이 끝났어도 예상 시간까지 진행 막대를 자연스럽게 채운다
    while (Date.now() - t0 < expectMs) {
      setSaving(null, Math.max(savingShown, (Date.now() - t0) / expectMs));
      await sleep(120);
    }
    setSaving(null, 1); await sleep(250);
    savingShown = 0;
  }

  // 책찾기: 바코드 인식 또는 번호 입력 → 맞으면 책과 함께 인증사진
  let scanTimer = null, detector = null, lastBad = '';
  const normCode = (x) => String(x || '').toUpperCase().replace(/[\s\-_.]/g, '');
  const bookAnswers = () => String(station().value || '').split(/[,\n]/).map(normCode).filter(Boolean);
  function setScanMsg(msg, cls) { const m = $('scanMsg'); m.textContent = msg; m.className = 'scan-msg' + (cls ? ' ' + cls : ''); }
  function checkBook(code, typed) {
    const c = normCode(code);
    if (!c) return false;
    const answers = bookAnswers();
    if (!answers.length || answers.includes(c)) { bookFound(); return true; }
    if (c !== lastBad || typed) { lastBad = c; setScanMsg(`이 책이 아니에요! (${code}) 다시 찾아봐요`, 'bad'); }
    return false;
  }
  function startScan() {
    lastBad = ''; $('scanInput').value = '';
    setScanMsg('책 뒤의 바코드를 네모 안에 비춰 주세요');
    if (!('BarcodeDetector' in window)) { setScanMsg('바코드 아래 번호를 입력해 주세요'); return; }
    try { detector = new BarcodeDetector({ formats: ['code_39', 'code_128', 'ean_13', 'ean_8', 'codabar', 'itf', 'qr_code', 'upc_a'] }); }
    catch (e) { setScanMsg('바코드 아래 번호를 입력해 주세요'); return; }
    let busy = false;
    scanTimer = setInterval(async () => {
      if (busy || !stream) return; busy = true;
      try { const codes = await detector.detect($('camVideo')); for (const b of codes) if (checkBook(b.rawValue)) break; }
      catch (e) {} finally { busy = false; }
    }, 300);
  }
  function stopScan() { clearInterval(scanTimer); scanTimer = null; }
  async function bookFound() {
    stopScan();
    setScanMsg('📗 찾았어요! 이제 책과 함께 인증사진을 찍어요', 'good');
    await sleep(1600);
    camMode = 'student';
    $('camScan').hidden = true; $('btnShutter').hidden = false; $('camTimerLabel').hidden = false;
    $('camTop').textContent = `${cur.group}조 · ${station().name} · 찾은 책을 들고 찍어요`;
  }

  // ---------- 결과 ----------
  const resUrls = [];
  let lastResult = null;
  function showResult(res) {
    lastResult = res;
    const s = station();
    const mode = (s.reveal || setting('공개방식', '즉시')).trim();
    resUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    const url = (b) => { const u = URL.createObjectURL(b); resUrls.push(u); return u; };
    const pick = (r) => (mode === '원본' ? r.original : (r.composite || r.original));
    const rec = res.recs[0];
    $('resGroup').textContent = rec.group + '조';
    $('resPhoto').hidden = true; $('resVideo').hidden = true; $('resVideo').removeAttribute('src');
    $('resPhotoBox').hidden = true; $('resBurst').hidden = true; $('resCount').hidden = true;
    let title = isMissionPlace(station()) ? '🎉 미션 성공!' : '🎉 인증샷 완료!', msg = res.video ? '영상이 저장됐어요' : '사진이 저장됐어요', success = true;

    if (mode === '숨김') {
      msg = (res.video ? '🎬 영상이' : '📸 사진이') + ' 안전하게 저장됐어요! 나중에 선생님과 함께 봐요.';
    } else if (res.burst) {
      const g = $('resBurst'); g.innerHTML = ''; g.hidden = false;
      res.recs.forEach((r) => { const im = document.createElement('img'); im.src = url(pick(r)); im.onclick = () => openModal(pick(r)); g.appendChild(im); });
      msg = `인증사진 ${res.recs.length}장이 저장됐어요`;
    } else if (res.video) {
      $('resPhotoBox').hidden = false; $('resVideo').hidden = false; $('resVideo').src = url(pick(rec));
    } else {
      $('resPhotoBox').hidden = false; $('resPhoto').hidden = false; $('resPhoto').src = url(pick(rec));
    }
    if (res.stacking) {
      success = !!rec.success;
      title = success ? `🎉 ${(rec.timeMs / 1000).toFixed(1)}초! 미션 성공!` : '⏰ 시간 초과! 아깝다!';
      if (!success) msg = '다시 도전해 볼까요?';
    }
    if (res.pingpong) {
      success = false; title = '🏓 몇 개 넣었나요?'; msg = '영상을 보고 확인해요';
      $('resCount').hidden = false;
      const btns = $('resCountBtns'); btns.innerHTML = '';
      const need = Math.round(stValue(3));
      for (let n = 0; n <= 5; n++) {
        const b = document.createElement('button'); b.className = 'btn ghost'; b.textContent = n;
        b.onclick = async () => {
          rec.count = n; rec.success = n >= need; rec.hold = false; await db.put(rec);
          if (setting('업로드', '자동') === '자동') uploadPending(false);
          $('resCount').hidden = true;
          $('resTitle').textContent = rec.success ? `🎉 ${n}개! 미션 성공!` : `😢 ${n}개… 아깝다!`;
          $('resMsg').textContent = rec.success ? '영상이 저장됐어요' : `${need}개 이상 넣어야 해요. 다시 도전해 볼까요?`;
          setClue(rec.success, true);
        };
        btns.appendChild(b);
      }
    }
    $('resTitle').textContent = title;
    const off = window.Intensity ? Intensity.offIds(cache.settings) : [];
    const used = cache.stations.filter((x) => !off.includes(x.id)), idx = used.findIndex((x) => x.id === s.id);
    if (success && idx >= 0 && used.length > 1) msg = `🔍 ${tourOn() ? '장소' : '미션'} ${idx + 1}/${used.length} 완료! ` + msg;
    $('btnDone').textContent = tourOn() ? '✅ 다음 장소로' : '✅ 미션 완료';
    $('resMsg').textContent = msg;
    setClue(success, !res.pingpong);
    show('scrResult');
    if (sfxOn() && mode !== '숨김' && mode !== '원본' && res.recs.some((r) => r.composite)) setTimeout(() => Sfx.play('whisper', sfxVol() * 0.7), 1500);
    armIdleHome();
  }
  // 결과 화면에서 2분 동안 아무도 안 누르면 대기 화면으로 (학생이 완료를 안 누르고 떠난 경우)
  let idleTimer = null;
  function armIdleHome() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!$('scrResult').hidden) goHome(); }, 120000);
  }
  document.addEventListener('pointerdown', () => { if (!$('scrResult').hidden) armIdleHome(); });
  function setClue(success, decided) {
    const s = station();
    $('resClue').hidden = !(success && s.clue);
    $('resClueText').textContent = s.clue || '';
    $('resClueLabel').textContent = tourOn() ? '🧭 다음 장소 — 이곳을 찾아가요' : '🔑 단서';
    const nx = success ? nextStationOf(s) : null;
    showPlaceImg($('resNextImg'), nx && nx.id);
    $('btnDone').hidden = !success;           // 성공해야 완료 가능
    $('btnRetake').hidden = !decided;         // 탁구공은 개수를 고른 뒤에 버튼 표시
    $('btnRetake').textContent = success ? '🔄 다시 찍기' : '🔄 다시 도전!';
    $('btnRetake').className = success ? 'btn ghost' : 'btn';
  }

  async function saveBackground(frame) {
    const s = station();
    const blob = await canvasToBlob(frame, 0.95);
    const name = `빈배경_${s ? s.id : 'unknown'}_${Date.now()}.jpg`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    let msg = '빈 배경을 다운로드 폴더에 저장했어요';
    if (conf.apiUrl && conf.apiKey) {
      try { await postFile('빈배경', name, blob); msg += ' + 드라이브 "빈배경" 폴더에 올렸어요'; }
      catch (e) { msg += ' (드라이브 업로드 실패)'; }
    }
    openAdmin('tools'); toast(msg, 4000);
  }

  async function testComposite(frame) {
    show('scrSaving');
    const r = await compose(frame);
    openAdmin('tools');
    if (r.applied && r.blob) openModal(r.blob, `합성 성공 (${r.ms || '?'}ms)`);
    else toast('합성 안 됨: ' + (r.reason || '알 수 없음'), 5000);
  }

  // ---------- 교사 모드 ----------
  let tapCount = 0, tapTimer = null, screenTestJump = false;
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-admin-tap]')) return;
    tapCount++; clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { tapCount = 0; }, 2500);
    if (tapCount >= 5) { tapCount = 0; openPin(); }
  });

  // 교사 모드 비밀번호: 숫자 4~8자리 (강도 설정 화면에서 바꿈). 맞으면 바로 열리고, 틀리면 ✓ 를 눌렀을 때 알려 준다
  let pinBuf = '';
  const adminPin = () => String(setting('관리자PIN', DEFAULT_PIN)).replace(/\D/g, '') || DEFAULT_PIN;
  function openPin() { pinBuf = ''; drawPin(); show('scrPin'); }
  function drawPin() {
    $('pinDots').innerHTML = Array.from({ length: Math.max(4, pinBuf.length) }, (_, i) => `<i class="${i < pinBuf.length ? 'f' : ''}"></i>`).join('');
  }
  function checkPin(final) {
    if (pinBuf === adminPin()) { pinBuf = ''; return openAdmin('conn'); }
    if (final || pinBuf.length >= 8) { toast('비밀번호가 틀렸어요'); pinBuf = ''; setTimeout(drawPin, 150); }
  }
  function buildPinPad() {
    const pad = $('pinPad');
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].forEach((k) => {
      const b = document.createElement('button'); b.textContent = k;
      if (k === '✓') b.className = 'pin-ok';
      b.onclick = () => {
        if (k === '⌫') { pinBuf = pinBuf.slice(0, -1); return drawPin(); }
        if (k === '✓') return checkPin(true);
        if (pinBuf.length < 8) pinBuf += k;
        drawPin(); checkPin(false);
      };
      pad.appendChild(b);
    });
  }

  function openAdmin(tab) {
    show('scrAdmin');
    $('inApiUrl').value = conf.apiUrl || '';
    $('inApiKey').value = conf.apiKey || '';
    if (cache.fetchedAt && !$('connStatus').classList.contains('ok')) {
      setStatus('connStatus', `저장된 설정: 장소 ${cache.stations.length}곳, 출발한 조 ${Object.keys(teams).length}개 (${new Date(cache.fetchedAt).toLocaleString()})`);
    }
    fillStations();
    $('assetStatus').textContent = '귀신 소재: ' + assetState;
    switchTab(tab || 'conn');
  }
  function fillStations() {
    const sel = $('selStation'); sel.innerHTML = '<option value="">— 장소 선택 —</option>';
    cache.stations.forEach((s) => {
      const o = document.createElement('option'); o.value = s.id; o.textContent = `${s.name} (${s.id})${s.ghost ? ' 👻' : ''}`;
      if (s.id === conf.stationId) o.selected = true; sel.appendChild(o);
    });
  }
  function switchTab(name) {
    document.querySelectorAll('#adminTabs .tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
    document.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== name; });
    if (name === 'ghost') renderGhostTable();
    if (name === 'gallery') renderGallery();
    if (name !== 'tools' && recNow) stopRec();
    if (name === 'tools') { renderRecs(); renderDiag(); renderCamSettings(); renderVoices(); $('btnVoicePrefetch').hidden = !ttsProvider(); }
    if (name === 'level') renderIntensity();
    if (name === 'story') renderStoryEditor();
  }

  function renderStoryEditor() {
    if (!window.StoryEditor) return;
    StoryEditor.render($('storyPanel'), cache.settings, cache.stations, {
      onSave: async (payload) => {
        if (!conf.apiUrl || !conf.apiKey) throw new Error('먼저 구글 시트를 연결하세요');
        const r = await fetch(conf.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ key: conf.apiKey, action: 'stories', ...payload }) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || '응답 오류');
        await loadRoster(true);
      }
    });
  }

  function renderIntensity() {
    if (!window.Intensity) return;
    Intensity.render($('intensityPanel'), cache.settings, {
      stationCount: ghostStations().length,
      stations: cache.stations,
      rawStations: cache.raw,
      onSfx: async (name, vol) => {
        if (window.Sfx) Sfx.unlock();
        const m = /^line(2?):(.*)$/.exec(name);
        if (m) {                                                                // 목소리 대사: 작은 목소리(은은) / 귀신 목소리(큰)
          const lv = m[1] ? 2 : 0;
          if (ttsProvider()) { const clip = await ttsClip(m[2], lv); if (clip) { const a = new Audio(URL.createObjectURL(clip)); a.volume = Math.max(0, Math.min(1, m[1] ? vol : vol * 0.7)); await a.play(); return {}; } }
          const u = new SpeechSynthesisUtterance(m[2]); u.lang = 'ko-KR'; u.volume = 1; u.rate = m[1] ? 0.6 : 0.7; u.pitch = m[1] ? 0.2 : 1.3; speechSynthesis.speak(u);
          return {};
        }
        const blob = await sfxClip(name);
        if (!blob) return { error: '소리를 받지 못했어요: ' + (sfxErr || '이유 모름') };
        playClip(name, vol); return {};
      },
      onStop: stopNarration,
      samplePreview: true,
      onPreview: async (o, lv, which) => {
        if (which === 'sample') {
          ttsError = '';
          const clip = await ttsClip(o.text, lv, o.previewVoice);
          return clip ? { clip } : { error: ttsError || '구글 시트 연결과 인터넷 상태를 확인하세요.' };
        }
        const s = station();
        const text = which === 'station' && s ? (function () {
          const def = storyDef(s);
          return ((s.stories && s.stories[lv]) || '').trim() || (def ? def.text[lv] : '');
        })() : prologueText(lv);
        if (!text) return { error: '이 장소에는 괴담 문구가 없어요' };
        const how = o['나레이션방식'] || setting('나레이션방식', '태블릿');
        const saved = cache.settings; cache.settings = Object.assign({}, saved, { '나레이션방식': how, '나레이션': '예' });
        ttsError = '';
        try { await narrate(text, { level: lv }); } finally { cache.settings = saved; }
        if (ttsError && how !== '태블릿') return { error: how + ' 실패 → 태블릿 음성으로 읽었어요: ' + ttsError };
        return { how: how === '태블릿' ? '태블릿 음성' : how };
      },
      onSave: async (o) => {
        if (!conf.apiUrl || !conf.apiKey) throw new Error('먼저 구글 시트를 연결하세요');
        const r = await fetch(conf.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ key: conf.apiKey, action: 'settings', settings: o }) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error === 'key' ? '비밀 키가 맞지 않아요. 연결 탭에서 비밀 키를 다시 넣어 주세요' : (j.error || '응답 오류'));
        cache.settings = j.settings; cache.stations = effStations(cache.raw, cache.settings); writeLS(LS_CACHE, cache);
        applySchoolName();
      }
    });
  }

  function renderGhostTable() {
    const nameOf = (id) => (cache.stations.find((s) => s.id === id) || {}).name || id;
    const list = ghostStations();
    const nums = Object.keys(teams).map(Number).sort((a, b) => a - b);
    let h = `<p>귀신 장소 후보: ${list.length ? list.map(nameOf).join(', ') : '없음 (시트 장소 탭의 귀신=예)'}</p>`;
    if (!nums.length) { $('ghostTable').innerHTML = h + '<p>아직 출발한 조가 없어요. 출발 장소에서 조가 시작하면 여기에 나타나요.</p>'; return; }
    const FEAR = ['😱 너무 무서움', '😬 조금', '😎 안 무서움'];
    h += '<table class="t"><tr><th>조</th><th>인원</th><th>무서움</th><th>귀신 장소</th><th>비고</th></tr>';
    nums.forEach((g) => {
      const sts = ghostStationsFor(g), t = teams[g];
      const f = t.young ? null : t.fear == null ? 1 : t.fear;
      const sound = f != null && window.Intensity ? [Intensity.softOn(cache.settings, f) && '은은한 소리', Intensity.loudOn(cache.settings, f) && '큰 소리'].filter(Boolean).join('·') : '';
      const note = t.young ? '1·2학년 있음 → 제외' : !sts.length && list.length ? (Intensity.ghostCount(cache.settings, f) === 0 ? '귀신 0곳 설정' : '귀신제외조') : sound;
      h += `<tr><td>${g}조</td><td>${t.size ? t.size + '명' : ''}</td><td>${t.young ? '—' : FEAR[t.fear == null ? 1 : t.fear]}</td><td>${sts.length ? sts.map((x) => '👻 ' + nameOf(x)).join(', ') : '—'}</td><td>${note}</td></tr>`;
    });
    $('ghostTable').innerHTML = h + '</table>';
  }

  const thumbUrls = [];
  async function renderGallery() {
    thumbUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    const recs = (await db.all()).sort((a, b) => b.takenAt - a.takenAt);
    const pend = recs.filter(needsUpload).length;
    setStatus('galStatus', `사진·영상 ${recs.length}개 (수정본 ${recs.filter((r) => r.ghost).length}장) · 드라이브 대기 ${pend}장`);
    const g = $('gallery'); g.innerHTML = '';
    recs.forEach((r) => {
      const u = URL.createObjectURL(r.composite || r.original); thumbUrls.push(u);
      const d = document.createElement('div'); d.className = 'gitem';
      const t = new Date(r.takenAt);
      const media = r.kind === 'video' ? `<video src="${u}#t=0.5" muted preload="metadata"></video>` : `<img src="${u}" alt="">`;
      const info = (r.reaction ? '😱 놀람 ' : '') + (r.kind === 'video' ? '🎬 ' : '') + (r.seq ? `#${r.seq} ` : '') +
        (r.timeMs ? `${(r.timeMs / 1000).toFixed(1)}초 ` : '') + (r.count != null ? `공 ${r.count}개 ` : '');
      d.innerHTML = `${media}<div>${r.group}조 · ${esc(r.stationName)} · ${pad(t.getHours())}:${pad(t.getMinutes())} ${info}<br>` +
        `${r.ghost ? '<span class="badge g">★ 수정</span>' : ''}${r.needsEdit ? '<span class="badge w">수정 대기</span>' : ''}${r.remoteEdit ? '<span class="badge g">노트북 수정</span>' : ''}${needsUpload(r) ? '<span class="badge w">대기</span>' : '<span class="badge u">올림</span>'}</div>`;
      d.onclick = () => openRecord(r);
      g.appendChild(d);
    });
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  let modalUrl = null;
  function setModalMedia(blob) {
    if (modalUrl) URL.revokeObjectURL(modalUrl);
    modalUrl = URL.createObjectURL(blob);
    const isVideo = /^video\//.test(blob.type);
    const img = $('modalImg'), vid = $('modalVideo');
    img.hidden = isVideo; vid.hidden = !isVideo;
    if (isVideo) { img.removeAttribute('src'); vid.src = modalUrl; } else { vid.pause(); vid.removeAttribute('src'); img.src = modalUrl; }
  }
  function openModal(blob, label, extraBtns) {
    setModalMedia(blob);
    const btns = $('modalBtns'); btns.innerHTML = '';
    if (label) { const s = document.createElement('span'); s.className = 'hd-sub'; s.textContent = label; btns.appendChild(s); }
    (extraBtns || []).forEach((b) => btns.appendChild(b));
    const c = document.createElement('button'); c.className = 'btn sm'; c.textContent = '닫기';
    c.onclick = () => { $('modalVideo').pause(); $('modal').hidden = true; }; btns.appendChild(c);
    $('modal').hidden = false;
  }
  function openRecord(r) {
    if (!r.composite) return openModal(r.original, '원본' + (r.reason && r.reason !== 'not-assigned' ? ` · 수정 안 됨(${r.reason})` : ''));
    const toggle = document.createElement('button'); toggle.className = 'btn sm ghost';
    let showComp = true;
    toggle.textContent = '원본 보기';
    toggle.onclick = () => {
      showComp = !showComp;
      setModalMedia(showComp ? r.composite : r.original);
      toggle.textContent = showComp ? '원본 보기' : '수정본 보기';
    };
    openModal(r.composite, '수정본', [toggle]);
  }

  async function exportZip() {
    if (!window.JSZip) return toast('압축 기능을 불러오지 못했어요');
    const recs = await db.all();
    if (!recs.length) return toast('사진이 없어요');
    setStatus('galStatus', '압축 파일 만드는 중...');
    const zip = new JSZip();
    recs.forEach((r) => {
      zip.file('원본/' + fileName(r, '원본'), r.original);
      if (r.composite) zip.file('수정본/' + fileName(r, '수정본'), r.composite);
    });
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const a = document.createElement('a');
    const st = station();
    a.href = URL.createObjectURL(blob);
    a.download = `할로윈사진_${st ? st.name : '태블릿'}_${new Date().toISOString().slice(0, 10)}.zip`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    setStatus('galStatus', `내보냄: ${recs.length}장 (원본/ 수정본/ 폴더로 구분)`, 'ok');
  }

  // 리허설 뒤 실제 행사 전에: 이 태블릿의 조 번호·출발 기록·방문 기록을 지운다 (사진은 그대로)
  let resetArmed = 0;
  function resetTeams() {
    if (Date.now() - resetArmed > 4000) { resetArmed = Date.now(); return toast('조 번호를 1번부터 다시 시작할까요? 4초 안에 한 번 더 누르세요.', 4000); }
    resetArmed = 0;
    teams = {}; saveTeams();
    writeLS(LS_COUNTER, 0); writeLS(LS_CHECKINS, []);
    Object.keys(localStorage).filter((k) => k.startsWith('hg_visited_')).forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
    toast('조 번호를 초기화했어요. 시트의 "출발"·"기록" 탭 내용도 지워 주세요.', 5000);
  }

  let wipeArmed = 0;
  async function wipe() {
    if (Date.now() - wipeArmed > 4000) {
      wipeArmed = Date.now();
      const recs = await db.all();
      const pend = recs.filter(needsUpload).length;
      return toast(`정말 지울까요? ${pend ? `드라이브에 안 올린 사진 ${pend}장도 사라져요. ` : ''}4초 안에 한 번 더 누르세요.`, 4000);
    }
    wipeArmed = 0;
    await db.clear(); renderGallery(); toast('이 태블릿의 사진을 모두 지웠어요');
  }

  function renderCamSettings() {
    document.querySelectorAll('input[name="camFacing"]').forEach((r) => { r.checked = r.value === camFacing(); });
    $('chkScreenLight').checked = !!conf.screenLight;
    $('chkFlash').checked = conf.flash !== false;
  }
  function renderDiag() {
    const es = window.GhostEngine && GhostEngine.status ? GhostEngine.status() : null;
    $('diag').innerHTML = [
      `장소: ${station() ? esc(station().name) : '미설정'}`,
      `귀신 소재: ${esc(assetState)}`,
      `합성 엔진: ${es ? (es.ready ? '준비됨' : '준비 안 됨') + (es.segmentation ? ' · 인물 분할 사용' : ' · 인물 분할 없음') + (es.error ? ' · ' + esc(es.error) : '') : '없음'}`,
      `출발 장소: ${esc((cache.stations.find((x) => x.id === startStationId()) || {}).name || '미정')}${isStartStation() ? ' (이 태블릿)' : ''} · 알고 있는 조 ${Object.keys(teams).length}개 · 출발 등록 대기 ${(readLS(LS_CHECKINS) || []).length}개`,
      `인터넷: ${navigator.onLine ? '연결됨' : '끊김'}`,
      `저장 공간: <span id="diagQuota">확인 중</span>`
    ].join('<br>');
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((q) => {
        const el = $('diagQuota'); if (el) el.textContent = `${(q.usage / 1e6).toFixed(0)}MB 사용 / ${(q.quota / 1e6).toFixed(0)}MB 가능`;
      });
    }
  }

  async function startStudent() {
    if (!station()) return toast('장소를 먼저 고르세요');
    try { await document.documentElement.requestFullscreen(); } catch (e) {}
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
    goHome();
  }
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && wakeLock !== null) {
      try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
    }
  });

  // ---------- 이벤트 연결 ----------
  function bind() {
    document.querySelectorAll('[data-go="home"]').forEach((b) => { b.onclick = goHome; });
    $('btnSetupAdmin').onclick = openPin;
    $('btnTeamStart').onclick = () => openTeamSetup();
    $('btnTeamGo').onclick = () => openMission();
    $('btnArrive').onclick = confirmArrival;
    $('btnStoryNext').onclick = nextStory;
    $('btnStoryReplay').onclick = () => narrate(storyPages[storyIdx] && storyPages[storyIdx].text);
    document.querySelectorAll('#selVoice, .sel-voice-lv').forEach((sel) => {
      sel.onchange = () => { conf.voices = conf.voices || []; conf.voices[Number(sel.dataset.lv)] = sel.value; writeLS(LS_CONF, conf); };
    });
    $('btnVoiceTest').onclick = async () => {
      const lv = Number($('selVoiceLevel').value); ttsError = '';
      await narrate(prologueText(lv), { level: lv });
      toast(ttsProvider() ? (ttsError ? ttsProvider() + ' 실패 → 태블릿 음성으로 읽었어요: ' + ttsError : ttsProvider() + ' 목소리로 읽어요') : '태블릿 음성으로 읽어요', 5000);
    };
    $('btnVoicePrefetch').onclick = async () => { if (!ttsProvider()) return toast('강도 설정에서 나레이션 방식을 ElevenLabs 나 클로바로 고르세요'); toast('이 장소 나레이션을 만드는 중… (1분쯤)', 4000); ttsError = ''; await prefetchNarration(); toast(ttsError ? '일부 실패: ' + ttsError : '이 장소 나레이션을 태블릿에 저장했어요', 5000); };
    $('btnNextGo').onclick = () => { const g = nextTeam(); if (g) startTeam(g); };
    $('btnOtherTeam').onclick = showTeamGrid;
    document.querySelectorAll('[data-size]').forEach((b) => { b.onclick = () => pickSize(Number(b.dataset.size)); });
    $('btnYoungYes').onclick = () => answerYoung(true);
    $('btnYoungNo').onclick = () => answerYoung(false);
    document.querySelectorAll('[data-fear]').forEach((b) => { b.onclick = () => finishTeam(false, Number(b.dataset.fear)); });
    $('btnResetTeams').onclick = resetTeams;
    document.querySelectorAll('input[name="camFacing"]').forEach((r) => { r.onchange = () => { conf.facing = r.value; writeLS(LS_CONF, conf); toast(r.value === 'user' ? '앞면 카메라로 찍어요' : '뒷면 카메라로 찍어요'); }; });
    $('chkScreenLight').onchange = (e) => { conf.screenLight = e.target.checked; writeLS(LS_CONF, conf); };
    $('chkFlash').onchange = (e) => { conf.flash = e.target.checked; writeLS(LS_CONF, conf); };
    $('btnOpenCam').onclick = startStudentCamera;
    $('btnShutter').onclick = shoot;
    $('btnCamCancel').onclick = () => { closeCamera(); backFromCamera(); };
    $('btnRetake').onclick = startStudentCamera;
    $('btnStop').onclick = () => finishVideo();
    $('btnScanOk').onclick = () => checkBook($('scanInput').value, true);
    $('scanInput').onkeydown = (e) => { if (e.key === 'Enter') checkBook($('scanInput').value, true); };
    $('btnDone').onclick = goHome;
    $('btnPinCancel').onclick = goHome;
    $('btnAdminExit').onclick = goHome;
    $('btnAdminEnter').onclick = openPin;
    $('btnGuide').onclick = () => { $('guideFrame').src = 'guide.html?embed=1'; $('guideModal').hidden = false; };
    $('btnGuideClose').onclick = () => { $('guideModal').hidden = true; $('guideFrame').src = 'about:blank'; };
    $('adminTabs').onclick = (e) => { const t = e.target.closest('.tab'); if (t) switchTab(t.dataset.tab); };
    $('btnLoadRoster').onclick = async () => {
      conf.apiUrl = $('inApiUrl').value.trim(); conf.apiKey = $('inApiKey').value.trim(); writeLS(LS_CONF, conf);
      setStatus('connStatus', '불러오는 중...');
      if (await loadRoster(false)) { fillStations(); await loadAsset(); }
    };
    $('selStation').onchange = async (e) => {
      conf.stationId = e.target.value; writeLS(LS_CONF, conf);
      $('assetStatus').textContent = '귀신 소재: 확인 중...';
      await loadAsset();
    };
    $('btnStartStudent').onclick = startStudent;
    $('btnUploadAll').onclick = async () => {
      if (!conf.apiUrl) return toast('먼저 구글 시트를 연결하세요');
      if (!navigator.onLine) return toast('인터넷이 끊겨 있어요');
      const r = await uploadPending(true);
      await renderGallery();
      if (r) toast(`드라이브에 ${r.n}개 파일을 올렸어요${r.fail ? ` (실패 ${r.fail})` : ''}`);
    };
    $('btnZip').onclick = exportZip;
    $('btnWipe').onclick = wipe;
    $('btnBgShot').onclick = () => { if (!station()) return toast('장소를 먼저 고르세요'); openCamera('background'); };
    $('btnTestShot').onclick = () => { if (!station()) return toast('장소를 먼저 고르세요'); openCamera('test'); };
    $('btnScreenGhostTest').onclick = () => { if (!station()) return toast('장소를 먼저 고르세요'); screenTestJump = false; sendCue('test', 2); openCamera('screentest'); };
    $('btnCueTest').onclick = async () => {
      if (!station()) return toast('장소를 먼저 고르세요');
      toast('칠판에 신호를 보내는 중...');
      const j = await sendCue('test', 2);
      toast(j && j.ok ? `칠판 신호를 보냈어요. "${station().name}" 칠판에 2~4초 안에 글씨가 써져요.` : j.error === 'key' ? '비밀 키가 맞지 않아요. 연결 탭에서 새 비밀 키를 넣어 주세요.' : j.error === 'action' ? '시트 스크립트가 예전 버전이에요. Code.gs 를 붙여 넣고 새 버전으로 배포해 주세요.' : j.error === 'nokey' ? '먼저 연결 탭에서 비밀 키를 넣어 주세요.' : '인터넷 연결을 확인해 주세요.', 6000);
    };
    $('btnJumpTest').onclick = () => { if (!station()) return toast('장소를 먼저 고르세요'); screenTestJump = true; sendCue('test', 2); if (window.Sfx) Sfx.unlock(); openCamera('screentest'); };
  }

  // ---------- 시작 ----------
  async function boot() {
    applySchoolName();
    bind();
    buildPinPad();
    goHome();
    await loadRoster(true);   // 이름은 메모리로만. 실패하면 저장된 설정(이름 없음)으로 진행
    await loadAsset();
    setTimeout(prefetchNarration, 3000);                 // AI 목소리를 쓰면 이 장소 이야기를 미리 만들어 둔다
    if (!$('scrSetup').hidden && station()) goHome();   // 시트에서 장소를 받아 왔으면 바로 시작 화면으로
    else if (!$('scrHome').hidden) renderHome();
    runEdits();               // 지난번에 못 끝낸 영상 편집 이어서
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
