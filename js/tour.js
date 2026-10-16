/* 운영 코스 — 태블릿 앱·노트북 진행판·관리자 화면·전자칠판이 함께 쓴다.
 * 설정 "운영방식"
 *   코스(기본)  = 마동 코스 4곳: 1학년 교실(큰 컵 쌓기) → 과학실(해골) → [중앙현관 계단] → 도서관(책 찾기) → 6학년 교실 앞(탁구공)  (창고 앞은 2026-10-16 뺌)
 *   인증샷      = 인증샷 투어 7곳 (1학년 교실 → 2층 복도 → 도서관 → 6학년 교실 → 중앙계단 → 과학실 → 영어체험실)
 *   미션        = 예전 방식 (시트 "장소" 탭의 장소·미션 그대로)
 * 코스·투어는 장소마다 이야기 → (미션) → 단체 인증샷(5초 카운트다운). 영상은 찍지 않는다.
 * 시트에 같은 장소id 줄이 있으면 귀신(예/아니오)·공개방식·괴담 문구는 그 줄을 따른다.
 * 미션 문구는 시트 "설정" 탭에 미션_<장소id> 를 적으면 그 글이 우선. 도서관 책은 설정 "찾을책".
 * story: 괴담을 고르는 곳 — course(stories.js courseById) · tour(tourById) · type:유형(byType) · id(byId)
 */
