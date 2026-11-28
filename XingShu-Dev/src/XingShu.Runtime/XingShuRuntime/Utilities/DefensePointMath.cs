using System;
using System.Collections.Generic;
using System.Globalization;

namespace XingShuRuntime.Utilities;

internal struct HandDefenseCard
{
    internal int CardId;
    internal string Name;
    internal int MinBonus;
    internal int MaxBonus;
    internal int Cost;
}

internal enum DefenseVerdictTone
{
    Safe = 0,
    PlayCards = 1,
    DangerDodge = 2,
}

internal sealed class DefenseAdvicePlan
{
    internal DefenseVerdictTone Tone;
    internal string Headline = "";
    internal string SummaryLine = "";
    internal string CardActionLine = "";
    internal string DiceAndDodgeLine = "";
    internal double BaseKoProbability;
    internal double BestCardKoProbability;
    internal double DodgeSuccessProbability;
    internal int RecommendedCardCount;
    internal bool RecommendDodge;
}

internal static class DefensePointMath
{
    internal static long MinimumDamage(long bonus) => checked(1L + Math.Max(0L, bonus));
    internal static long MinimumDamageDefense(long attack) => Math.Max(0L, attack - 1L);

    // -1 means ordinary defense cannot prevent the KO, even with infinite DEF.
    internal static long SurviveDefense(long attack, long hp, long bonus)
        => hp <= MinimumDamage(bonus) ? -1L : Math.Max(0L, checked(attack + bonus - hp + 1L));

    internal static string DodgeAdvice(long hp, long survivalThreshold, long bestDefenseBeforeDice, bool estimated)
    {
        if (hp == 1) return "仅剩 1 血，建议闪避";
        if (survivalThreshold < 0) return "普通防御无法保命，建议闪避";
        if (survivalThreshold <= bestDefenseBeforeDice || survivalThreshold - bestDefenseBeforeDice <= 6)
            return string.Empty;
        return estimated ? "按预计上限防不住，建议闪避" : "现有防御防不住，建议闪避";
    }

    internal static string Dice(long threshold, long defenseBeforeDice)
    {
        if (threshold < 0) return "普通防御无法避免击飞";
        long required = Math.Max(1L, threshold - defenseBeforeDice);
        return required <= 1 ? "普通1–6骰均可" : required <= 6 ? "防御骰 ≥ " + required : "现有防御不足，还需防御牌";
    }

    /// <summary>
    /// Native dodge formula verified from FightWindow::RefreshDodgeInfo:
    /// dodge succeeds when defense die > attackPoint (or == 6 when attackPoint == 6).
    /// </summary>
    internal static double ComputeDodgeSuccessProbability(int revealedAttackPoint, bool dodgeAvailable)
    {
        if (!dodgeAvailable) return 0.0;
        if (revealedAttackPoint >= 1 && revealedAttackPoint <= 6)
        {
            return revealedAttackPoint == 6 ? (1.0 / 6.0) : ((6.0 - revealedAttackPoint) / 6.0);
        }
        return 16.0 / 36.0;
    }

    internal static string FormatPercent(double p)
    {
        double clamped = Math.Max(0.0, Math.Min(1.0, p));
        if (clamped <= 0.0001) return "0%";
        if (clamped >= 0.9999) return "100%";
        return Math.Max(0.1, Math.Min(99.9, clamped * 100.0)).ToString("0.#", CultureInfo.InvariantCulture) + "%";
    }

