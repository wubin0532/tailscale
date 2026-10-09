# tailscale-luci

OpenWrt 的 Tailscale 一体化管理包：合并二进制 + LuCI 管理界面 + 防火墙自动设置，单 ipk 安装。

## 功能

- **服务状态**：仪表盘式状态页（运行状态、当前节点、Tailscale IP、已绑定用户、公开网段），二维码扫码登录，节点密钥过期提醒，连接质量检测（netcheck）
- **节点列表**：tailnet 内全部设备（在线状态、直连/中继、最后在线时间、逐节点 ping 检测）
- **运行日志**：实时滚动查看 tailscaled 日志
- **全局设置**：允许组网、设备名称、公开网段（一键填入 LAN 网段）、认证密钥、Headscale 自建控制服务器、Tailscale SSH
- **出口节点**：作为出口节点供他人使用 / 使用其他出口节点
- **防火墙自动设置**：自动创建 tailscale 防火墙 zone（fw4）+ 独立控制 LAN → Tailscale 与 Tailscale → LAN 转发 + 入站端口白名单，幂等且只清理自身创建的规则
- **中英双语**：界面语言随 LuCI 系统语言自动切换
- **原生主题**：跟随 LuCI 系统主题（Argon 等）

## 安装

在 [Releases](https://github.com/wubin0532/tailscale/releases) 下载对应架构和系统版本的安装包：

- **使用 opkg 的固件**：`opkg install tailscale-luci_1.102.2-10_<架构>.ipk`
- **使用 apk 的固件**：`apk add --allow-untrusted tailscale-luci_1.102.2-10_<架构>.apk`

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

- OpenWrt 22.03+（fw4）；按固件实际包管理器选择 ipk（opkg）或 apk；不能仅凭版本号判断
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

`build-ipk.sh` 直接用本机 Go 交叉编译二进制 + UPX 压缩 + 手工组装安装包，每个架构产出 opkg 用的 `.ipk`；设置 `APK_MKPKG` 指向 apk-tools 3 后也产出 `.apk`：

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

## v1.2.3 修复与默认设置

- 配置通过 `tailscale set` 更新；保留登录身份和插件未管理的 DNS、netfilter 等偏好。CLI 错误、等待超时、操作忙和防火墙失败会显示在页面；控制连接与进程运行状态分开显示，控制/DNS 恢复后自动重试配置。
- 校验公开网段的 IPv4/IPv6 网络地址，禁止 `192.168.123.1/24` 这类带主机位的网段；出口节点填写 Tailscale IP 或设备名。
- 接受远程子网前检查其是否与本机 IPv4/IPv6 直连网络重叠；后台每 5 秒复查。检测到冲突会关闭实际接受路由并显示错误。移除冲突后重新保存应用；检查间隔内仍可能短暂出现冲突。
- 自动防火墙默认输入 **REJECT**、输出 **ACCEPT**、区域内转发 **REJECT**；默认仅允许 LAN → Tailscale，Tailscale → LAN 默认关闭。升级旧版自动区域会迁移到这些默认策略；手动管理的区域保持原样。
- NAT 源、目标限制默认留空。办公室访问家庭时可填：源 `192.168.123.0/24`、目标 `192.168.199.0/24`。留空表示不限制；这两个列表限制 NAT，并不授予转发权限。自动防火墙只重建 `ts_auto=1` 的规则，更新失败尝试恢复原配置。
- 修复启停设置未提交、注销失败误报成功、节点 Ping 按钮异常、登录窗口关闭后无法重开、升级浏览器缓存旧视图等问题。

### 验证与发布

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
node tests/test_views.js
./build-ipk.sh
```

升级前在路由器本机备份 `/etc/config/tailscale`、`/etc/config/firewall`、`/etc/tailscale` 和旧安装包，备份目录应仅允许 root 访问。不要删除状态文件或注销已登录节点。GitHub 标签构建生成草稿发布；确认真机验证及构建通过后再公开发布。
