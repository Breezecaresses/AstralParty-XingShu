using System;
using System.Collections.Generic;
using XingShuRuntime.Utilities;

internal static class PlayerStarBuffTests
{
    private static int _checks;
    private static int _failed;

    private static void Check(bool condition, string message)
    {
        _checks++;
        if (!condition)
        {
            _failed++;
            Console.WriteLine("FAIL: " + message);
        }
    }

    private static int Main()
    {
        // 1. Extra Move Speed policy tests
        Check(PlayerCombatStatusPolicy.ResolveExtraMoveSpeed(2, 0, true, 0, 0, 0) == 2, "star move +2 resolves to +2");
        Check(PlayerCombatStatusPolicy.ResolveExtraMoveSpeed(5, 2, true, 0, 0, 0) == 3, "add 5 minus 2 resolves to +3");
        Check(PlayerCombatStatusPolicy.ResolveExtraMoveSpeed(0, 3, true, 0, 0, 0) == -3, "slow -3 resolves to -3");
        Check(PlayerCombatStatusPolicy.ResolveExtraMoveSpeed(0, 0, true, 2, 1, 0) == 0, "server reset to 0 overrides stale reconnect fallback");
        Check(PlayerCombatStatusPolicy.ResolveExtraMoveSpeed(0, 0, false, 2, 1, 0) == 3, "reconnect fallback sums AdditionAttrs + AppendMovePoint");

        Check(PlayerCombatStatusPolicy.FormatMoveSpeedToken(2) == "[color=#7CFF9B]移速+2[/color]", "format +2 token");
        Check(PlayerCombatStatusPolicy.FormatMoveSpeedToken(-1) == "[color=#FF8DA1]移速-1[/color]", "format -1 token");
        Check(PlayerCombatStatusPolicy.FormatMoveSpeedToken(0) == "", "format 0 returns empty");

        // 2. Buff classification tests
        Check(PlayerStarBuffPolicy.ClassifyBuff(21026, 1, false, false, "疾行", "移动速度+3") == StarBuffCategory.Move, "疾行 classified as Move");
        Check(PlayerStarBuffPolicy.ClassifyBuff(9001, 1, false, false, "迟缓", "移动速度-2") == StarBuffCategory.Move, "减速 classified as Move");
        Check(PlayerStarBuffPolicy.ClassifyBuff(9002, 1, true, false, "剧毒", "每回合失去1点生命") == StarBuffCategory.Debuff, "poison tag classified as Debuff");
        Check(PlayerStarBuffPolicy.ClassifyBuff(10004, 1, false, true, "治愈", "回合开始回复") == StarBuffCategory.Hero, "property buff classified as Hero");
        Check(PlayerStarBuffPolicy.ClassifyBuff(1221202, 2, false, false, "精准打击", "轨道轰炸伤害+1") == StarBuffCategory.Hero, "Mark buff classified as Hero");
        Check(PlayerStarBuffPolicy.ClassifyBuff(5001, 4, false, false, "狂暴", "攻击力+2") == StarBuffCategory.Combat, "Battle buff classified as Combat");
        Check(PlayerStarBuffPolicy.ClassifyBuff(6001, 5, false, false, "购物狂", "商店折扣") == StarBuffCategory.Event, "Event buff classified as Event");
        Check(PlayerStarBuffPolicy.ClassifyBuff(7001, 1, false, false, "神秘印章", "未知效果") == StarBuffCategory.Other, "unknown normal buff classified as Other");

        // 3. Filter & tri-state override tests
        var dis = new HashSet<int> { 5001 };
        var en = new HashSet<int> { 9002 };
        Check(PlayerStarBuffPolicy.ShouldShowBuff(21026, StarBuffCategory.Move, true, false, false, false, false, false, dis, en), "enabled Move category shows buff");
        Check(!PlayerStarBuffPolicy.ShouldShowBuff(5001, StarBuffCategory.Combat, true, true, true, true, true, true, dis, en), "explicit disabled override hides buff even if category on");
        Check(PlayerStarBuffPolicy.ShouldShowBuff(9002, StarBuffCategory.Debuff, false, false, false, false, false, false, dis, en), "explicit enabled override shows buff even if category off");

        // 4. ID set serialization round-trip
        var parsed = PlayerStarBuffPolicy.ParseIdSet(" 10004, abc, 21026; -5, 10004 , 9001 ");
        Check(parsed.Count == 3 && parsed.Contains(10004) && parsed.Contains(21026) && parsed.Contains(9001), "ParseIdSet filters invalid and deduplicates");
        Check(PlayerStarBuffPolicy.SerializeIdSet(parsed) == "9001,10004,21026", "SerializeIdSet sorts ascending");

        // 5. Anchor calculation tests
        float ax, ay;
        PlayerStarBuffPolicy.ComputeAnchorPosition(0, 100f, 50f, 80f, 24f, 60f, 28f, 4f, 0f, out ax, out ay);
        Check(Math.Abs(ax - 188f) < 0.01f && Math.Abs(ay - 48f) < 0.01f, "anchor right of stars");
        PlayerStarBuffPolicy.ComputeAnchorPosition(1, 100f, 50f, 80f, 24f, 60f, 28f, -4f, 0f, out ax, out ay);
        Check(Math.Abs(ax - 32f) < 0.01f && Math.Abs(ay - 48f) < 0.01f, "anchor left of stars");
        PlayerStarBuffPolicy.ComputeAnchorPosition(2, 100f, 50f, 80f, 24f, 60f, 28f, 0f, 2f, out ax, out ay);
        Check(Math.Abs(ax - 100f) < 0.01f && Math.Abs(ay - 78f) < 0.01f, "anchor below stars");

        Console.WriteLine("PlayerStarBuff & MoveSpeed tests: " + (_checks - _failed) + "/" + _checks + " passed");
        return _failed == 0 ? 0 : 1;
    }
}
