#
# Copyright (C) 2021 CZ.NIC, z. s. p. o. (https://www.nic.cz/)
#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=tailscale
PKG_VERSION:=1.102.2
PKG_RELEASE:=1

PKG_SOURCE:=$(PKG_NAME)-$(PKG_VERSION).tar.gz
PKG_SOURCE_URL:=https://codeload.github.com/tailscale/tailscale/tar.gz/v$(PKG_VERSION)?
PKG_HASH:=66c447b5555aa89e0690dc21e0ec59421302ceaa982f3ccc0df686b16f5d5505

PKG_MAINTAINER:=Zephyr Lykos <self@mochaa.ws>, \
		Sandro Jäckel <sandro.jaeckel@gmail.com>
PKG_LICENSE:=BSD-3-Clause
PKG_LICENSE_FILES:=LICENSE
PKG_CPE_ID:=cpe:/a:tailscale:tailscale

PKG_BUILD_DEPENDS:=golang/host
PKG_BUILD_PARALLEL:=1
PKG_BUILD_FLAGS:=no-mips16

GO_PKG:=tailscale.com/cmd/tailscaled
GO_PKG_LDFLAGS:=-X 'tailscale.com/version.longStamp=$(PKG_VERSION)-$(PKG_RELEASE) (OpenWrt)'
GO_PKG_LDFLAGS_X:=tailscale.com/version.shortStamp=$(PKG_VERSION)
GO_PKG_TAGS:=ts_include_cli,ts_omit_aws,ts_omit_bird,ts_omit_completion,ts_omit_kube,ts_omit_systray,ts_omit_taildrop,ts_omit_tap,ts_omit_tpm

ifeq ($(CONFIG_TAILSCALE_EXTRA_SMALL),y)
GO_PKG_TAGS+=,ts_omit_acme,ts_omit_connectivity_control,ts_omit_debugeventbus,ts_omit_debugportmapper,ts_omit_desktop_sessions,ts_omit_drive,ts_omit_kubernetes,ts_omit_oauthkey,ts_omit_outboundproxy,ts_omit_posture,ts_omit_ssh
GO_PKG_LDFLAGS+= -s -w
endif

include $(INCLUDE_DIR)/package.mk
include ../../lang/golang/golang-package.mk

define Package/tailscale/config
	source "$(SOURCE)/Config.in"
endef

define Package/tailscale
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=VPN
  TITLE:=Zero config VPN
  URL:=https://tailscale.com
  DEPENDS:=$(GO_ARCH_DEPENDS) +ca-bundle +kmod-tun
  PROVIDES:=tailscaled
endef

define Package/tailscale/description
  It creates a secure network between your servers, computers,
  and cloud instances. Even when separated by firewalls or subnets.
  This package ships the combined tailscaled/tailscale binary only;
  init script, UCI config and LuCI interface are provided by
  luci-app-tailscale.
endef

define Build/Compile
	$(call GoPackage/Build/Compile)
ifeq ($(CONFIG_TAILSCALE_UPX),y)
	upx --lzma --best $(GO_PKG_BUILD_BIN_DIR)/tailscaled
endif
endef

define Package/tailscale/conffiles
/etc/tailscale/
endef

define Package/tailscale/install
	$(INSTALL_DIR) $(1)/usr/sbin $(1)/etc/tailscale
	$(INSTALL_BIN) $(GO_PKG_BUILD_BIN_DIR)/tailscaled $(1)/usr/sbin
	$(LN) tailscaled $(1)/usr/sbin/tailscale
endef

$(eval $(call BuildPackage,tailscale))
