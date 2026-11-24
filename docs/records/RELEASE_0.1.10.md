# 星枢 0.1.10 正式版

本次为正式版发布（替代 `0.1.9`），双端同步升级至 `0.1.10`（更新序号 `2026112402`）：重点升级桌面端「**万能本地 Mod 自动适配引擎**」（原生解析社区 RML `mod.json` 补丁与中文改名 `CAB-*` 模型/动作包），并将双端内置官方功能模组清单从 19 项扩展至 21 项（新增「梅加斯伤害计算」与「角色状态显示」），配合 `r8.47` / `android-preview8.47` 核心框架。

## 版本信息与下载

- **适用游戏版本**：《吉星派对》`3.3.0 / 资源 160`（Steam 国服、TapTap Windows、哔哩哔哩、WeGame、安卓国服）
- **版本号**：桌面端 Hub 与安卓启动器 `0.1.10`（更新序号 `2026112402`），电脑端核心框架插件 `1.0.0-game-ui-r8.47`，安卓端核心框架插件 `1.0.0-android-preview8.47`
- [电脑端一键安装包](https://github.com/Breezecaresses/AstralParty-XingShu/releases/download/v0.1.10/XingShu_Hub_0.1.10_x64-setup.exe)：Windows 安装程序，一步安装「星枢 Hub」（`xingshu-hub.exe`）。
- [电脑端便携版 ZIP](https://github.com/Breezecaresses/AstralParty-XingShu/releases/download/v0.1.10/XingShu_Desktop_0.1.10.zip)：极简纯启动器绿色版，仅含 `Hub/xingshu-hub.exe` 与使用说明。
- [直接安装安卓 APK](https://github.com/Breezecaresses/AstralParty-XingShu/releases/download/v0.1.10/XingShu_Android_0.1.10.apk)：轻量纯启动器 APK，支持覆盖安装、应用内自更新与动态热更核心框架。
- [安卓手机 ZIP](https://github.com/Breezecaresses/AstralParty-XingShu/releases/download/v0.1.10/XingShu_Android_0.1.10.zip)：极简压缩包，仅含 `星枢启动器.apk`、`先读我.txt`、`LICENSE.txt` 与哈希校验文件。

## 核心更新内容

- **桌面端「万能本地 Mod 自动适配引擎」再升级**：
  - **中文改名多对象模型/动作包自动匹配（`CAB-*` 指纹）**：当社区皮肤/行走动画包的 `.bundle` 文件名被改写为中文而非 32 位哈希时，启动器仅读取 UnityFS 头部块索引提取 `CAB-*` 指纹，自动对齐本地游戏 `3.3.0` 原版容器并备份覆盖安装。
  - **RML（`mod.json`）格式原生解析**：拖入社区原生 `ResourceModLoader` 补丁压缩包时，若识别到合法 `mod.json`，将安全跳过随包附带的 `ResourceModLoader.exe`（其余可执行扩展名仍严格拦截），直接解析 `Redirect`（`TextAsset` / `Texture2D`）、`.patch.bnk`（Wwise `.wem` 音轨注入）与 `.patch.proto`（Protobuf 配置字段补丁）并原位写入游戏容器。
- **双端官方功能模组扩展至 21 项（同步核心框架 `r8.47` / `android-preview8.47`）**：
  - **#20 `megath-damage`（梅加斯伤害计算）**：仅当本地角色为梅加斯（`HeroId = 122`）时显示独立理论最大伤害面板；严格按公式（轰炸次数 `⌊手牌数/2⌋`、PVE 单炮 `3 + ⌈总费用/3⌉`，如 9 张=4 炮、4 费=3+2=5 伤、6 张 7 费=3 炮×6 伤=18）仅统计手牌轰炸伤害；当场上存在带「精准打击」(`Buff 1221202`) 的存活怪物时额外标注每炮 +1 伤参考（支持自由拖拽及功能中心「击飞预测」页调位/缩放）。
  - **#21 `player-combat-hud`（角色状态显示）**：支持双位置显示——棋盘角色头顶与怪物逻辑推演（`com_AttrInfos`）同层锁死不可拖动，按视觉头顶比例贴合人物头部并支持高度微调；左侧玩家头像金币星级栏下方同步显示状态条，支持自由拖动、锁定、独立开关与偏移/缩放微调。
  - **「对局数据挂件设置」迁移**：将原位于「高级设置」的 `对局数据挂件设置` 完整迁入「对局数据」页面，并把局内悬浮窗「设置」快捷按钮直接指向「对局数据」页，同时清理冗余重复面板。

## 安装与更新说明

- 通过桌面端 Hub 或安卓 APK 自更新到 `0.1.10` 后，请先正常退出游戏，再前往「模组」页安装或校验升级核心插件至 `1.0.0-game-ui-r8.47` / `1.0.0-android-preview8.47`。
