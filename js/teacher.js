/* 진행판 (교사 노트북)
 * - 시트 "기록" 탭을 주기적으로 읽어 조별 진행을 보여준다
 * - 수정이 필요한 영상(편집=대기)을 받아 1초 수정본을 만들고 드라이브에 올린다
 * 학생 이름은 다루지 않는다. 조 번호·인원·1·2학년 여부만 쓴다.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LS = 'hg_teacher';
  let conf = {};
  try { conf = JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) {}
  let roster = null;            // { groups:[{group, size, young, time}], stations, settings }
  let rows = [];                // 기록 탭 줄 (row 번호 = 배열 위치)
  let cursor = 0;
  const editing = { now: null, done: 0, failed: 0, retryAt: {} };

  // ---------- 서버 ----------
  const api = (params) => conf.apiUrl + (conf.apiUrl.includes('?') ? '&' : '?') + new URLSearchParams({ key: conf.apiKey, ...params });
  async function get(params) {
    const r = await fetch(api(params), { cache: 'no-store' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error === 'key' ? '비밀 키가 맞지 않아요' : j.error || '응답 오류');
    return j;
  }
  async function post(body) {
    const r = await fetch(conf.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: conf.apiKey, ...body }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || '응답 오류');
    return j;
  }
  function chip(id, text, cls) { const c = $(id); c.textContent = text; c.className = 'chip' + (cls ? ' ' + cls : ''); }
  function status(id, text, cls) { const c = $(id); c.textContent = text; c.className = 'status' + (cls ? ' ' + cls : ''); }

  // ---------- 귀신 배정 (태블릿 앱과 같은 계산) ----------
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function excludedGroups() {
    const st = roster.settings || {};
    const ex = new Set(String(st['귀신제외조'] || '').split(/[,\s]+/).map(Number).filter(Boolean));
    roster.groups.forEach((g) => { if (g.young || Intensity.ghostCount(roster.settings, g.fear) === 0) ex.add(g.group); });
    return ex;
  }
  /** 태블릿 앱과 같은 계산: 무서움 정도별 강도 설정의 귀신 장소 수 */
  function ghostStationsFor(g, ex) {
    if (ex.has(g.group)) return [];
    const st = roster.settings || {}, seed = String(st['귀신시드'] || '0');
    const list = roster.stations.filter((s) => s.ghost).map((s) => s.id).sort()
      .sort((a, b) => fnv1a(seed + ':' + g.group + ':' + a) - fnv1a(seed + ':' + g.group + ':' + b));
    return list.slice(0, Intensity.ghostCount(st, g.fear));
  }

  // ---------- 불러오기 ----------
  let intensityDrawn = '';
  function drawIntensity() {
    const key = JSON.stringify(roster.settings) + roster.stations.length;
    if (key === intensityDrawn) return;
    const el = $('intensityPanel');
    if (el.contains(document.activeElement)) return;      // 고치는 중에는 다시 그리지 않음
    intensityDrawn = key;
    Intensity.render(el, roster.settings, {
      stationCount: roster.stations.filter((s) => s.ghost).length,
      onSave: async (o) => { const j = await post({ action: 'settings', settings: o }); roster.settings = j.settings; intensityDrawn = JSON.stringify(j.settings) + roster.stations.length; render(); }
    });
  }
  async function loadRoster() {
    roster = await get({ action: 'roster' });
    drawIntensity();
    const sel = $('manStation'), keep = sel.value;
    const opts = roster.stations.filter((s) => s.ghost).map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    if (sel.dataset.opts !== opts) { sel.innerHTML = opts; sel.dataset.opts = opts; if (keep) sel.value = keep; }
  }
  async function loadLog(full) {
    const j = await get({ action: 'log', since: full ? 0 : cursor });
    if (full) rows = [];
    j.rows.forEach((r) => { rows[r.row] = r; });
    cursor = j.next;
  }
  let lastFull = 0;
  async function refresh() {
    if (!conf.apiUrl || !conf.apiKey) return;
    try {
      const full = Date.now() - lastFull > 120000;
      await loadRoster();
      await loadLog(full);
      if (full) lastFull = Date.now();
      chip('chipConn', '연결됨', 'ok');
      chip('chipSync', '갱신 ' + new Date().toLocaleTimeString());
      render();
      pumpEdits();
    } catch (e) {
      chip('chipConn', '연결 오류', 'bad');
      chip('chipSync', e.message);
    }
  }

  // ---------- 화면 ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const attemptKey = (r) => { const m = String(r['파일명']).match(/_(\d{4}-\d{6})(?:_\d\d)?_(원본|수정본)\./); return m ? m[1] : r['기록ID']; };
  function render() {
    if (!roster) return;
    const ex = excludedGroups();
    const list = rows.filter(Boolean);
    const st = roster.stations;
    let h = '<tr><th>조</th><th>인원·출발</th>' + st.map((s) => `<th>${esc(s.name)}</th>`).join('') + '</tr>';
    roster.groups.forEach((g) => {
      const ghostAt = ghostStationsFor(g, ex);
      const FEAR = ['😱', '😬', '😎'];
      const t = g.time ? new Date(g.time) : null;
      const when = t && !isNaN(t) ? `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')} 출발` : '';
      const why = g.young ? '1·2학년' : Intensity.ghostCount(roster.settings, g.fear) === 0 ? '귀신 0곳' : '제외';
      h += `<tr><td><b>${g.group}조</b> ${g.young ? '' : FEAR[g.fear == null ? 1 : g.fear]}${ex.has(g.group) ? `<br><span class="tag x">${why}</span>` : ''}</td><td class="names">${g.size ? g.size + '명' : ''}<br>${when}</td>`;
      st.forEach((s) => {
        const mine = list.filter((r) => Number(r['조']) === g.group && r['장소id'] === s.id);
        const orig = mine.filter((r) => r['구분'] === '원본');
        const edited = mine.filter((r) => r['구분'] === '수정본');
        const attempts = new Map();
        orig.forEach((r) => { const k = attemptKey(r); if (!attempts.has(k)) attempts.set(k, r); });
        const tries = [...attempts.values()];
        const okRow = tries.find((r) => r['결과'] === '성공' || r['결과'] === '');
        const fails = tries.filter((r) => r['결과'] === '실패').length;
        let cell = '';
        if (!tries.length) cell = '<span class="st-none">—</span>';
        else if (okRow) cell = `<span class="st-ok">✅ ${esc(okRow['기록'] && !/번째/.test(okRow['기록']) ? okRow['기록'] : '')}</span>`;
        else cell = `<span class="st-bad">❌</span>`;
        if (fails) cell += `<span class="st-bad" style="font-size:12px">실패 ${fails}회</span>`;
        let tags = '';
        if (ghostAt.includes(s.id)) tags += '<span class="tag g">👻</span> ';
        const vids = orig.filter((r) => r['종류'] === '영상' && r['편집']);
        if (edited.length) tags += '<span class="tag u">★ 수정</span>';
        else if (vids.some((r) => r['편집'] === '대기')) tags += '<span class="tag w">⏳ 수정 대기</span>';
        else if (vids.some((r) => String(r['편집']).startsWith('실패'))) tags += `<span class="tag x" title="${esc(vids.map((r) => r['편집']).join(' / '))}">수정 실패</span>`;
        h += `<td><div class="cell">${cell}<span>${tags}</span></div></td>`;
      });
      h += '</tr>';
    });
    $('progress').innerHTML = h;

    const feed = list.slice(-30).reverse().map((r) => {
      const t = new Date(r['시각']);
      const what = `${r['조']}조 · ${esc(r['장소이름'])} · ${esc(r['종류'])} ${esc(r['구분'])}`;
      const res = [r['결과'], r['기록']].filter(Boolean).map(esc).join(' ');
      return `<li><time>${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}</time>${what}${res ? ' — ' + res : ''}${r['편집'] ? ` <span class="tag ${r['편집'] === '완료' ? 'u' : r['편집'] === '대기' ? 'w' : 'x'}">${esc(r['편집'])}</span>` : ''}</li>`;
    });
    $('feed').innerHTML = feed.join('') || '<li>아직 기록이 없어요</li>';

    const q = pendingEdits();
    $('queue').innerHTML = q.map((r) => `<li>${r['조']}조 · ${esc(r['장소이름'])} · ${esc(r['파일명'])}${editing.now === r['파일ID'] ? ' <b>(편집 중)</b>' : ''}</li>`).join('') || '<li>수정할 영상이 없어요</li>';
    chip('chipEdit', editing.now ? '편집 중' : `편집 대기 ${q.length} · 완료 ${editing.done}${editing.failed ? ' · 실패 ' + editing.failed : ''}`, editing.now ? 'busy' : q.length ? '' : 'ok');
  }

  // ---------- 영상 편집 ----------
  function pendingEdits() {
    return rows.filter((r) => r && r['구분'] === '원본' && r['종류'] === '영상' && r['편집'] === '대기');
  }
  function b64ToBlob(b64, mime) {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'video/mp4' });
  }
  function blobToB64(blob) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => { const s = String(fr.result); res(s.slice(s.indexOf(';base64,') + 8)); }; fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
  }
  function videoDuration(blob) {
    return new Promise((res) => {
      const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true;
      const u = URL.createObjectURL(blob);
      v.onloadedmetadata = () => { const d = v.duration; URL.revokeObjectURL(u); res(Number.isFinite(d) ? d * 1000 : 60000); };
      v.onerror = () => { URL.revokeObjectURL(u); res(60000); };
      v.src = u;
    });
  }
  async function editBlob(blob, stationId, onProgress) {
    const asset = await GhostEngine.loadAsset('ghosts/' + stationId + '/');
    const d = await videoDuration(blob);
    return GhostEngine.editVideo(blob, asset, {
      ghostAtMs: [Math.min(3000, d * 0.2), Math.max(4000, d - 2000)], durationMs: 1000,
      forceRealtime: true, onProgress
    });
  }
  function setBar(p) { $('editBar').style.width = Math.round((p || 0) * 100) + '%'; }

  let pumping = false;
  async function pumpEdits() {
    if (pumping || !$('autoEdit').checked || document.hidden || !window.GhostEngine) return;
    pumping = true;
    try {
      for (;;) {
        const r = pendingEdits().find((x) => !(editing.retryAt[x['파일ID']] > Date.now()));
        if (!r || document.hidden || !$('autoEdit').checked) break;
        editing.now = r['파일ID']; render();
        const label = `${r['조']}조 · ${r['장소이름']}`;
        try {
          status('editNow', `${label} 영상 받는 중...`); setBar(0);
          const f = await get({ action: 'file', id: r['파일ID'] });
          const blob = b64ToBlob(f.data, f.mime);
          status('editNow', `${label} 수정본 만드는 중... (영상 길이의 약 2배 걸려요)`);
          const res = await editBlob(blob, r['장소id'], setBar);
          if (res.applied && res.blob) {
            status('editNow', `${label} 수정본 올리는 중...`);
            const name = String(r['파일명']).replace(/_원본\.(\w+)$/, '_수정본.' + (res.ext || '$1'));
            await post({ action: 'upload', kind: '수정본', filename: name, mime: res.blob.type || res.mime, data: await blobToB64(res.blob),
              meta: { recId: r['기록ID'], group: r['조'], stationId: r['장소id'], stationName: r['장소이름'], media: '영상' } });
            await post({ action: 'edited', fileId: r['파일ID'], status: '완료' });
            r['편집'] = '완료'; editing.done++;
            status('editNow', `${label} 수정본 완료 ✅`, 'ok');
          } else {
            const why = '실패: ' + (res.reason || '알 수 없음');
            await post({ action: 'edited', fileId: r['파일ID'], status: why });
            r['편집'] = why; editing.failed++;
            status('editNow', `${label} 수정 못 함 — ${res.reason}`, 'err');
          }
        } catch (e) {
          // 네트워크 문제 등: 1분 뒤 다시
          editing.retryAt[r['파일ID']] = Date.now() + 60000;
          status('editNow', `${label} 잠시 실패, 1분 뒤 다시 시도 — ${e.message}`, 'err');
        }
        editing.now = null; setBar(0); render();
      }
    } finally { pumping = false; editing.now = null; }
  }

  // ---------- 파일로 직접 편집 ----------
  async function manualEdit() {
    const f = $('manFile').files[0], sid = $('manStation').value;
    if (!f || !sid) return status('manStatus', '장소와 영상 파일을 고르세요', 'err');
    status('manStatus', '수정본 만드는 중...');
    try {
      const res = await editBlob(f, sid, (p) => status('manStatus', `수정본 만드는 중... ${Math.round(p * 100)}%`));
      if (!res.applied) return status('manStatus', '수정 못 함 — ' + res.reason, 'err');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(res.blob);
      a.download = f.name.replace(/_원본\.(\w+)$/, '_수정본.' + res.ext).replace(/^(?!.*_수정본\.)(.*)\.(\w+)$/, '$1_수정본.' + res.ext);
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      status('manStatus', `완료: ${a.download} 를 다운로드 폴더에 저장했어요`, 'ok');
    } catch (e) { status('manStatus', '오류: ' + e.message, 'err'); }
  }

  // ---------- 화면 꺼짐 방지 ----------
  let wake = null;
  async function keepAwake() {
    try { wake = await navigator.wakeLock.request('screen'); chip('chipAwake', '화면 켜짐 유지', 'ok'); }
    catch (e) { chip('chipAwake', '화면 꺼짐 방지 안 됨', 'bad'); }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) chip('chipAwake', '⚠ 탭이 가려져 편집 멈춤', 'bad');
    else { keepAwake(); pumpEdits(); }
  });

  // ---------- 시작 ----------
  $('inUrl').value = conf.apiUrl || '';
  $('inKey').value = conf.apiKey || '';
  $('btnConnect').onclick = async () => {
    conf = { apiUrl: $('inUrl').value.trim(), apiKey: $('inKey').value.trim() };
    try { localStorage.setItem(LS, JSON.stringify(conf)); } catch (e) {}
    status('connStatus', '연결 중...');
    lastFull = 0; cursor = 0; rows = [];
    await refresh();
    if ($('chipConn').classList.contains('ok')) status('connStatus', `연결됨 · 장소 ${roster.stations.length}곳 · 출발한 조 ${roster.groups.length}개`, 'ok');
    else status('connStatus', '연결 실패 — 주소와 비밀 키를 확인하세요', 'err');
    keepAwake();
  };
  $('btnManual').onclick = manualEdit;
  $('autoEdit').onchange = pumpEdits;
  setInterval(refresh, 10000);
  if (conf.apiUrl && conf.apiKey) { refresh().then(() => { if (roster) status('connStatus', `연결됨 · 장소 ${roster.stations.length}곳 · 출발한 조 ${roster.groups.length}개`, 'ok'); }); keepAwake(); }
})();
