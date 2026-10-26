#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
arch="${1:-$(uname -m)}"
case "$arch" in arm64|x86_64) ;; *) echo 'Use arm64 or x86_64' >&2; exit 1 ;; esac
preset="macos-$arch"
cmake --preset "$preset"
cmake --build --preset "$preset" --parallel
export CG_TEST_OUTPUT="$PWD/test-output"
ctest --test-dir ".build/$preset" -C RelWithDebInfo --output-on-failure
cmake --install ".build/$preset" --config RelWithDebInfo --prefix "$PWD/dist/$preset"
cp README.md LICENSE THIRD-PARTY.md VALIDATION.md "dist/$preset/"
version=$(sed -n 's/.*"version": "\([0-9][0-9.]*\)".*/\1/p' buildspec.json | tail -1)
ditto -c -k --keepParent "dist/$preset/cg-live-native.plugin" "dist/cg-live-native-$version-$preset.zip"
echo "Build + tests complete. Package: dist/cg-live-native-$version-$preset.zip"
