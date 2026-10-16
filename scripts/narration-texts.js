/* 나레이션 mp3 를 만들 이야기 글 목록을 뽑는다 (node scripts/narration-texts.js > texts.json)
 * 앱과 같은 규칙: 코스·인증샷 투어 장소의 기본 괴담 + 프롤로그, 무서움 단계(0·1·2)별.
 * 파일 이름 = fnv1a(cleanSpeech(글)) 16진수 → narration/<이름>.mp3
 */
global.window = {};
require('../js/stories.js');
require('../js/tour.js');
const S = window.HG_STORIES, T = window.HG_TOUR;
const cleanSpeech = (t) => String(t || '').replace(/[「」📜😊]/g, '').trim();
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const out = new Map();
const add = (text, level) => {
  const t = cleanSpeech(text); if (!t) return;
  const key = fnv1a(t).toString(16);
  if (!out.has(key)) out.set(key, { key, level, text: t });
};
[S.prologue, S.prologueCourse, S.prologueTour].forEach((list) => list.forEach((t, lv) => add(t, lv)));
// 코스: 고를 수 있는 모든 장소를 넣은 경우까지
const ids = T.catalog([]).map((p) => p.id).join(',');
[{ 운영방식: '코스' }, { 운영방식: '코스', 코스장소: ids }, { 운영방식: '인증샷' }].forEach((st) => {
  T.stations([], st).forEach((s) => { const d = S.defFor(s); if (d) d.text.forEach((t, lv) => add(t, lv)); });
});
process.stdout.write(JSON.stringify([...out.values()], null, 1));
