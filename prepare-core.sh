#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
. "$ROOT/core-version.env"
UPX_BIN=${UPX_BIN:-upx}
[ "$("$UPX_BIN" --version | head -1)" = "upx $UPX_VERSION" ] || { echo "UPX $UPX_VERSION is required" >&2; exit 1; }
"$ROOT/fetch-core.sh"
for arch in arm64 arm mipsle amd64; do
    source_dir="$ROOT/build/official/$arch"
    target_dir="$ROOT/build/packed/$arch"
    mkdir -p "$target_dir"
    for binary in tailscale tailscaled; do
        source="$source_dir/$binary"
        target="$target_dir/$binary"
        fingerprint="$(shasum -a 256 "$source" | awk '{print $1}'):$UPX_VERSION:best-lzma"
        if [ -f "$target" ] && [ "$(cat "$target.source" 2>/dev/null)" = "$fingerprint" ] && [ "$(shasum -a 256 "$target" | awk '{print $1}')" = "$(cat "$target.sha256" 2>/dev/null)" ]; then
            "$UPX_BIN" -t "$target" >/dev/null
            continue
        fi
        cp "$source" "$target.tmp"
        "$UPX_BIN" --best --lzma "$target.tmp"
        "$UPX_BIN" -t "$target.tmp"
        cp "$target.tmp" "$target.verify"
        "$UPX_BIN" -d "$target.verify" >/dev/null
        cmp "$source" "$target.verify" || { echo "UPX did not restore the official bytes: $arch/$binary" >&2; exit 1; }
        rm "$target.verify"
        mv "$target.tmp" "$target"
        printf '%s\n' "$fingerprint" > "$target.source"
        shasum -a 256 "$target" | awk '{print $1}' > "$target.sha256"
    done
done
