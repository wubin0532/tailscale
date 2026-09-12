# tailscale-luci

OpenWrt 的 Tailscale 一体化管理包：合并二进制 + LuCI 管理界面 + 防火墙自动设置，单 ipk 安装。

## 功能

- **服务状态**：仪表盘式状态页（运行状态、当前节点、Tailscale IP、已绑定用户、公开网段），二维码扫码登录，节点密钥过期提醒，连接质量检测（netcheck）
- **节点列表**：tailnet 内全部设备（在线状态、直连/中继、最后在线时间、逐节点 ping 检测）
- **运行日志**：实时滚动查看 tailscaled 日志
- **全局设置**：允许组网、设备名称、公开网段（一键填入 LAN 网段）、认证密钥、Headscale 自建控制服务器、Tailscale SSH
- **出口节点**：作为出口节点供他人使用 / 使用其他出口节点
- **防火墙自动设置**：自动创建 tailscale 防火墙 zone（fw4）+ LAN 双向转发 + 入站端口白名单，幂等且只清理自身创建的规则
- **中英双语**：界面语言随 LuCI 系统语言自动切换
- **原生主题**：跟随 LuCI 系统主题（Argon 等）

## 安装

在 [Releases](https://github.com/wubin0532/tailscale/releases) 下载对应架构和系统版本的安装包：

- **OpenWrt 22.03 – 23.05**（opkg）：`opkg install tailscale-luci_1.102.2-7_<架构>.ipk`
- **OpenWrt 24.10 / 25.x**（apk）：`apk add --allow-untrusted tailscale-luci_1.102.2-7_<架构>.apk`

安装后执行：

```sh
/etc/init.d/rpcd restart
```

| 架构 | 适用 |
|---|---|
| aarch64_cortex-a53 | 64 位 ARM 路由器 |
| arm_cortex-a7 | 32 位 ARM 路由器 |
| mipsel_24kc | MT7621 等 mipsel 设备 |
| x86_64 | x86 软路由 |

若已安装官方 tailscale 包导致冲突：安装前先卸载官方包（opkg 系统 `opkg remove tailscale`，apk 系统 `apk del tailscale`）。

## 要求

- OpenWrt 22.03+（fw4）；ipk 用于 opkg 系统（≤23.05），apk 用于 apk 系统（24.10+）
- 二进制为合并二进制 extra-small 构建 + UPX 压缩（~6.6–8.2MB），RAM < 64MB 的设备请谨慎使用

## 从源码构建

### 方式一：OpenWrt SDK（交叉编译完整固件包）

```sh
echo "src-link tailscale_feed /path/to/this/repo" >> feeds.conf.default
./scripts/feeds update tailscale_feed
./scripts/feeds install -a -p tailscale_feed
make menuconfig   # Network -> VPN -> tailscale；LuCI -> Applications -> luci-app-tailscale
make package/tailscale/compile V=s
make package/luci-app-tailscale/compile V=s
```

### 方式二：本机直编（无需 SDK）

`build-ipk.sh` 直接用本机 Go 交叉编译二进制 + UPX 压缩 + 手工组装安装包，每个架构同时产出 opkg 用的 `.ipk` 和 apk 用的 `.apk`：

```sh
./build-ipk.sh   # 产物在 dist/
```

## 目录结构

```
tailscale/                        # SDK 用二进制包定义（Makefile/Config.in）
luci-app-tailscale/
├── htdocs/luci-static/resources/
│   ├── tailscale/qrcode.min.js   # 二维码库（vendor）
│   └── view/tailscale/           # status / peers / log / settings 视图
├── po/zh_Hans/tailscale.po       # 中文翻译（英文为默认 msgid）
└── root/
    ├── etc/config/tailscale      # UCI 配置
    ├── etc/init.d/tailscale      # procd 服务（含防火墙自动配置）
    ├── usr/libexec/rpcd/tailscale  # rpcd 后端（status/log/netcheck/ping/logout）
    └── usr/share/{luci/menu.d,rpcd/acl.d}/  # 菜单与权限注册
```
