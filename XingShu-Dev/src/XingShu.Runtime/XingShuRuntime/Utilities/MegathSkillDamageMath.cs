using System;
using System.Collections.Generic;

namespace XingShuRuntime.Utilities
{
    /// <summary>
    /// Pure calculation helpers for Megath (HeroId 122) active skill "轨道轰炸" theoretical max damage.
    /// Decoupled from FairyGUI so headless unit tests can verify formula outputs directly.
    /// </summary>
    internal struct MegathDamageSummary
    {
        internal int CardCount { get; private set; }
        internal int TotalCost { get; private set; }
        internal int CardsPerShot { get; private set; }
        internal int Shots { get; private set; }
        internal int BaseDamagePerShot { get; private set; }
        internal int CostBonusPerShot { get; private set; }
        internal int DamagePerShot { get; private set; }
        internal int TotalDamage { get; private set; }
        internal bool IsPveScaling { get; private set; }
        internal bool GrantsOrbitalCannon { get; private set; }
        internal int SkillId { get; private set; }

        internal MegathDamageSummary(
            int cardCount,
            int totalCost,
            int cardsPerShot,
            int shots,
            int baseDamagePerShot,
            int costBonusPerShot,
            int damagePerShot,
            int totalDamage,
            bool isPveScaling,
            bool grantsOrbitalCannon,
            int skillId) : this()
        {
            CardCount = cardCount;
            TotalCost = totalCost;
            CardsPerShot = cardsPerShot;
            Shots = shots;
            BaseDamagePerShot = baseDamagePerShot;
            CostBonusPerShot = costBonusPerShot;
            DamagePerShot = damagePerShot;
            TotalDamage = totalDamage;
            IsPveScaling = isPveScaling;
            GrantsOrbitalCannon = grantsOrbitalCannon;
            SkillId = skillId;
        }
    }

    internal static class MegathSkillDamageMath
    {
        internal const int MegathHeroId = 122;
        internal const int PvpSkillId = 12201;
        internal const int PveSkillId = 12202;
        internal const int PvePotentialSkillId = 12203;
        internal const int PotentialOrbitalCardThreshold = 6;

        internal static MegathDamageSummary Compute(
            int skillId,
            bool isPveMode,
            IList<int> skillParams,
            IList<int> cardCosts)
        {
            bool isPveScaling = skillId == PveSkillId
                || skillId == PvePotentialSkillId
                || (isPveMode && skillParams != null && skillParams.Count >= 5);

            int baseDmg = (skillParams != null && skillParams.Count >= 1 && skillParams[0] > 0)
                ? skillParams[0]
                : (isPveScaling ? 3 : 2);

            int cardsPerShot = (skillParams != null && skillParams.Count >= 2 && skillParams[1] > 0)
                ? skillParams[1]
                : 2;

            int costPerStep = isPveScaling
                ? ((skillParams != null && skillParams.Count >= 4 && skillParams[3] > 0) ? skillParams[3] : 3)
                : 0;
            int bonusPerStep = isPveScaling
                ? ((skillParams != null && skillParams.Count >= 5 && skillParams[4] > 0) ? skillParams[4] : 1)
                : 0;

            int cardCount = cardCosts != null ? cardCosts.Count : 0;
            int totalCost = 0;
            if (cardCosts != null)
            {
                for (int i = 0; i < cardCosts.Count; i++)
                {
                    if (cardCosts[i] > 0) totalCost += cardCosts[i];
                }
            }

            int shots = cardCount / cardsPerShot;
            int costBonus = costPerStep > 0 ? (totalCost / costPerStep) * bonusPerStep : 0;
            int perShot = baseDmg + costBonus;
            int totalDamage = shots * perShot;
            bool grantsOrbitalCannon = (skillId == PvePotentialSkillId) && (cardCount >= PotentialOrbitalCardThreshold);

            return new MegathDamageSummary(
                cardCount,
                totalCost,
                cardsPerShot,
                shots,
                baseDmg,
                costBonus,
                perShot,
                totalDamage,
                isPveScaling,
                grantsOrbitalCannon,
                skillId);
        }

        internal static string FormatFormulaLine(MegathDamageSummary summary)
        {
            if (summary.Shots <= 0)
            {
                return summary.IsPveScaling
                    ? string.Format("{0}张(费{1}) = 不足{2}张(无法开炮)", summary.CardCount, summary.TotalCost, summary.CardsPerShot)
                    : string.Format("{0}张 = 不足{1}张(无法开炮)", summary.CardCount, summary.CardsPerShot);
            }

            if (summary.IsPveScaling)
            {
                string line = string.Format("{0}张(费{1}) = {2}炮 * {3}伤", summary.CardCount, summary.TotalCost, summary.Shots, summary.DamagePerShot);
                if (summary.GrantsOrbitalCannon)
                {
                    line += " + 轨道炮";
                }
                return line;
            }

            return string.Format("{0}张 = {1}炮 * {2}伤", summary.CardCount, summary.Shots, summary.DamagePerShot);
        }
    }
}
