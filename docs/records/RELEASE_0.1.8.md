# 星枢 0.1.8 正式版

本次为正式版发布（替代 `0.1.7`），正式上线**双端完全独立可热更新核心框架**、**19 项官方模块（新增第 19 项「自定义大厅背景」）**、**EdgeOne CDN + 并发缓存高速下载体系**，并全面重排桌面端 Mod 详情弹窗、接入角色表情回应与官方高清图标，以及解决重复点击下载状态错乱等问题。

## 版本信息与下载

- **适用游戏版本**：《吉星派对》`3.3.0 / 资源 160`（Steam 国服、TapTap Windows、哔哩哔哩、WeGame、安卓国服）
- **版本号**：桌面端 Hub 与安卓启动器 `0.1.8`（更新序号 `2026112302`），电脑端核心框架插件 `1.0.0-game-ui-r8.41`，安卓端核心框架插件 `1.0.0-android-preview8.36`
- [电脑端一键安装包](https://github.com/Breezecaresses/AstralParty-XingShu/releases/download/v0.1.8/XingShu_Hub_0.1.8_x64-setup.exe)：Windows 安装程序，一步安装「星枢 Hub」（`xingshu-hub.exe`）。
- [电脑端便携版 ZIP](https://github.com/Breezecaresses/AstralParty-XingShu/releases/download/v0.1.8/XingShu_Desktop_0.1.8.zip)：极简纯启动器绿色版，仅含 `Hub/xingshu-hub.exe` 与使用说明。
- [直接安装安卓 APK](https://github.com/Breezecaresses/AstralParty-XingShu/releases/download/v0.1.8/XingShu_Android_0.1.8.apk)：轻量纯启动器 APK，支持覆盖安装、应用内自更新与动态热更核心框架。
- [安卓手机 ZIP](https://github.com/Breezecaresses/AstralParty-XingShu/releases/download/v0.1.8/XingShu_Android_0.1.8.zip)：极简压缩包，仅含 `星枢启动器.apk`、`先读我.txt`、`LICENSE.txt` 与哈希校验文件。

## 核心更新与架构升级

- **双端「纯启动器 + 完全独立热更新核心框架」架构**：
  - 电脑端接入远端独立核心清单 `core-manifest.json`（`no-store` 实时校验 + 本地签名缓存与内置基线兜底），手机端新增 `CoreRuntimeSpec` 接入独立清单 `android-core-manifest.json` 并通过 Shizuku IPC 与无线调试 ADB 双通道同步至授权引擎。
  - **以后无需升级/重装启动器本体或 APK**，后续更新核心框架（如 `r8.42`、`android-preview8.37`）甚至游戏版本升级后，老版本星枢启动器即可直接在线识别并热更新「星枢官方插件 Mod」。
- **新增第 19 项官方模块：`自定义大厅背景`（`xingshu.launcher.custom-lobby-bg`）**：
  - 双端运行时升级至 `r8.41` / `android-preview8.36`；支持在游戏内「星枢中心 → 自定义大厅背景」选图替换大厅背景并即时生效（自动写入标记且零依赖持久化恢复），全端默认仍可纯净启动官方原版。
- **EdgeOne CDN 加速 + 4 路并发与下载防错乱修复**：
  - 全站切换 EdgeOne CDN 加速并启用服务器 `tcp_bbr` 拥塞控制，为不可变核心包与工坊 Mod 分片开启强缓存；PC `r8.41` 全渠道启用 LZ4 压缩，体积由 `21.2 MB` 精简至约 `9.3 MB`。
  - 修复快速连续点击安装或下载途中切换页面引起的进度反复横跳与状态丢失：新增 Rust 目录级单飞互斥锁、跨页进度恢复查询、4 路并发分片下载、`.xingshu-mods/payload-cache/` 本地 SHA-256 缓存与前端 `useRef` 同步锁。
- **桌面端 Mod 详情重排 + 表情回应 + 官方高清 Logo**：
  - 修复详情弹窗在 Portal 下丢失尺寸与登录弹窗层级遮挡问题，重排为「固定顶栏 + 纵向滚动区 + 固定底栏」三段式结构（适配 6 套启动器主题），支持多图灯箱与游戏内动态角色表情回应（`EmoteReactionBar`）。
  - 启动页左侧品牌徽标替换为从游戏内提取的原生透明底《星引擎 PARTY》双语高清官方 Logo（`276×156` 放大展示），同时移除此前缺失白名单资源造成的裂图。
- **安卓端协同与实时工坊升级**：
  - 初始化、连接授权、刷新检测及「一键安装全部官方模组」自动拉取最新远端核心清单；修正 19 项模块计数文案与 1 GB 分片提示上限。
  - **工坊实时同步 & 全量目录**：切换至「工坊」页、回前台或点击刷新时携带防缓存参数实时同步全量工坊（展示同步进度与时间）；PE 可直装社区包置顶展示，其余 PC 端社区 Mod 同步显示（带「仅 PC 端」标识与网页详情直达）并提供 `全部 / 手机可装 / 社区模组 / 官方优化` 筛选。
  - **「模组」页首屏显眼本地导入 + 双分栏**：将「导入本地 Mod 包（.zip / .xspkg）」与「去工坊」主卡片置顶到核心插件卡下方首屏位置，并将下方拆分为「官方模块 (19)」与「本地与外部 Mod」顶部切换分栏，导入后自动切换查看。
- **网页端工坊 SEO 与官方图标上线**：
  - 线上部署多尺寸 `/favicon.ico`、`apple-touch-icon.png` 及更新后的标题/摘要与 JSON-LD 结构化数据，适配搜索引擎站点图标与卡片展示。

## 安装与更新说明

- **软件自更新与核心插件关系**：通过 Hub 或安卓 APK 自更新到 `0.1.8` 后，请先正常退出游戏，再在「模组」页安装或升级核心插件至 `r8.41` / `android-preview8.36`；自 `0.1.8` 起，未来核心框架升级将独立于启动器在线热更。
