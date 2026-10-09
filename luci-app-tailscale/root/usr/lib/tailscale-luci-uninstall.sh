#!/bin/sh
# Remove only the files recorded by this installer; retain config and identity.
set -eu
[ "$(id -u)" = 0 ] || { echo 'Run as root' >&2; exit 1; }
. /usr/lib/tailscale-luci.sh
manifest=/usr/share/tailscale-luci/installed-files
[ -s "$manifest" ] || { echo 'Missing .run install manifest' >&2; exit 1; }
umask 077
mkdir -p /var/run/tailscale
exec 6>/var/run/tailscale/install.lock
exec 8>/var/run/tailscale/service.lock
exec 7>/var/run/tailscale/operation.lock
flock -n 6 && flock -n 8 && flock -n 7 || { echo 'An operation is running' >&2; exit 1; }
# Validate the ENTIRE list before stopping/removing anything.
while IFS= read -r path; do
    case "$path" in ''|/*|*..*) echo 'Unsafe installed manifest' >&2; exit 1;; esac
    case "$path" in etc/config/tailscale|etc/init.d/tailscale|usr/sbin/tailscale|usr/sbin/tailscaled|usr/lib/tailscale-luci.sh|usr/lib/tailscale-luci-uninstall.sh|usr/lib/tailscale-luci/*|usr/libexec/rpcd/tailscale|usr/libexec/tailscale-*|usr/share/tailscale-luci/*|usr/share/luci/menu.d/luci-app-tailscale.json|usr/share/rpcd/acl.d/luci-app-tailscale.json|usr/lib/lua/luci/i18n/tailscale.*|www/luci-static/resources/tailscale/*|www/luci-static/resources/view/tailscale/*) ;; *) echo "Unexpected path: $path" >&2; exit 1;; esac
done < "$manifest"
copy=$(mktemp /tmp/tailscale-remove.XXXXXX)
trap 'rm -f "$copy"' EXIT HUP INT TERM
cp "$manifest" "$copy"
/etc/init.d/tailscale stop 6>&- 7>&- 8>&-
/etc/init.d/tailscale disable 6>&- 7>&- 8>&-
while IFS= read -r path; do
    [ "$path" = etc/config/tailscale ] || rm -f "/$path"
done < "$copy"
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache
/etc/init.d/rpcd reload 6>&- 7>&- 8>&-
echo 'Plugin removed; /etc/config/tailscale and /etc/tailscale identity retained.'
