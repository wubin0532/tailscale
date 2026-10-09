#!/bin/sh
# Transactional installation on an existing fw4 + LuCI router.
set -eu
umask 077
stage=$1
arch=$2
version=$3
data=$stage/data
runtime=$data/usr/lib/tailscale-luci/runtime
fail() { echo "Install refused: $*" >&2; exit 1; }
for path in /lib/functions.sh /etc/rc.common /usr/share/luci /etc/init.d/rpcd /etc/init.d/firewall; do
    [ -e "$path" ] || fail "missing firmware framework: $path"
done
for cmd in uci ubus procd fw4 sha256sum tar awk; do command -v "$cmd" >/dev/null || fail "missing firmware command: $cmd"; done
[ -c /dev/net/tun ] || fail 'TUN support is missing; install the module matching this firmware kernel first.'
[ "$(id -u)" = 0 ] || fail 'requires root'
[ -f "$stage/FILES" ] && [ -f "$stage/SHA256SUMS" ] || fail 'missing manifest'
(cd "$data"; sha256sum -c "$stage/SHA256SUMS" >/dev/null) || fail 'file checksum mismatch'
# Test the private musl runtime on the target BEFORE stopping any service.
loader=$(find "$runtime/lib" -name 'ld-musl-*.so.1' | head -1)
[ -n "$loader" ] || fail 'missing bundled loader'
# Shell positional slicing is not portable; use an explicit shift.
dep() { executable=$1; shift; "$loader" --library-path "$runtime/lib:$runtime/usr/lib" "$runtime/$executable" "$@"; }
dep usr/bin/curl --version >/dev/null || fail 'bundled curl cannot run'
dep usr/libexec/ip-full -Version >/dev/null || fail 'bundled ip cannot run'
printf '{"ok":true}\n' | dep usr/bin/jsonfilter -e '@.ok' | grep -qx true || fail 'bundled JSON tools cannot run'
"$data/usr/sbin/tailscale" version | head -1 | grep -qx '@CORE_VERSION@' || fail 'combined core CLI cannot run'
"$data/usr/sbin/tailscaled" --version | head -1 | grep -q '^@CORE_VERSION@' || fail 'daemon cannot run'
# Private install lock and the same service/operation locks used by RPC.
mkdir -p /var/run/tailscale; chmod 700 /var/run/tailscale
exec 6>/var/run/tailscale/install.lock
dep usr/bin/util-linux-flock -n 6 || fail 'another installation is running'
exec 8>/var/run/tailscale/service.lock
exec 7>/var/run/tailscale/operation.lock
dep usr/bin/util-linux-flock -n 8 && dep usr/bin/util-linux-flock -n 7 || fail 'a Tailscale operation is running'
for package in tailscale luci-app-tailscale; do
    if command -v opkg >/dev/null && opkg status "$package" 7>&- 8>&- | grep -q '^Status: .* installed$'; then fail "conflicting package $package is installed"; fi
    if command -v apk >/dev/null && apk info -e "$package" 7>&- 8>&- >/dev/null 2>&1; then fail "conflicting package $package is installed"; fi
done
# Ensure persistent storage can hold the new installation AND a recovery copy.
needed=$(du -sk "$data" | awk '{print $1}')
available=$(df -Pk /usr | awk 'END {print $4}')
[ "$available" -gt "$((needed * 2 + 16384))" ] || fail 'not enough persistent free space for installation and rollback'
backup=/root/tailscale-backup-v2/run-$version-$(date +%Y%m%d-%H%M%S)-$$
mkdir -p "$backup"; chmod 700 "$backup"
existing=$backup/existing
: > "$existing"
# Include both old manifest entries and new destinations so replacement is reversible.
cat "$stage/FILES" > "$backup/managed"
[ ! -f /usr/share/tailscale-luci/installed-files ] || cat /usr/share/tailscale-luci/installed-files >> "$backup/managed"
if command -v opkg >/dev/null && opkg status tailscale-luci 7>&- 8>&- | grep -q '^Status: .* installed$'; then
    [ ! -f /usr/lib/opkg/info/tailscale-luci.list ] || sed 's,^/,,' /usr/lib/opkg/info/tailscale-luci.list >> "$backup/managed"
    awk 'BEGIN{RS="";ORS="\n\n"} /^Package: tailscale-luci\n/' /usr/lib/opkg/status > "$backup/opkg-record"
    mkdir "$backup/opkg-info"
    cp -p /usr/lib/opkg/info/tailscale-luci.* "$backup/opkg-info/"
fi
if command -v apk >/dev/null && apk info -e tailscale-luci 7>&- 8>&- >/dev/null 2>&1; then
    # APK's installed database is shared. Refuse migration until rollback is supported.
    fail 'existing APK installation: remove tailscale-luci after backing up config/identity, then run this installer'
