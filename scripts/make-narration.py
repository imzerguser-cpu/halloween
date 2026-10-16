"""나레이션 mp3 만들기 — 컴퓨터(Microsoft 한국어 음성)로 이야기를 읽어 narration/ 에 저장한다.
태블릿 음성이 이야기를 못 읽어서 (사용자 요청 2026-10-16), 앱은 이 파일이 있으면 먼저 튼다.

    pip install edge-tts
    python scripts/make-narration.py          # 없는 파일만 만든다 (--all 이면 전부 다시)

이야기 글을 고치면 다시 돌려 주세요. 글 목록은 scripts/narration-texts.js 가 앱과 같은 규칙으로 뽑는다.
"""
import asyncio, json, os, subprocess, sys

import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'narration')
# 무서움 단계별 목소리: 0 너무 무서워요·1·2학년(밝은 여자) · 1 조금(차분한 남자) · 2 안 무서움(느리고 낮은 남자)
VOICE = [
    dict(voice='ko-KR-SunHiNeural', rate='-5%', pitch='+0Hz'),
    dict(voice='ko-KR-InJoonNeural', rate='-10%', pitch='-4Hz'),
    dict(voice='ko-KR-InJoonNeural', rate='-22%', pitch='-12Hz'),
]


async def main():
    texts = json.loads(subprocess.check_output(['node', os.path.join(ROOT, 'scripts', 'narration-texts.js')], cwd=ROOT))
    os.makedirs(OUT, exist_ok=True)
    redo = '--all' in sys.argv
    for i, t in enumerate(texts):
        path = os.path.join(OUT, t['key'] + '.mp3')
        if os.path.exists(path) and not redo:
            continue
        v = VOICE[t['level'] if t['level'] in (0, 1, 2) else 1]
        await edge_tts.Communicate(t['text'], **v).save(path)
        print(f"{i + 1}/{len(texts)} {t['key']} ({t['level']}) {t['text'][:30]}…")
    keys = sorted(t['key'] for t in texts)
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(keys, f)
    # 목록에 없는 예전 파일 정리
    for name in os.listdir(OUT):
        if name.endswith('.mp3') and name[:-4] not in keys:
            os.remove(os.path.join(OUT, name))
    print('done', len(keys))


asyncio.run(main())
