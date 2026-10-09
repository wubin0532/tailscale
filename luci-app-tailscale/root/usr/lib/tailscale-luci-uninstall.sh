#!/bin/sh
# Standalone removal: deliberately do NOT source the service/JSON helper.
set -eu
umask 077
mode=purge
from_package=0
for arg in "$@"; do
    case "$arg" in
        --purge) mode=purge;;
        --keep-state) mode=keep;;
        --from-package) from_package=1;;
        --help|-h) echo 'Usage: uninstall [--purge (default) | --keep-state]'; exit 0;;
        *) echo "Unknown uninstall option: $arg" >&2; exit 2;;
    esac
done
fail() { echo "Uninstall refused: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail 'requires root'
[ -f /etc/rc.common ] && command -v uci >/dev/null || fail 'requires OpenWrt firmware'
# Use native package removal so the installed database and iStore stay consistent.
if [ "$from_package" = 0 ] && command -v opkg >/dev/null &&
    opkg status tailscale-luci-run 2>/dev/null | grep -q '^Status: .* installed$'; then
    TS_UNINSTALL_MODE=$mode; export TS_UNINSTALL_MODE
    exec opkg remove tailscale-luci-run
fi

safe_parents() {
    local parent=${1%/*}
    while [ "$parent" != / ] && [ -n "$parent" ]; do
        [ ! -L "$parent" ] || fail "symlink parent: $parent"
        parent=${parent%/*}
    done
}
owned_path() {
    case "$1" in ''|/*|*..*) return 1;; esac
    case "$1" in
        etc/config/tailscale|etc/init.d/tailscale|usr/sbin/tailscale|usr/sbin/tailscaled|usr/lib/tailscale-luci.sh|usr/lib/tailscale-luci-uninstall.sh|usr/lib/tailscale-luci/*|usr/libexec/rpcd/tailscale|usr/libexec/tailscale-*|usr/share/tailscale-luci/*|usr/share/luci/menu.d/luci-app-tailscale.json|usr/share/rpcd/acl.d/luci-app-tailscale.json|usr/lib/lua/luci/i18n/tailscale.*|www/luci-static/resources/tailscale/*|www/luci-static/resources/view/tailscale/*) return 0;;
        *) return 1;;
    esac
}
# Refuse to commit someone else's pending firewall/network edits.
for config in firewall network; do
    [ -z "$(uci -q changes "$config" 2>/dev/null)" ] || fail "unsaved $config changes; save or discard them first"
done
state=$(uci -q get tailscale.settings.state_file 2>/dev/null || true)
if [ "$mode" = purge ] && [ -n "$state" ]; then
    case "$state" in /*/tailscaled.state|/*/tailscale.state) ;; *) fail 'custom state path must end in tailscaled.state or tailscale.state';; esac
    case "$state" in *..*|*'
'*) fail 'unsafe state path';; esac
    # OpenWrt deliberately aliases /var to /tmp and /run to /tmp/run.
    case "$state" in
        /var/*) if [ -L /var ]; then
            case "$(readlink /var)" in tmp|/tmp) state=/tmp/${state#/var/};; *) fail 'unexpected /var alias';; esac
        fi;;
        /run/*) if [ -L /run ]; then
            case "$(readlink /run)" in /tmp/run) state=/tmp/run/${state#/run/};; *) fail 'unexpected /run alias';; esac
        fi;;
    esac
    safe_parents "$state"
    [ ! -L "$state" ] || fail 'identity file is a symlink; resolve it before purging'
fi
for path in /var/run/tailscale /usr/lib/tailscale-luci /usr/share/tailscale-luci /www/luci-static/resources/tailscale /www/luci-static/resources/view/tailscale; do
    # /var itself is a standard OpenWrt symlink; use /tmp for its runtime tree.
    case "$path" in /var/*) safe_parents /tmp/run/tailscale;; *) safe_parents "$path";; esac
done
[ ! -L /var/run/tailscale ] || fail 'runtime directory is a symlink'
mkdir -p /var/run/tailscale; chmod 700 /var/run/tailscale
for lock in install service operation; do [ ! -L "/var/run/tailscale/$lock.lock" ] || fail 'lock file is a symlink'; done
exec 6>/var/run/tailscale/install.lock
exec 8>/var/run/tailscale/service.lock
exec 7>/var/run/tailscale/operation.lock
lock_tool=/usr/lib/tailscale-luci/runtime/bin/flock
[ -x "$lock_tool" ] || lock_tool=$(command -v flock || true)
lock_fd() {
    if [ -n "$lock_tool" ]; then "$lock_tool" -n "$1"; return $?; fi
    local runtime=${TS_UNINSTALL_RUNTIME:-} loader
    [ -n "$runtime" ] || fail 'flock is unavailable; use package.run --uninstall to recover'
    loader=$(find "$runtime/lib" -name 'ld-musl-*.so.1' | head -1)
    [ -n "$loader" ] || fail 'recovery runtime lacks its loader'
    "$loader" --library-path "$runtime/lib:$runtime/usr/lib" "$runtime/usr/bin/util-linux-flock" -n "$1"
}
lock_fd 6 && lock_fd 8 && lock_fd 7 || fail 'cannot acquire locks; an operation is running or flock failed'
copy=$(mktemp /tmp/tailscale-remove.XXXXXX)
trap 'rm -f "$copy"' EXIT
trap 'exit 130' HUP INT TERM
manifest=/usr/share/tailscale-luci/installed-files
if [ -s "$manifest" ]; then
    cp "$manifest" "$copy"
else
    # Recover a partial installation, using only fixed plugin-owned destinations.
    printf '%s\n' etc/config/tailscale etc/init.d/tailscale usr/sbin/tailscale usr/sbin/tailscaled usr/lib/tailscale-luci.sh usr/lib/tailscale-luci-uninstall.sh usr/libexec/rpcd/tailscale usr/libexec/tailscale-route-watch usr/libexec/tailscale-route-check.awk usr/share/luci/menu.d/luci-app-tailscale.json usr/share/rpcd/acl.d/luci-app-tailscale.json > "$copy"
fi
while IFS= read -r path; do
    owned_path "$path" || fail "unsafe installed manifest: $path"
    safe_parents "/$path"
done < "$copy"
# Validate every directory before stopping anything, including old installer remnants.
dirs='/usr/lib/tailscale-luci /usr/share/tailscale-luci /www/luci-static/resources/tailscale /www/luci-static/resources/view/tailscale /usr/lib/lua/luci/view/tailscaler /www/luci-static/tailscaler'
purge_dirs='/etc/tailscale /tmp/lib/tailscale /root/tailscale-backup-v2'
for path in $dirs $purge_dirs /root/tailscale-install-backup-* /usr/lib/lua/luci/i18n/tailscale.zh-cn.lmo /etc/istore/uci-defaults_bak/50_luci-tailscaler /tmp/lib/luci-bwc/if/tailscale0 /tmp/.uci/tailscale /tmp/lock/procd_tailscale.lock /usr/share/istore/run-records/tailscale-record.txt; do safe_parents "$path"; done

timed() {
    local pid elapsed=0 result=0
    "$@" 6>&- 7>&- 8>&- & pid=$!
    while kill -0 "$pid" 2>/dev/null; do
        if [ "$elapsed" -ge 20 ]; then
            kill "$pid" 2>/dev/null || true; sleep 1
            kill -9 "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true
            return 124
        fi
        sleep 1; elapsed=$((elapsed + 1))
    done
    wait "$pid" || result=$?
    return "$result"
}
# procd deletion also works when config, helper or init script is already missing.
if [ -x /etc/init.d/tailscale ]; then
    timed /etc/init.d/tailscale stop >/dev/null 2>&1 || echo 'Init stop failed; trying procd directly.' >&2
fi
timed ubus call service delete '{"name":"tailscale"}' >/dev/null 2>&1 || true
service_status=$(timed ubus call service list '{"name":"tailscale"}' 2>/dev/null || true)
if printf '%s\n' "$service_status" | grep -q '"running"[[:space:]]*:[[:space:]]*true'; then fail 'procd still has running Tailscale instances; files retained'; fi
elapsed=0
while pidof tailscaled >/dev/null 2>&1; do
    [ "$elapsed" -lt 10 ] || fail 'tailscaled is still running; files retained'
    sleep 1; elapsed=$((elapsed + 1))
done
if [ -x /etc/init.d/tailscale ]; then timed /etc/init.d/tailscale disable >/dev/null 2>&1 || true; fi
for link in /etc/rc.d/*tailscale /etc/rc.d/*tailscaler; do
    [ ! -L "$link" ] || rm -f "$link"
done

# Only marked auto rules are removed for --keep-state. Purge also removes rules
# explicitly referencing the Tailscale zone; LAN/WAN and shared dependencies stay.
for kind in forwarding rule redirect zone; do
    index=0
    while uci -q get "firewall.@${kind}[$index]" >/dev/null 2>&1; do
        section="firewall.@${kind}[$index]"
        remove=0
        [ "$(uci -q get "$section.ts_auto" || true)" != 1 ] || remove=1
        if [ "$mode" = purge ]; then
            for option in src dest; do [ "$(uci -q get "$section.$option" || true)" != tailscale ] || remove=1; done
            if [ "$kind" = zone ] && [ "$(uci -q get "$section.name" || true)" = tailscale ]; then remove=1; fi
        fi
        if [ "$remove" = 1 ]; then uci -q delete "$section" || fail 'firewall deletion failed'; else index=$((index + 1)); fi
    done
done
uci commit firewall || fail 'firewall commit failed'
timed /etc/init.d/firewall reload || fail 'firewall reload failed; plugin files retained for retry'
# fw4 reload can retain obsolete EMPTY chains. Never flush unrelated tables.
zone_exists=0
index=0
while uci -q get "firewall.@zone[$index]" >/dev/null 2>&1; do
    [ "$(uci -q get "firewall.@zone[$index].name" || true)" != tailscale ] || zone_exists=1
    index=$((index + 1))
done
if [ "$zone_exists" = 0 ] && command -v nft >/dev/null; then
    for chain in input_tailscale output_tailscale forward_tailscale accept_to_tailscale reject_from_tailscale reject_to_tailscale srcnat_tailscale accept_from_tailscale; do
        if nft list chain inet fw4 "$chain" >/dev/null 2>&1; then
            nft delete chain inet fw4 "$chain" || fail "cannot remove stale chain $chain"
        fi
    done
fi
if [ "$mode" = purge ]; then
    index=0; network_changed=0
    while uci -q get "network.@interface[$index]" >/dev/null 2>&1; do
        section="network.@interface[$index]"
        if [ "$(uci -q get "$section.device" || true)" = tailscale0 ] || [ "$(uci -q get "$section.ifname" || true)" = tailscale0 ]; then
            uci -q delete "$section" || fail 'network deletion failed'; network_changed=1
        else index=$((index + 1)); fi
    done
    [ "$network_changed" = 0 ] || uci commit network || fail 'network commit failed'
    # No network-wide reload: removing an unused tunnel must not interrupt WAN.
    if [ -e /sys/class/net/tailscale0/tun_flags ]; then
        command -v ip >/dev/null || fail 'ip is unavailable for tunnel cleanup'
        ip link delete tailscale0 || fail 'tunnel deletion failed'
    fi
    [ -z "$state" ] || rm -f -- "$state"
    for path in $purge_dirs /root/tailscale-install-backup-*; do rm -rf -- "$path"; done
    rm -f /etc/config/tailscale /etc/config/tailscale-opkg /tmp/.uci/tailscale
    for path in /tmp/tailscale-*.log /tmp/tailscale-luci_*.ipk; do rm -f -- "$path"; done
fi
while IFS= read -r path; do
    [ "$path" != etc/config/tailscale ] || [ "$mode" != keep ] || continue
    rm -f -- "/$path"
done < "$copy"
for path in $dirs; do rm -rf -- "$path"; done
for path in /usr/lib/lua/luci/i18n/tailscale.* /etc/istore/uci-defaults_bak/50_luci-tailscaler /tmp/lock/procd_tailscale.lock /tmp/lock/procd_tailscaler.lock; do rm -f -- "$path"; done
rm -rf /tmp/lib/luci-bwc/if/tailscale0 /tmp/luci-indexcache /tmp/luci-modulecache
# Remove only records containing THIS package alone, never a shared install record.
for record in /usr/share/istore/run-records/*.txt; do
    [ -f "$record" ] || continue
    if [ "$(sed -n '2,$p' "$record")" = tailscale-luci-run ]; then rm -f "$record"; fi
done
timed /etc/init.d/rpcd reload || fail 'rpcd reload failed'
exec 6>&- 7>&- 8>&-
rm -rf /tmp/run/tailscale
if [ "$mode" = keep ]; then
    # Release lock descriptors before removing transient runtime files.
    echo 'Plugin removed. Configuration, login identity and recovery backups retained (--keep-state).'
else
    echo 'Tailscale removed: core, UI, configuration, identity, private dependencies, backups and firewall rules.'
fi