    internal static DefenseAdvicePlan BuildAdvicePlan(
        KillProbabilityMath.Distribution attackBeforeDice,
        KillProbabilityMath.Distribution defenseBeforeDice,
        int revealedAttackPoint,
        long hp,
        long bonusDamage,
        IReadOnlyList<HandDefenseCard> unplayedHandCards,
        int residueCost,
        bool dodgeAvailable)
    {
        var d6 = KillProbabilityMath.Uniform(1, 6);
        var atkDieDist = (revealedAttackPoint >= 1 && revealedAttackPoint <= 6)
            ? KillProbabilityMath.Fixed(revealedAttackPoint)
            : d6;
        var atkTotal = KillProbabilityMath.Add(attackBeforeDice, atkDieDist);
        var baseDefTotal = KillProbabilityMath.Add(defenseBeforeDice, d6);

        EvaluateDamageOutcomes(atkTotal, baseDefTotal, hp, bonusDamage, out double baseKo, out double baseMinDmgProb);
        double dodgeProb = ComputeDodgeSuccessProbability(revealedAttackPoint, dodgeAvailable);

        var plan = new DefenseAdvicePlan
        {
            BaseKoProbability = baseKo,
            BestCardKoProbability = baseKo,
            DodgeSuccessProbability = dodgeProb,
        };

        long maxAtk = atkTotal.Max;
        long minAtk = atkTotal.Min;
        long floorDef = MinimumDamageDefense(maxAtk);
        long surviveDef = SurviveDefense(maxAtk, hp, bonusDamage);
        string dodgeText = dodgeAvailable
            ? ("闪避成功率 [color=#73DAFF]" + FormatPercent(dodgeProb) + "[/color]")
            : "本次不可闪避";

        plan.SummaryLine = $"敌方总攻 [color=#FF937B]{minAtk}~{maxAtk}[/color] · 你 [color=#FF8DA1]{hp}血[/color] · 当前防 [color=#7ECBFF]{defenseBeforeDice.Min}~{defenseBeforeDice.Max}[/color]";

        // Filter playable defense cards by remaining cost & valid bounds, sorted cheapest/weakest first
        var candidates = new List<HandDefenseCard>();
        if (unplayedHandCards != null)
        {
            for (int i = 0; i < unplayedHandCards.Count; i++)
            {
                var c = unplayedHandCards[i];
                if (c.Cost > residueCost || c.MaxBonus < c.MinBonus || c.MaxBonus <= 0) continue;
                candidates.Add(c);
            }
        }
        candidates.Sort((a, b) =>
        {
            int cmp = a.MaxBonus.CompareTo(b.MaxBonus);
            if (cmp != 0) return cmp;
            cmp = a.Cost.CompareTo(b.Cost);
            return cmp != 0 ? cmp : a.MinBonus.CompareTo(b.MinBonus);
        });
        if (candidates.Count > 5) candidates.RemoveRange(5, candidates.Count - 5);

        // Rule 1: HP too low to survive even minimum 1 damage + bonus
        if (surviveDef < 0)
        {
            plan.Tone = DefenseVerdictTone.DangerDodge;
            plan.RecommendDodge = dodgeAvailable;
            plan.Headline = dodgeAvailable ? "血量不够，直接选闪避！" : "防不住，必被击飞！";
            plan.CardActionLine = dodgeAvailable
                ? "吃满最低伤害也会倒下，千万别交防牌，直接点闪避！"
                : "当前血量无法承受最低伤害，保留手牌即可。";
            plan.DiceAndDodgeLine = dodgeText + (dodgeAvailable && revealedAttackPoint >= 1 && revealedAttackPoint <= 6
                ? $"（敌方已亮骰 {revealedAttackPoint}）"
                : "");
            return plan;
        }

        // Rule 2: Already 0% KO without playing extra cards
        if (baseKo <= 0.0001)
        {
            plan.Tone = DefenseVerdictTone.Safe;
            plan.Headline = "稳了！不用出防牌";
            HandDefenseCard? singleHelpCard = null;
            if (baseMinDmgProb < 0.999 && candidates.Count > 0)
            {
                for (int i = 0; i < candidates.Count; i++)
                {
                    var cand = candidates[i];
                    var withCard = TryAddCard(defenseBeforeDice, cand);
                    EvaluateDamageOutcomes(atkTotal, KillProbabilityMath.Add(withCard, d6), hp, bonusDamage, out _, out double newMinDmgProb);
                    if (newMinDmgProb >= 0.999)
                    {
                        singleHelpCard = cand;
                        break;
                    }
                }
            }
            plan.CardActionLine = singleHelpCard.HasValue
                ? $"不出牌 0% 被击飞；想压到最低 {MinimumDamage(bonusDamage)} 血可补 1 张「{singleHelpCard.Value.Name}」"
                : "不出防御牌也 100% 稳扛，省下手牌留着用！";
            plan.DiceAndDodgeLine = $"压至最低伤害需总防 ≥ {floorDef} · {dodgeText}";
            return plan;
        }

        // Search subsets of size 1..3 (with total cost <= residueCost)
        var bestSafeSubset = new List<HandDefenseCard>();
        bool foundSafe = false;
        int bestSafeCount = int.MaxValue;
        int bestSafeCost = int.MaxValue;
        int bestSafeBonusSum = int.MaxValue;

        var bestMinKoSubset = new List<HandDefenseCard>();
        double minKo = baseKo;
        int minKoCount = 0;
        int minKoCost = 0;

        int n = candidates.Count;
        int maskLimit = 1 << n;
        for (int mask = 1; mask < maskLimit; mask++)
        {
            int cnt = 0;
            int costSum = 0;
            int maxBonusSum = 0;
            for (int i = 0; i < n; i++)
            {
                if ((mask & (1 << i)) == 0) continue;
                cnt++;
                costSum += candidates[i].Cost;
                maxBonusSum += candidates[i].MaxBonus;
            }
            if (cnt == 0 || cnt > 3 || costSum > residueCost) continue;

            var defCards = defenseBeforeDice;
            bool ok = true;
            for (int i = 0; i < n; i++)
            {
                if ((mask & (1 << i)) == 0) continue;
                defCards = TryAddCard(defCards, candidates[i]);
                if (defCards == null) { ok = false; break; }
            }
            if (!ok) continue;

            var defTotal = KillProbabilityMath.Add(defCards, d6);
            EvaluateDamageOutcomes(atkTotal, defTotal, hp, bonusDamage, out double koProb, out _);

            if (koProb <= 0.0001)
            {
                if (!foundSafe
                    || cnt < bestSafeCount
                    || (cnt == bestSafeCount && (costSum < bestSafeCost || (costSum == bestSafeCost && maxBonusSum < bestSafeBonusSum))))
                {
                    foundSafe = true;
                    bestSafeCount = cnt;
                    bestSafeCost = costSum;
                    bestSafeBonusSum = maxBonusSum;
                    CollectMask(candidates, mask, bestSafeSubset);
                }
            }
            else if (koProb < minKo - 0.0001
                || (Math.Abs(koProb - minKo) <= 0.0001 && (cnt < minKoCount || (cnt == minKoCount && costSum < minKoCost))))
            {
                minKo = koProb;
                minKoCount = cnt;
                minKoCost = costSum;
                CollectMask(candidates, mask, bestMinKoSubset);
            }
        }

        if (foundSafe)
        {
            plan.Tone = DefenseVerdictTone.PlayCards;
            plan.BestCardKoProbability = 0.0;
            plan.RecommendedCardCount = bestSafeSubset.Count;
            string names = JoinCardNames(bestSafeSubset);
            plan.Headline = $"出 {bestSafeSubset.Count} 张「{names}」就稳了！";
            plan.CardActionLine = $"不出牌被击飞 [color=#FF6B81]{FormatPercent(baseKo)}[/color] → 出 {bestSafeSubset.Count} 张「{names}」降至 [color=#67E480]0%[/color] 稳扛";
            plan.DiceAndDodgeLine = FormatNeedRollText(surviveDef, defenseBeforeDice.Min, dodgeText);
            return plan;
        }

        plan.BestCardKoProbability = minKo;
        double bestSurvive = 1.0 - minKo;
        bool hasHelpfulCards = bestMinKoSubset.Count > 0 && minKo < baseKo - 0.005;

        // Check whether hard defense even with hand cards + max roll 6 is still worse than dodging
        if (bestSurvive <= 0.0001 || (dodgeAvailable && dodgeProb > bestSurvive + 0.03 && minKo >= 0.40))
        {
            plan.Tone = DefenseVerdictTone.DangerDodge;
            plan.RecommendDodge = dodgeAvailable;
            plan.Headline = dodgeAvailable ? "硬防不稳，建议直接闪避！" : "硬防风险极高！";
            if (hasHelpfulCards)
            {
                string names = JoinCardNames(bestMinKoSubset);
                plan.CardActionLine = dodgeAvailable
                    ? $"就算交 {bestMinKoSubset.Count} 张「{names}」仍会被击飞 [color=#FF6B81]{FormatPercent(minKo)}[/color]，不如留牌直接闪避！"
                    : $"交 {bestMinKoSubset.Count} 张「{names}」可把被击飞从 {FormatPercent(baseKo)} 压到 {FormatPercent(minKo)}";
            }
            else
            {
                plan.CardActionLine = dodgeAvailable
                    ? $"硬吃被击飞概率 [color=#FF6B81]{FormatPercent(baseKo)}[/color]，手上防御不足，直接点闪避赌赢面更大！"
                    : $"硬吃被击飞概率 [color=#FF6B81]{FormatPercent(baseKo)}[/color]，当前无可用防牌";
            }
            plan.DiceAndDodgeLine = $"{FormatNeedRollText(surviveDef, defenseBeforeDice.Min, dodgeText)}";
            return plan;
        }

        if (hasHelpfulCards)
        {
            plan.Tone = DefenseVerdictTone.PlayCards;
            plan.RecommendedCardCount = bestMinKoSubset.Count;
            string names = JoinCardNames(bestMinKoSubset);
            plan.Headline = $"建议出 {bestMinKoSubset.Count} 张「{names}」保命";
            plan.CardActionLine = $"不出牌被击飞 [color=#FF6B81]{FormatPercent(baseKo)}[/color] → 出后降至 [color=#FFD85A]{FormatPercent(minKo)}[/color]";
            plan.DiceAndDodgeLine = FormatNeedRollText(surviveDef, defenseBeforeDice.Min, dodgeText);
            return plan;
        }

        // No helpful cards in hand, rely on dice vs dodge
        bool preferDodge = dodgeAvailable && dodgeProb > (1.0 - baseKo) + 0.03;
        plan.Tone = preferDodge || baseKo >= 0.50 ? DefenseVerdictTone.DangerDodge : DefenseVerdictTone.PlayCards;
        plan.RecommendDodge = preferDodge;
        plan.Headline = preferDodge
            ? "手牌无防牌，建议直接闪避！"
            : $"无可用防牌，硬防被击飞 {FormatPercent(baseKo)}";
        plan.CardActionLine = preferDodge
            ? $"硬防活命仅 {FormatPercent(1.0 - baseKo)}，点闪避成功率为 {FormatPercent(dodgeProb)}"
            : "拼防御骰点数保命，注意留心对手高攻上限";
        plan.DiceAndDodgeLine = FormatNeedRollText(surviveDef, defenseBeforeDice.Min, dodgeText);
        return plan;
    }