(function () {
  'use strict';
  const SHOT = '모두 화면에 들어오게 모인 뒤 📸 버튼을 누르면 5초 뒤에 찰칵!';
  const COURSES = {
    '코스': {
      label: '마동 코스 4곳 (1학년 교실 큰 컵 쌓기 → 과학실 해골 → 중앙현관 계단 → 도서관 책 찾기 → 6학년 교실 앞 탁구공)',
      prologue: 'prologueCourse',
      places: [
        { id: 'class1', name: '1학년 교실', kind: 'mission', story: 'course', shoot: '영상',
          mission: '큰 컵 쌓기! 🎬 버튼을 누르면 3초 뒤에 녹화가 시작돼요. 다 함께 큰 컵으로 탑을 쌓고, 다 쌓으면 ■ 버튼을 눌러 녹화를 끝내요!',
          clue: '다음은 과학실로! 해골이 기다리고 있어요.' },
        { id: 'science', name: '과학실', kind: 'photo', story: 'course',
          mission: '해골 모형 옆에 다 함께 모여 인증샷! ' + SHOT,
          clue: '다음은 중앙현관 계단을 지나 도서관으로! 계단에서는 난간을 잡고 천천히.' },
        { id: 'library', name: '도서관', kind: 'mission', story: 'type:책찾기',
          mission: '도서관 어딘가에 있는 {책}을 찾아요! 찾으면 책을 들고 다 함께 모여 📸 버튼을 눌러요. 5초 뒤에 찰칵!',
          clue: '다음은 6학년 교실 앞으로!' },
        { id: 'class6', name: '6학년 교실 앞', kind: 'mission', story: 'course', shoot: '영상',
          mission: '컵에 탁구공 넣기! 🎬 버튼을 누르면 3초 뒤에 녹화가 시작돼요. 탁구공을 던져 컵에 3개를 넣으면 성공! 다 넣으면 ■ 버튼을 눌러 녹화를 끝내요!',
          clue: '마지막 장소였어요! 강당으로 돌아가요.' }
      ]
    },
    '인증샷': {
      label: '인증샷 투어 7곳 (1학년 교실 → 2층 올라가는 복도 → 도서관 → 6학년 교실 → 중앙계단 → 과학실 → 영어체험실)',
      prologue: 'prologueTour',
      places: [
        { id: 'class1', name: '1학년 교실', story: 'tour', clue: '다음은 2층으로 올라가는 복도로!' },
        { id: 'hall2', name: '2층 올라가는 복도', story: 'tour', clue: '다음은 책이 가득한 도서관으로!' },
        { id: 'library', name: '도서관', story: 'tour', clue: '다음은 6학년 교실로!' },
        { id: 'class6', name: '6학년 교실', story: 'tour', clue: '다음은 중앙계단으로! 천천히 내려가요.' },
        { id: 'stairs', name: '중앙계단', story: 'tour', clue: '다음은 과학실로!' },
        { id: 'science', name: '과학실', story: 'id', clue: '다음은 영어체험실로!' },
        { id: 'english', name: '영어체험실', story: 'id', clue: '마지막 장소였어요! 선생님께 돌아가요.' }
      ]
    }
  };
  const modeOf = (settings) => {
    const m = String((settings || {})['운영방식'] || '코스').trim();
    return m === '미션' ? '미션' : COURSES[m] ? m : '코스';
  };
  const on = (settings) => modeOf(settings) !== '미션';
  const course = (settings) => (on(settings) ? COURSES[modeOf(settings)] : null);
  // 마동 코스에 넣을 수 있는 모든 장소: 두 코스의 장소 + 시트 장소 탭의 장소
  function catalog(raw) {
    const map = new Map();
    COURSES['코스'].places.forEach((p) => map.set(p.id, p));
    COURSES['인증샷'].places.forEach((p) => { if (!map.has(p.id)) map.set(p.id, p); });
    (raw || []).forEach((s) => { if (s && s.id && !map.has(s.id)) map.set(s.id, { id: s.id, name: s.name || s.id, kind: 'photo', story: 'id' }); });
    return [...map.values()];
  }
  const josa = (w) => { const c = String(w).trim().slice(-1).charCodeAt(0) - 0xac00; return c >= 0 && c <= 11171 && c % 28 && c % 28 !== 8 ? '으로' : '로'; };
  /** 관리자가 고른 마동 코스 장소(설정 "코스장소" = 장소id 를 쉼표로, 순서대로). 비우면 기본 5곳 */
  function coursePlaces(settings, raw) {
    const ids = String((settings || {})['코스장소'] || '').split(/[,\s]+/).filter(Boolean);
    const base = COURSES['코스'].places;
    if (!ids.length) return base;
    const cat = new Map(catalog(raw).map((p) => [p.id, p]));
    const list = ids.map((id) => cat.get(id)).filter(Boolean);
    return list.map((p, i) => {
      const next = list[i + 1], b = base.findIndex((q) => q.id === p.id);
      const sameNext = b >= 0 && (next ? base[b + 1] && base[b + 1].id === next.id : b === base.length - 1);
      const clue = sameNext && p.clue ? p.clue : next ? `다음은 ${next.name}${josa(next.name)}!` : '마지막 장소였어요! 강당으로 돌아가요.';
      return Object.assign({}, p, { clue });
    });
  }

  window.HG_TOUR = {
    COURSES,
    get PLACES() { return COURSES['코스'].places; },
    on, modeOf, course, catalog, coursePlaces,
    /** 시트 장소 목록(raw) → 지금 운영방식에서 쓰는 장소 목록 */
    stations(raw, settings) {
      raw = raw || [];
      const c = course(settings);
      if (!c) return raw;
      settings = settings || {};
      const byId = {};
      raw.forEach((s) => { byId[s.id] = s; });
      const book = String(settings['찾을책'] || '').trim();
      const places = modeOf(settings) === '코스' ? coursePlaces(settings, raw) : c.places;
      return places.map((p) => {
        const r = byId[p.id] || {};
        const base = String(settings['미션_' + p.id] || '').trim() || p.mission || `${p.name}에서 다 함께 인증샷! ${SHOT}`;
        return {
          id: p.id, name: p.name, type: '사진', value: '',
          mission: base.replace(/\{책\}/g, book ? `『${book}』 책` : '선생님이 알려 준 책'),
          ghost: r.ghost != null ? !!r.ghost : true,
          reveal: r.reveal || '', clue: p.clue,
          storyTitle: r.storyTitle || '', stories: r.stories || ['', '', ''],
          tour: true, kind: p.kind || 'photo', storyFrom: p.story || 'id',
          shoot: modeOf(settings) === '코스' ? p.shoot || '' : ''   // 마동 코스의 1·6학년 교실은 영상 미션
        };
      });
    }
  };
})();
