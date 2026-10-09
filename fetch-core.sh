#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
. "$ROOT/core-version.env"
mkdir -p "$ROOT/build/official"
for arch in arm64 arm mipsle amd64; do
    name="tailscale_${CORE_VERSION}_${arch}.tgz"
    expected=$(awk -v name="$name" '$2 == name { print $1 }' "$ROOT/official-sha256.txt")
    [ "${#expected}" = 64 ] || { echo "Missing checksum: $name" >&2; exit 1; }
    file="$ROOT/build/official/$name"
    if [ ! -f "$file" ]; then
        curl --fail --location --retry 2 --connect-timeout 15 --max-time 300 \
            -o "$file.tmp" "https://pkgs.tailscale.com/stable/$name"
        mv "$file.tmp" "$file"
    fi
    actual=$(shasum -a 256 "$file" | awk '{print $1}')
    [ "$actual" = "$expected" ] || { echo "Checksum mismatch: $name" >&2; exit 1; }
    mkdir -p "$ROOT/build/official/$arch"
    tar -xzf "$file" --strip-components=1 -C "$ROOT/build/official/$arch"
    echo "Verified official core: $arch $CORE_VERSION"
done
