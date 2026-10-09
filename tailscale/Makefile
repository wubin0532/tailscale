# Official Tailscale stable binaries, compressed with pinned UPX.
include $(TOPDIR)/rules.mk

PKG_NAME:=tailscale
PKG_VERSION:=1.104.1
PKG_RELEASE:=1
CORE_ARCH:=$(if $(filter aarch64,$(ARCH)),arm64,$(if $(filter arm,$(ARCH)),arm,$(if $(filter mipsel,$(ARCH)),mipsle,$(if $(filter x86_64,$(ARCH)),amd64))))
CORE_HASH_arm64:=f60294374967f3dfd8cf57bbbd474d6cfce32d123e3a8ddeab82a87940daa806
CORE_HASH_arm:=aea7ae225989d302444b10b44aa42e89fdfa2a691b4d124ed710b4753518a875
CORE_HASH_mipsle:=6ad1f6c2d26f54f61312303ae9d2bad7a71b505b83ffc08cd77ed7f89875b3ac
CORE_HASH_amd64:=108d1d96ecf410d305571e173516f27038f870919a9b89c914a167c6d33a4528
PKG_SOURCE:=tailscale_$(PKG_VERSION)_$(CORE_ARCH).tgz
PKG_SOURCE_URL:=https://pkgs.tailscale.com/stable
PKG_HASH:=$(CORE_HASH_$(CORE_ARCH))
PKG_BUILD_DIR:=$(BUILD_DIR)/tailscale_$(PKG_VERSION)_$(CORE_ARCH)
PKG_LICENSE:=BSD-3-Clause
PKG_MAINTAINER:=wubin0532
include $(INCLUDE_DIR)/package.mk

define Package/tailscale
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=VPN
  TITLE:=Official Tailscale binaries
  URL:=https://tailscale.com
  DEPENDS:=@(aarch64||arm||mipsel||x86_64) +ca-bundle +kmod-tun
endef

HOST_UPX?=upx

define Build/Compile
	[ "$$$$( $(HOST_UPX) --version | head -1 )" = "upx 5.2.1" ]
	for binary in tailscale tailscaled; do \
		$(HOST_UPX) --best --lzma -o $(PKG_BUILD_DIR)/$$$$binary.upx $(PKG_BUILD_DIR)/$$$$binary && \
		$(HOST_UPX) -t $(PKG_BUILD_DIR)/$$$$binary.upx && \
		$(HOST_UPX) -d -o $(PKG_BUILD_DIR)/$$$$binary.verify $(PKG_BUILD_DIR)/$$$$binary.upx && \
		cmp $(PKG_BUILD_DIR)/$$$$binary $(PKG_BUILD_DIR)/$$$$binary.verify && \
		rm $(PKG_BUILD_DIR)/$$$$binary.verify || exit 1; \
	done
endef

define Package/tailscale/conffiles
/etc/tailscale/
endef

define Package/tailscale/install
	$(INSTALL_DIR) $(1)/usr/sbin $(1)/etc/tailscale
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/tailscaled.upx $(1)/usr/sbin/tailscaled
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/tailscale.upx $(1)/usr/sbin/tailscale
endef

$(eval $(call BuildPackage,tailscale))
