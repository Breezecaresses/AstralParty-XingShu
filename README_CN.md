<h1 align="center">AstralParty-XingShu</h1>

<h3 align="center">感谢您选择 AstralParty-XingShu（星枢）！</h3>

<p align="center">
  <strong>反馈问题与建议：QQ 群 <code>1080908767</code> &nbsp;|&nbsp; <a href="https://discord.gg/dxVS6ZF393">Discord</a></strong>
</p>

<p align="center">
  <img src="AstralParty-Hub/public/brand/xingshu.svg" width="128" alt="AstralParty-XingShu" />
</p>

<p align="center">
  纯启动器架构 · 模块化官方插件 · 回放复盘 · 模组工坊 · 全新 Compose 安卓端
</p>

<p align="center">
  <a href="https://github.com/Breezecaresses/AstralParty-XingShu/releases"><img src="https://img.shields.io/github/v/release/Breezecaresses/AstralParty-XingShu?include_prereleases&label=release&color=3b82f6" alt="Release" /></a>
  <img src="https://img.shields.io/badge/Hub-Tauri%202%20%7C%20Rust-orange.svg" alt="Tauri Rust" />
  <img src="https://img.shields.io/badge/Frontend-React%2019%20%7C%20TypeScript-blue.svg" alt="React TS" />
  <img src="https://img.shields.io/badge/Android-Kotlin%20%7C%20Compose-7f52ff.svg" alt="Kotlin Compose" />
  <img src="https://img.shields.io/badge/Runtime-C%23%20%7C%20.NET-purple.svg" alt="C# .NET" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20Android%20%7C%20Web-lightgrey.svg" alt="Platform" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Source%20Available-blue.svg" alt="License: Source Available &amp; Fair Use" /></a>
</p>

<p align="center">
  <a href="https://github.com/Breezecaresses/AstralParty-XingShu/releases/tag/v0.1.8">下载 v0.1.8</a> ·
  <a href="https://astralparty-xingshu.lanxichaxu.cn/xingshu-hub/">在线网页版</a> ·
  <a href="docs/README.md">文档与验证记录</a> ·
  <a href="README.md">English</a> · <a href="README_CN.md">简体中文</a>
</p>

---

## 正式版本

