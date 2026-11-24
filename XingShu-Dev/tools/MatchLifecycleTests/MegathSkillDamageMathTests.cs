using System;
using XingShuRuntime.Utilities;

internal static class MegathSkillDamageMathTests
{
    private static int _passed;

    private static void Assert(bool cond, string message)
    {
        if (!cond) throw new Exception("Assertion failed: " + message);
        _passed++;
    }

    private static void Main()
    {
        Assert(MegathSkillDamageMath.MegathHeroId == 122, "Megath HeroId is 122");

        // 1. PVE 12202: 6 cards, total cost 7 => 3 shots, cost bonus floor(7/3)=2, damage per shot 3+2=5 => total 15
        var pve7 = MegathSkillDamageMath.Compute(12202, true, new[] { 3, 2, 6, 3, 1 }, new[] { 1, 1, 2, 1, 1, 1 });
        Assert(pve7.CardCount == 6 && pve7.TotalCost == 7, "PVE 7-cost hand count and total cost");
        Assert(pve7.Shots == 3 && pve7.DamagePerShot == 5 && pve7.TotalDamage == 15, "PVE 7-cost shots and damage");
        Assert(!pve7.GrantsOrbitalCannon, "PVE 12202 does not flag potential orbital cannon");
        Assert(MegathSkillDamageMath.FormatFormulaLine(pve7) == "6张(费7) = 3炮 * 5伤", "PVE 7-cost formula formatting");

        // 2. PVE 12202 with 9 cost: 6 cards => 3 shots * 6 dmg = 18
        var pve9 = MegathSkillDamageMath.Compute(12202, true, new[] { 3, 2, 6, 3, 1 }, new[] { 2, 2, 2, 1, 1, 1 });
        Assert(pve9.Shots == 3 && pve9.DamagePerShot == 6 && pve9.TotalDamage == 18, "PVE 9-cost = 3*6=18");
        Assert(MegathSkillDamageMath.FormatFormulaLine(pve9) == "6张(费9) = 3炮 * 6伤", "PVE 9-cost formula formatting");

        // 3. PVE Potential 12203 with 6 cards => orbital cannon bonus flagged
        var pot6 = MegathSkillDamageMath.Compute(12203, true, new[] { 3, 2, 6, 3, 1, 3 }, new[] { 1, 1, 1, 1, 1, 1 });
        Assert(pot6.GrantsOrbitalCannon && pot6.TotalDamage == 15, "Potential 12203 grants orbital cannon at >=6 cards");
        Assert(MegathSkillDamageMath.FormatFormulaLine(pot6) == "6张(费6) = 3炮 * 5伤 + 轨道炮", "Potential formula formatting");

        // 4. PVE Potential 12203 with 5 cards (<6) => 2 shots, no orbital cannon
        var pot5 = MegathSkillDamageMath.Compute(12203, true, new[] { 3, 2, 6, 3, 1, 3 }, new[] { 2, 2, 2, 2, 2 });
        Assert(!pot5.GrantsOrbitalCannon && pot5.Shots == 2 && pot5.DamagePerShot == 6 && pot5.TotalDamage == 12, "Potential <6 cards omits orbital cannon");

        // 5. PVP 12201 ignores cost scaling: 7 cards => 3 shots * 2 dmg = 6
        var pvp7 = MegathSkillDamageMath.Compute(12201, false, new[] { 2, 2 }, new[] { 3, 3, 3, 2, 1, 0, 1 });
        Assert(!pvp7.IsPveScaling && pvp7.Shots == 3 && pvp7.DamagePerShot == 2 && pvp7.TotalDamage == 6, "PVP uses fixed 2 dmg per shot");
        Assert(MegathSkillDamageMath.FormatFormulaLine(pvp7) == "7张 = 3炮 * 2伤", "PVP formula formatting");

        // 6. Fewer than 2 cards => 0 shots, 0 damage
        var low1 = MegathSkillDamageMath.Compute(12202, true, null, new[] { 3 });
        Assert(low1.Shots == 0 && low1.TotalDamage == 0, "1 card produces 0 shots and 0 damage");
        Assert(MegathSkillDamageMath.FormatFormulaLine(low1) == "1张(费3) = 不足2张(无法开炮)", "Zero shot message formatting");

        // 7. 0 cards & negative cost clamping
        var empty = MegathSkillDamageMath.Compute(12201, false, null, new int[0]);
        Assert(empty.CardCount == 0 && empty.TotalCost == 0 && empty.TotalDamage == 0, "Empty hand yields 0 damage");
        var neg = MegathSkillDamageMath.Compute(12202, true, new[] { 4, 2, 6, 3, 2 }, new[] { -2, 3, 0, 3 });
        Assert(neg.TotalCost == 6 && neg.Shots == 2 && neg.DamagePerShot == 8 && neg.TotalDamage == 16, "Dynamic skillParams and negative cost guard");

        Console.WriteLine("ALL MEGATH SKILL DAMAGE TESTS PASSED (" + _passed + " assertions).");
    }
}
