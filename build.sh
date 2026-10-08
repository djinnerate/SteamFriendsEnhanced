#!/usr/bin/env bash
# Packages the extension for each browser into dist/<browser>/ and dist/<browser>.zip.
#   chrome  - Chrome, Brave, Edge and other Chromium browsers (uses manifest.json)
#   firefox - Firefox 140+ (uses manifest.firefox.json)
# Usage: ./build.sh [chrome|firefox]...   (no arguments builds both)
set -euo pipefail
cd "$(dirname "$0")"

FILES=(index.html background.js popup scripts styles images)
targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=(chrome firefox)

for target in "${targets[@]}"; do
    case "$target" in
        chrome)  manifest=manifest.json ;;
        firefox) manifest=manifest.firefox.json ;;
        *) echo "Unknown target: $target" >&2; exit 1 ;;
    esac

    out="dist/$target"
    rm -rf "$out" "$out.zip"
    mkdir -p "$out"
    cp -r "${FILES[@]}" "$out/"
    cp "$manifest" "$out/manifest.json"
    (cd "$out" && python3 -m zipfile -c "../$target.zip" ./*)
    echo "Built $out and $out.zip"
done
