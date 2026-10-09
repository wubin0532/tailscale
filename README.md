# Tailscale LuCI v2.0

OpenWrt/LibWrt 的 Tailscale 管理插件，插件界面版本 **v2.0**，离线自解压安装器版本 **2.0.0-r2**，核心版本 **1.104.1**。交付格式为 `.run`，不再构建 IPK/APK。

从固定的官方源码构建完整功能核心，使用上游 `build_dist.sh --box --strip` 合并 CLI 与守护进程，再以 UPX 5.2.1 压缩。只安装一份 `tailscaled`；`tailscale` 是指向它的符号链接。没有使用任何 `ts_omit_*` 精简标签。此核心是官方源码构建产物，并非官方预编译文件。

## 功能

- 状态卡片区分进程运行、登录授权、控制连接、请求失败和过期数据；提供扫码登录、连接检测及独立的身份清理区。
- 设备页显示核心实际返回的在线和离线节点，支持搜索、在线筛选。检测结果按稳定节点 ID 保存，刷新不会吞掉正在执行的 Ping 或结果。
- 设置按连接与子网、网络与防火墙、高级设置分组，配置项与说明直接展开。四页采用统一宽度的轻量卡片布局，跟随 LuCI 浅色、深色主题；重要操作以颜色和文字区分，手机上设备表格改为卡片。
- 日志支持暂停、继续、筛选、复制和自动跟随；刷新失败保留旧内容。HTTP 页面没有剪贴板权限时可选中文本复制。
- 状态查询通过 Unix socket LocalAPI，页面和路由保护共享最长 5 秒的私有快照，常规查询不启动 Go CLI。锁由内核 `flock` 管理，进程异常退出后自动释放。
- 接收远程子网前检查 IPv4/IPv6 直连网段冲突，并每 5 秒复查；过期或正在刷新的数据不能用于确认路由安全。冲突会关闭实际路由接收并反馈错误，处理冲突后重新应用。

设备列表受核心和访问策略限制，不能保证看到整个 tailnet。核心没有返回的节点不会由界面虚构。

## 离线安装与升级

下载 [Releases](https://github.com/wubin0532/tailscale/releases/tag/v2.0) 中与 CPU 对应的 `.run` 及 `SHA256SUMS-v2.0-run.txt`。新安装器经过真机验证后才替换公开交付包；请以 Release 资产和验证记录为准。

```sh
uname -m
sha256sum -c SHA256SUMS-v2.0-run.txt
# Home x86-64 示例；上传到路由器后以 root 执行
sh tailscale-luci_2.0.0-r2_amd64.run --check
sh tailscale-luci_2.0.0-r2_amd64.run --install
```

校验清单包含四个架构；只下载一个包时，可单独对照该行校验。`--check` 验证内置载荷校验和，外部 SHA-256 清单用于核对完整文件。

| `uname -m` | 安装器架构 | 用户态依赖基线 |
|---|---|---|
| aarch64 | arm64 | aarch64 Cortex-A53 |
| armv7l | arm | ARMv7 Cortex-A7 / NEON / VFPv4 |
| mips / mipsel，小端 | mipsle | MIPS 24Kc、小端软浮点 |
| x86_64 | amd64 | x86-64 |

安装器离线携带 curl、jsonfilter、jshn、ip-full、flock、CA 证书和全部对应用户态库，包括私有 musl 加载器。依赖位于 `/usr/lib/tailscale-luci/runtime`，不覆盖系统工具或库，也不联网安装依赖。

固件须已有 **LuCI、rpcd、procd、UCI、fw4、BusyBox 和与当前内核匹配的 TUN 支持**。这些属于固件框架，不能用同一个用户态安装器跨内核替换。缺少框架、架构不符、依赖无法运行或空间不足时，安装器在停止原服务前退出。ARM 包要求上述 CPU 指令集；MIPS 包只支持小端。

普通升级保留 `/etc/config/tailscale`、现有设备身份和手动防火墙规则。安装前建立 root 专用恢复备份；替换失败时恢复旧文件、配置及原服务。升级旧的 `tailscale-luci` IPK 时会迁移其包记录，保留系统依赖。其它维护者的 `tailscale` / `luci-app-tailscale` 包会报冲突，避免直接覆盖。已有 `tailscale-luci` APK 的自动迁移尚不支持：先备份配置与身份、卸载旧插件，再运行安装器。

新安装默认保持服务关闭，在 LuCI 中启用并登录。升级保持原服务启停与开机启动状态。控制连接可能晚于本地进程恢复；安装成功只确认本地核心和 API 可运行。

```sh
# 只解压到一个尚不存在的目录
sh tailscale-luci_2.0.0-r2_amd64.run --extract /tmp/tailscale-inspect
# 卸载 .run 安装的文件，保留配置和登录身份
sh /usr/lib/tailscale-luci-uninstall.sh
```

“身份与配置清理”会删除登录状态，需重新授权。UPX 节约磁盘空间，不能据此承诺实际 RSS 下降；保留官方默认内存参数。

## 办公室访问家庭与 VPS

1. 家庭路由器发布家庭网段，例如 `192.168.199.0/24`，在 Tailscale 管理后台批准。
2. 办公室路由器开启“访问远程内网”，避免远程路由与办公室 LAN 重叠。只访问家庭时不必发布办公室网段，也不必配置互联网出口节点。
3. VPS 加入同一个 tailnet，允许对应访问策略和主机服务端口，然后通过 VPS 的 `100.x.x.x` 地址访问。访问 VPS 本机不需要发布子网。

自动防火墙默认输入 **REJECT**、输出 **ACCEPT**、区域内转发 **REJECT**；默认 LAN → Tailscale 开启，Tailscale → LAN 关闭。仅管理带 `ts_auto=1` 的规则，保留手动规则；更新失败尝试恢复原配置。

NAT 限制默认留空。例如源地址可填办公室 `192.168.123.0/24`；目标限制若只填写家庭网段，还要添加 VPS 的 `100.x.x.x/32` 才能同时对 VPS 做 NAT。NAT 限制仅选择做地址转换的流量，不授予访问权限，也不能代替访问控制。不要把源网段、公开网段和目标地址混填。

## 构建与验证

`core-version.env` 固定插件版本、Go 1.27.1、UPX 5.2.1、上游源码提交与归档 SHA-256。`prepare-core.sh` 验证源码和构建目录，完整功能合并编译、去符号、压缩，并核对 UPX 解压后与本次原始构建完全一致。`dependencies.lock.json` 固定四种架构的 OpenWrt 用户态依赖版本、URL、校验和及许可证。

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
node tests/test_views.js
# 先将 LuCI po2lmo 构建到 build/po2lmo
./build-run.sh
python3 tests/verify_run.py
# Linux + qemu-user：校验全部架构的 CLI 与用户态依赖可执行
python3 tests/verify_run.py --execute
```

构建需要网络下载固定源码、Go 模块和固定依赖；**安装时不需要网络或包管理器安装依赖**。依赖解析的 `--resolve` 仅用于维护锁文件，普通构建不会解析最新包。

GitHub Actions 只从 main 或手工触发构建 `.run` 和校验清单，不自动公开 Release。新产物记录真实构建提交，已有 v2.0 标签保持不动，不新建开发分支或其它标签。验证记录见 [旧版 v2.0 包验证](docs/validation-v2.0.md) 和 [`.run` 候选验证](docs/validation-run-v2.0.md)。
