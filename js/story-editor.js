/* 이야기 편집 — 태블릿 교사 모드와 노트북 진행판이 함께 쓴다.
 * 프롤로그(무서움 3단계)와 장소별 괴담(제목 + 3단계 문구)을 고쳐 구글 시트에 저장한다.
 * 칸을 비우면 기본 문구(js/stories.js)를 쓴다.
 */
(function () {
  'use strict';
  const LV = [['너무', '😱 너무 무서워요 (1·2학년 조도)'], ['조금', '😬 조금 무서워요'], ['안무서움', '😎 하나도 안 무서워요']];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const D = () => window.HG_STORIES || { prologue: ['', '', ''], byType: {} };

  window.StoryEditor = {
    /** el 에 편집 화면을 그린다. settings: 시트 설정, stations: 장소 목록(storyTitle, stories[3], type 포함), onSave(payload) → Promise */
    render(el, settings, stations, { onSave } = {}) {
      settings = settings || {}; stations = stations || [];
      const ta = (key, val, ph) => `<textarea data-key="${esc(key)}" rows="3" placeholder="${esc(ph)}">${esc(val)}</textarea>`;
      const pro = LV.map(([k, label], i) => `<label class="se-lv">${label}${ta('p:' + i, settings['프롤로그_' + k] || '', '비우면 기본: ' + (D().prologue[i] || ''))}</label>`).join('');
      const st = stations.map((s) => {
        const def = D().byType[(s.type || '').trim()] || { title: '', text: ['', '', ''] };
        const stories = s.stories || ['', '', ''];
        return `<details class="se-st"><summary>${esc(s.name)} <small>${esc(s.storyTitle || def.title || '')}</small></summary>
          <label class="se-lv">괴담 제목<input data-key="t:${esc(s.id)}" value="${esc(s.storyTitle || '')}" placeholder="${esc('비우면 기본: ' + (def.title || ''))}"></label>
          ${LV.map(([, label], i) => `<label class="se-lv">${label}${ta('s:' + s.id + ':' + i, stories[i] || '', '비우면 기본: ' + (def.text[i] || '').replace(/\{장소\}/g, s.name))}</label>`).join('')}
        </details>`;
      }).join('');
      el.innerHTML = `<div class="se">
        <p class="se-help">칸을 비워 두면 기본 문구가 나옵니다(흐린 글씨). 사진·영상 촬영을 암시하는 말은 넣지 않는 게 좋아요.</p>
        <h4>출발할 때 이야기 (프롤로그)</h4>${pro}
        <h4>장소별 괴담</h4>${st || '<p class="se-help">장소 목록을 먼저 불러오세요.</p>'}
        <div class="se-row"><button type="button" class="se-save">💾 이야기 저장 (모든 태블릿에 적용)</button><span class="se-msg"></span></div>
      </div>`;
      const msg = (t, ok) => { const m = el.querySelector('.se-msg'); m.textContent = t; m.style.color = ok === false ? '#ff9aa8' : ok ? '#9ce6b4' : ''; };
      el.querySelector('.se-save').onclick = async () => {
        if (!onSave) return;
        const payload = { prologue: ['', '', ''], stations: {} };
        el.querySelectorAll('[data-key]').forEach((f) => {
          const [kind, a, b] = f.dataset.key.split(':'), v = f.value.trim();
          if (kind === 'p') payload.prologue[Number(a)] = v;
          else {
            const o = payload.stations[a] || (payload.stations[a] = { title: '', texts: ['', '', ''] });
            if (kind === 't') o.title = v; else o.texts[Number(b)] = v;
          }
        });
        msg('저장 중...');
        try { await onSave(payload); msg('저장했어요. 태블릿에는 1분 안에 적용돼요.', true); }
        catch (e) { msg('저장 실패: ' + e.message + ' (시트 스크립트를 새 버전으로 배포했는지 확인하세요)', false); }
      };
    }
  };
  const css = `.se h4{margin:14px 0 6px;font-size:15px;color:#ffcf7a}.se-help{font-size:13px;color:#a9aec0;margin:4px 0 8px}
.se-lv{display:block;font-size:13px;color:#c3c7d4;margin:8px 0}.se textarea,.se input{display:block;width:100%;margin-top:4px;padding:9px 11px;border-radius:8px;border:1px solid #3a3f50;background:#0f1116;color:#fff;font:15px/1.5 'Malgun Gothic',sans-serif;resize:vertical;user-select:text;-webkit-user-select:text}
.se textarea::placeholder,.se input::placeholder{color:#6d7285}.se-st{border:1px solid #2e3240;border-radius:10px;padding:8px 12px;margin:8px 0;background:#181b22}
.se-st summary{cursor:pointer;font-weight:700;color:#e8eaf0}.se-st summary small{color:#a9aec0;font-weight:400;margin-left:6px}
.se-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}.se-save{border:none;border-radius:9px;padding:9px 16px;font-weight:700;font-size:14px;cursor:pointer;background:linear-gradient(180deg,#ffd98f,#e9a94a);color:#3a2408}.se-msg{font-size:13px}`;
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
})();
