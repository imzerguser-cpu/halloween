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
  const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbymj5VOiN61_FIOvXO8tApwiUPoXAZ7hUUnIZRtvzyYd1gO8XSOQvJU-IGMGmJ74lq4gA/exec';
  let conf = readLS(LS_CONF) || {};
  if (!conf.apiUrl) conf.apiUrl = DEFAULT_API_URL;
  let cache = readLS(LS_CACHE) || { stations: [], settings: {} };
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
  const SCREENS = ['scrSetup', 'scrHome', 'scrTeam', 'scrMission', 'scrCamera', 'scrSaving', 'scrResult', 'scrPin', 'scrAdmin'];
  function show(id) {
    SCREENS.forEach((s) => { $(s).hidden = s !== id; });
    window.scrollTo(0, 0);
  }
  function goHome() {
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
    return cache.stations.filter((s) => s.ghost).map((s) => s.id).sort();
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
  const loudVol = () => (window.Intensity ? Intensity.loudVol(cache.settings) : 1);
  /** 은은한 소리로 긴장시키고, 큰 소리가 켜져 있으면 3~6초 뒤 쾅! */
  function scheduleSpook(minMs, maxMs, name) {
    clearTimeout(spookTimer); clearTimeout(loudTimer);
    const soft = sfxOn(), loud = loudOn();
    if (!soft && !loud) return;
    const at = minMs + Math.random() * Math.max(0, maxMs - minMs);
    if (soft) spookTimer = setTimeout(() => { if (stream) Sfx.play(name, sfxVol()); }, at);
    if (loud) loudTimer = setTimeout(() => { if (stream) Sfx.loud(null, loudVol()); }, soft ? at + 3000 + Math.random() * 3000 : at);
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
      cache = { stations: j.stations, settings: j.settings, fetchedAt: j.fetchedAt };
      writeLS(LS_CACHE, cache);
      mergeOrder(j.groups || []);
      if (!silent) setStatus('connStatus', `불러옴: 장소 ${j.stations.length}곳, 출발한 조 ${Object.keys(teams).length}개 (${new Date().toLocaleTimeString()})`, 'ok');
      return true;
    } catch (e) {
      setStatus('connStatus', '불러오기 실패: ' + e.message + (cache.fetchedAt ? ' — 저장된 설정으로 진행합니다' : ''), 'err');
      return false;
    }
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
  async function uploadPending(report) {
    if (uploading || !conf.apiUrl || !conf.apiKey || !navigator.onLine) return 0;
    uploading = true;
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
    return { n, fail };
  }
  const needsUpload = (r) => !r.hold && (!r.up.orig || (r.composite && !r.up.comp));
  // 시트 "기록" 탭에 남길 정보 (이름 없음 — 조 번호만)
  function uploadMeta(rec, isOriginal) {
    const record = rec.timeMs != null ? (rec.timeMs / 1000).toFixed(1) + '초'
      : rec.count != null ? `공 ${rec.count}개` : rec.seq ? `${rec.seq}번째` : '';
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
    return `${rec.group}조_${rec.stationName}_${t}${seq}_${kind}.${rec.ext || 'jpg'}`;
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
    const nums = all || !known.length ? Array.from({ length: teamCount() }, (_, i) => i + 1) : known;
    nums.forEach((g) => {
      const b = document.createElement('button');
      b.className = 'gbtn' + (v.has(teamTag(g)) ? ' done' : '');
      b.innerHTML = `${g}<small>조</small>`;
      b.onclick = () => (pickMode() && isStartStation() ? openTeamSetup(g) : startTeam(g));
      grid.appendChild(b);
    });
    $('homeGrid').hidden = false;
  }
  function startTeam(g) {
    if (pickMode() && !teams[g]) loadOrder();          // 출발 장소에서 등록한 정보(저학년·무서움)를 받아 둔다
    clearInterval(orderTimer);
    cur.group = g;
    markVisited(g);
    openMission();
  }

  // 출발 장소: 인원 → (1·2학년?) → 조 번호 안내 → 미션
  let teamDraft = {};
  function openTeamSetup(fixed) {
    teamDraft = { fixed: fixed || null };
    $('teamAskSize').hidden = false; $('teamAskYoung').hidden = true; $('teamAskFear').hidden = true; $('teamDone').hidden = true;
    show('scrTeam');
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
    $('teamAskSize').hidden = true; $('teamAskYoung').hidden = true; $('teamDone').hidden = false;
    $('teamNum').textContent = g + '조';
    $('teamSizeText').textContent = `${teamDraft.size}명`;
    await sleep(2200);
    if (!$('scrTeam').hidden) openMission();
  }

  // 장소 유형: 사진(기본) · 스태킹(영상+제한시간) · 탁구공(영상+개수 입력) · 책찾기(바코드→사진) · 연속사진(10초 뒤 여러 장)
  const TYPE = {
    '사진': { btn: '📸 사진 찍으러 가기', lead: '미션을 성공한 순간을 사진으로 남겨요!' },
    '스태킹': { btn: '🎬 영상 찍으러 가기', lead: '시작을 누르면 시간이 흘러요. 다 쌓고 내리면 "끝!"을 눌러요!' },
    '탁구공': { btn: '🎬 영상 찍으러 가기', lead: '공을 던지는 모습을 영상으로 남겨요!' },
    '책찾기': { btn: '🔍 찾은 책 바코드 찍기', lead: '책을 찾으면 바코드를 찍어 확인해요!' },
    '연속사진': { btn: '📸 인증사진 찍으러 가기', lead: '버튼을 누르고 10초 안에 자리를 잡아요!' }
  };
  const stType = () => { const t = String(station().type || '사진').trim(); return TYPE[t] ? t : '사진'; };
  const stValue = (d) => { const v = parseFloat(station().value); return Number.isFinite(v) && v > 0 ? v : d; };
  const wantGhostHere = () => { const s = station(); return !!(s.ghost && ghostStationsFor(cur.group).includes(s.id)); };

  function openMission() {
    const s = station(), t = stType();
    $('misStation').textContent = '📜 ' + s.name + ' 미션';
    $('misText').textContent = s.mission || '미션 성공 장면을 사진으로 찍어요!';
    $('misGroup').textContent = cur.group + '조';
    $('misLead').textContent = TYPE[t].lead;
    $('btnOpenCam').textContent = TYPE[t].btn;
    show('scrMission');
  }
  function startStudentCamera() {
    const t = stType();
    openCamera(t === '스태킹' || t === '탁구공' ? 'video' : t === '책찾기' ? 'scan' : t === '연속사진' ? 'burst' : 'student');
  }

  // ---------- 카메라 ----------
  const STUDENT_MODES = ['student', 'video', 'scan', 'burst'];
  async function openCamera(mode) {
    camMode = mode;
    const s = station();
    $('camTop').textContent = mode === 'background' ? '빈 배경 촬영 — 사람이 없게 해 주세요'
      : mode === 'test' ? '귀신 합성 시험 촬영'
      : mode === 'scan' ? `${cur.group}조 · ${s.name} · 책 확인`
      : `${cur.group}조 · ${s.name}`;
    $('camRec').hidden = true; $('camBurst').hidden = true; $('btnStop').hidden = true;
    $('camScan').hidden = mode !== 'scan';
    $('btnShutter').hidden = mode === 'scan';
    $('btnCamCancel').hidden = false;
    $('camTimerLabel').hidden = mode !== 'student';
    show('scrCamera');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: mode === 'video',
        video: mode === 'video'
          ? { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      const v = $('camVideo'); v.srcObject = stream; await v.play();
    } catch (e) {
      closeCamera();
      toast('카메라를 열 수 없어요. 선생님께 알려 주세요.', 4000);
      return backFromCamera();
    }
    if (mode === 'scan') startScan();
    if (['student', 'burst', 'scan'].includes(mode)) scheduleSpook(3000, 6000);
  }
  function closeCamera() {
    stopScan();
    clearTimeout(spookTimer); clearTimeout(loudTimer);
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
  const canvasToBlob = (c, q) => new Promise((res) => c.toBlob(res, 'image/jpeg', q || 0.92));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const newId = () => Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  function flash() { const fl = $('camFlash'); fl.classList.add('on'); setTimeout(() => fl.classList.remove('on'), 60); }
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
      if ($('camTimer').checked && camMode === 'student') await countdown(3);
      const frame = grabFrame();
      flash();
      closeCamera();
      if (camMode === 'background') await saveBackground(frame);
      else if (camMode === 'test') await testComposite(frame);
      else await saveStudentPhoto(frame);
    } finally { if (!recorder) shooting = false; }
  }

  async function compose(frame) {
    if (!asset || !window.GhostEngine) return { blob: null, applied: false, reason: assetState };
    try { return await GhostEngine.composite(frame, asset, { quality: 0.92 }); }
    catch (e) { return { blob: null, applied: false, reason: 'error: ' + e.message }; }
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
    if (wantGhostHere()) {
      const r = await compose(frame);
      if (r.applied && r.blob) { rec.composite = r.blob; rec.ghost = true; rec.reason = ''; } else rec.reason = r.reason || 'not-applied';
    }
    await saveRecords([rec]);
    await minWait(t0, 1800); // 너무 빨리 끝나면 어색하므로 최소 대기
    showResult({ recs: [rec] });
  }

  // 연속사진: 10초 뒤 n장 (0.5초 간격), 귀신은 그중 한 장
  async function shootBurst() {
    const n = Math.min(20, Math.round(stValue(10)));
    $('btnShutter').hidden = true; $('btnCamCancel').hidden = true;
    await countdown(10, 1000);
    const frames = [];
    $('camBurst').hidden = false;
    for (let i = 0; i < n; i++) {
      frames.push(grabFrame()); flash();
      $('camBurst').textContent = `📸 ${i + 1} / ${n}`;
      if (i < n - 1) await sleep(500);
    }
    $('camBurst').hidden = true; $('btnShutter').hidden = false; $('btnCamCancel').hidden = false;
    closeCamera();
    show('scrSaving'); setSaving('사진을 저장하고 있어요...', 0);
    const t0 = Date.now(), takenAt = Date.now();
    const recs = [];
    for (let i = 0; i < n; i++) recs.push(baseRecord({ takenAt, seq: i + 1, original: await canvasToBlob(frames[i]), reason: 'not-assigned' }));
    if (wantGhostHere()) {
      // 앞쪽 몇 장은 비우고, 가운데~뒤쪽 중 무작위 한 장부터 차례로 시도
      const order = [];
      for (let i = Math.min(3, n - 1); i < n; i++) order.push(i);
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
    const limitMs = t === '스태킹' ? stValue(60) * 1000 : 60000;
    $('btnShutter').hidden = true; $('btnCamCancel').hidden = true;
    await countdown(3);
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
    scheduleSpook(3000, Math.max(3500, Math.min(9000, limitMs - 2000)));   // 녹화 중에 나서 영상에도 담긴다
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
  document.addEventListener('visibilitychange', () => { if (document.hidden && recorder) finishVideo(); });

  let finishing = false;
  async function finishVideo() {
    if (finishing || !recorder) return;
    finishing = true;
    clearInterval(recTimer); clearTimeout(recLimit);
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
      if (wantGhostHere()) {
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
    let title = '🎉 미션 성공!', msg = res.video ? '영상이 저장됐어요' : '사진이 저장됐어요', success = true;

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
  let tapCount = 0, tapTimer = null;
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
    if (name === 'tools') renderDiag();
    if (name === 'level') renderIntensity();
  }

  function renderIntensity() {
    if (!window.Intensity) return;
    Intensity.render($('intensityPanel'), cache.settings, {
      stationCount: ghostStations().length,
      onSave: async (o) => {
        if (!conf.apiUrl || !conf.apiKey) throw new Error('먼저 구글 시트를 연결하세요');
        const r = await fetch(conf.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ key: conf.apiKey, action: 'settings', settings: o }) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || '응답 오류');
        cache.settings = j.settings; writeLS(LS_CACHE, cache);
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
      const info = (r.kind === 'video' ? '🎬 ' : '') + (r.seq ? `#${r.seq} ` : '') +
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
    $('btnNextGo').onclick = () => { const g = nextTeam(); if (g) startTeam(g); };
    $('btnOtherTeam').onclick = showTeamGrid;
    document.querySelectorAll('[data-size]').forEach((b) => { b.onclick = () => pickSize(Number(b.dataset.size)); });
    $('btnYoungYes').onclick = () => answerYoung(true);
    $('btnYoungNo').onclick = () => answerYoung(false);
    document.querySelectorAll('[data-fear]').forEach((b) => { b.onclick = () => finishTeam(false, Number(b.dataset.fear)); });
    $('btnResetTeams').onclick = resetTeams;
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
  }

  // ---------- 시작 ----------
  async function boot() {
    bind();
    buildPinPad();
    goHome();
    await loadRoster(true);   // 이름은 메모리로만. 실패하면 저장된 설정(이름 없음)으로 진행
    await loadAsset();
    if (!$('scrSetup').hidden && station()) goHome();   // 시트에서 장소를 받아 왔으면 바로 시작 화면으로
    else if (!$('scrHome').hidden) renderHome();
    runEdits();               // 지난번에 못 끝낸 영상 편집 이어서
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
