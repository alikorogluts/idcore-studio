#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
build="$root/build"
sources="$root/Sources"
resources="$root/Resources"
minimum_macos=12.0
target="$(uname -m)-apple-macos$minimum_macos"
app="$build/IDCORE Studio.app"
mkdir -p "$build"
staging="$(mktemp -d "$build/.idcore.XXXXXX")"
trap 'rm -rf "$staging"' EXIT
bundle="$staging/IDCORE Studio.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"

xcrun clang -std=gnu11 -O2 -Wall -Wextra -Werror -Wno-unused-parameter \
    -mmacosx-version-min="$minimum_macos" -c "$sources/StudioAudio.c" -o "$staging/StudioAudio.o"
xcrun swiftc -target "$target" -module-cache-path "$build/swift-cache" -O \
    -import-objc-header "$sources/StudioAudio.h" "$sources/IDCOREStudio.swift" \
    "$sources/StudioRecording.swift" "$sources/StudioSystemAudio.swift" "$staging/StudioAudio.o" -framework CoreAudio \
    -o "$bundle/Contents/MacOS/IDCOREStudio"

cp "$resources/Info.plist" "$bundle/Contents/Info.plist"
cp "$resources/StudioIcon.icns" "$resources/idcore-studio.html" "$bundle/Contents/Resources/"
ditto "$resources/studio-assets" "$bundle/Contents/Resources/studio-assets"
codesign --force --sign - "$bundle"
codesign --verify --strict "$bundle"

if [[ -e "$app" ]]; then
    mv "$app" "$staging/previous.app"
fi
if ! mv "$bundle" "$app"; then
    if [[ -d "$staging/previous.app" ]]; then mv "$staging/previous.app" "$app"; fi
    exit 1
fi
printf '%s\n' "$app"