    private static string FormatNeedRollText(long surviveDef, long curMinDef, string dodgeText)
    {
        long needDie = surviveDef - curMinDef;
        string needStr = needDie <= 1
            ? "保底防骰全过"
            : (needDie <= 6 ? $"保命需总防 ≥ {surviveDef}（防骰 ≥ {needDie}）" : $"保命需总防 ≥ {surviveDef}（需补防牌）");
        return needStr + " · " + dodgeText;
    }

    private static KillProbabilityMath.Distribution TryAddCard(KillProbabilityMath.Distribution current, HandDefenseCard card)
    {
        try
        {
            var cardDist = card.MinBonus == card.MaxBonus
                ? KillProbabilityMath.Fixed(card.MinBonus)
                : KillProbabilityMath.Uniform(card.MinBonus, card.MaxBonus);
            return KillProbabilityMath.Add(current, cardDist);
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    private static void CollectMask(List<HandDefenseCard> cards, int mask, List<HandDefenseCard> dest)
    {
        dest.Clear();
        for (int i = 0; i < cards.Count; i++)
        {
            if ((mask & (1 << i)) != 0) dest.Add(cards[i]);
        }
    }

    private static string JoinCardNames(List<HandDefenseCard> cards)
    {
        if (cards.Count == 1) return cards[0].Name;
        var arr = new string[cards.Count];
        for (int i = 0; i < cards.Count; i++) arr[i] = cards[i].Name;
        return string.Join("+", arr);
    }

    private static void EvaluateDamageOutcomes(
        KillProbabilityMath.Distribution atkTotal,
        KillProbabilityMath.Distribution defTotal,
        long hp,
        long bonusDamage,
        out double koProb,
        out double minDmgProb)
    {
        koProb = 0.0;
        minDmgProb = 0.0;
        long minDamage = MinimumDamage(bonusDamage);
        for (int ai = 0; ai < atkTotal.Weights.Length; ai++)
        {
            double pa = atkTotal.Weights[ai];
            if (pa <= 0.0) continue;
            long a = (long)atkTotal.Min + ai;
            for (int di = 0; di < defTotal.Weights.Length; di++)
            {
                double pd = defTotal.Weights[di];
                if (pd <= 0.0) continue;
                long d = (long)defTotal.Min + di;
                long dmg = Math.Max(1L, a - d) + bonusDamage;
                double weight = pa * pd;
                if (dmg >= hp) koProb += weight;
                if (dmg <= minDamage) minDmgProb += weight;
            }
        }
    }
}
