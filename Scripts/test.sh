#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

xcrun clang -std=gnu11 -O2 -Wall -Wextra -Werror -Wno-unused-parameter \
    "$root/Tests/audio-check.c" -framework CoreAudio -framework CoreFoundation -o "$scratch/audio-check"
"$scratch/audio-check"

xcrun clang -std=gnu11 -O2 -mmacosx-version-min=12.0 -c "$root/Sources/StudioAudio.c" -o "$scratch/StudioAudio.o"
xcrun swiftc -target "$(uname -m)-apple-macos12.0" -module-cache-path "$scratch/swift-cache" \
    -import-objc-header "$root/Sources/StudioAudio.h" "$root/Sources/StudioRecording.swift" "$root/Sources/StudioSystemAudio.swift" \
    "$root/Tests/recording-check.swift" "$scratch/StudioAudio.o" -framework CoreAudio -o "$scratch/recording-check"
"$scratch/recording-check" "$scratch"

if command -v node >/dev/null; then
    node "$root/Tests/tuner-check.mjs"
    node "$root/Tests/song-tones-check.mjs"
    node "$root/Tests/tone-comparison-check.mjs"
fi
