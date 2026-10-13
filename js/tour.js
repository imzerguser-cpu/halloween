/* 장소별 인증샷 투어 — 태블릿 앱·노트북 진행판·관리자 화면이 함께 쓴다.
 * 설정 "운영방식" = 인증샷(기본) 이면 아래 순서의 장소만 쓰고, 장소마다 이야기 → 단체 인증샷(5초 카운트다운)만 한다.
 * 미션 = 예전 방식(시트 "장소" 탭의 장소·미션 그대로).
 * 시트에 같은 장소id 줄이 있으면 귀신(예/아니오)·공개방식·괴담 문구는 그 줄을 따른다. 없는 장소(예: hall2)도 그대로 쓸 수 있다.
 */
(function () {
  'use strict';
  const PLACES = [
    { id: 'class1', name: '1학년 교실', clue: '다음은 2층으로 올라가는 복도로!' },
    { id: 'hall2', name: '2층 올라가는 복도', clue: '다음은 책이 가득한 도서관으로!' },
    { id: 'library', name: '도서관', clue: '다음은 6학년 교실로!' },
    { id: 'class6', name: '6학년 교실', clue: '다음은 중앙계단으로! 천천히 내려가요.' },
    { id: 'stairs', name: '중앙계단', clue: '다음은 과학실로!' },
    { id: 'science', name: '과학실', clue: '다음은 영어체험실로!' },
    { id: 'english', name: '영어체험실', clue: '마지막 장소였어요! 선생님께 돌아가요.' }
  ];
  const on = (settings) => String((settings || {})['운영방식'] || '인증샷').trim() !== '미션';

  window.HG_TOUR = {
    PLACES,
    on,
    /** 시트 장소 목록(raw) → 지금 운영방식에서 쓰는 장소 목록 */
    stations(raw, settings) {
      raw = raw || [];
      if (!on(settings)) return raw;
      const byId = {};
      raw.forEach((s) => { byId[s.id] = s; });
      return PLACES.map((p) => {
        const r = byId[p.id] || {};
        return {
          id: p.id, name: p.name, type: '사진', value: '',
          mission: `${p.name}에서 다 함께 인증샷! 모두 화면에 들어오게 모인 뒤 📸 버튼을 누르면 5초 뒤에 찰칵!`,
          ghost: r.ghost != null ? !!r.ghost : true,
          reveal: r.reveal || '', clue: p.clue,
          storyTitle: r.storyTitle || '', stories: r.stories || ['', '', ''],
          tour: true
        };
      });
    }
  };
})();
