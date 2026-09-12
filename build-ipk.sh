#!/bin/bash
# 手工打包 ipk（无 OpenWrt SDK 环境）
# 仅产出单包合并版 tailscale-luci：二进制 + LuCI 界面一体
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"
TS_VER=1.102.2
TS_REL=7

rm -rf "$DIST"
mkdir -p "$DIST"

# GNU tar 用 gnu，bsdtar（macOS）用 gnutar，两者都生成无 PAX 头的 tar
if tar --format=gnutar -cf /dev/null /dev/null 2>/dev/null; then
	TARFORMAT=gnutar
	TAROWNER="--uid=0 --gid=0"
else
	TARFORMAT=gnu
	TAROWNER="--owner=0 --group=0 --numeric-owner"
fi

pack_ipk() { # $1=pkg dir (含 data/ control/ ), $2=output
	local dir="$1" out="$2"
	# gnutar 格式：避免 macOS bsdtar 生成 busybox tar 不认识的 PAX 扩展头
	( cd "$dir/data"    && tar --format=$TARFORMAT $TAROWNER -czf "$dir/data.tar.gz" . )
	( cd "$dir/control" && tar --format=$TARFORMAT $TAROWNER -czf "$dir/control.tar.gz" . )
	echo "2.0" > "$dir/debian-binary"
	( cd "$dir" && tar --format=$TARFORMAT $TAROWNER -czf "$out" ./debian-binary ./control.tar.gz ./data.tar.gz )
	echo "built: $out"
}

pack_apk() { # $1=pkg dir (含 data/ 与 control/control 元数据), $2=output
	# apk v2 格式：gzip tar，成员为 .PKGINFO + data.tar.gz
	# data.tar.gz 由 pack_ipk 生成，这里直接复用；data/ 根部的
	# .post-install 等脚本由 apk 执行后丢弃，不会留在文件系统上
	local dir="$1" out="$2"
	local size
	size=$(($(du -sk "$dir/data" | cut -f1) * 1024))

	local pkgver pkgdesc url
	pkgver=$(sed -n 's/^Version: //p' "$dir/control/control")
	pkgdesc=$(sed -n 's/^Description: //p' "$dir/control/control" | tr '\n' ' ')
	url=$(sed -n 's/^URL: //p' "$dir/control/control")

	cat > "$dir/.PKGINFO" <<EOF
# apk v2
pkgname = tailscale-luci
pkgver = $pkgver
pkgdesc = $pkgdesc
url = $url
builddate = $(date +%s)
packager = wubin0532
size = $size
arch = $owrt_arch
origin = tailscale-luci
EOF
	sed -n 's/^Depends: //p'   "$dir/control/control" |
		tr ',' '\n' | sed 's/^ *//; s/^/depend = /' >> "$dir/.PKGINFO"
	sed -n 's/^Conflicts: //p' "$dir/control/control" |
		tr ',' '\n' | sed 's/^ *//; s/^/conflicts = /' >> "$dir/.PKGINFO"

	( cd "$dir" && tar --format=$TARFORMAT $TAROWNER -czf "$out" ./.PKGINFO ./data.tar.gz )
	echo "built: $out"
}

# ---------- 重新生成中文翻译 ----------
if [ -x "$ROOT/build/po2lmo" ]; then
	mkdir -p "$ROOT/build/i18n"
	"$ROOT/build/po2lmo" "$ROOT/luci-app-tailscale/po/zh_Hans/tailscale.po" \
		"$ROOT/build/i18n/tailscale.zh-cn.lmo"
fi

declare -a ARCHES=(
	"aarch64_cortex-a53:arm64"
	"arm_cortex-a7:armv7"
	"mipsel_24kc:mipsle"
	"x86_64:amd64"
)

# ---------- Luci 界面部分（所有架构共用，先备好暂存目录）----------
LUCI_STAGE="$DIST/stage-luci"
mkdir -p "$LUCI_STAGE"

# root 目录（UCI 配置、init 脚本、rpcd 后端、menu/acl）
( cd "$ROOT/luci-app-tailscale/root" && find . -name .DS_Store -delete; tar -cf - . ) | ( cd "$LUCI_STAGE" && tar -xf - )
# 全部静态资源（视图 JS、样式、二维码库）→ /www
mkdir -p "$LUCI_STAGE/www/luci-static/resources"
( cd "$ROOT/luci-app-tailscale/htdocs/luci-static/resources" && tar -cf - . ) | \
	( cd "$LUCI_STAGE/www/luci-static/resources" && tar -xf - )
# 中文翻译
mkdir -p "$LUCI_STAGE/usr/lib/lua/luci/i18n"
cp "$ROOT/build/i18n/tailscale.zh-cn.lmo" "$LUCI_STAGE/usr/lib/lua/luci/i18n/"

