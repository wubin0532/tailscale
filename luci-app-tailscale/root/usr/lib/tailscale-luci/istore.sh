#!/bin/sh
# iStore's native dotrun creates the first record from package-list differences.
# Direct CLI installs and upgrades need a record too; never patch iStore itself.
ts_istore_record() {
    local arch=$1 version=$2 registered_before=$3 digest ts id record tmp
    digest=$(md5sum "${TS_RUN_SOURCE:-/usr/share/tailscale-luci/registration.ipk}" | awk '{print $1}') || return 1
    case "$digest" in ''|*[!a-f0-9]*) return 1;; esac
    # Let dotrun create its own initial record, avoiding duplicates.
    if [ "$registered_before" = 0 ] && [ -f "/tmp/is-root/tmp/pre_$digest.txt" ]; then return 0; fi
    ts=$(date +%s); id=$ts-$digest
    mkdir -p /usr/share/istore/run-records || return 1
    tmp=$(mktemp /usr/share/istore/run-records/tailscale-record.XXXXXX) || return 1
    printf '{"id":"%s","ts":%s,"md5":"%s","file":"tailscale-luci_%s_%s.run"}\ntailscale-luci-run\n' "$id" "$ts" "$digest" "$version" "$arch" > "$tmp" || { rm -f "$tmp"; return 1; }
    mv "$tmp" "/usr/share/istore/run-records/$id.txt" || { rm -f "$tmp"; return 1; }
    ts_record_created=/usr/share/istore/run-records/$id.txt
    for record in /usr/share/istore/run-records/*.txt; do
        [ "$record" != "$ts_record_created" ] || continue
        [ -f "$record" ] || continue
        if [ "$(sed -n '2,$p' "$record")" = tailscale-luci-run ]; then rm -f "$record" || return 1; fi
    done
}
