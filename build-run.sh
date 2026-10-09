#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
"$ROOT/prepare-core.sh"
[ -x "$ROOT/build/po2lmo" ] || { echo 'Build LuCI po2lmo into build/po2lmo first.' >&2; exit 1; }
mkdir -p "$ROOT/build/i18n"
"$ROOT/build/po2lmo" "$ROOT/luci-app-tailscale/po/zh_Hans/tailscale.po" "$ROOT/build/i18n/tailscale.zh-cn.lmo"
python3 "$ROOT/packaging/build_run.py"
