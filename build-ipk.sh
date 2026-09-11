#!/bin/bash
# 手工打包 ipk（无 OpenWrt SDK 环境）
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"
TS_VER=1.102.2
TS_REL=2
LUCI_VER=1.0.0
LUCI_REL=1

rm -rf "$DIST"
mkdir -p "$DIST"

pack_ipk() { # $1=pkg dir (含 data/ control/ ), $2=output
	local dir="$1" out="$2"
	( cd "$dir/data"    && tar --uid=0 --gid=0 --numeric-owner -czf "$dir/data.tar.gz" . )
	( cd "$dir/control" && tar --uid=0 --gid=0 --numeric-owner -czf "$dir/control.tar.gz" . )
	echo "2.0" > "$dir/debian-binary"
	( cd "$dir" && tar --uid=0 --gid=0 --numeric-owner -czf "$out" ./debian-binary ./control.tar.gz ./data.tar.gz )
	echo "built: $out"
}

# ---------- tailscale 二进制包 ----------
declare -a ARCHES=(
	"aarch64_cortex-a53:arm64"
	"arm_cortex-a7:armv7"
	"mipsel_24kc:mipsle"
	"x86_64:amd64"
)

for pair in "${ARCHES[@]}"; do
	owrt_arch="${pair%%:*}"
	go_arch="${pair##*:}"
	pkg="$DIST/pkg-tailscale-$owrt_arch"
	mkdir -p "$pkg/data/usr/sbin" "$pkg/data/etc/tailscale" "$pkg/control"

	# 优先使用 UPX 压缩后的二进制
	if [ -f "$ROOT/build/bin/upx/tailscaled-linux-$go_arch" ]; then
		cp "$ROOT/build/bin/upx/tailscaled-linux-$go_arch" "$pkg/data/usr/sbin/tailscaled"
	else
		cp "$ROOT/build/bin/tailscaled-linux-$go_arch" "$pkg/data/usr/sbin/tailscaled"
	fi
	chmod 755 "$pkg/data/usr/sbin/tailscaled"
	ln -sf tailscaled "$pkg/data/usr/sbin/tailscale"

	size=$(du -sk "$pkg/data" | cut -f1)
	cat > "$pkg/control/control" <<EOF
Package: tailscale
Version: $TS_VER-$TS_REL
Architecture: $owrt_arch
Maintainer: wubin0532
Section: net
Installed-Size: $size
Depends: ca-bundle, kmod-tun
Provides: tailscaled
Description: Zero config VPN (combined tailscaled/tailscale binary, extra-small build, UPX compressed).
 Init script, UCI config and LuCI interface are provided by luci-app-tailscale.
EOF

	pack_ipk "$pkg" "$DIST/tailscale_${TS_VER}-${TS_REL}_${owrt_arch}.ipk"
done

# ---------- luci-app-tailscale ----------
pkg="$DIST/pkg-luci-app-tailscale"
mkdir -p "$pkg/data" "$pkg/control"

# root 目录（UCI 配置、init 脚本、rpcd 后端、menu/acl）
( cd "$ROOT/luci-app-tailscale/root" && find . -name .DS_Store -delete; tar -cf - . ) | ( cd "$pkg/data" && tar -xf - )
# LuCI 视图 → /www
mkdir -p "$pkg/data/www/luci-static/resources/view/tailscale"
cp "$ROOT/luci-app-tailscale/htdocs/luci-static/resources/view/tailscale/"*.js \
   "$pkg/data/www/luci-static/resources/view/tailscale/"
# 中文翻译
mkdir -p "$pkg/data/usr/lib/lua/luci/i18n"
cp "$ROOT/build/i18n/tailscale.zh-cn.lmo" "$pkg/data/usr/lib/lua/luci/i18n/"

chmod 755 "$pkg/data/etc/init.d/tailscale" "$pkg/data/usr/libexec/rpcd/tailscale"
find "$pkg/data" -type f ! -path '*/init.d/*' ! -path '*/rpcd/tailscale' -exec chmod 644 {} +
find "$pkg/data" -type d -exec chmod 755 {} +

size=$(du -sk "$pkg/data" | cut -f1)
cat > "$pkg/control/control" <<EOF
Package: luci-app-tailscale
Version: $LUCI_VER-$LUCI_REL
Architecture: all
Maintainer: wubin0532
Section: luci
Installed-Size: $size
Depends: luci-base, tailscale, rpcd
Description: LuCI web interface to manage Tailscale on OpenWrt,
 including service control, subnet routes and automatic firewall setup.
EOF

cat > "$pkg/control/conffiles" <<EOF
/etc/config/tailscale
EOF

cat > "$pkg/control/postinst" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	rm -rf /tmp/luci-indexcache /tmp/luci-modulecache 2>/dev/null
	/etc/init.d/rpcd reload 2>/dev/null
}
exit 0
EOF

cat > "$pkg/control/prerm" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	/etc/init.d/tailscale stop 2>/dev/null
	/etc/init.d/tailscale disable 2>/dev/null
	rm -rf /tmp/luci-indexcache /tmp/luci-modulecache 2>/dev/null
}
exit 0
EOF
chmod 755 "$pkg/control/postinst" "$pkg/control/prerm"

pack_ipk "$pkg" "$DIST/luci-app-tailscale_${LUCI_VER}-${LUCI_REL}_all.ipk"

rm -rf "$DIST"/pkg-*
ls -la "$DIST"
