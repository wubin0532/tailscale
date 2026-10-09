# Tailscale LuCI v2.2.0

[English](#english) · [简体中文](#简体中文)

## English

Tailscale management for OpenWrt, LibWrt and compatible iStoreOS firmware. Plugin **v2.2.0**, offline installer **2.2.0-r2**, core **1.104.1**. Releases contain four architecture-specific `.run` installers and a SHA-256 checksum list.

The interface follows **System → System → Language and Style → Language** in LuCI: Simplified Chinese selects Chinese; English selects English. **Auto** follows LuCI's own language negotiation. Plugin-specific text without a translation falls back to English; shared LuCI controls keep their system translations. Save the system language and reload the page to switch menus, buttons, help, validation messages and time formatting. No separate plugin language setting is needed. Core logs, command output without a translation, device names and network addresses retain their original values.

### Features

- Status cards distinguish the daemon, login, control connection, request failures and stale data. QR-code login, network checks and identity cleanup have separate controls.
- The devices page shows online and offline peers returned by the core, with search and an online filter. Ping progress and results survive polling, keyed by stable node IDs.
- All four pages use the same lightweight card layout, support LuCI light/dark themes and mobile screens, and mark important actions with color and text. Settings and help remain expanded.
- Logs support pause/resume, filtering, copying and auto-follow. Failed refreshes preserve previous content; text can be selected when clipboard access is unavailable.
- Routine status queries use the Unix socket LocalAPI. The UI and route guard share a private snapshot for up to five seconds, avoiding repeated Go CLI processes. Kernel `flock` releases locks after a process exits.
- Remote subnet routes are checked against directly connected IPv4/IPv6 networks before activation and every five seconds. Stale data cannot confirm route safety; a conflict disables route acceptance and reports the reason.

Peer visibility is controlled by the core and access policy. The UI does not invent missing devices.

### Core and offline dependencies

The full-feature core is built from pinned official source using upstream `build_dist.sh --box --strip`, then compressed with **UPX 5.2.1**. There are no `ts_omit_*` build tags. Only one `tailscaled` binary is installed; `tailscale` is a symlink to it. This is an official-source build, not an official prebuilt binary. UPX reduces disk use; it does not guarantee lower RSS. Official default memory parameters are retained.

Each installer includes curl, jsonfilter, jshn, ip-full, flock, CA certificates and their user-space libraries, including a private musl loader. Dependencies live under `/usr/lib/tailscale-luci/runtime`; system tools and libraries are not overwritten, and installation does not download dependencies.

The firmware must already provide **LuCI, rpcd, procd, UCI, fw4, BusyBox and TUN support matching the running kernel**. Framework, architecture, runtime or disk-space checks fail before stopping an existing service.

| `uname -m` | Installer | User-space baseline |
|---|---|---|
| aarch64 | arm64 | Cortex-A53 |
| armv7l | arm | ARMv7 Cortex-A7 / NEON / VFPv4 |
| mips / mipsel, little-endian | mipsle | MIPS 24Kc, little-endian soft float |
| x86_64 | amd64 | x86-64 |

### Install and upgrade

Download the matching `.run` and `SHA256SUMS-v2.2.0-run.txt` from [Releases](https://github.com/wubin0532/tailscale/releases/tag/v2.0). Run as root on the router:

```sh
uname -m
# The checksum list covers all four architectures. If downloading one installer,
# compare that file's checksum with its corresponding line instead.
sha256sum -c SHA256SUMS-v2.2.0-run.txt
# Home x86-64 example
sh tailscale-luci_2.2.0-r2_amd64.run --check
sh tailscale-luci_2.2.0-r2_amd64.run --install
# Inspect without installation; destination must not already exist
sh tailscale-luci_2.2.0-r2_amd64.run --extract /tmp/tailscale-inspect
```

`--check` validates the embedded payload; the external checksum verifies the whole installer.

Upgrades preserve `/etc/config/tailscale`, identity, manual firewall rules and service/startup state. A root-only recovery backup is created before replacement; failures restore the previous files, configuration and service. Legacy `tailscale-luci` IPK records are migrated while shared system dependencies remain installed. Other maintainers' `tailscale` / `luci-app-tailscale` packages are rejected as conflicts. Automatic migration from a legacy `tailscale-luci` APK is not supported: back up configuration and identity, remove the old plugin, then install.

New installations leave the service disabled; enable it and log in from LuCI. A successful installation verifies local runtime and API operation; the control connection may recover later. Home hardware testing is performed by the maintainer; isolated build validation does not establish router network stability.

### Uninstall

```sh
# Full removal: program, configuration, identity, private dependencies,
# recovery backups and Tailscale firewall rules
sh /usr/lib/tailscale-luci-uninstall.sh
# Remove the program, retaining configuration, identity and recovery backups
sh /usr/lib/tailscale-luci-uninstall.sh --keep-state
# Recover removal when installed files are missing
sh tailscale-luci_2.2.0-r2_amd64.run --uninstall
sh tailscale-luci_2.2.0-r2_amd64.run --uninstall-keep-state
```

On **opkg-based iStoreOS**, the `.run` embeds a tiny native management package, `tailscale-luci-run`, with no shared-library dependencies. It registers the installation with opkg so the iStore manual-install history and uninstall action work. Direct SSH installs and repeated upgrades also maintain this record. No separate IPK download is needed. APK firmware supports CLI installation/removal but is not yet integrated with iStore native history.

Removal refuses concurrent operations and uncommitted firewall/network changes. Stop, cleanup or reload failures return a nonzero status. Missing configuration, helper scripts or manifests can be recovered. Custom state files must be named `tailscaled.state` or `tailscale.state` and use paths without symlink parents. Full removal does not delete the device entry from the Tailscale admin console. LuCI's identity-cleanup action removes login/configuration while leaving the installed plugin in place; login is required again afterward.

### Office, Home and VPS

1. Home advertises its LAN, such as `192.168.199.0/24`; approve it in the Tailscale admin console.
2. Office enables **Access remote subnets**, ensuring remote routes do not overlap Office LAN. Accessing Home does not require advertising Office LAN or selecting an internet exit node.
3. Join the VPS to the same tailnet, allow the required access policy and host service ports, then use its `100.x.x.x` address. Accessing the VPS itself does not require a subnet advertisement.

Automatic firewall defaults are **REJECT / ACCEPT / REJECT** for input/output/intra-zone forwarding. LAN → Tailscale is enabled by default; Tailscale → LAN is disabled. Only rules marked `ts_auto=1` are managed; manual rules remain. Failed updates attempt to restore the previous configuration.

NAT limits default to empty. A source example is Office `192.168.123.0/24`. To match both Home and a VPS as destinations, add `192.168.199.0/24` and the VPS Tailscale address with `/32`. NAT limits select traffic for translation; they do not grant access or replace access controls. Source ranges, advertised routes and destination ranges serve different purposes.

### Build and verify

`core-version.env` pins the plugin, Go **1.27.1**, UPX, upstream commit and archive checksum. `prepare-core.sh` validates source and build directories, builds the complete combined core, strips/compresses it, and checks that UPX decoding reproduces the original binary. `dependencies.lock.json` pins dependency versions, URLs, SHA-256 checksums and licenses for all four architectures.

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
node tests/test_views.js
# Build LuCI po2lmo into build/po2lmo first
./build-run.sh
python3 tests/verify_run.py
# Linux + qemu-user: execute every architecture's CLI and private dependencies
python3 tests/verify_run.py --execute
# Linux/root: isolated native opkg/iStore lifecycle checks
sudo python3 tests/verify_native_registration.py
```

English is the source language; Chinese translations are in [`tailscale.po`](luci-app-tailscale/po/zh_Hans/tailscale.po), compiled into LuCI's standard `tailscale.zh-cn.lmo`. Coverage checks include menus, views, status states, fixed backend messages and formatting placeholders. The CI also reads compiled translations using upstream LuCI's LMO implementation.

Building downloads pinned source, Go modules and dependencies; **installation is offline**. Dependency `--resolve` is only for maintaining the lock file. GitHub Actions builds from `main` or manual dispatch; it does not publish releases automatically. The existing `v2.0` tag remains unchanged, and no new branches/tags are created. Each package's `build.json` records its actual build commit. Earlier validation: [v2.0](docs/validation-v2.0.md), [`.run` candidate](docs/validation-run-v2.0.md).

## 简体中文

OpenWrt/LibWrt 的 Tailscale 管理插件，插件界面版本 **v2.2.0**，离线自解压安装器版本 **2.2.0-r2**，核心版本 **1.104.1**。对外交付 `.run`，不单独发布 IPK/APK。

界面跟随 LuCI 的 **系统 → 系统 → 语言和界面 → 语言**：简体中文显示中文，English 显示英文；“自动”沿用 LuCI 的语言选择，未提供译文的插件文案回退到英文，LuCI 通用控件保留系统译文。保存系统语言后刷新页面，菜单、按钮、帮助、校验提示和时间格式一起切换，无需单独设置插件语言。核心原始日志、未提供译文的命令输出、设备名称和网络地址保留原文。

从固定的官方源码构建完整功能核心，使用上游 `build_dist.sh --box --strip` 合并 CLI 与守护进程，再以 UPX 5.2.1 压缩。只安装一份 `tailscaled`；`tailscale` 是指向它的符号链接。没有使用任何 `ts_omit_*` 精简标签。此核心是官方源码构建产物，并非官方预编译文件。

### 功能

- 状态卡片区分进程运行、登录授权、控制连接、请求失败和过期数据；提供扫码登录、连接检测及独立的身份清理区。
- 设备页显示核心实际返回的在线和离线节点，支持搜索、在线筛选。检测结果按稳定节点 ID 保存，刷新不会吞掉正在执行的 Ping 或结果。
- 设置按连接与子网、网络与防火墙、高级设置分组，配置项与说明直接展开。四页采用统一宽度的轻量卡片布局，跟随 LuCI 浅色、深色主题；重要操作以颜色和文字区分，手机上设备表格改为卡片。
- 日志支持暂停、继续、筛选、复制和自动跟随；刷新失败保留旧内容。HTTP 页面没有剪贴板权限时可选中文本复制。
- 状态查询通过 Unix socket LocalAPI，页面和路由保护共享最长 5 秒的私有快照，常规查询不启动 Go CLI。锁由内核 `flock` 管理，进程异常退出后自动释放。
- 接收远程子网前检查 IPv4/IPv6 直连网段冲突，并每 5 秒复查；过期或正在刷新的数据不能用于确认路由安全。冲突会关闭实际路由接收并反馈错误，处理冲突后重新应用。

设备列表受核心和访问策略限制，不能保证看到整个 tailnet。核心没有返回的节点不会由界面虚构。

### 离线安装与升级

下载 [Releases](https://github.com/wubin0532/tailscale/releases/tag/v2.0) 中与 CPU 对应的 `.run` 及 `SHA256SUMS-v2.2.0-run.txt`。本次由用户自行在 Home x86-64 真机测试；构建验证通过后直接更新 Release，尚未标为真机通过。

```sh
uname -m
sha256sum -c SHA256SUMS-v2.2.0-run.txt
# Home x86-64 示例；上传到路由器后以 root 执行
sh tailscale-luci_2.2.0-r2_amd64.run --check
sh tailscale-luci_2.2.0-r2_amd64.run --install
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
sh tailscale-luci_2.2.0-r2_amd64.run --extract /tmp/tailscale-inspect
# 完整卸载：清除配置、设备身份、私有依赖、备份和 Tailscale 防火墙规则
sh /usr/lib/tailscale-luci-uninstall.sh
# 仅移除程序，保留配置、身份与恢复备份，供再次安装
sh /usr/lib/tailscale-luci-uninstall.sh --keep-state
# 已缺少卸载脚本时，用原安装包进行恢复卸载
sh tailscale-luci_2.2.0-r2_amd64.run --uninstall
sh tailscale-luci_2.2.0-r2_amd64.run --uninstall-keep-state
```

在使用 **opkg 的 iStoreOS** 上，`.run` 内携带一个约几 KB 的原生管理包 `tailscale-luci-run`，没有共享库依赖。安装器通过 opkg 登记；iStore 手动安装记录中的“卸载”会调用内置的完整清理脚本。SSH 直接安装和重复升级也维护该记录，不修改 iStore 本身。对外仍只发布 `.run`，不需要单独下载安装 IPK。APK 固件目前可以安装和通过上述 CLI 卸载，但尚未接入 iStore 的原生管理记录。

卸载会拒绝与正在执行的服务/配置操作并发；如防火墙或网络存在未保存的修改，先保存或放弃这些修改再卸载。停止服务、删除规则或重载失败会返回非零状态。缺少配置、辅助脚本或安装清单时仍可恢复清理。自定义身份文件必须位于不经过符号链接的路径，且文件名为 `tailscaled.state` 或 `tailscale.state`，避免误删其它应用文件。完整卸载不会删除 Tailscale 控制台中的设备记录。

“身份与配置清理”会删除登录状态，需重新授权。UPX 节约磁盘空间，不能据此承诺实际 RSS 下降；保留官方默认内存参数。

### 办公室访问家庭与 VPS

1. 家庭路由器发布家庭网段，例如 `192.168.199.0/24`，在 Tailscale 管理后台批准。
2. 办公室路由器开启“访问远程内网”，避免远程路由与办公室 LAN 重叠。只访问家庭时不必发布办公室网段，也不必配置互联网出口节点。
3. VPS 加入同一个 tailnet，允许对应访问策略和主机服务端口，然后通过 VPS 的 `100.x.x.x` 地址访问。访问 VPS 本机不需要发布子网。

自动防火墙默认输入 **REJECT**、输出 **ACCEPT**、区域内转发 **REJECT**；默认 LAN → Tailscale 开启，Tailscale → LAN 关闭。仅管理带 `ts_auto=1` 的规则，保留手动规则；更新失败尝试恢复原配置。

NAT 限制默认留空。例如源地址可填办公室 `192.168.123.0/24`；目标限制若只填写家庭网段，还要添加 VPS 的 `100.x.x.x/32` 才能同时对 VPS 做 NAT。NAT 限制仅选择做地址转换的流量，不授予访问权限，也不能代替访问控制。不要把源网段、公开网段和目标地址混填。

### 构建与验证

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

英文作为界面源语言，中文译文位于 [`tailscale.po`](luci-app-tailscale/po/zh_Hans/tailscale.po)，构建为标准 LuCI `tailscale.zh-cn.lmo`。覆盖检查包括菜单、四页文案、运行状态、固定后端提示和格式参数；CI 同时使用上游 LuCI 的 LMO 实现验证编译后译文。
