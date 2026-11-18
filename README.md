# 워십밴드연습툴 (together_wing)

예배팀 보컬 화음 연습용 악보 앱입니다. MuseScore에서 저장한 `.mscz` 파일을 **내보내기 없이 그대로** 열어서,
악보를 보며 파트별로 음량·뮤트·솔로를 조절하고 구간을 반복 연습하는 것이 목표입니다.

- 형태: PWA(웹앱). 안드로이드와 아이폰 모두 브라우저에서 홈 화면에 설치해 사용
- 악보 전달: 각자 받은 `.mscz` 파일을 앱에서 직접 연다 (서버 없음, 파일은 기기 밖으로 나가지 않음)
- 재생 음색: 피아노 (MVP)

## 진행 단계

| 단계 | 내용 | 상태 |
|---|---|---|
| P0 | `.mscz` 파서: 파트·음표·가사·조성·템포·반복/점프 읽기, 연주 순서 전개 | 진행 중 |
| P1 | 악보 표시 (MuseScore 원본 레이아웃 최대한 유지) | |
| P2 | 파트별 재생, 믹서(음량/뮤트/솔로/템포) | |
| P3 | 재생 커서 동기화, 구간 반복 | |
| P4 | PWA 설치, 안드로이드·아이폰 실기기 테스트 | |

## 구조

- `src/core/mscz.ts` — `.mscz`(zip)에서 본 악보 `.mscx` 꺼내기 (파트보 Excerpts 제외)
- `src/core/parseMscx.ts` — MuseScore XML → 파트, 마디, 음표, 가사, 템포, 볼타, 점프/마커
- `src/core/unroll.ts` — 도돌이표·1·2번 괄호·D.C./D.S./Coda/Fine 을 실제 연주 순서로 펼침
- `src/core/timeline.ts` — 펼친 순서를 초 단위 재생 타임라인으로 (붙임줄 합치기, 반복 회차별 가사)
- `src/report/scoreReport.ts` — 점검 리포트 (웹 화면과 CLI 공용)

### 반복 규칙과 MuseScore 호환

`unroll.ts`는 MuseScore 4의 재생 규칙(`src/engraving/dom/repeatlist.cpp`)과 같은 결과를 내도록 구현했고,
MuseScore 저장소의 반복 테스트 69개(`repeat_tests.cpp`)로 결과를 대조합니다. 테스트 데이터는 MuseScore(GPLv3)
소유라 저장소에 넣지 않고 `scripts/fetch-musescore-tests.sh`로 받아서 씁니다.

## 개발

```bash
npm install
./scripts/fetch-musescore-tests.sh   # MuseScore 반복 테스트 데이터 (선택)
npm test                             # 단위 테스트
npm run report -- samples/곡.mscz     # 악보 점검 리포트 (Markdown)
npm run dev                          # 웹 화면
```

실제 팀 악보는 저작권 때문에 저장소에 올리지 않습니다. `samples/` 폴더에 두면 `tests/samples.test.ts`가 함께 검사합니다.