chmod 755 "$LUCI_STAGE/etc/init.d/tailscale" "$LUCI_STAGE/usr/libexec/rpcd/tailscale"
find "$LUCI_STAGE" -type f ! -path '*/init.d/*' ! -path '*/rpcd/tailscale' -exec chmod 644 {} +
find "$LUCI_STAGE" -type d -exec chmod 755 {} +

# ---------- 单包合并版 ----------
for pair in "${ARCHES[@]}"; do
	owrt_arch="${pair%%:*}"
	go_arch="${pair##*:}"
	pkg="$DIST/pkg-full-$owrt_arch"
	mkdir -p "$pkg/data/usr/sbin" "$pkg/data/etc/tailscale" "$pkg/control"

	# UPX 压缩后的二进制
	cp "$ROOT/build/bin/upx/tailscaled-linux-$go_arch" "$pkg/data/usr/sbin/tailscaled"
	chmod 755 "$pkg/data/usr/sbin/tailscaled"
	ln -sf tailscaled "$pkg/data/usr/sbin/tailscale"

	cp -a "$LUCI_STAGE/." "$pkg/data/"

	size=$(du -sk "$pkg/data" | cut -f1)
	cat > "$pkg/control/control" <<EOF
Package: tailscale-luci
Version: $TS_VER-$TS_REL
Architecture: $owrt_arch
Maintainer: wubin0532
Section: net
URL: https://github.com/wubin0532/tailscale
Installed-Size: $size
Depends: luci-base, rpcd, ca-bundle, kmod-tun
Conflicts: tailscale, luci-app-tailscale
Description: Tailscale all-in-one package: combined binary (UPX compressed, Tailscale SSH enabled), procd service, UCI config and LuCI web interface with peers list, logs, exit node and automatic firewall setup.
EOF

	cat > "$pkg/control/conffiles" <<EOF
/etc/config/tailscale
EOF

	cat > "$pkg/control/postinst" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	rm -rf /tmp/luci-indexcache /tmp/luci-modulecache 2>/dev/null
	/etc/init.d/rpcd reload 2>/dev/null
	# upgrade: restart if the service was enabled
	if [ "$1" = "configure" ] && /etc/init.d/tailscale enabled 2>/dev/null; then
		/etc/init.d/tailscale start >/dev/null 2>&1 &
	fi
}
exit 0
EOF

	cat > "$pkg/control/prerm" <<'EOF'
#!/bin/sh
# upgrade: only stop the daemon, keep the service enabled and config intact
if [ "$1" = "upgrade" ]; then
	[ -n "${IPKG_INSTROOT}" ] || /etc/init.d/tailscale stop >/dev/null 2>&1
	exit 0
fi
[ -n "${IPKG_INSTROOT}" ] || {
	/etc/init.d/tailscale stop 2>/dev/null
	/etc/init.d/tailscale disable 2>/dev/null
	rm -rf /tmp/luci-indexcache /tmp/luci-modulecache 2>/dev/null
}
exit 0
EOF
	chmod 755 "$pkg/control/postinst" "$pkg/control/prerm"

	# apk 生命周期脚本（apk v2：放在 data 包根部，执行后不留存）
	# 参数语义与 opkg 不同，不依赖 $1
	cat > "$pkg/data/.post-install" <<'EOF'
#!/bin/sh
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache 2>/dev/null
/etc/init.d/rpcd reload 2>/dev/null
/etc/init.d/tailscale enabled 2>/dev/null && /etc/init.d/tailscale start >/dev/null 2>&1 &
exit 0
EOF
	cat > "$pkg/data/.post-upgrade" <<'EOF'
#!/bin/sh
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache 2>/dev/null
/etc/init.d/rpcd reload 2>/dev/null
/etc/init.d/tailscale enabled 2>/dev/null && /etc/init.d/tailscale start >/dev/null 2>&1 &
exit 0
EOF
	cat > "$pkg/data/.pre-upgrade" <<'EOF'
#!/bin/sh
/etc/init.d/tailscale stop >/dev/null 2>&1
exit 0
EOF
	cat > "$pkg/data/.pre-deinstall" <<'EOF'
#!/bin/sh
/etc/init.d/tailscale stop 2>/dev/null
/etc/init.d/tailscale disable 2>/dev/null
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache 2>/dev/null
exit 0
EOF
	chmod 755 "$pkg/data/".post-install "$pkg/data/".post-upgrade \
		"$pkg/data/".pre-upgrade "$pkg/data/".pre-deinstall

	pack_ipk "$pkg" "$DIST/tailscale-luci_${TS_VER}-${TS_REL}_${owrt_arch}.ipk"
	pack_apk "$pkg" "$DIST/tailscale-luci_${TS_VER}-${TS_REL}_${owrt_arch}.apk"
done

rm -rf "$DIST"/pkg-* "$LUCI_STAGE"
ls -la "$DIST"
