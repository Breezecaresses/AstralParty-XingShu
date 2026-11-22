# 星枢 0.1.7 正式版

本次为正式版发布（替代 `0.1.6`），仓库授权条款已升级为《AstralParty-XingShu 许可与合理使用条款》（源码公开、限个人非商用，衍生分支须署名并保持同条款开源，详见 LICENSE）。本版将电脑端与安卓手机端全面重构为**纯启动器 + 模块化官方插件 Mod**架构，彻底消除外部安装弹窗并将冲突检测/还原流程整合进 Hub；重做基于 Kotlin + Jetpack Compose Material 3 的全新安卓启动器，并修复游戏内原版 `Setting` 图集异步加载竞态引发的面板全白缺陷（PC 升级至 `r8.40`）。

## 版本信息与下载

- **适用游戏版本**：《吉星派对》`3.3.0 / 资源 160`（Steam 国服、TapTap Windows、哔哩哔哩、WeGame、安卓国服）
- **版本号**：桌面端 Hub 与安卓启动器 `0.1.7`（更新序号 `2026112210`），电脑端官方插件 `1.0.0-game-ui-r8.40`，安卓端官方插件 `1.0.0-android-preview8.35`
- [电脑端一键安装包](https://github.com/Breezecaresses/AstralParty-XingShu/releases/download/v0.1.7/XingShu_Hub_0.1.7_x64-setup.exe)：Windows 安装程序，一步安装「星枢 Hub」（`xingshu-hub.exe`）。
- [电脑端便携版 ZIP](https://github.com/Breezecaresses/AstralParty-XingShu/releases/download/v0.1.7/XingShu_Desktop_0.1.7.zip)：极简纯启动器绿色版，仅含 `Hub/xingshu-hub.exe` 与使用说明（无独立安装助手、无预打包 `Runtime/` 与 `Android/` 大文件）。
- [直接安装安卓 APK](https://github.com/Breezecaresses/AstralParty-XingShu/releases/download/v0.1.7/XingShu_Android_0.1.7.apk)：轻量纯启动器 APK，支持覆盖安装、应用内自更新与按需校验下载运行库。
- [安卓手机 ZIP](https://github.com/Breezecaresses/AstralParty-XingShu/releases/download/v0.1.7/XingShu_Android_0.1.7.zip)：极简压缩包，仅含 `星枢启动器.apk`、`先读我.txt`、`LICENSE.txt` 与哈希校验文件（无旧版「手机安装助手」与 `手动替换/`）。

## 核心更新与架构升级

- **双端纯启动器架构 + 模块化「星枢官方插件 Mod」**：
  - 电脑端与手机端默认均作为纯净启动器运行，不再强制捆绑修改游戏目录；可在「模组」页自由勾选安装、启停或一键批量安装**星枢官方插件 Mod**及全部 **18 项官方功能模块**（含实时下载进度展示）。
  - 精准识别各渠道官方原版基线哈希与 `r8.38` / `r8.39` 等历史运行时残留，杜绝误报“纯净启动”，支持跨版本备份检索与一键卸载还原。
- **Hub 控制台深度整合与主题/工坊升级**：
  - 彻底剔除独立的「星枢安装助手.exe」「星枢安卓安装助手.exe」及外部 WinForms 弹窗，将目录冲突扫描、历史备份识别、在线下载安装与无损还原全流程直接整合于星枢 Hub；打包产物亦全面瘦身，不再重复附带离线运行库。
  - 新增 PCL 风格动态启动页动画与多套配色主题（支持自定义色调），全面重构电脑端与网页版（Modrinth 风格）模组工坊、星枢平台账号与游戏内实时开房管理（仅在大厅连接就绪后开放操作）。
  - 角色、卡牌、筹码与地图图鉴页直接标注当前已生效的本地 Mod 替换状态。
- **游戏内 `r8.40` 原生功能中心修复与新模块**：
  - 修复 `FairyGUI.UIPackage.AddPackageAsync("Setting")` 在异步图集尚未就绪前提前注册包名引发的 `1×1` 纯白纹理缓存缺陷，并增加跨场景自愈与纹理持久化保护。
  - 统一 PC 与移动端的原生设置风格控制中心布局；新增选人界面地图名称提示、战斗卡牌点数显示与弃牌选牌命中框防护。
- **全新 Kotlin + Jetpack Compose 安卓启动器**：
  - 全新采用 Jetpack Compose + Material 3 重构移动端界面，配备星枢原创顶部指示线底部导航栏、自定义主题色与壁纸背景。
  - 轻量化 APK 安装包按需从官方 HTTPS 路由拉取运行库/原版文件并强制校验 SHA-256；支持 Shizuku 与无线/USB ADB 授权、PE 工坊浏览下载与本地卡面/Mod 包导入。

## 安装与更新说明

- **软件自更新与插件关系**：通过 Hub 或安卓 APK 完成自更新后，请先正常退出游戏，再在「模组」页核验或升级游戏内插件包至 `r8.40` / `android-preview8.35`。
- **桌面端用户**：完整解压 `XingShu_Desktop_0.1.7.zip` 后运行 `Hub/xingshu-hub.exe`，选择游戏渠道目录即可一键启动纯净原版或按需安装官方模块与社区工坊 Mod。
