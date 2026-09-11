# luci-app-tailscale

OpenWrt 的 Tailscale LuCI 管理界面，包含：

- **tailscale**：Tailscale 合并二进制包（CLI + daemon 一体，支持 extra-small 构建与 UPX 压缩，见
  [Tailscale 官方文档](https://tailscale.com/docs/how-to/set-up-small-tailscale)）
- **luci-app-tailscale**：LuCI 界面（服务状态 / 全局设置）+ procd 服务 + **防火墙自动设置**

## 功能

### 服务状态页
- 启用/禁用服务
- 运行状态、当前节点、Tailscale IP、已绑定用户
- 未登录时显示登录链接；已登录可一键「注销登录并解除绑定」

### 全局设置页
- 允许组网（`--accept-routes`）
- 设备名称（`--hostname`，留空使用系统主机名）
- 公开网段（`--advertise-routes`，如 `192.168.199.0/24`）
- 认证密钥（`--auth-key`，可选，免浏览器自动登录）

### 防火墙自动设置
开启后服务启动时自动执行（基于 fw4，需 OpenWrt 22.03+）：

1. 创建 `tailscale` 防火墙区域（设备 `tailscale0`，可配置入站策略、NAT 伪装、MTU fix）
2. 可选创建 `lan ↔ tailscale` 双向转发规则
3. 自动写入 UCI 防火墙配置并 reload，重启不丢失

规则带 `ts_auto=1` 标记：已存在同名 zone 时跳过（幂等），关闭功能或服务停止时仅移除本脚本创建的规则，不触碰用户手动配置。

## 构建

在 OpenWrt 源码树 / SDK 中：

```sh
# 添加本 feed
echo "src-link tailscale_feed /path/to/this/repo" >> feeds.conf.default
./scripts/feeds update tailscale_feed
./scripts/feeds install -a -p tailscale_feed

make menuconfig
# Network -> VPN -> tailscale        （可选 EXTRA_SMALL / UPX 压缩）
# LuCI -> Applications -> luci-app-tailscale

make package/tailscale/compile V=s
make package/luci-app-tailscale/compile V=s
```

> 注意：本 feed 的 `tailscale` 包与官方 packages feed 同名，请只启用其一
> （本 feed 优先，或 `./scripts/feeds uninstall tailscale` 官方版本后再装本 feed 版本）。
> 本包不自带 init/config，由 `luci-app-tailscale` 提供。

## 安装到路由器

```sh
scp bin/packages/<arch>/tailscale_feed/*.ipk root@router:/tmp/
ssh root@router
opkg install /tmp/tailscale_*.ipk /tmp/luci-app-tailscale_*.ipk
/etc/init.d/rpcd restart
```

然后在 LuCI「服务 → Tailscale」中启用并登录。

## 目录结构

```
tailscale/                        # 二进制包（combined binary，可选 UPX）
luci-app-tailscale/
├── htdocs/luci-static/resources/view/tailscale/
│   ├── status.js                 # 服务状态页
│   └── settings.js               # 全局设置 + 防火墙设置页
├── po/zh_Hans/tailscale.po       # 中文翻译
└── root/
    ├── etc/config/tailscale      # UCI 配置
    ├── etc/init.d/tailscale      # procd 服务（含防火墙自动配置）
    ├── usr/libexec/rpcd/tailscale  # rpcd 后端（get_status / get_log / logout）
    ├── usr/share/luci/menu.d/luci-app-tailscale.json
    └── usr/share/rpcd/acl.d/luci-app-tailscale.json
```

## 要求

- OpenWrt 22.03 / 23.05 / 24.10（fw4）
- 架构需支持 Go（官方 tailscale 包的架构要求相同）
- Flash 紧张时可开启 `TAILSCALE_EXTRA_SMALL`（默认开）与 `TAILSCALE_UPX`（需构建主机安装 upx）
