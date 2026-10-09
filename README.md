# Tailscale LuCI v2.0

OpenWrt 的 Tailscale 管理插件，包含经 UPX 压缩的官方独立 `tailscale`、`tailscaled` 二进制和 LuCI 界面。插件版本 `v2.0`，IPK 版本 `2.0.0-1`，APK 版本 `2.0.0-r1`；核心独立显示为 `1.104.1`。

## 功能

- 状态卡片区分进程运行、登录授权、控制连接、请求失败和过期数据；提供扫码登录、连接检测及独立的身份清理区。
- 设备页显示核心实际返回的在线和离线节点，支持搜索、在线筛选。检测结果按稳定节点 ID 保存，刷新不会吞掉正在执行的 Ping 或结果。
- 设置按连接与子网、网络与防火墙、高级设置分组，配置项与说明直接展开。四页采用统一宽度的轻量卡片布局，跟随 LuCI 浅色、深色主题；重要操作以颜色和文字区分，手机上设备表格改为卡片。
- 日志支持暂停、继续、筛选、复制和自动跟随；刷新失败保留旧内容。HTTP 页面没有剪贴板权限时可选中文本复制。
- 状态查询通过 Unix socket LocalAPI，页面和路由保护共享最长 5 秒的私有快照，常规查询不启动 Go CLI。锁由内核 `flock` 管理，进程异常退出后自动释放。
- 接收远程子网前检查 IPv4/IPv6 直连网段冲突，并每 5 秒复查；过期或正在刷新的数据不能用于确认路由安全。冲突会关闭实际路由接收并反馈错误，处理冲突后重新应用。

设备列表受核心和访问策略限制，不能保证看到整个 tailnet。核心没有返回的节点不会由界面虚构。

## 安装

从 [main 构建页面](https://github.com/wubin0532/tailscale/actions/workflows/release.yml?query=branch%3Amain) 打开通过的构建，下载 `tailscale-luci-packages` 产物，按固件架构与包管理器选择文件，并对照 `SHA256SUMS-v2.0.txt` 校验。按维护者要求，v2.0 代码直接交付到 main，不创建版本标签或 GitHub Release。

```sh
# 使用 opkg 的固件
opkg install ./tailscale-luci_2.0.0-1_aarch64_cortex-a53.ipk
# 使用 apk 的固件（apk v3）
apk add --allow-untrusted ./tailscale-luci_2.0.0-r1_aarch64_cortex-a53.apk
/etc/init.d/rpcd restart
```

| 包架构 | 官方核心架构 |
|---|---|
| aarch64_cortex-a53 | arm64 |
| arm_cortex-a7 | arm |
| mipsel_24kc | mipsle |
| x86_64 | amd64 |

要求 fw4 固件，以及 `luci-base`、`rpcd`、`ca-bundle`、`kmod-tun`、`jsonfilter`、`ip-full`、`curl`、`flock`。按固件实际包管理器选择 IPK/APK。已有官方 `tailscale` 包时先备份配置和身份，再处理包冲突。

本版直接使用[官方稳定下载](https://pkgs.tailscale.com/stable/)的原始二进制，不做精简编译；再用 UPX 5.2.1 压缩以节约路由器存储，每份压缩文件均验证解压内容与官方文件一致。升级前确认剩余存储。保留官方默认内存参数，不把 VSZ 当实际内存。

升级前将 `/etc/config/tailscale`、`/etc/config/firewall`、`/etc/tailscale` 和旧包备份到 root 专用目录。普通升级保留身份；“身份与配置清理”会删除登录状态，需重新授权。

## 办公室访问家庭与 VPS

1. 家庭路由器发布家庭网段，例如 `192.168.199.0/24`，在 Tailscale 管理后台批准。
2. 办公室路由器开启“访问远程内网”，避免远程路由与办公室 LAN 重叠。只访问家庭时不必发布办公室网段，也不必配置互联网出口节点。
3. VPS 加入同一个 tailnet，允许对应访问策略和主机服务端口，然后通过 VPS 的 `100.x.x.x` 地址访问。访问 VPS 本机不需要发布子网。

自动防火墙默认输入 **REJECT**、输出 **ACCEPT**、区域内转发 **REJECT**；默认 LAN → Tailscale 开启，Tailscale → LAN 关闭。仅管理带 `ts_auto=1` 的规则，保留手动规则；更新失败尝试恢复原配置。

NAT 限制默认留空。例如源地址可填办公室 `192.168.123.0/24`；目标限制若只填写家庭网段，还要添加 VPS 的 `100.x.x.x/32` 才能同时对 VPS 做 NAT。NAT 限制仅选择做地址转换的流量，不授予访问权限，也不能代替访问控制。不要把源网段、公开网段和目标地址混填。

## 构建与验证

`core-version.env` 固定插件及核心版本，`official-sha256.txt` 固定四种架构官方归档的 SHA-256。`fetch-core.sh` 下载并校验归档，`prepare-core.sh` 使用固定 UPX 压缩并验证可逆性，每次复用缓存仍检查校验和。`build-ipk.sh` 安装两份 UPX 压缩核心；APK 使用 apk-tools 3，非 root 构建须使用 fakeroot。

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
node tests/test_views.js
./fetch-core.sh
# 先构建 LuCI po2lmo，并放到 build/po2lmo
./build-ipk.sh
# Linux 上构建全部 IPK/APK
APK_MKPKG=/path/to/apk-tools-3 fakeroot ./build-ipk.sh
```

SDK 构建主机须提供 UPX 5.2.1（可通过 `HOST_UPX` 指定路径）。SDK 编译使用 `tailscale/Makefile` 和 `luci-app-tailscale/Makefile`，同样下载固定官方归档。GitHub Actions 在 main 推送及手工触发时构建 IPK/APK 并保存产物；仅将实机验证过的同一文件作为交付包。ARM64 IPK 的实测范围与其它架构/APK 的构建验证分开记录，见 [v2.0 验证记录](docs/validation-v2.0.md)。
