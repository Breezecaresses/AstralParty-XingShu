package app.xingshu.installer

/**
 * Canonical catalog of the 21 modular official XingShu features that map 1:1 to
 * `xingshu/plugins/xingshu.launcher.<id>.module` markers inside the Android game data folder.
 */
object OfficialModulesCatalog {
    data class OfficialModule(
        val id: String,
        val name: String,
        val description: String,
        val group: String,
    )

    val ALL: List<OfficialModule> = listOf(
        OfficialModule("hand-monitor", "手牌监视", "局内手牌入口与已授权合作局队友同步", "对局信息"),
        OfficialModule("battle-stats", "对局统计", "局内统计挂件与对局数据", "对局信息"),
        OfficialModule("avatar-praise", "头像点赞", "选择点赞、取消选择与图标大小设置", "快捷与娱乐"),
        OfficialModule("quick-thanks", "快捷致谢", "局内原生感谢快捷项", "快捷与娱乐"),
        OfficialModule("star-coin-shop", "每日星币商店", "每日星币货架助手，仍需在游戏中开启", "快捷与娱乐"),
        OfficialModule("defense-hint", "防御点数提示", "本人防御与闪避参考", "战术推演"),
        OfficialModule("knockback-preview", "击飞预测", "局内击飞概率参考", "战术推演"),
        OfficialModule("monster-targeting", "怪物索敌", "地图上的怪物索敌推演提示", "战术推演"),
        OfficialModule("monster-cooldown", "怪物冷却", "怪物技能冷却与状态提示", "战术推演"),
        OfficialModule("free-camera", "自由镜头", "镜头移动、缩放与地图查看", "操作与画面"),
        OfficialModule("game-speed", "游戏变速", "独立的游戏内变速设置", "操作与画面"),
        OfficialModule("thinking-time", "思考时间", "局内本地计时显示调整", "操作与画面"),
        OfficialModule("action-guard", "战局守护", "本地战局状态监视与重连设置", "对局信息"),
        OfficialModule("replay-player", "局内录像", "游戏内回放播放面板", "对局信息"),
        OfficialModule("static-portraits", "立绘替换", "独立的立绘与动态资源显示设置", "操作与画面"),
        OfficialModule("settlement-capture", "结算截图", "专用的结算截图入口", "快捷与娱乐"),
        OfficialModule("select-map-name", "选人地图提示", "在选人界面右侧显示当前地图名称", "战术推演"),
        OfficialModule("battle-card-points", "战斗卡牌点数", "战斗卡牌打出后显示点数与加成明细", "战术推演"),
        OfficialModule("custom-lobby-bg", "自定义大厅背景", "免改原包替换大厅视频/静态图/USM 背景，兼容隐藏 UI 与缩放", "快捷与娱乐"),
        OfficialModule("megath-damage", "梅加斯伤害计算", "游玩梅加斯时显示主动技能理论最大伤害面板（可拖动调节位置）", "战术推演"),
        OfficialModule("player-combat-hud", "角色状态头顶显示", "在棋盘玩家角色上方显示技能冷却、血量与基础攻防（可调节位置）", "对局信息"),
    )

    val GROUPS: List<String> = listOf("全部", "对局信息", "战术推演", "操作与画面", "快捷与娱乐")

    private val SAFE_ID = Regex("^[a-z0-9-]{2,48}$")

    fun isSafeId(id: String): Boolean = SAFE_ID.matches(id)

    fun allIdsCsv(): String = ALL.joinToString(",") { it.id }

    fun toSafeCsv(ids: Collection<String>): String =
        ids.map { it.trim().lowercase() }.filter { isSafeId(it) }.distinct().joinToString(",")
}
