#!/usr/bin/env bash
# MuseScore 저장소의 반복 기호 테스트 데이터(GPLv3)를 vendor/ 에 받아온다.
# 저장소에는 포함하지 않고, 재생 순서 검증용으로만 쓴다.
set -euo pipefail
DEST="$(dirname "$0")/../vendor/musescore"
if [ ! -d "$DEST/.git" ]; then
  git clone --depth 1 --filter=blob:none --sparse https://github.com/musescore/MuseScore "$DEST"
fi
git -C "$DEST" sparse-checkout set --no-cone '/src/engraving/tests/repeat_data/*' '/src/engraving/tests/repeat_tests.cpp'
echo "MuseScore 반복 테스트 데이터 준비 완료: $DEST/src/engraving/tests"