[下载星枢 v0.1.8](https://github.com/Breezecaresses/AstralParty-XingShu/releases/tag/v0.1.8)（详见[发布记录](docs/records/RELEASE_0.1.8.md)），电脑端与安卓手机端同步适配《吉星派对》`3.3.0`（资源版本 `160`）。

| 平台 | 获取方式 | 说明 |
| --- | --- | --- |
| **Windows 桌面端** | `XingShu_Hub_0.1.8_x64-setup.exe` / `XingShu_Desktop_0.1.8.zip` | **极简纯启动器 + 完全独立热更新核心**：提供一键安装包与便携包（仅含 `Hub/xingshu-hub.exe` 与说明文档）。通过远端 `core-manifest.json` 热更新核心插件而无需升级启动器，集成 4 路并发 SHA-256 缓存下载、重排 Mod 详情与表情回应，并可按需安装**星枢官方插件 Mod**（`r8.41` LZ4）与 **19 项官方模块**。 |
| **在线网页版** | [astralparty-xingshu.lanxichaxu.cn/xingshu-hub](https://astralparty-xingshu.lanxichaxu.cn/xingshu-hub/) | 免安装打开即用：Modrinth 风格社区**模组 / 卡牌 / 皮肤工坊**浏览下载与作者投稿、星枢平台账号体系、UID 战绩查询、`.rep` / 对局编号回放深度分析与离线全量图鉴。 |
| **安卓手机端** | `XingShu_Android_0.1.8.apk` / `XingShu_Android_0.1.8.zip` | 全新 Kotlin + Jetpack Compose Material 3 **轻量纯启动器**：支持直装 APK 或极简 ZIP（仅含 `星枢启动器.apk` 与说明文件）。新增独立 `CoreRuntimeSpec`（`android-core-manifest.json`）与 Shizuku/ADB 同步，后续核心框架与游戏新版本更新无需重装 APK 即可在线热更。详见[手机安装说明](docs/guides/ANDROID_PHONE_INSTALL.md)。 |

> [!NOTE]
> 自 `0.1.8` 起，核心框架（**星枢官方插件 Mod**）已彻底解耦并独立托管：未来发布新版核心插件或适配游戏新版本时，老版本电脑 Hub 与手机 APK 均可在「模组」页直接在线热更核心插件，无需重装启动器。详见[v0.1.8 发布记录](docs/records/RELEASE_0.1.8.md)与[发布打包说明](docs/guides/RELEASE_PACKAGING.md)。

---

## 项目简介

**AstralParty-XingShu（星枢）** 是面向《Astral Party》（吉星派对）的多端纯启动器、模组工坊、回放分析平台与模块化游戏增强套件：

1. **AstralParty-Hub（桌面端 & 网页版）**：基于 Tauri 2 + Rust + React 19 + TypeScript 构建。桌面端默认以纯净启动器运行，支持远端核心清单独立热更新、Rust 单飞锁防连点与 4 路并发 SHA-256 缓存下载、内置冲突检测与跨版本备份还原、PCL 风格启动体验与《星引擎 PARTY》官方徽标、在线大厅房间管理、`.rep` 逐帧回放复盘与表情回应工坊。
2. **星枢官方插件 Mod（`r8.41` 电脑端 / `android-preview8.36` 手机端，C# / Unity）**：独立可热更新游戏内插件核心，现提供 **19 项**可单独开关或一键安装的官方功能模块（新增**自定义大厅背景**，并含队友手牌监视、防御/击飞预测、战斗卡牌点数提示、选人界面地图显示、弃牌防误触、怪物技能冷却追踪、自由缩放镜头、对局统计与原生游戏内功能中心）。
3. **全新安卓纯启动器（`AndroidInstaller`，Kotlin / Jetpack Compose）**：采用 Material 3 与原创顶部指示线底部导航栏，支持远端 `CoreRuntimeSpec` 独立核心热更、动态配色/壁纸、Shizuku/无线 ADB 双通道、19 项官方模块管理、PE 模组工坊与 Windows 卡牌方案 ZIP 导入。

---

## v0.1.8 核心功能亮点

- **双端完全独立热更新核心框架**：桌面端接入 `core-manifest.json`，安卓端新增 `CoreRuntimeSpec` 对接 `android-core-manifest.json` 并通过 Shizuku IPC 与无线调试同步，核心框架与游戏适配信息脱离启动器发布周期独立热更。
- **19 项模块化官方功能（新增「自定义大厅背景」）**：上线第 19 项官方模块 `xingshu.launcher.custom-lobby-bg`，支持局内自定义大厅背景并零依赖持久化恢复；双端保持默认纯净启动官方原版。
- **EdgeOne CDN 加速 + LZ4 瘦身 + 并发缓存防错乱**：全站接入 EdgeOne CDN 加速并开启服务端 `tcp_bbr`，PC `r8.41` 开启 LZ4 压缩降至 ~`9.3 MB`；桌面端新增目录单飞锁与切页进度恢复、4 路并发分片与 `.xingshu-mods/payload-cache/` SHA-256 缓存，彻底根治连点下载反复横跳。
- **桌面端 Mod 详情重排 + 表情回应 + 官方高清图标**：修复细节弹窗样式与登录框层级遮挡，新增多图灯箱与游戏内动态角色表情回应（`EmoteReactionBar`）；启动页左侧替换为游戏内提取的原生透明底《星引擎 PARTY》高清官方图标。
- **游戏内原生功能中心 & 回放复盘**：局内按 `F1` 或点击悬浮球呼出统一 UI（支持 12 项快捷键自定义，见[快捷键说明](docs/guides/HOTKEYS.md)）；导入 `.rep` 或对局编号即可进行逐轮伤害/星币曲线分析与棋盘步进复盘。

---

## 架构概览

```mermaid
flowchart TD
    subgraph Hub["AstralParty-Hub (Tauri 2 / Rust + React 19)"]
        UI["桌面控制台与工坊界面 (React + TS)"]
        FSM["会话隔离与大厅/跟房协调"]
        TCPServer["Bridge TCP Server (127.0.0.1:25890)"]
        Workshop["内置冲突检测与 SHA-256 原子安装器"]
        UI <--> TCPServer
        UI <--> Workshop
        FSM <--> TCPServer
    end

    subgraph RuntimeSpectator["观战端客户端 (可选)"]
        SpecHook["WatchLogic 拦截挂钩"]
        SpecStore["SpectatorStateStore 权威快照"]
        SpecBridge["Bridge Client (Loopback TCP)"]
        SpecHook --> SpecStore --> SpecBridge
    end

    subgraph RuntimeMain["主游戏客户端 (可选装星枢官方插件 r8.41)"]
        MainBridge["Bridge Client (Loopback TCP)"]
        TruthSource["HandTruthSource 权威数据源"]
        Modules["19 项模块化官方插件 & 原生功能中心"]
        MainBridge --> TruthSource --> Modules
    end

    subgraph AndroidApp["安卓纯启动器 (Kotlin + Jetpack Compose + localadb / Shizuku)"]
        MobileUI["Compose Material 3 界面与 PE 工坊"]
        PayloadMgr["HTTPS + SHA-256 按需校验缓存"]
        Privileged["Shizuku Binder / 无线与 USB ADB"]
        MobileUI --> PayloadMgr --> Privileged
    end

    TCPServer <== "Loopback TCP (JSON Frames)" ==> SpecBridge
    TCPServer <== "HAND_TRUTH_MIRROR & ROOM" ==> MainBridge
```

---

## 安全与完整性保障

- **签名更新与哈希绑定**：软件自更新严格验证 RSA 签名清单（`xingshu-update.json`）；桌面端组件与安卓按需运行库均强制 HTTPS 下载与全量 SHA-256 指纹核验。
- **安全模组安装边界**：`.xspkg` / `.zip` 扩展包安装器严格拦截路径穿越、符号链接及非法可执行文件覆盖，并在替换前自动保留 `.xingshu-backup` / `.xingshu-mods` 基线备份。
- **权威手牌真值 (`HandTruthSource`)**：合作局手牌快照仅通过本机 `127.0.0.1` 回环传递，并严格校验对局英雄名单，杜绝伪造占位牌面。

---

## 目录结构

```text
AstralParty-XingShu/
├── AstralParty-Hub/                      # Tauri 2 + React 19 桌面启动器与在线网页工坊
│   ├── src/                              # 前端源码（启动台、开房、工坊、图鉴、回放分析、账号）
│   ├── src-tauri/                        # Rust 后端（TCP 通信桥、内置冲突检测与原子安装）
│   └── public/                           # 品牌图标、离线图鉴与动态表情资源
├── XingShu-Dev/                          # 游戏内 C# Unity 模块化运行时
│   ├── src/XingShu.Runtime/              # 19 项官方模块、原生功能中心、手牌真值与房间控制
│   └── tools/                            # 编译脚本、一致性校验与生命周期测试
├── AndroidInstaller/                     # Kotlin + Jetpack Compose 安卓纯启动器源码
│   ├── app/                              # Compose UI、Shizuku 接入、HTTPS 按需缓存与单元测试
│   └── localadb/                         # 无线/USB ADB 协议实现模块
├── tools/                                # 发布包封装、APK 构建签名与 Python 自动化测试
├── docs/                                 # 使用指南、技术规范与版本发布记录
└── LICENSE                               # AstralParty-XingShu 许可与合理使用条款
```

---

## 本地构建

> [!NOTE]
> 本仓库遵循合规开源原则，**不包含**任何游戏专有 DLL、原版商业资源包、签名私钥或敏感凭据。

### 1. AstralParty-Hub（桌面端与网页版）

- 环境要求：Node.js 20+、Rust & Cargo（最新 stable）、Visual Studio C++ 生成工具、Microsoft Edge WebView2。

```bash
cd AstralParty-Hub
npm ci

# 构建在线网页版静态产物
npm run build:web

# 运行前后端校验与单元测试
npx tsc --noEmit
npm run test:all
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --lib

# 构建 Tauri 桌面端程序与安装包
npx tauri build -- --locked --offline
```

### 2. XingShu Runtime（C# 游戏插件）

- 环境要求：支持 C# 11 的 Visual Studio MSBuild（目标 `.NET Framework 4.0`）、Python 3.x、`XingShu-Dev/tools/lib` 下的 Mono.Cecil。
- 从合法拥有的客户端提取 `AstralParty.Runtime.dll` 放入 `XingShu-Dev/references/`（或指定 `AstralPartyRuntimePath`）。

```powershell
.\XingShu-Dev\tools\build.ps1 -Configuration Release
```

### 3. Android 纯启动器（Kotlin / Jetpack Compose）

- 环境要求：JDK 17、Android SDK（`compileSdk 35`）、Gradle 8.9。

```powershell
python tools/build_android_installer.py --help
```

---

## 详细文档与验证记录

- [项目文档与验证记录](docs/README.md) — 文档总索引与历史发布验证记录
- [RELEASE_0.1.8.md](docs/records/RELEASE_0.1.8.md) — v0.1.8 正式版更新与核心框架独立热更新记录
- [RELEASE_0.1.7.md](docs/records/RELEASE_0.1.7.md) — v0.1.7 正式版更新与架构重构记录
- [ANDROID_PHONE_INSTALL.md](docs/guides/ANDROID_PHONE_INSTALL.md) — 安卓手机安装与还原指南
- [HOTKEYS.md](docs/guides/HOTKEYS.md) — 游戏内快捷键自定义说明
- [AUTO_FOLLOW_PROTOCOL.md](docs/guides/AUTO_FOLLOW_PROTOCOL.md) — 自动跟房本地 TCP 通信协议规范
- [AUTO_FOLLOW_STATE_MACHINE.md](docs/guides/AUTO_FOLLOW_STATE_MACHINE.md) — 自动跟房 11 状态机设计说明
- [HAND_TRUTH_SOURCE_ARCHITECTURE.md](docs/guides/HAND_TRUTH_SOURCE_ARCHITECTURE.md) — 手牌真值单源架构与防伪造设计
- [OVERLAY_LIFECYCLE_RECONCILIATION.md](docs/guides/OVERLAY_LIFECYCLE_RECONCILIATION.md) — 浮动挂件生命周期自适应调和规范
- [local-managed-watcher.md](AstralParty-Hub/docs/local-managed-watcher.md) — 本机托管观战说明
- [extension_channels.md](AstralParty-Hub/docs/specs/extension_channels.md) — 扩展包渠道声明与目录映射边界

---

## 免责声明与授权条款

1. 本项目仅供技术研究、本地测试、模组管理与社区交流学习使用。
2. 原游戏美术、文本、配置与音画资产版权均归原权利人所有，不随本项目代码许可证重新授权。
3. 请合理合规使用辅助功能并遵守游戏官方服务条款；开发者不对不当使用引发的账号风险承担责任。
4. 本仓库代码采用《[AstralParty-XingShu 许可与合理使用条款](LICENSE)》（源码公开、限个人非商用，衍生分支须署名并保持同条款开源）。
