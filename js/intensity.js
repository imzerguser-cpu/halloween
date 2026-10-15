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
    '은은한소리_너무': '예', '은은한소리_조금': '예', '은은한소리_안무서움': '예',
    '큰소리_너무': '아니오', '큰소리_조금': '예', '큰소리_안무서움': '예',
    '깜짝얼굴_너무': '아니오', '깜짝얼굴_조금': '아니오', '깜짝얼굴_안무서움': '예',
    '칠판글씨_너무': '예', '칠판글씨_조금': '예', '칠판글씨_안무서움': '예',
    '효과음크기': '0.6', '큰소리크기': '1',
    '구글목소리_너무': 'ko-KR-Neural2-A', '구글목소리_조금': 'ko-KR-Neural2-B', '구글목소리_안무서움': 'ko-KR-Neural2-C',
    '애저목소리_너무': 'ko-KR-SunHiNeural', '애저목소리_조금': 'ko-KR-JiMinNeural', '애저목소리_안무서움': 'ko-KR-SoonBokNeural',
    '공개방식': '즉시', '저학년질문': '예', '무서움질문': '예', '조선정': '자동', '조수': '12', '학교이름': '마동초등학교', '나레이션': '예', '나레이션방식': '태블릿',
    '운영방식': '코스', '촬영방식': '미션대로', '자유배치': '예', '쉬는장소': '', '귀신보기': '화면', '놀람촬영': '연사', '칠판녹화': '예', '칠판장소': 'class1'
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

  // 소리 목록: [이름, 화면 표시]. line: 으로 시작하면 목소리 대사
  const SOFT_LIST = [['steps2', '발자국'], ['rustle2', '옷깃 스치는 소리'], ['drag2', '발 끄는 소리'], ['desk2', '책상 끌리는 소리'], ['door2', '문 열리는 소리'], ['wind2', '바람 소리'], ['murmur2', '소곤소곤 속삭임'],
    ['line:나랑 같이 놀자…', '"나랑 같이 놀자…"'], ['line:무서워…', '"무서워…"'], ['line:외로워…', '"외로워…"'], ['line:쉿…', '"쉿…"']];
  const LOUD_LIST = [['laughW', '여자 웃음소리'], ['laughM', '아저씨 웃음소리'], ['babyCry', '아기 울음소리'], ['catCry', '고양이 울음소리'], ['girlCry', '여자아이 울음소리'],
    ['scream', '여자 비명'], ['scream2', '여자아이 비명'], ['laugh', '여자아이 킥킥 웃음']];
  const api = {
    LEVELS, DEF, get, SOFT_LIST, LOUD_LIST,
    ghostCount: (st, fear) => Math.round(num(get(st, '귀신수_' + lv(fear)), 1, 0, 9)),
    softOn: (st, fear) => yes(get(st, '은은한소리_' + lv(fear))),
    loudOn: (st, fear) => yes(get(st, '큰소리_' + lv(fear))),
    /** 전자칠판 분필 글씨 (1·2학년 조는 '너무' 단계 설정을 따른다) */
    boardOn: (st, fear) => yes(get(st, '칠판글씨_' + lv(fear == null ? 0 : fear))),
    /** 화면 귀신 뒤 큰 얼굴 + 큰 소리 */
    jumpOn: (st, fear) => yes(get(st, '깜짝얼굴_' + lv(fear))),
    softVol: (st) => num(get(st, '효과음크기'), 0.6, 0, 1),
    loudVol: (st) => num(get(st, '큰소리크기'), 1, 0, 1),
    /** 모든 장소를 사진 인증샷으로 (영상·연속사진 대신 사진 1장) */
    photoOnly: (st) => get(st, '촬영방식') === '사진' || get(st, '운영방식') !== '미션',
    /** 장소별 인증샷 투어(기본) / 미션(예전 방식) */
    tourOn: (st) => get(st, '운영방식') !== '미션',
    /** 빈 배경이 맞지 않으면(들고 찍은 사진) 어두운 곳에 귀신을 자유 배치 */
    freeGhost: (st) => yes(get(st, '자유배치')),
    /** 칠판 글씨가 나오는 장소(칠판장소)에서 카메라를 켜면 학생 반응을 영상으로 */
    boardRecAt: (st, id) => yes(get(st, '칠판녹화')) && String(get(st, '칠판장소') || '').split(/[,\s]+/).includes(id),
    /** 귀신이 나온 순간 학생 반응 찍기: 끔 · 연사(5장) · 영상 · 둘다 */
    reactMode: (st) => (['끔', '연사', '영상', '둘다'].includes(get(st, '놀람촬영')) ? get(st, '놀람촬영') : '연사'),
    /** 귀신 보이는 방법: 화면 · 사진 · 둘다 */
    ghostView: (st) => (['화면', '사진', '둘다'].includes(get(st, '귀신보기')) ? get(st, '귀신보기') : '화면'),
    /** 이번 행사에서 쓰지 않는 장소 id */
    offIds: (st) => (window.HG_TOUR && HG_TOUR.modeOf(st) === '코스' ? [] : String(get(st, '쉬는장소') || '').split(/[,\s]+/).filter(Boolean)),   // 마동 코스는 코스 장소 목록이 곧 쓰는 장소

    /** el 안에 설정 화면을 그린다. onSave(바뀐값) → Promise<새 settings> */
    render(el, st, { onSave, onPreview, onStop, onSfx, stationCount, stations, rawStations } = {}) {
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const max = Math.max(1, stationCount || 4);
      const sel = (k) => `<select data-k="${k}">${Array.from({ length: max + 1 }, (_, i) => `<option value="${i}"${String(i) === get(st, k) ? ' selected' : ''}>${i}곳</option>`).join('')}</select>`;
      const chk = (k) => `<label class="int-chk"><input type="checkbox" data-k="${k}"${yes(get(st, k)) ? ' checked' : ''}> 켜기</label>`;
      const rng = (k, name, play) => `<div class="int-vol"><span>${name}</span><input type="range" min="0" max="1" step="0.1" data-k="${k}" value="${esc(get(st, k))}"><b data-v="${k}">${Math.round(num(get(st, k), 0, 0, 1) * 100)}%</b><button type="button" class="int-play" data-play="${play}">▶ 미리 듣기</button></div>`;
      const reveal = get(st, '공개방식');
      el.innerHTML = `
<div class="int">
  <table class="int-t"><tr><th>출발할 때 고른 답</th><th>귀신 나오는 장소</th><th>은은한 소리</th><th>큰 소리</th><th>깜짝 얼굴 (+큰 소리)</th><th>칠판 글씨</th></tr>
  ${LEVELS.map((l) => `<tr><td>${l.label}</td><td>${sel('귀신수_' + l.key)}</td><td>${chk('은은한소리_' + l.key)}</td><td>${chk('큰소리_' + l.key)}</td><td>${chk('깜짝얼굴_' + l.key)}</td><td>${chk('칠판글씨_' + l.key)}</td></tr>`).join('')}
  </table>
  <p class="int-help">1·2학년 동생이 있다고 한 조는 위 설정과 관계없이 귀신과 소리가 없습니다. 은은한 소리는 촬영 중 몇 초 뒤, 큰 소리는 그 3~6초 뒤에 납니다. 깜짝 얼굴을 켠 조는 카운트다운 끝 무렵 큰 얼굴이 화면 가득 0.7초 나오며 큰 소리가 납니다(이때는 따로 큰 소리를 내지 않음).</p>
  ${rng('효과음크기', '은은한 소리 크기', 'soft')}
  ${rng('큰소리크기', '큰 소리 크기', 'loud')}
  <div class="int-row int-sfx"><span>은은한 소리 하나씩 듣기</span>
    ${api.SOFT_LIST.map(([n, t]) => `<button type="button" class="int-play" data-sfx="${n}" data-kind="soft">▶ ${t}</button>`).join('')}
  </div>
  <div class="int-row int-sfx"><span>큰 소리 하나씩 듣기</span>
    ${api.LOUD_LIST.map(([n, t]) => `<button type="button" class="int-play" data-sfx="${n}" data-kind="loud">▶ ${t}</button>`).join('')}
  </div>
  <p class="int-help">처음 누를 때는 소리를 만드느라 몇 초 걸려요(한 번 만들면 저장돼서 바로 나와요). 음량은 위 크기 막대를 따라요.</p>
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
    ${LEVELS.map((l, i) => `<tr><td>${l.label}</td><td><input list="int-el-voices" data-k="나레이션목소리_${l.key}" value="${esc(get(st, '나레이션목소리_' + l.key) || ['21m00Tcm4TlvDq8ikWAM', 'EXAVITQu4vr4xnSDxMaL', 'pNInz6obpgDQGcFmaJgB'][i])}" style="width:100%;max-width:340px;padding:6px 8px;border-radius:7px;border:1px solid #3a3f50;background:#0f1116;color:#fff;font-size:14px"></td></tr>`).join('')}
    </table>
    <datalist id="int-el-voices"><option value="21m00Tcm4TlvDq8ikWAM">Rachel · 여성 차분</option><option value="EXAVITQu4vr4xnSDxMaL">Sarah · 여성 부드러움</option><option value="pNInz6obpgDQGcFmaJgB">Adam · 남성 낮음</option><option value="ErXwobaYiN019PkySvjV">Antoni · 남성</option></datalist>
    <p class="int-help">ElevenLabs 사이트에서 마음에 드는 목소리의 Voice ID를 복사해 칸에 붙여 넣고 💾 저장하면, 모든 태블릿이 그 목소리로 읽어요. 아래 "나레이션 미리 듣기"로 바로 확인할 수 있어요. 무료 요금제에서는 쓸 수 없는 목소리도 있어서, 그럴 땐 미리 듣기에 오류가 떠요.</p>
  </div>
  <div class="int-row int-preview"><span>나레이션 미리 듣기</span>
    <select class="int-pv-lv"><option value="0">😱 너무 무서워요 말투</option><option value="1" selected>😬 조금 무서워요 말투</option><option value="2">😎 하나도 안 무서워요 말투</option></select>
    <select class="int-pv-text"><option value="prologue">출발 이야기(프롤로그)</option><option value="station">이 장소 괴담</option></select>
    <button type="button" class="int-pv-play">🔊 미리 듣기</button><button type="button" class="int-pv-stop">■ 멈춤</button>
  </div>
  <p class="int-help">태블릿 음성(Web Speech)의 단계별 목소리는 교사 모드 <b>도구</b> 탭에서 태블릿마다 고릅니다. 남자 목소리는 태블릿에 남성 음성 데이터가 있어야 나옵니다.</p>

  <div class="int-row"><span>운영 방식</span>
    ${(() => { const m = window.HG_TOUR ? HG_TOUR.modeOf(st) : get(st, '운영방식'); const opts = (window.HG_TOUR ? Object.keys(HG_TOUR.COURSES).map((k) => [k, HG_TOUR.COURSES[k].label]) : []).concat([['미션', '장소별 미션 (예전 방식: 시트 "장소" 탭의 장소·미션, 영상 미션 포함)']]);
      return opts.map(([v, t]) => `<label class="int-chk" style="display:flex"><input type="radio" name="int-mode" value="${v}"${m === v ? ' checked' : ''}> ${esc(t)}</label>`).join(''); })()}
  </div>
  <p class="int-help">운영 방식을 바꿔 저장하면 장소 목록이 바뀝니다. 태블릿마다 교사 모드에서 장소를 다시 골라 주세요. 마동 코스·인증샷 투어에서는 아래 촬영 방법과 관계없이 사진 인증샷(5초 카운트다운)으로 찍습니다. 미션 문구는 시트 설정 탭의 미션_장소id(예: 미션_class6), 도서관에서 찾을 책은 찾을책 에 적으면 바뀝니다.</p>
  <div class="int-row"><span>촬영 방법 (미션 방식)</span>
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
  <div class="int-row"><span>칠판 글씨 반응 녹화</span>
    <label class="int-chk"><input type="checkbox" data-k="칠판녹화"${yes(get(st, '칠판녹화')) ? ' checked' : ''}> 전자칠판이 있는 장소에서 카메라를 켜면 14초 동안 학생 반응을 영상으로 몰래 녹화</label>
    <label class="int-chk">칠판 장소 id <input type="text" data-k="칠판장소" value="${esc(get(st, '칠판장소'))}" style="width:120px;padding:6px 8px;border-radius:7px;border:1px solid #3a3f50;background:#0f1116;color:#fff"></label>
  </div>
  <div class="int-row"><span>귀신 넣는 방법</span>
    <label class="int-chk"><input type="checkbox" data-k="자유배치"${yes(get(st, '자유배치')) ? ' checked' : ''}> 빈 배경이 없거나 맞지 않으면 어두운 곳에 귀신 그림을 자동으로 놓기 (화면 귀신은 늘 이 방식)</label>
  </div>
  ${window.HG_TOUR && HG_TOUR.modeOf(st) === '코스' ? (() => {
      const cur = HG_TOUR.coursePlaces(st, rawStations || []), curIds = cur.map((p) => p.id);
      const rest = HG_TOUR.catalog(rawStations || []).filter((p) => !curIds.includes(p.id));
      const row = (p, on) => `<li class="int-crow" data-cid="${esc(p.id)}"><label class="int-chk"><input type="checkbox" class="int-cuse"${on ? ' checked' : ''}> ${esc(p.name)} <small style="color:#8c91a3">(${esc(p.id)})</small></label><button type="button" class="int-cup">▲</button><button type="button" class="int-cdown">▼</button></li>`;
      return `<div class="int-row"><span>마동 코스 장소</span><div style="flex:1;min-width:260px"><ol class="int-course">${cur.map((p) => row(p, true)).join('')}${rest.map((p) => row(p, false)).join('')}</ol>
        <button type="button" class="int-cdefault">↩ 기본 코스(5곳)로</button></div></div>
      <p class="int-help">체크한 장소를 위에서부터 순서대로 돕니다. ▲▼로 순서를 바꾸고, 체크를 켜면 추가·끄면 삭제돼요. 시트에 없는 장소도 넣을 수 있어요. 💾 저장 후 태블릿마다 장소를 다시 골라 주세요.</p>`;
    })() : ''}
  ${stations && stations.length && !(window.HG_TOUR && HG_TOUR.modeOf(st) === '코스') ? `<div class="int-row int-use"><span>이번에 쓰는 장소</span>
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
    <button type="button" class="int-reset">↩ 단계별 기본값으로</button>
    <span class="int-msg"></span>
  </div>
</div>`;
      const msg = (t, ok) => { const m = el.querySelector('.int-msg'); m.textContent = t; m.style.color = ok === false ? '#ff9aa8' : ok ? '#9ce6b4' : ''; };
      el.querySelectorAll('input[type=range]').forEach((r) => { r.oninput = () => { el.querySelector(`[data-v="${r.dataset.k}"]`).textContent = Math.round(r.value * 100) + '%'; }; });
      el.querySelectorAll('[data-sfx]').forEach((b) => {
        b.onclick = async () => {
          if (!onSfx) return msg('이 화면에서는 들을 수 없어요', false);
          const vol = parseFloat(el.querySelector(`input[data-k="${b.dataset.kind === 'loud' ? '큰소리크기' : '효과음크기'}"]`).value);
          msg('🔊 ' + b.textContent.replace('▶ ', '') + ' 준비 중...');
          try { const r = await onSfx(b.dataset.sfx, vol, b.dataset.kind); msg(r && r.error ? r.error : '🔊 ' + b.textContent.replace('▶ ', ''), !(r && r.error)); }
          catch (e) { msg('듣기 실패: ' + e.message, false); }
        };
      });
      el.querySelectorAll('[data-play]').forEach((b) => {
        b.onclick = () => {
          if (!window.Sfx) return msg('소리 기능을 불러오지 못했어요', false);
          Sfx.unlock();
          const k = b.dataset.play === 'loud' ? '큰소리크기' : '효과음크기';
          const v = parseFloat(el.querySelector(`input[data-k="${k}"]`).value);
          if (b.dataset.play === 'loud' && window.HG_loudPreview) {
            msg('큰 소리를 준비하는 중...');
            window.HG_loudPreview(v).then((n) => { if (n) msg('🔊 ' + ({ laughW: '여자 웃음소리', laughM: '아저씨 웃음소리', babyCry: '아기 울음소리', catCry: '고양이 울음소리', girlCry: '여자아이 울음소리' }[n] || n)); else { Sfx.loud(null, v); msg('실제 소리를 아직 못 받아서 합성 소리로 들려줘요 (시트 스크립트 새 버전 배포 확인)', false); } });
          } else if (b.dataset.play !== 'loud' && window.HG_softPreview) {
            msg('은은한 소리를 준비하는 중...');
            window.HG_softPreview(v).then((n) => msg('🔊 ' + ({ steps2: '발자국', rustle2: '옷깃 스치는 소리', drag2: '발 끄는 소리', desk2: '책상 끌리는 소리', door2: '문 열리는 소리', wind2: '바람 소리', murmur2: '소곤소곤 속삭임', voice: '작은 목소리' }[n] || '합성 소리')));
          } else b.dataset.play === 'loud' ? Sfx.loud(null, v) : Sfx.play(null, v);
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
        const md = el.querySelector('input[name="int-mode"]:checked'); if (md) o['운영방식'] = md.value;
        const gv = el.querySelector('input[name="int-gview"]:checked'); if (gv) o['귀신보기'] = gv.value;
        const rc = el.querySelector('input[name="int-react"]:checked'); if (rc) o['놀람촬영'] = rc.value;
        const crows = el.querySelectorAll('.int-crow');
        if (crows.length) { o['코스장소'] = [...crows].filter((r) => r.querySelector('.int-cuse').checked).map((r) => r.dataset.cid).join(','); o['쉬는장소'] = ''; }
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
      el.querySelector('.int-pv-stop').onclick = () => { if (onStop) onStop(); };
      el.querySelector('.int-pv-play').onclick = async () => {
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
      // 코스 장소 순서 바꾸기
      el.querySelectorAll('.int-cup, .int-cdown').forEach((b) => {
        b.onclick = () => {
          const li = b.closest('li'), up = b.classList.contains('int-cup');
          const sib = up ? li.previousElementSibling : li.nextElementSibling;
          if (sib) li.parentNode.insertBefore(li, up ? sib : sib.nextElementSibling);
        };
      });
      const cdef = el.querySelector('.int-cdefault');
      if (cdef) cdef.onclick = () => {
        const ol = el.querySelector('.int-course'), base = HG_TOUR.COURSES['코스'].places.map((p) => p.id);
        const rows = [...ol.children];
        rows.sort((a, b) => { const ia = base.indexOf(a.dataset.cid), ib = base.indexOf(b.dataset.cid); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
        rows.forEach((r) => { r.querySelector('.int-cuse').checked = base.includes(r.dataset.cid); ol.appendChild(r); });
        msg('기본 코스로 채웠어요. 💾 저장을 눌러야 적용돼요.');
      };
      // 무서움 단계 표(귀신 수·은은한 소리·큰 소리·깜짝 얼굴)만 기본값으로 채운다. 저장을 눌러야 적용
      el.querySelector('.int-reset').onclick = () => {
        LEVELS.forEach((l) => {
          ['귀신수_', '은은한소리_', '큰소리_', '깜짝얼굴_', '칠판글씨_'].forEach((p) => {
            const k = p + l.key, f = el.querySelector(`[data-k="${k}"]`);
            if (!f) return;
            if (f.type === 'checkbox') f.checked = DEF[k] === '예'; else f.value = DEF[k];
          });
        });
        msg('단계별 기본값으로 채웠어요. 💾 저장을 눌러야 적용돼요.');
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
.int-course{margin:0;padding-left:22px}.int-course li{display:flex;align-items:center;gap:6px;margin:4px 0}.int-course li button{padding:3px 9px;font-size:12px;background:#252935;color:#e8eaf0}
.int-sfx button{padding:6px 10px;font-size:13px}
.int-pin input{width:190px;padding:8px 10px;border-radius:8px;border:1px solid #3a3f50;background:#0f1116;color:#fff;font-size:15px}
.int-vol{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:8px 0;font-size:14px}.int-vol span{min-width:150px;color:#a9aec0}.int-vol input{width:200px}.int-vol b{min-width:44px}
.int button{border:none;border-radius:9px;padding:8px 14px;font-weight:700;font-size:14px;cursor:pointer;background:linear-gradient(180deg,#ffd98f,#e9a94a);color:#3a2408;font-family:inherit}
.int .int-play,.int .int-shuffle,.int .int-pv-stop{background:#252935;color:#e8eaf0}.int-preview select{padding:7px 8px;border-radius:7px;border:1px solid #3a3f50;background:#0f1116;color:#fff;font-size:14px}.int-msg{font-size:13px}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
})();
