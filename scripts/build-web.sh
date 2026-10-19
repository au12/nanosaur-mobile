#!/usr/bin/env bash
# Builds the Nanosaur web bundle.
#
#   scripts/build-web.sh <path to Nanosaur checkout> <output dir>
#
# Set PHASE=compile or PHASE=assemble to run only one half (the Dockerfile does this so
# that editing the web shell doesn't recompile the game).
#
# Expects: an Emscripten SDK on PATH (emcmake/emcc), CMake >= 3.21, Python 3, and an SDL3
# source tree in <checkout>/extern/SDL. The Dockerfile sets all of this up; you can also run
# it on any machine with emsdk activated.
set -euo pipefail

SRC="$(cd "$1" && pwd)"
OUT="${2:-/dev/null}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 4)}"
BUILD_TYPE="${BUILD_TYPE:-Release}"

PHASE="${PHASE:-all}"

if [ "$PHASE" = "all" ] || [ "$PHASE" = "compile" ]; then
echo "==> Applying web port patches"
if ! git -C "$SRC" apply --check "$HERE/patches/nanosaur-web.patch" 2>/dev/null; then
	if git -C "$SRC" apply --reverse --check "$HERE/patches/nanosaur-web.patch" 2>/dev/null; then
		echo "    (already applied)"
	else
		echo "error: patches/nanosaur-web.patch doesn't apply to this Nanosaur checkout." >&2
		echo "       Use the commit pinned in the Dockerfile (NANOSAUR_COMMIT)." >&2
		exit 1
	fi
else
	git -C "$SRC" apply "$HERE/patches/nanosaur-web.patch"
fi
if git -C "$SRC/extern/Pomme" apply --check "$HERE/patches/pomme-web.patch" 2>/dev/null; then
	git -C "$SRC/extern/Pomme" apply "$HERE/patches/pomme-web.patch"
fi

echo "==> Configuring (Emscripten, $BUILD_TYPE)"
emcmake cmake -S "$SRC" -B "$SRC/build-web" \
	-DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
	-DBUILD_SDL_FROM_SOURCE=ON \
	-DSDL_STATIC=ON -DSDL_SHARED=OFF \
	-DSDL_TEST_LIBRARY=OFF -DSDL_TESTS=OFF -DSDL_EXAMPLES=OFF \
	-DSDL_CAMERA=OFF -DSDL_SENSOR=OFF -DSDL_HAPTIC=OFF -DSDL_DIALOG=OFF -DSDL_TRAY=OFF

echo "==> Building with $JOBS jobs"
cmake --build "$SRC/build-web" -j "$JOBS"

fi

if [ "$PHASE" = "all" ] || [ "$PHASE" = "assemble" ]; then
echo "==> Assembling $OUT"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$HERE/shell/." "$OUT/"
cp "$SRC/build-web/nanosaur.js" "$SRC/build-web/nanosaur.wasm" "$SRC/build-web/nanosaur.data" "$OUT/"
python3 -I "$HERE/tools/make-hud-assets.py" "$SRC/Data" "$OUT/hud"
python3 -I "$HERE/tools/make-art.py" "$SRC/Data" "$OUT/art"
python3 -I "$HERE/tools/finalize-dist.py" "$OUT"
echo "==> Done: $(du -sh "$OUT" | cut -f1) in $OUT"
fi
