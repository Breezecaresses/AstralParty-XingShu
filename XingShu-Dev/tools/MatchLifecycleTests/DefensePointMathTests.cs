using System;
using System.Collections.Generic;
using XingShuRuntime.Utilities;

internal static class DefensePointMathTests
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
        else
        {
            Console.WriteLine("PASS: " + message);
        }
    }

    private static int Main()
    {
        // 1. Native dodge formula: defense die > attackPoint (or == 6 when attackPoint == 6), unrevealed = 16/36
        Check(Math.Abs(DefensePointMath.ComputeDodgeSuccessProbability(0, true) - (16.0 / 36.0)) < 1e-6,
            "unrevealed attack die gives 16/36 (~44.4%) dodge");
        Check(Math.Abs(DefensePointMath.ComputeDodgeSuccessProbability(1, true) - (5.0 / 6.0)) < 1e-6,
            "attack die 1 gives 5/6 dodge");
        Check(Math.Abs(DefensePointMath.ComputeDodgeSuccessProbability(6, true) - (1.0 / 6.0)) < 1e-6,
            "attack die 6 gives 1/6 dodge (6 vs 6 succeeds)");
        Check(DefensePointMath.ComputeDodgeSuccessProbability(1, false) == 0.0,
            "unavailable dodge gives 0");

        // 2. Already 0% KO without playing extra cards -> Safe verdict ("稳了！不用出防牌")
        var safePlan = DefensePointMath.BuildAdvicePlan(
            KillProbabilityMath.Fixed(2),
            KillProbabilityMath.Fixed(3),
            1,
            10,
            0,
            new List<HandDefenseCard>
            {
                new HandDefenseCard { CardId = 1, Name = "防御(中)", MinBonus = 1, MaxBonus = 3, Cost = 1 }
            },
            3,
            true);
        Check(safePlan.Tone == DefenseVerdictTone.Safe && safePlan.RecommendedCardCount == 0 && !safePlan.RecommendDodge,
            "0% base KO recommends saving all defense cards");

        // 3. 1 defense card guarantees 0% KO -> PlayCards ("出 1 张「...」就稳了！")
        // Atk base 5 + revealed die 4 = 9. Def base 2 + d6(1..6) = 3..8. HP = 3 (max dmg taken = 9 - 3 = 6 >= 3).
        // Playing 防御(大) +1..6 brings def total to 4..14 -> with minBonus 1 still dmg max 5 >=3, WAIT use Fixed atk=4+4=8, Def=3+d6=4..9, HP=5 -> max dmg 4 if +2? Let's test exact:
        // Atk base 4 + revealed 3 = 7. Def base 0 + d6 = 1..6. HP = 5. Without card: max dmg = 7 - 1 = 6 (dies on roll 1,2 -> 2/6 KO).
        // Adding 防御(中) (+2..2 or +2..4): min def = 3 -> max dmg = 4 < 5 -> 0% KO!
        var playOnePlan = DefensePointMath.BuildAdvicePlan(
            KillProbabilityMath.Fixed(4),
            KillProbabilityMath.Fixed(0),
            3,
            5,
            0,
            new List<HandDefenseCard>
            {
                new HandDefenseCard { CardId = 201, Name = "防御(中)", MinBonus = 2, MaxBonus = 4, Cost = 1 },
                new HandDefenseCard { CardId = 202, Name = "防御(大)", MinBonus = 1, MaxBonus = 6, Cost = 2 }
            },
            2,
            true);
        Check(playOnePlan.Tone == DefenseVerdictTone.PlayCards &&
              playOnePlan.RecommendedCardCount == 1 &&
              playOnePlan.BestCardKoProbability <= 0.0001 &&
              playOnePlan.CardActionLine.Contains("防御(中)"),
            "cheapest 1-card combo dropping KO to 0% is chosen");

        // 4. Cost limit blocks expensive cards -> evaluates only affordable cards
        var costLimited = DefensePointMath.BuildAdvicePlan(
            KillProbabilityMath.Fixed(4),
            KillProbabilityMath.Fixed(0),
            3,
            5,
            0,
            new List<HandDefenseCard>
            {
                new HandDefenseCard { CardId = 202, Name = "防御(特大)", MinBonus = 4, MaxBonus = 6, Cost = 3 }
            },
            1,
            true);
        Check(costLimited.RecommendedCardCount == 0,
            "unaffordable defense cards are excluded from recommendation");

        // 5. HP = 1 (or cannot survive minimum damage) -> DangerDodge recommends Dodge directly
        var hp1Plan = DefensePointMath.BuildAdvicePlan(
            KillProbabilityMath.Fixed(2),
            KillProbabilityMath.Fixed(5),
            2,
            1,
            0,
            new List<HandDefenseCard>
            {
                new HandDefenseCard { CardId = 203, Name = "防御(大)", MinBonus = 3, MaxBonus = 6, Cost = 1 }
            },
            3,
            true);
        Check(hp1Plan.Tone == DefenseVerdictTone.DangerDodge && hp1Plan.RecommendDodge &&
              hp1Plan.Headline.Contains("闪避"),
            "HP=1 recommends direct dodge instead of wasting defense cards");

        Console.WriteLine($"DefensePointMathTests: {_checks} checks, {_failed} failed.");
        return _failed == 0 ? 0 : 1;
    }
}