fi
# Only known package paths may be managed; never allow arbitrary manifest paths.
sort -u "$backup/managed" > "$backup/managed.tmp"; mv "$backup/managed.tmp" "$backup/managed"
while IFS= read -r path; do
    case "$path" in ''|/*|*..*) fail 'unsafe managed path';; esac
    case "$path" in etc/config/tailscale|etc/init.d/tailscale|usr/sbin/tailscale|usr/sbin/tailscaled|usr/lib/tailscale-luci.sh|usr/lib/tailscale-luci-uninstall.sh|usr/lib/tailscale-luci/*|usr/libexec/rpcd/tailscale|usr/libexec/tailscale-*|usr/share/tailscale-luci/*|usr/share/luci/menu.d/luci-app-tailscale.json|usr/share/rpcd/acl.d/luci-app-tailscale.json|usr/lib/lua/luci/i18n/tailscale.*|www/luci-static/resources/tailscale/*|www/luci-static/resources/view/tailscale/*) ;; *) fail "unexpected managed file: $path";; esac
    [ ! -e "/$path" ] && [ ! -L "/$path" ] || printf '%s\n' "$path" >> "$existing"
done < "$backup/managed"
configured_state=$(uci -q get tailscale.settings.state_file 7>&- 8>&- 6>&- 2>/dev/null || true)
case "$configured_state" in /*) case "$configured_state" in *..*|*'
'*) fail 'unsafe configured state path';; esac
    [ ! -f "$configured_state" ] || printf '%s\n' "${configured_state#/}" >> "$existing";; esac
for path in etc/config/firewall etc/tailscale; do [ ! -e "/$path" ] || echo "$path" >> "$existing"; done
for path in /etc/rc.d/*tailscale; do [ ! -e "$path" ] && [ ! -L "$path" ] || echo "${path#/}" >> "$existing"; done
# Check a conservative bound for the actual previous files, not a guessed core size.
old_kb=0
while IFS= read -r path; do
    size=$(du -sk "/$path" | awk '{print $1}')
    old_kb=$((old_kb + size))
done < "$existing"
[ "$available" -gt "$((needed + old_kb + 16384))" ] || fail 'not enough persistent space for the previous installation backup'
tar -czf "$backup/before.tar.gz" -C / -T "$existing"
# Confirm the recovery archive is readable before making any changes.
tar -tzf "$backup/before.tar.gz" >/dev/null
[ ! -f /etc/config/tailscale ] || cp -p /etc/config/tailscale "$backup/config"
was_enabled=0; was_running=0
[ ! -x /etc/init.d/tailscale ] || ! /etc/init.d/tailscale enabled 7>&- 8>&- 6>&- >/dev/null 2>&1 || was_enabled=1
pidof tailscaled >/dev/null 2>&1 && was_running=1
changed=0
rollback() {
    status=$?
    trap - EXIT HUP INT TERM
    if [ "$changed" = 1 ]; then
        echo "Installation failed; restoring previous files from $backup" >&2
        /etc/init.d/tailscale stop 7>&- 8>&- 6>&- >/dev/null 2>&1 || true
        while IFS= read -r path; do rm -f "/$path"; done < "$backup/managed"
        tar -xzf "$backup/before.tar.gz" -C /
        if [ -s "$backup/opkg-record" ]; then
            awk 'BEGIN{RS="";ORS="\n\n"} !/^Package: tailscale-luci\n/' /usr/lib/opkg/status > "$backup/opkg-status"
            cat "$backup/opkg-record" >> "$backup/opkg-status"
            cat "$backup/opkg-status" > /usr/lib/opkg/status
            cp -p "$backup/opkg-info/"* /usr/lib/opkg/info/
        fi
        exec 7>&- 8>&-
        /etc/init.d/firewall reload >/dev/null 2>&1 || true
        /etc/init.d/rpcd reload >/dev/null 2>&1 || true
        [ "$was_running" = 0 ] || /etc/init.d/tailscale start >/dev/null 2>&1 || true
    fi
    exit "$status"
}
trap rollback EXIT
trap 'exit 130' HUP INT TERM
changed=1
[ ! -x /etc/init.d/tailscale ] || /etc/init.d/tailscale stop 7>&- 8>&- 6>&- >/dev/null 2>&1
if [ -s "$backup/opkg-record" ]; then opkg remove tailscale-luci 7>&- 8>&- 6>&-; fi
# Replace only plugin-owned files; preserve config and all login identity files.
while IFS= read -r path; do
    [ "$path" = etc/config/tailscale ] && [ -f "$backup/config" ] && continue
    rm -f "/$path"
done < "$backup/managed"
(cd "$data"; tar -cf - .) | tar -xf - -C /
[ ! -f "$backup/config" ] || cp -p "$backup/config" /etc/config/tailscale
chmod 600 /etc/config/tailscale
cp "$stage/FILES" /usr/share/tailscale-luci/installed-files
if [ "$was_enabled" = 1 ]; then /etc/init.d/tailscale enable 7>&- 8>&- 6>&-; fi
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache
/etc/init.d/rpcd reload 7>&- 8>&- 6>&-
exec 7>&-
if [ "$was_running" = 1 ] || [ "$was_enabled" = 1 ]; then
    /etc/init.d/tailscale start 8>&- 6>&-
    count=0
    until /usr/lib/tailscale-luci/runtime/bin/curl -fsS --unix-socket /var/run/tailscale/tailscaled.sock --noproxy '*' --connect-timeout 1 --max-time 2 http://local-tailscaled.sock/localapi/v0/status >/dev/null 8>&- 6>&- 2>/dev/null; do
        count=$((count+1)); [ "$count" -lt 30 ] || { echo 'Daemon LocalAPI failed to start' >&2; exit 1; }; sleep 1
    done
fi
exec 8>&-
changed=0
trap - EXIT HUP INT TERM
echo "Installed Tailscale LuCI v$version ($arch); one combined core @CORE_VERSION@."
echo "Config and identity preserved. Recovery backup: $backup"
echo 'Control connection may take time to recover; check LuCI service status.'
