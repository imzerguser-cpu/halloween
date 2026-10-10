/* 무서움 강도 설정 — 태블릿 교사 모드와 노트북 진행판이 함께 쓴다.
 * 값은 구글 시트 "설정" 탭에 저장되고 모든 태블릿이 따른다.
 * window.Intensity.ghostCount / softOn / loudOn 으로 조의 무서움 정도(0 너무·1 조금·2 안 무서움)에 맞는 값을 얻는다.
 */
(function () {
  'use strict';
  const LEVELS = [
    { key: '너무', label: '😱 너무 무서워요' },
    { key: '조금', label: '😬 조금 무서워요' },
    { key: '안무서움', label: '😎 하나도 안 무서워요' }
  ];
  const DEF = {
    '귀신수_너무': '0', '귀신수_조금': '1', '귀신수_안무서움': '2',
    '은은한소리_너무': '아니오', '은은한소리_조금': '아니오', '은은한소리_안무서움': '예',
    '큰소리_너무': '아니오', '큰소리_조금': '아니오', '큰소리_안무서움': '예',
    '효과음크기': '0.6', '큰소리크기': '1',
    '공개방식': '즉시', '저학년질문': '예', '무서움질문': '예', '조선정': '자동', '조수': '12'
  };
  function get(st, k) {
    st = st || {};
    if (st[k] != null && st[k] !== '') return String(st[k]);
    // 예전 키 호환
    if (k === '귀신수_안무서움' && st['용감한조귀신수']) return String(st['용감한조귀신수']);
    if (k === '은은한소리_안무서움' && st['효과음']) return String(st['효과음']);
    if (k === '큰소리_안무서움' && st['큰소리']) return String(st['큰소리']);
    return DEF[k];
  }
  const lv = (fear) => LEVELS[fear == null || fear < 0 || fear > 2 ? 1 : fear].key;
  const yes = (v) => String(v).trim() === '예';
  const num = (v, d, lo, hi) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

  const api = {
    LEVELS, DEF, get,
    ghostCount: (st, fear) => Math.round(num(get(st, '귀신수_' + lv(fear)), 1, 0, 9)),
    softOn: (st, fear) => yes(get(st, '은은한소리_' + lv(fear))),
    loudOn: (st, fear) => yes(get(st, '큰소리_' + lv(fear))),
    softVol: (st) => num(get(st, '효과음크기'), 0.6, 0, 1),
    loudVol: (st) => num(get(st, '큰소리크기'), 1, 0, 1),

    /** el 안에 설정 화면을 그린다. onSave(바뀐값) → Promise<새 settings> */
    render(el, st, { onSave, stationCount } = {}) {
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const max = Math.max(1, stationCount || 4);
      const sel = (k) => `<select data-k="${k}">${Array.from({ length: max + 1 }, (_, i) => `<option value="${i}"${String(i) === get(st, k) ? ' selected' : ''}>${i}곳</option>`).join('')}</select>`;
      const chk = (k) => `<label class="int-chk"><input type="checkbox" data-k="${k}"${yes(get(st, k)) ? ' checked' : ''}> 켜기</label>`;
      const rng = (k, name, play) => `<div class="int-vol"><span>${name}</span><input type="range" min="0" max="1" step="0.1" data-k="${k}" value="${esc(get(st, k))}"><b data-v="${k}">${Math.round(num(get(st, k), 0, 0, 1) * 100)}%</b><button type="button" class="int-play" data-play="${play}">▶ 미리 듣기</button></div>`;
      const reveal = get(st, '공개방식');
      el.innerHTML = `
<div class="int">
  <table class="int-t"><tr><th>출발할 때 고른 답</th><th>귀신 나오는 장소</th><th>은은한 소리</th><th>큰 소리</th></tr>
  ${LEVELS.map((l) => `<tr><td>${l.label}</td><td>${sel('귀신수_' + l.key)}</td><td>${chk('은은한소리_' + l.key)}</td><td>${chk('큰소리_' + l.key)}</td></tr>`).join('')}
  </table>
  <p class="int-help">1·2학년 동생이 있다고 한 조는 위 설정과 관계없이 귀신과 소리가 없습니다. 은은한 소리는 촬영 중 몇 초 뒤, 큰 소리는 그 3~6초 뒤에 납니다.</p>
  ${rng('효과음크기', '은은한 소리 크기', 'soft')}
  ${rng('큰소리크기', '큰 소리 크기', 'loud')}
  <div class="int-row"><span>찍은 뒤 학생에게 보여 주기</span>
    ${[['즉시', '수정본 바로 보여 주기'], ['원본', '원본만 보여 주기'], ['숨김', '사진 안 보여 주기']].map(([v, t]) => `<label class="int-chk"><input type="radio" name="int-reveal" data-k="공개방식" value="${v}"${reveal === v ? ' checked' : ''}> ${t}</label>`).join('')}
  </div>
  <div class="int-row"><span>조 정하는 방법</span>
    <label class="int-chk"><input type="radio" name="int-pick" data-k="조선정" value="자동"${get(st, '조선정') !== '선택' ? ' checked' : ''}> 자동 번호 (출발 장소에서 1조, 2조… / 다른 장소는 순서대로)</label>
    <label class="int-chk"><input type="radio" name="int-pick" data-k="조선정" value="선택"${get(st, '조선정') === '선택' ? ' checked' : ''}> 조 번호 직접 고르기 (장소마다 번호 누르기)</label>
    <label class="int-chk">조 수 <select data-k="조수">${Array.from({ length: 30 }, (_, i) => i + 1).map((n) => `<option value="${n}"${String(n) === get(st, '조수') ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
  </div>
  <div class="int-row"><span>출발할 때 묻기</span>
    <label class="int-chk"><input type="checkbox" data-k="저학년질문"${yes(get(st, '저학년질문')) ? ' checked' : ''}> 1·2학년 동생 있나요?</label>
    <label class="int-chk"><input type="checkbox" data-k="무서움질문"${yes(get(st, '무서움질문')) ? ' checked' : ''}> 지금 얼마나 무서워요?</label>
  </div>
  <div class="int-row">
    <button type="button" class="int-save">💾 저장 (모든 태블릿에 적용)</button>
    <button type="button" class="int-shuffle">🔀 귀신 장소 다시 섞기</button>
    <span class="int-msg"></span>
  </div>
</div>`;
      const msg = (t, ok) => { const m = el.querySelector('.int-msg'); m.textContent = t; m.style.color = ok === false ? '#ff9aa8' : ok ? '#9ce6b4' : ''; };
      el.querySelectorAll('input[type=range]').forEach((r) => { r.oninput = () => { el.querySelector(`[data-v="${r.dataset.k}"]`).textContent = Math.round(r.value * 100) + '%'; }; });
      el.querySelectorAll('[data-play]').forEach((b) => {
        b.onclick = () => {
          if (!window.Sfx) return msg('소리 기능을 불러오지 못했어요', false);
          Sfx.unlock();
          const k = b.dataset.play === 'loud' ? '큰소리크기' : '효과음크기';
          const v = parseFloat(el.querySelector(`input[data-k="${k}"]`).value);
          b.dataset.play === 'loud' ? Sfx.loud(null, v) : Sfx.play(null, v);
        };
      });
      const collect = () => {
        const o = {};
        el.querySelectorAll('select[data-k]').forEach((s) => { o[s.dataset.k] = s.value; });
        el.querySelectorAll('input[type=checkbox][data-k]').forEach((c) => { o[c.dataset.k] = c.checked ? '예' : '아니오'; });
        el.querySelectorAll('input[type=range][data-k]').forEach((r) => { o[r.dataset.k] = String(r.value); });
        const rv = el.querySelector('input[name="int-reveal"]:checked'); if (rv) o['공개방식'] = rv.value;
        const pk = el.querySelector('input[name="int-pick"]:checked'); if (pk) o['조선정'] = pk.value;
        return o;
      };
      const save = async (o, label) => {
        if (!onSave) return;
        msg('저장 중...');
        try { await onSave(o); msg(label || '저장했어요. 태블릿에는 1분 안에 적용돼요.', true); }
        catch (e) { msg('저장 실패: ' + e.message, false); }
      };
      el.querySelector('.int-save').onclick = () => save(collect());
      let armed = 0;
      el.querySelector('.int-shuffle').onclick = () => {
        if (Date.now() - armed > 4000) { armed = Date.now(); return msg('이미 출발한 조의 귀신 장소도 바뀌어요. 4초 안에 한 번 더 누르세요.'); }
        armed = 0;
        save({ '귀신시드': String(Math.floor(Math.random() * 1e9)) }, '귀신 장소를 새로 섞었어요.');
      };
    }
  };
  window.Intensity = api;

  // 두 화면에서 같이 쓰는 모양
  const css = `.int-t{width:100%;border-collapse:collapse;font-size:14px;margin-bottom:8px}.int-t th,.int-t td{padding:7px 8px;border-bottom:1px solid #2e3240;text-align:left}
.int-t th{color:#a9aec0;font-weight:700}.int select{padding:6px 8px;border-radius:7px;border:1px solid #3a3f50;background:#0f1116;color:#fff;font-size:15px;width:auto}
.int-chk{display:inline-flex;align-items:center;gap:5px;margin-right:12px;font-size:14px;color:#e8eaf0;cursor:pointer}.int-chk input{width:auto}
.int-help{font-size:13px;color:#a9aec0;margin:6px 0 12px}.int-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:12px 0}.int-row>span:first-child{font-size:14px;color:#a9aec0;min-width:150px}
.int-vol{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:8px 0;font-size:14px}.int-vol span{min-width:150px;color:#a9aec0}.int-vol input{width:200px}.int-vol b{min-width:44px}
.int button{border:none;border-radius:9px;padding:8px 14px;font-weight:700;font-size:14px;cursor:pointer;background:linear-gradient(180deg,#ffd98f,#e9a94a);color:#3a2408;font-family:inherit}
.int .int-play,.int .int-shuffle{background:#252935;color:#e8eaf0}.int-msg{font-size:13px}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
})();
