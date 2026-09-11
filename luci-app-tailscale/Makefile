include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-tailscale
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0

LUCI_TITLE:=LuCI support for Tailscale
LUCI_DESCRIPTION:=LuCI web interface to manage Tailscale on OpenWrt, \
  including service control, subnet routes and automatic firewall setup.
LUCI_DEPENDS:=+luci-base +tailscale
LUCI_PKGARCH:=all

define Package/$(PKG_NAME)/conffiles
/etc/config/tailscale
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
