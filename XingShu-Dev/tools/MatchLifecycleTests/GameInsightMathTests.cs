using System;
using System.Collections.Generic;
using XingShuRuntime.Utilities;

class GameInsightMathTests
{
    static void Check(bool ok, string name)
    {
        if (!ok) throw new Exception("FAIL: " + name);
        Console.WriteLine("PASS " + name);
    }

    static void Main()
    {
        // 1. Fanny 10202 2-choice reveal
        var fanny = new FannyEventChoiceState();
        fanny.RecordOffer(1002, "芬妮玩家", 3, new[] { 9101, 9102 }, 50.0d);
        Check(fanny.HasVisibleNotice(51.0d), "pending Fanny offer is visible");
        Check(fanny.LatestEntry.IsPending && fanny.LatestEntry.OfferedEventIds.Length == 2, "two offered events stored");

        var chosen = fanny.RecordSelection(1002, 9102, 55.0d);
        Check(chosen != null && !chosen.IsPending && chosen.ChosenEventId == 9102 && chosen.UnchosenEventId == 9101,
            "selection resolves chosen 9102 and unchosen 9101");
        Check(fanny.HasVisibleNotice(70.0d), "selection remains visible during hold window");
        Check(!fanny.HasVisibleNotice(80.0d), "selection auto-hides after hold window");

        // 2. Mimi active skill + Vitamin Pill
        var mimi = GameInsightMath.ComputeMimiSkill(handCount: 5, battleCardCount: 3, hasVitaminPill: true, currentHealStacks: 2, utilityKnifeCount: 1);
        Check(mimi.ExpectedStarCoins == 3, "Mimi star coins equals battle cards (3)");
        Check(mimi.ExpectedDrawCount == 6 && mimi.ExpectedHealGain == 6 && mimi.ProjectedHealStacks == 8,
            "Mimi + Vitamin Pill draws 6 and adds 6 heal stacks (2 -> 8)");
        Check(mimi.ProjectedKnifeBonusAtk == 6, "Utility knife gains +6 ATK from Mimi draw");

        var mimiNoPill = GameInsightMath.ComputeMimiSkill(4, 2, false, 3, 1);
        Check(mimiNoPill.ExpectedStarCoins == 2 && mimiNoPill.ExpectedHealGain == 0 && mimiNoPill.ProjectedHealStacks == 3,
            "Mimi without Vitamin Pill grants 0 heal stacks");

        // 3. Universal stacked damage calculator
        var stacked = GameInsightMath.ComputeStackedDamage(new StackedDamageInput
        {
            BasePanelAtk = 5,
            Hp = 10,
            MaxHp = 10,
            ExtraMaxHp = 4,
            Gold = 35,
            HealStacks = 6,
            StarlightStacks = 9,
            ElectricStacks = 8,
            SuperEnergyStacks = 2,
            HasBlueCurse = true,
            MaxMonsterMarkStacks = 3,
            MaxMonsterDefense = 4,
            HasBossMonster = true,
            AnyTargetSlowed = true,
            MarkTargetName = "Boss",
            OwnedRelics = new HashSet<int>
            {
                GameInsightMath.ChipUtilityKnifeSharp,   // +6 atk from heal
                GameInsightMath.ChipHawkeyeSight,        // (3+1)*2 = +8 vs monster
                GameInsightMath.ChipNinjutsuDart,        // +3 effect card
                GameInsightMath.ChipFlashlightStrong,    // 9/4 = +2 vs monster
                GameInsightMath.ChipGoldenShootingStar,  // 2 + 9 = 11 vs boss
                GameInsightMath.ChipStarCoinHammer,      // floor(35*0.3) = +10 atk
                GameInsightMath.ChipSportWristband,      // +4 atk vs slowed
                GameInsightMath.ChipRailgun,             // floor(total*0.5)
                GameInsightMath.ChipPiercingGun,         // +4 effect card
                GameInsightMath.ChipBookmark,            // +2 effect card
            }
        });
        Check(stacked.HasAnyRelevantEffect, "stacked damage summary active");
        Check(stacked.TotalAttackGeneral == 5 + 6 + 10, "general combat ATK includes heal knife (+6) and hammer (+10) without double-counting panel");
        Check(stacked.TotalAttackVsMonster == 21 + 8 + 2 + 4, "vs-monster ATK adds hawkeye (+8), flashlight (+2), wristband (+4) = 35");
        Check(stacked.EffectCardBonusDmg == 3 + 4 + 2, "effect card bonus sums dart (+3), piercing (+4), bookmark (+2) = 9");
        Check(stacked.GoldenStarBossBonusDmg == 11, "golden shooting star vs boss = 2 + 9 = 11");
        Check(stacked.RailgunAoeDmg == 17, "railgun AoE = floor(35 * 0.5) = 17");
    }
}
