#!/bin/bash
# Full upstream daemon + CLI in one static executable, without feature omissions.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
. "$ROOT/core-version.env"
UPX_BIN=${UPX_BIN:-upx}
[ "$("$UPX_BIN" --version | head -1)" = "upx $UPX_VERSION" ] || { echo "UPX $UPX_VERSION required" >&2; exit 1; }
[ "$(go version | awk '{print $3}')" = "go$GO_VERSION" ] || { echo "Go $GO_VERSION required" >&2; exit 1; }
mkdir -p "$ROOT/build/source"
archive="$ROOT/build/source/tailscale-$CORE_VERSION.tar.gz"
if [ ! -f "$archive" ]; then
    curl -fsSL --retry 2 --connect-timeout 15 --max-time 300 -o "$archive.tmp" "https://codeload.github.com/tailscale/tailscale/tar.gz/refs/tags/v$CORE_VERSION"
    mv "$archive.tmp" "$archive"
fi
[ "$(shasum -a 256 "$archive" | awk '{print $1}')" = "$CORE_SOURCE_SHA256" ] || { echo 'Source checksum mismatch' >&2; exit 1; }
source_dir="$ROOT/build/source/tailscale-$CORE_VERSION"
if [ ! -f "$source_dir/build_dist.sh" ]; then tar -xzf "$archive" -C "$ROOT/build/source"; fi
# The build tree must also match the pinned archive, not just its cached tarball.
verify_dir=$(mktemp -d)
trap 'rm -rf "$verify_dir"' EXIT
tar -xzf "$archive" -C "$verify_dir"
diff -qr "$verify_dir/tailscale-$CORE_VERSION" "$source_dir" >/dev/null || { echo 'Modified upstream source tree' >&2; exit 1; }
for arch in ${CORE_ARCHES:-arm64 arm mipsle amd64}; do
    case "$arch" in arm64|arm|mipsle|amd64) ;; *) exit 1;; esac
    target_dir="$ROOT/build/combined/$arch"
    mkdir -p "$target_dir"
    fingerprint="$CORE_SOURCE_SHA256:$GO_VERSION:$arch:$UPX_VERSION:box-strip-full-vcsstamp"
    if [ -f "$target_dir/tailscaled" ] && [ "$(cat "$target_dir/source" 2>/dev/null)" = "$fingerprint" ] && [ "$(shasum -a 256 "$target_dir/tailscaled" | awk '{print $1}')" = "$(cat "$target_dir/sha256" 2>/dev/null)" ]; then
        "$UPX_BIN" -t "$target_dir/tailscaled" >/dev/null
        continue
    fi
    (
        cd "$source_dir"
        export CGO_ENABLED=0 GOOS=linux GOARCH="$arch" GOARM=7 GOMIPS=softfloat
        export TS_VERSION_LONG="$CORE_VERSION-t${CORE_SOURCE_COMMIT:0:9}" TS_VERSION_GIT_HASH="$CORE_SOURCE_COMMIT"
        # An archive under this project's checkout must not inherit this project's Git revision.
        ./build_dist.sh --box --strip -buildvcs=false \
            -ldflags "-s -w -X tailscale.com/version.longStamp=$TS_VERSION_LONG -X tailscale.com/version.shortStamp=$CORE_VERSION -X tailscale.com/version.gitCommitStamp=$CORE_SOURCE_COMMIT" \
            -o "$target_dir/tailscaled.raw" ./cmd/tailscaled
    )
    cp "$target_dir/tailscaled.raw" "$target_dir/tailscaled.tmp"
    "$UPX_BIN" --best --lzma "$target_dir/tailscaled.tmp"
    "$UPX_BIN" -t "$target_dir/tailscaled.tmp"
    cp "$target_dir/tailscaled.tmp" "$target_dir/verify"
    "$UPX_BIN" -d "$target_dir/verify" >/dev/null
    cmp "$target_dir/tailscaled.raw" "$target_dir/verify"
    rm "$target_dir/verify"
    mv "$target_dir/tailscaled.tmp" "$target_dir/tailscaled"
    printf '%s\n' "$fingerprint" > "$target_dir/source"
    shasum -a 256 "$target_dir/tailscaled" | awk '{print $1}' > "$target_dir/sha256"
done
