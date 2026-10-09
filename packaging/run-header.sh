#!/bin/sh
# Tailscale LuCI @VERSION@ / @ARCH@. Payload integrity is checked before extraction.
set -eu
umask 077
mode=${1:---install}
case "$mode" in --help|-h)
    echo 'Usage: sh package.run [--install | --check | --extract NEW_DIRECTORY]'
    exit 0;;
    --install|--check|--extract) ;; *) echo 'Unknown option' >&2; exit 2;;
esac
if [ "$mode" = --extract ]; then [ "$#" = 2 ] || exit 2; else [ "$#" -le 1 ] || exit 2; fi
available=$(df -Pk /tmp | awk 'END {print $4}')
[ "$available" -gt @TEMP_KB@ ] || { echo 'Not enough temporary space; nothing extracted.' >&2; exit 1; }
work=$(mktemp -d /tmp/tailscale-run.XXXXXX)
trap 'rm -rf "$work"' EXIT
trap 'exit 130' HUP INT TERM
line=$(awk '/^__TAILSCALE_PAYLOAD__$/ { print NR + 1; exit }' "$0")
tail -n +"$line" "$0" > "$work/payload.tar.gz"
printf '%s  %s\n' '@SHA256@' "$work/payload.tar.gz" | sha256sum -c - >/dev/null || { echo 'Payload checksum mismatch; nothing installed.' >&2; exit 1; }
[ "$mode" != --check ] || { echo 'Tailscale v@VERSION@ @ARCH@: payload verified.'; exit 0; }
if [ "$mode" = --extract ]; then
    [ ! -e "$2" ] && [ ! -L "$2" ] || { echo 'Extraction destination must not exist.' >&2; exit 1; }
    mkdir -m 700 "$2"
    tar -xzf "$work/payload.tar.gz" -C "$2"
    echo "Extracted into $2"
    exit 0
fi
[ "$(id -u)" = 0 ] || { echo 'Install as root.' >&2; exit 1; }
[ "$(uname -s)" = Linux ] || { echo 'Requires an OpenWrt/LibWrt Linux router.' >&2; exit 1; }
case "@ARCH@:$(uname -m)" in arm64:aarch64|arm:armv7l|mipsle:mips|mipsle:mipsel|amd64:x86_64) ;; *) echo 'Wrong architecture; nothing installed.' >&2; exit 1;; esac
tar -xzf "$work/payload.tar.gz" -C "$work"
sh "$work/install.sh" "$work" "@ARCH@" "@VERSION@"
exit 0
__TAILSCALE_PAYLOAD__
