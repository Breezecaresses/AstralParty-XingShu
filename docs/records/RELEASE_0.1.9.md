# 星枢 0.1.9 正式版

本次为正式版发布（替代 `0.1.8`），重点上线桌面端「**万能本地 Mod 自动适配引擎**」、手机端游戏内「**自定义大厅背景万能解码与列表修复**」、**安卓星枢启动器排版重构**，并将双端核心框架与工坊全曲库同步升级。

## 版本信息与下载

- **适用游戏版本**：《吉星派对》`3.3.0 / 资源 160`（Steam 国服、TapTap Windows、哔哩哔哩、WeGame、安卓国服）
- **版本号**：桌面端 Hub 与安卓启动器 `0.1.9`（更新序号 `2026112401`），电脑端核心框架插件 `1.0.0-game-ui-r8.44`，安卓端核心框架插件 `1.0.0-android-preview8.44`
- [电脑端一键安装包](https://github.com/Breezecaresses/AstralParty-XingShu/releases/download/v0.1.9/XingShu_Hub_0.1.9_x64-setup.exe)：Windows 安装程序，一步安装「星枢 Hub」（`xingshu-hub.exe`）。
- [电脑端便携版 ZIP](https://github.com/Breezecaresses/AstralParty-XingShu/releases/download/v0.1.9/XingShu_Desktop_0.1.9.zip)：极简纯启动器绿色版，仅含 `Hub/xingshu-hub.exe` 与使用说明。
- [直接安装安卓 APK](https://github.com/Breezecaresses/AstralParty-XingShu/releases/download/v0.1.9/XingShu_Android_0.1.9.apk)：轻量纯启动器 APK，支持覆盖安装、应用内自更新与动态热更核心框架。
- [安卓手机 ZIP](https://github.com/Breezecaresses/AstralParty-XingShu/releases/download/v0.1.9/XingShu_Android_0.1.9.zip)：极简压缩包，仅含 `星枢启动器.apk`、`先读我.txt`、`LICENSE.txt` 与哈希校验文件。

## 核心更新内容

- **桌面端「万能本地 Mod 自动适配引擎」**：
  - 当旧版 Mod 压缩包或本地目录的 32 位地址哈希未命中当前游戏 `3.3.0` 时，自动读取 UnityFS 容器内的 `Texture2D` / `MonoBehaviour` 资产名并反查本地 `catalog_3.3.0.json` 进行跨版本精准匹配（优先命中主资源包）。
  - `Texture2D` 贴图资源支持无损转换为 `modimg/<AssetName>.png` 直接安装，并在检测弹窗内支持一键导出「安卓端通用 `modimg` 整合包」。
  - `MonoBehaviour`（技能动作、`VKVLoop` 等）自动迁移载荷回当前游戏版本原版容器（支持从 `.xingshu-mods/` 备份基线读取）。
  - 新增 `.rar` 归档与加密压缩包支持（缺密码时弹窗输入重试），自动忽略 `原/` / `backup/` 冗余备份目录；严格拦截篡改 `AstralParty.Runtime.dll` 的旧版危险容器并安全跳过 `APENC01` 加密载荷。
- **双端核心框架热更新至 `r8.44` / `android-preview8.44`**：
  - 修复手机端游戏内「自定义大厅背景」选图后无法应用的问题：新增 `.webp` / `.bmp` 扩展识别与安卓原生 `BitmapFactory` 万能解码/安全缩放兜底（彻底兼容相册 WebP/HEIC 及超大图），补齐顶部内联状态回显与移动端单列全宽列表排版。
  - 新增动态立绘加载器 `xingshu_dynamic_cards/`、对局统计「实际造成伤害」统计字段与手牌监视 UI 适配；历史哈希回溯链完整，老版本 `v0.1.8` 亦可在「模组」页在线热更新核心插件。
- **安卓端星枢启动器 (`AndroidInstaller`) Compose 排版与布局重构**：
  - 修复无线调试授权弹窗右上角「开发者选项」按钮被挤压换行的问题。
  - 重构自定义页顶部主题预览为扁平描边卡并消除内嵌阴影，将 6 套官方色板由 5+1 改为对称 `3×2` 网格、对齐自定义 Hex「应用」按钮。
  - 将启动页渠道切换与模组/工坊筛选芯片改为横向单排滚动 `LazyRow`，大幅压缩模组页首屏堆叠间距，使 19 项官方模块与本地导入入口清晰直达首屏。
- **工坊多端全曲库与移动端 `modimg` 资源升级**：
  - 修复《星趴 BA 音乐替换》整合包 `3.3.0-r2`（`92 -> 106` 文件），补齐 `BGM_HomeSystem`、通用战斗、皮肤战斗与 `NGOBGM` 等 7 套远端 `AssetBundles` 现役音库；同步为多款全年龄社区 Mod 补充 `ANDROID_CN` `modimg` 手机版。

## 安装与更新说明

- 通过桌面端 Hub 或安卓 APK 自更新到 `0.1.9` 后，请先正常退出游戏，再前往「模组」页安装或校验升级核心插件至 `1.0.0-game-ui-r8.44` / `1.0.0-android-preview8.44`。
