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
  // ElevenLabs 공개 /v1/voices의 premade 설명 기준. 한국어 말투는 직접 비교한다.
  const EL_VOICES = [
    ['pFZP5JQG7iQjIQuC4Bku', 'Lily · 부드럽고 벨벳 같은 여성 이야기꾼'],
    ['JBFqnCBsd6RMkjVDRZzb', 'George · 따뜻한 울림의 남성 이야기꾼'],
    ['N2lVS1w4EtoT3dr4eOWO', 'Callum · 거칠고 불안한 느낌의 허스키 남성'],
    ['nPczCjzI2devNBz1zQrb', 'Brian · 깊고 울림 있는 편안한 남성'],
    ['pqHfZKP75CvOlQylNhV4', 'Bill · 나이 든 차분한 남성 이야기꾼'],
    ['CwhRBWXzGAHq8TQ4Fs17', 'Roger · 여유롭고 울림 있는 남성'],
    ['XrExE9yKIg1WjnnlVkGX', 'Matilda · 듣기 편한 알토 여성'],
    ['EXAVITQu4vr4xnSDxMaL', 'Sarah · 안심시키는 따뜻한 여성']
  ];
  const EL_DEFAULTS = EL_VOICES.slice(0, 3).map(([id]) => id);
  const EL_SAMPLE = '아무도 없는 복도 끝에서, 분명히 내 이름을 부르는 작은 목소리가 들렸어요.';
  const DEF = {
    '나레이션목소리_너무': EL_DEFAULTS[0], '나레이션목소리_조금': EL_DEFAULTS[1], '나레이션목소리_안무서움': EL_DEFAULTS[2],
    '귀신수_너무': '0', '귀신수_조금': '1', '귀신수_안무서움': '2',
    '은은한소리_너무': '예', '은은한소리_조금': '예', '은은한소리_안무서움': '예',
    '큰소리_너무': '아니오', '큰소리_조금': '아니오', '큰소리_안무서움': '예',
    '깜짝얼굴_너무': '아니오', '깜짝얼굴_조금': '아니오', '깜짝얼굴_안무서움': '예',
    '효과음크기': '0.6', '큰소리크기': '1',
    '구글목소리_너무': 'ko-KR-Neural2-A', '구글목소리_조금': 'ko-KR-Neural2-B', '구글목소리_안무서움': 'ko-KR-Neural2-C',
    '애저목소리_너무': 'ko-KR-SunHiNeural', '애저목소리_조금': 'ko-KR-JiMinNeural', '애저목소리_안무서움': 'ko-KR-SoonBokNeural',
    '공개방식': '즉시', '저학년질문': '예', '무서움질문': '예', '조선정': '자동', '조수': '12', '학교이름': '마동초등학교', '나레이션': '예', '나레이션방식': '태블릿',
    '촬영방식': '미션대로', '자유배치': '예', '쉬는장소': '', '귀신보기': '화면', '놀람촬영': '연사'
  };
  function get(st, k) {
    st = st || {};
    if (st[k] != null && st[k] !== '') return String(st[k]);
    if (k.startsWith('나레이션목소리_') && st['나레이션목소리']) return String(st['나레이션목소리']);
    // 예전 키 호환
    if (k === '귀신수_안무서움' && st['용감한조귀신수']) return String(st['용감한조귀신수']);
    if (k === '은은한소리_안무서움' && st['효과음']) return String(st['효과음']);
    if (k === '큰소리_안무서움' && st['큰소리']) return String(st['큰소리']);
    return DEF[k];
  }
  // 고를 수 있는 목소리 (이름, 설명)
  const VOICES = {
    Google: [['ko-KR-Neural2-A', '여성 A'], ['ko-KR-Neural2-B', '여성 B'], ['ko-KR-Neural2-C', '남성 (Neural2-C)'],
      ['ko-KR-Wavenet-A', '여성 (Wavenet-A)'], ['ko-KR-Wavenet-C', '남성 (Wavenet-C)'], ['ko-KR-Wavenet-D', '남성 (Wavenet-D)'],
      ['ko-KR-Standard-C', '남성 (Standard-C)'], ['ko-KR-Standard-D', '남성 (Standard-D)']],
    Azure: [['ko-KR-SunHiNeural', '여성 선히'], ['ko-KR-JiMinNeural', '여성 지민'], ['ko-KR-YuJinNeural', '여성 유진'], ['ko-KR-SeoHyeonNeural', '여자아이 서현'],
      ['ko-KR-SoonBokNeural', '할머니 순복'], ['ko-KR-InJoonNeural', '남성 인준'], ['ko-KR-HyunsuNeural', '남성 현수'],
      ['ko-KR-BongJinNeural', '남성 봉진'], ['ko-KR-GookMinNeural', '남성 국민']]
  };
  const lv = (fear) => LEVELS[fear == null || fear < 0 || fear > 2 ? 1 : fear].key;
  const yes = (v) => String(v).trim() === '예';
  const num = (v, d, lo, hi) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

  const api = {
    LEVELS, DEF, get,
    ghostCount: (st, fear) => Math.round(num(get(st, '귀신수_' + lv(fear)), 1, 0, 9)),
    softOn: (st, fear) => yes(get(st, '은은한소리_' + lv(fear))),
    loudOn: (st, fear) => yes(get(st, '큰소리_' + lv(fear))),
    /** 화면 귀신 뒤 큰 얼굴 + 큰 소리 */
    jumpOn: (st, fear) => yes(get(st, '깜짝얼굴_' + lv(fear))),
    softVol: (st) => num(get(st, '효과음크기'), 0.6, 0, 1),
    loudVol: (st) => num(get(st, '큰소리크기'), 1, 0, 1),
    /** 모든 장소를 사진 인증샷으로 (영상·연속사진 대신 사진 1장) */
    photoOnly: (st) => get(st, '촬영방식') === '사진',
    /** 빈 배경이 맞지 않으면(들고 찍은 사진) 어두운 곳에 귀신을 자유 배치 */
    freeGhost: (st) => yes(get(st, '자유배치')),
    /** 귀신이 나온 순간 학생 반응 찍기: 끔 · 연사(5장) · 영상 · 둘다 */
    reactMode: (st) => (['끔', '연사', '영상', '둘다'].includes(get(st, '놀람촬영')) ? get(st, '놀람촬영') : '연사'),
    /** 귀신 보이는 방법: 화면 · 사진 · 둘다 */
    ghostView: (st) => (['화면', '사진', '둘다'].includes(get(st, '귀신보기')) ? get(st, '귀신보기') : '화면'),
    /** 이번 행사에서 쓰지 않는 장소 id */
    offIds: (st) => String(get(st, '쉬는장소') || '').split(/[,\s]+/).filter(Boolean),

    /** el 안에 설정 화면을 그린다. onSave(바뀐값) → Promise<새 settings> */
    render(el, st, { onSave, onPreview, onStop, samplePreview = false, stationCount, stations } = {}) {
      if (el.stopIntensityPreview) el.stopIntensityPreview();
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const max = Math.max(1, stationCount || 4);
      const sel = (k) => `<select data-k="${k}">${Array.from({ length: max + 1 }, (_, i) => `<option value="${i}"${String(i) === get(st, k) ? ' selected' : ''}>${i}곳</option>`).join('')}</select>`;
      const chk = (k) => `<label class="int-chk"><input type="checkbox" data-k="${k}"${yes(get(st, k)) ? ' checked' : ''}> 켜기</label>`;
      const rng = (k, name, play) => `<div class="int-vol"><span>${name}</span><input type="range" min="0" max="1" step="0.1" data-k="${k}" value="${esc(get(st, k))}"><b data-v="${k}">${Math.round(num(get(st, k), 0, 0, 1) * 100)}%</b><button type="button" class="int-play" data-play="${play}">▶ 미리 듣기</button></div>`;
      const reveal = get(st, '공개방식');
      el.innerHTML = `
<div class="int">
  <table class="int-t"><tr><th>출발할 때 고른 답</th><th>귀신 나오는 장소</th><th>은은한 소리</th><th>큰 소리</th><th>깜짝 얼굴 (+큰 소리)</th></tr>
  ${LEVELS.map((l) => `<tr><td>${l.label}</td><td>${sel('귀신수_' + l.key)}</td><td>${chk('은은한소리_' + l.key)}</td><td>${chk('큰소리_' + l.key)}</td><td>${chk('깜짝얼굴_' + l.key)}</td></tr>`).join('')}
  </table>
  <p class="int-help">1·2학년 동생이 있다고 한 조는 위 설정과 관계없이 귀신과 소리가 없습니다. 은은한 소리는 촬영 중 몇 초 뒤, 큰 소리는 그 3~6초 뒤에 납니다. 깜짝 얼굴을 켠 조는 카운트다운 끝 무렵 큰 얼굴이 화면 가득 0.7초 나오며 큰 소리가 납니다(이때는 따로 큰 소리를 내지 않음).</p>
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
  <div class="int-row"><span>이야기 읽어 주기</span>
    <label class="int-chk"><input type="checkbox" data-k="나레이션"${yes(get(st, '나레이션')) ? ' checked' : ''}> 나레이션 켜기</label>
  </div>
  <div class="int-row"><span>나레이션 목소리</span>
    ${[['태블릿', '태블릿 음성 (Web Speech · 무료·바로 됨)'], ['ElevenLabs', 'ElevenLabs (무료 요금제 · 감정 표현)'], ['Google', 'Google Cloud TTS (자연스러움)'], ['Azure', 'MS Azure Neural TTS (자연스러움)']].map(([v, t]) => `<label class="int-chk"><input type="radio" name="int-voice" value="${v}"${get(st, '나레이션방식') === v ? ' checked' : ''}> ${t}</label>`).join('')}
  </div>
  ${['Google', 'Azure'].map((prov) => `<div class="int-voices" data-prov="${prov}"${get(st, '나레이션방식') === prov ? '' : ' hidden'}>
    <table class="int-t"><tr><th>${prov} 단계별 목소리</th><th>목소리 (남성·여성)</th></tr>
    ${LEVELS.map((l) => { const k = (prov === 'Google' ? '구글목소리_' : '애저목소리_') + l.key, cur = get(st, k);
      const opts = VOICES[prov].some(([v]) => v === cur) ? VOICES[prov] : VOICES[prov].concat([[cur, cur + ' (직접 입력한 값)']]);
      return `<tr><td>${l.label}</td><td><select data-k="${k}">${opts.map(([v, t]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></td></tr>`; }).join('')}
    </table></div>`).join('')}
  <div class="int-voices" data-prov="ElevenLabs"${get(st, '나레이션방식') === 'ElevenLabs' ? '' : ' hidden'}>
    <table class="int-t"><tr><th>ElevenLabs 단계별 목소리</th><th>Voice ID (목록에서 고르거나 Voice Library 의 ID 붙여넣기)</th></tr>
    ${LEVELS.map((l, i) => `<tr><td>${l.label}<p class="int-help">추천: ${esc(EL_VOICES[i][1])}</p></td><td><input aria-label="${l.label} Voice ID" list="int-el-voices" data-k="나레이션목소리_${l.key}" value="${esc(get(st, '나레이션목소리_' + l.key))}" style="width:100%;max-width:340px;padding:6px 8px;border-radius:7px;border:1px solid #3a3f50;background:#0f1116;color:#fff;font-size:14px"><button type="button" data-el-listen="${i}">이 목소리 바로 듣기</button><button type="button" data-el-default="${i}">추천값 넣기</button></td></tr>`).join('')}
    </table>
    <datalist id="int-el-voices">${EL_VOICES.map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('')}</datalist>
    <div class="int-row"><label>비교할 단계 <select class="int-el-level">${LEVELS.map((l, i) => `<option value="${i}"${i === 1 ? ' selected' : ''}>${l.label}</option>`).join('')}</select></label></div>
    <div class="int-el-candidates">${EL_VOICES.map(([id, name]) => `<div class="int-row"><span>${esc(name)}</span><button type="button" data-el-candidate="${id}">짧게 듣기</button><button type="button" data-el-select="${id}">비교 단계에 선택</button></div>`).join('')}</div>
    <p class="int-help">시험 문장: ${EL_SAMPLE}<br>짧게 듣기는 설정을 저장하지 않습니다. 목소리를 고른 뒤 아래 저장 버튼을 누르세요. 같은 목소리·단계·문장은 재사용합니다. 한국어 발음과 무서운 정도는 직접 비교해 주세요.</p>
    <p class="int-help">기본 목소리는 2026년 3월 이전 가입 계정에 제공되며 2026년 12월 31일 종료 예정입니다. 무료 API에서는 Voice Library 목소리를 쓸 수 없습니다. 이용 가능 여부는 바로 듣기로 확인하세요.</p>
  </div>
  <div class="int-row int-preview"><span>나레이션 미리 듣기</span>
    <select class="int-pv-lv"><option value="0">😱 너무 무서워요 말투</option><option value="1" selected>😬 조금 무서워요 말투</option><option value="2">😎 하나도 안 무서워요 말투</option></select>
    <select class="int-pv-text"><option value="prologue">출발 이야기(프롤로그)</option><option value="station">이 장소 괴담</option></select>
    <button type="button" class="int-pv-play">🔊 미리 듣기</button><button type="button" class="int-pv-stop">■ 멈춤</button>
  </div>
  <p class="int-help">태블릿 음성(Web Speech)의 단계별 목소리는 교사 모드 <b>도구</b> 탭에서 태블릿마다 고릅니다. 남자 목소리는 태블릿에 남성 음성 데이터가 있어야 나옵니다.</p>

  <div class="int-row"><span>촬영 방법</span>
    <label class="int-chk"><input type="radio" name="int-shot" value="미션대로"${get(st, '촬영방식') !== '사진' ? ' checked' : ''}> 미션대로 (스태킹·탁구공은 영상, 동상은 연속사진)</label>
    <label class="int-chk"><input type="radio" name="int-shot" value="사진"${get(st, '촬영방식') === '사진' ? ' checked' : ''}> 모든 장소 사진 인증샷 (5초 카운트다운 뒤 찰칵)</label>
  </div>
  <div class="int-row"><span>귀신 보이는 방법</span>
    ${[['화면', '카메라 화면에만 1초쯤 (찍힌 사진은 그대로)'], ['사진', '찍힌 사진에만 (수정본)'], ['둘다', '화면에도, 사진에도']].map(([v, t]) => `<label class="int-chk"><input type="radio" name="int-gview" value="${v}"${api.ghostView(st) === v ? ' checked' : ''}> ${t}</label>`).join('')}
  </div>
  <div class="int-row"><span>놀라는 장면 찍기</span>
    ${[['끔', '안 찍기'], ['연사', '사진 5장 연사'], ['영상', '영상 (카운트다운 동안)'], ['둘다', '연사 + 영상']].map(([v, t]) => `<label class="int-chk"><input type="radio" name="int-react" value="${v}"${api.reactMode(st) === v ? ' checked' : ''}> ${t}</label>`).join('')}
  </div>
  <p class="int-help">화면에 귀신(깜짝 얼굴을 켠 조는 깜짝 얼굴)이 나온 순간 학생들 모습을 몰래 찍어 원본으로 저장합니다(파일 이름에 "놀람"). 학생 화면에는 보여 주지 않습니다. 영상은 소리도 담으려고 마이크 권한을 물을 수 있어요.</p>
  <div class="int-row"><span>귀신 넣는 방법</span>
    <label class="int-chk"><input type="checkbox" data-k="자유배치"${yes(get(st, '자유배치')) ? ' checked' : ''}> 빈 배경이 없거나 맞지 않으면 어두운 곳에 귀신 그림을 자동으로 놓기 (화면 귀신은 늘 이 방식)</label>
  </div>
  ${stations && stations.length ? `<div class="int-row int-use"><span>이번에 쓰는 장소</span>
    ${stations.map((s) => `<label class="int-chk"><input type="checkbox" data-use="${esc(s.id)}"${api.offIds(st).includes(s.id) ? '' : ' checked'}> ${esc(s.name)}</label>`).join('')}
  </div>
  <p class="int-help">체크를 끈 장소는 귀신 배정과 진행판에서 빠집니다. 동선 안내(다음 장소 단서)는 시트 "장소" 탭의 단서 칸에서 고쳐 주세요.</p>` : ''}

  <div class="int-row int-pin"><span>학교 이름 (첫 화면 푯말)</span>
    <input type="text" data-k="학교이름" maxlength="20" value="${esc(get(st, '학교이름'))}" placeholder="예: 마동초등학교">
  </div>
  <div class="int-row int-pin"><span>교사 모드 비밀번호</span>
    <input type="password" inputmode="numeric" maxlength="8" placeholder="새 비밀번호 (숫자 4~8자리)" class="int-pin1" autocomplete="new-password">
    <input type="password" inputmode="numeric" maxlength="8" placeholder="한 번 더" class="int-pin2" autocomplete="new-password">
    <button type="button" class="int-pinsave">비밀번호 바꾸기</button>
  </div>
  <div class="int-row">
    <button type="button" class="int-save">💾 저장 (모든 태블릿에 적용)</button>
    <button type="button" class="int-shuffle">🔀 귀신 장소 다시 섞기</button>
    <span class="int-msg"></span>
  </div>
</div>`;
      const msg = (t, ok) => { const m = el.querySelector('.int-msg'); m.textContent = t; m.style.color = ok === false ? '#ff9aa8' : ok ? '#9ce6b4' : ''; };
      const voiceInput = (i) => el.querySelector(`[data-k="나레이션목소리_${LEVELS[i].key}"]`);
      const compareLevel = () => Number(el.querySelector('.int-el-level').value);
      el.querySelectorAll('[data-el-default]').forEach((b) => { b.onclick = () => {
        const i = Number(b.dataset.elDefault); voiceInput(i).value = EL_DEFAULTS[i]; msg('추천값을 넣었어요. 적용하려면 저장하세요.');
      }; });
      el.querySelectorAll('[data-el-select]').forEach((b) => { b.onclick = () => {
        voiceInput(compareLevel()).value = b.dataset.elSelect; msg('목소리를 선택했어요. 적용하려면 저장하세요.');
      }; });
      // 태블릿은 onPreview/IndexedDB를 재사용. 진행판의 기존 긴 이야기 콜백은
      // 그대로 두고 동일한 tts 액션과 서버 캐시를 사용한다(teacher.js 수정 범위 밖).
      let sampleAudio = null, sampleUrl = '', sampleToken = 0, sampleBusy = false;
      const sampleCache = new Map();
      const stopSample = () => {
        sampleToken++;
        if (sampleAudio) sampleAudio.pause();
        if (sampleUrl) URL.revokeObjectURL(sampleUrl);
        sampleAudio = null; sampleUrl = '';
      };
      el.stopIntensityPreview = stopSample;
      const shortPreview = async (voice, level) => {
        if (sampleBusy) return;
        if (!/^[a-zA-Z0-9]{20}$/.test(voice)) return msg('Voice ID를 확인하세요(영문·숫자 20자리).', false);
        stopSample(); if (onStop) onStop();
        const token = sampleToken, cacheKey = [voice, level, EL_SAMPLE].join('|');
        const buttons = el.querySelectorAll('[data-el-listen], [data-el-candidate], .int-pv-play');
        sampleBusy = true; buttons.forEach((b) => { b.disabled = true; });
        msg('짧은 문장을 준비하는 중...');
        try {
          let blob = sampleCache.get(cacheKey);
          if (!blob && samplePreview && onPreview) {
            const result = await onPreview({ previewVoice: voice, text: EL_SAMPLE }, level, 'sample');
            if (!result || !result.clip) throw new Error(result && result.error || '시험 음성을 받지 못했어요.');
            blob = result.clip;
            sampleCache.set(cacheKey, blob);
          }
          if (!blob) {
            const teacher = !!document.getElementById('inUrl');
            const connection = JSON.parse(localStorage.getItem(teacher ? 'hg_teacher' : 'hg_conf') || '{}');
            if (!connection.apiUrl || !connection.apiKey) throw new Error('먼저 연결 화면에서 구글 시트 연결을 저장하세요.');
            const response = await fetch(connection.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: JSON.stringify({ key: connection.apiKey, action: 'tts', provider: 'ElevenLabs', level, text: EL_SAMPLE, previewVoice: voice }) });
            const result = await response.json();
            if (!result.ok) throw new Error(result.error || '음성 생성 실패');
            if (result.voice !== voice || result.preview !== true) throw new Error('Code.gs를 새 버전으로 배포한 뒤 다시 시험하세요.');
            blob = new Blob([Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0))], { type: result.mime || 'audio/mpeg' });
            sampleCache.set(cacheKey, blob);
          }
          if (token !== sampleToken || !el.isConnected) return;
          sampleUrl = URL.createObjectURL(blob); sampleAudio = new Audio(sampleUrl);
          sampleAudio.onended = () => { stopSample(); msg('시험이 끝났어요. 마음에 들면 선택 후 저장하세요.', true); };
          await sampleAudio.play();
          if (token === sampleToken) msg('선택한 ElevenLabs 목소리로 짧게 읽고 있어요.', true);
        } catch (e) { if (token === sampleToken) { stopSample(); msg('바로 듣기 실패: ' + e.message, false); } }
        finally { sampleBusy = false; buttons.forEach((b) => { b.disabled = false; }); }
      };
      el.querySelectorAll('[data-el-listen]').forEach((b) => { b.onclick = () => { const i = Number(b.dataset.elListen); shortPreview(voiceInput(i).value.trim(), i); }; });
      el.querySelectorAll('[data-el-candidate]').forEach((b) => { b.onclick = () => shortPreview(b.dataset.elCandidate, compareLevel()); });
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
        el.querySelectorAll('input[type=text][data-k], input[list][data-k]').forEach((t) => { o[t.dataset.k] = t.value.trim() || DEF[t.dataset.k] || ''; });
        const rv = el.querySelector('input[name="int-reveal"]:checked'); if (rv) o['공개방식'] = rv.value;
        const pk = el.querySelector('input[name="int-pick"]:checked'); if (pk) o['조선정'] = pk.value;
        const vc = el.querySelector('input[name="int-voice"]:checked'); if (vc) o['나레이션방식'] = vc.value;
        const sh = el.querySelector('input[name="int-shot"]:checked'); if (sh) o['촬영방식'] = sh.value;
        const gv = el.querySelector('input[name="int-gview"]:checked'); if (gv) o['귀신보기'] = gv.value;
        const rc = el.querySelector('input[name="int-react"]:checked'); if (rc) o['놀람촬영'] = rc.value;
        const use = el.querySelectorAll('input[data-use]');
        if (use.length) o['쉬는장소'] = [...use].filter((c) => !c.checked).map((c) => c.dataset.use).join(',');
        return o;
      };
      const save = async (o, label) => {
        if (!onSave) return;
        msg('저장 중...');
        try { await onSave(o); msg(label || '저장했어요. 태블릿에는 1분 안에 적용돼요.', true); }
        catch (e) { msg('저장 실패: ' + e.message, false); }
      };
      el.querySelectorAll('input[name="int-voice"]').forEach((r) => { r.onchange = () => { el.querySelectorAll('.int-voices').forEach((d) => { d.hidden = d.dataset.prov !== r.value; }); }; });
      el.querySelector('.int-save').onclick = () => save(collect());
      el.querySelector('.int-pv-stop').onclick = () => { stopSample(); if (onStop) onStop(); msg('재생을 멈췄어요.'); };
      el.querySelector('.int-pv-play').onclick = async () => {
        stopSample();
        if (!onPreview) return msg('이 화면에서는 미리 듣기를 할 수 없어요', false);
        const o = collect(), lv = Number(el.querySelector('.int-pv-lv').value), which = el.querySelector('.int-pv-text').value;
        const changed = Object.keys(o).some((k) => /목소리|나레이션방식|속도|높이/.test(k) && String(o[k]) !== String(get(st, k)));
        try {
          if (changed && onSave) { msg('바뀐 목소리 설정을 저장하는 중...'); await onSave(o); st = Object.assign({}, st, o); }
          msg('읽는 중...');
          const r = await onPreview(o, lv, which);
          msg(r && r.error ? r.error : '🔊 ' + (r && r.how ? r.how : '') + ' 목소리로 읽어요', r && r.error ? false : true);
        } catch (e) { msg('미리 듣기 실패: ' + e.message, false); }
      };
      el.querySelector('.int-pinsave').onclick = () => {
        const a = el.querySelector('.int-pin1').value.trim(), b = el.querySelector('.int-pin2').value.trim();
        if (!/^\d{4,8}$/.test(a)) return msg('비밀번호는 숫자 4~8자리로 해 주세요', false);
        if (a !== b) return msg('두 칸의 비밀번호가 달라요', false);
        el.querySelector('.int-pin1').value = ''; el.querySelector('.int-pin2').value = '';
        save({ '관리자PIN': a }, '교사 모드 비밀번호를 바꿨어요. 모든 태블릿에 1분 안에 적용돼요.');
      };
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
.int-pin input{width:190px;padding:8px 10px;border-radius:8px;border:1px solid #3a3f50;background:#0f1116;color:#fff;font-size:15px}
.int-vol{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:8px 0;font-size:14px}.int-vol span{min-width:150px;color:#a9aec0}.int-vol input{width:200px}.int-vol b{min-width:44px}
.int button{border:none;border-radius:9px;padding:8px 14px;font-weight:700;font-size:14px;cursor:pointer;background:linear-gradient(180deg,#ffd98f,#e9a94a);color:#3a2408;font-family:inherit}
.int .int-play,.int .int-shuffle,.int .int-pv-stop{background:#252935;color:#e8eaf0}.int-preview select{padding:7px 8px;border-radius:7px;border:1px solid #3a3f50;background:#0f1116;color:#fff;font-size:14px}.int-msg{font-size:13px}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
})();
