using System;
using System.Collections.Generic;
using System.Text;

namespace XingShuRuntime.Utilities
{
    internal sealed class FannyEventChoiceEntry
    {
        internal long PlayerId;
        internal string PlayerName;
        internal int Round;
        internal int[] OfferedEventIds;
        internal int ChosenEventId;
        internal int UnchosenEventId;
        internal bool IsPending;
        internal double UpdatedRealTime;
    }

    internal sealed class FannyEventChoiceState
    {
        internal const double DefaultNoticeHoldSeconds = 20.0d;
        private readonly List<FannyEventChoiceEntry> _entries = new List<FannyEventChoiceEntry>();

        internal FannyEventChoiceEntry LatestEntry => _entries.Count > 0 ? _entries[_entries.Count - 1] : null;
        internal int Count => _entries.Count;

        internal void Clear()
        {
            _entries.Clear();
        }

        internal void RecordOffer(long playerId, string playerName, int round, IList<int> offeredEventIds, double realNow)
        {
            if (playerId <= 0 || offeredEventIds == null || offeredEventIds.Count == 0) return;
            var ids = new List<int>(offeredEventIds.Count);
            for (int i = 0; i < offeredEventIds.Count; i++)
            {
                int id = offeredEventIds[i];
                if (id > 0 && !ids.Contains(id)) ids.Add(id);
            }
            if (ids.Count == 0) return;

            for (int i = _entries.Count - 1; i >= 0; i--)
            {
                var existing = _entries[i];
                if (existing.PlayerId == playerId && existing.IsPending && existing.Round == round)
                {
                    existing.PlayerName = string.IsNullOrEmpty(playerName) ? existing.PlayerName : playerName;
                    existing.OfferedEventIds = ids.ToArray();
                    existing.UpdatedRealTime = realNow;
                    return;
                }
            }

            _entries.Add(new FannyEventChoiceEntry
            {
                PlayerId = playerId,
                PlayerName = string.IsNullOrEmpty(playerName) ? ("P" + playerId) : playerName,
                Round = round,
                OfferedEventIds = ids.ToArray(),
                ChosenEventId = 0,
                UnchosenEventId = 0,
                IsPending = true,
                UpdatedRealTime = realNow,
            });
            if (_entries.Count > 12) _entries.RemoveAt(0);
        }

        internal FannyEventChoiceEntry RecordSelection(long playerId, int chosenEventId, double realNow)
        {
            if (playerId <= 0 || chosenEventId <= 0) return null;
            for (int i = _entries.Count - 1; i >= 0; i--)
            {
                var e = _entries[i];
                if (e.PlayerId != playerId) continue;
                if (e.IsPending)
                {
                    e.ChosenEventId = chosenEventId;
                    e.IsPending = false;
                    e.UpdatedRealTime = realNow;
                    e.UnchosenEventId = ResolveOtherEventId(e.OfferedEventIds, chosenEventId);
                    return e;
                }
            }
            return null;
        }

        internal static int ResolveOtherEventId(int[] offeredEventIds, int chosenEventId)
        {
            if (offeredEventIds == null) return 0;
            for (int i = 0; i < offeredEventIds.Length; i++)
            {
                if (offeredEventIds[i] > 0 && offeredEventIds[i] != chosenEventId)
                {
                    return offeredEventIds[i];
                }
            }
            return 0;
        }

        internal bool HasVisibleNotice(double realNow, double holdSeconds = DefaultNoticeHoldSeconds)
        {
            var latest = LatestEntry;
            if (latest == null) return false;
            if (latest.IsPending) return true;
            return realNow - latest.UpdatedRealTime <= holdSeconds;
        }
    }

    internal struct MimiSkillSummary
    {
        internal int HandCount;
        internal int BattleCardCount;
        internal int ExpectedStarCoins;
        internal int ExpectedDrawCount;
        internal bool HasVitaminPill;
        internal int CurrentHealStacks;
        internal int ExpectedHealGain;
        internal int ProjectedHealStacks;
        internal int UtilityKnifeCount;
        internal int ProjectedKnifeBonusAtk;
        internal int ActiveSkillCd;
    }

    internal struct StackedDamageInput
    {
        internal int BasePanelAtk;
        internal int Hp;
        internal int MaxHp;
        internal int ExtraMaxHp;
        internal int Gold;
        internal int HealStacks;
        internal int StarlightStacks;
        internal int ElectricStacks;
        internal int SuperEnergyStacks;
        internal bool HasBlueCurse;
        internal int MaxMonsterMarkStacks;
        internal int MaxMonsterDefense;
        internal bool HasBossMonster;
        internal bool AnyTargetSlowed;
        internal string MarkTargetName;
        internal ICollection<int> OwnedRelics;
    }

    internal struct StackedDamageSummary
    {
        internal bool HasAnyRelevantEffect;
        internal int BasePanelAtk;
        internal int NonTargetCombatBonusAtk;
        internal int MonsterAttackBonusAtk;
        internal int MarkBonusVsTargetAtk;
        internal int TotalAttackGeneral;
        internal int TotalAttackVsMonster;
        internal int EffectCardBonusDmg;
        internal int GoldenStarBossBonusDmg;
        internal int RailgunAoeDmg;
        internal string BreakdownText;
    }

    internal static class GameInsightMath
    {
        internal const int FannyHeroId = 102;
        internal const int FannyPotentialSkillId = 10202;
        internal const int MimiHeroId = 108;

        // Verified chip IDs from gameCatalog / StaticConfigure
        internal const int ChipSandwichDelicious = 50009;   // 夹心饼干-美味: 每2点额外HP上限 ATK+1
        internal const int ChipUtilityKnifeBasic = 50010;   // 美工刀-初级: 满血+2, 攻击+治愈层数
        internal const int ChipUtilityKnifeSharp = 50011;   // 美工刀-锋利: 满血+4, 攻击+治愈层数
        internal const int ChipFlashlightStrong = 50013;    // 手电筒-强光: 攻怪每4层星光 ATK+1
        internal const int ChipAdrenaline = 50024;          // 肾上腺素-高效: HP<=50% ATK+8
        internal const int ChipVitaminPill = 50027;         // 维生素药丸: 每获1牌 +1治愈
        internal const int ChipVengeanceHalberd = 50038;    // 复仇之戟: 青之诅咒 ATK+5
        internal const int ChipPiercingGun = 50039;         // 贯穿之铳: 效果牌额外加目标防御
        internal const int ChipStarCoinHammer = 50043;      // 星币锤: 星币>20 攻击+floor(星币*30%)
        internal const int ChipHawkeyeSight = 50044;        // 鹰眼瞄具: 攻击先加1标记并增(目标标记)*2攻
        internal const int ChipNinjutsuDart = 50045;        // 忍术飞镖: 效果伤害牌额外+目标标记层数
        internal const int ChipTargetMark = 50046;          // 标靶: ATK+1, 每回合对4格最近怪+1标记
        internal const int ChipSportWristband = 50073;      // 运动手环: ATK+1, 防御方移速受影响+4
        internal const int ChipGoldenShootingStar = 50079;  // 金色飞星: 放过怪造成2伤, 首领额外+星光层数
        internal const int ChipBookmark = 50081;            // 书签: 效果牌伤害+2
        internal const int ChipWhetstone = 50082;           // 磨刀石: HP<=50% ATK+4
        internal const int ChipElectricSword = 50085;       // 电流剑: 电流>7 ATK+2
        internal const int ChipRailgun = 50091;             // 电磁炮: ATK+2, 挑战后耗4电流对同格怪造成50%攻
        internal const int ChipPerfectBranch = 50096;       // 完美的树枝: 每层超强精力 ATK+2

        internal static MimiSkillSummary ComputeMimiSkill(
            int handCount,
            int battleCardCount,
            bool hasVitaminPill,
            int currentHealStacks,
            int utilityKnifeCount,
            int activeSkillCd = 0)
        {
            int cleanHand = Math.Max(0, handCount);
            int cleanBattle = Math.Max(0, Math.Min(cleanHand, battleCardCount));
            int drawCount = cleanHand + 1;
            int healGain = hasVitaminPill ? drawCount : 0;
            int totalHeal = Math.Max(0, currentHealStacks) + healGain;
            int knifeCount = Math.Max(0, utilityKnifeCount);
            return new MimiSkillSummary
            {
                HandCount = cleanHand,
                BattleCardCount = cleanBattle,
                ExpectedStarCoins = cleanBattle,
                ExpectedDrawCount = drawCount,
                HasVitaminPill = hasVitaminPill,
                CurrentHealStacks = Math.Max(0, currentHealStacks),
                ExpectedHealGain = healGain,
                ProjectedHealStacks = totalHeal,
                UtilityKnifeCount = knifeCount,
                ProjectedKnifeBonusAtk = healGain * knifeCount,
                ActiveSkillCd = Math.Max(0, activeSkillCd),
            };
        }

        internal static StackedDamageSummary ComputeStackedDamage(StackedDamageInput input)
        {
            var relics = input.OwnedRelics;
            if (relics == null || relics.Count == 0)
            {
                return new StackedDamageSummary
                {
                    HasAnyRelevantEffect = false,
                    BasePanelAtk = input.BasePanelAtk,
                    TotalAttackGeneral = input.BasePanelAtk,
                    TotalAttackVsMonster = input.BasePanelAtk,
                    BreakdownText = "",
                };
            }

            bool hasKnifeBasic = relics.Contains(ChipUtilityKnifeBasic);
            bool hasKnifeSharp = relics.Contains(ChipUtilityKnifeSharp);
            bool hasFlashlight = relics.Contains(ChipFlashlightStrong);
            bool hasHawkeye = relics.Contains(ChipHawkeyeSight);
            bool hasDart = relics.Contains(ChipNinjutsuDart);
            bool hasTarget = relics.Contains(ChipTargetMark);
            bool hasGoldenStar = relics.Contains(ChipGoldenShootingStar);
            bool hasHammer = relics.Contains(ChipStarCoinHammer);
            bool hasAdrenaline = relics.Contains(ChipAdrenaline);
            bool hasWhetstone = relics.Contains(ChipWhetstone);
            bool hasSandwich = relics.Contains(ChipSandwichDelicious);
            bool hasBranch = relics.Contains(ChipPerfectBranch);
            bool hasVengeance = relics.Contains(ChipVengeanceHalberd);
            bool hasElectricSword = relics.Contains(ChipElectricSword);
            bool hasRailgun = relics.Contains(ChipRailgun);
            bool hasWristband = relics.Contains(ChipSportWristband);
            bool hasPiercing = relics.Contains(ChipPiercingGun);
            bool hasBookmark = relics.Contains(ChipBookmark);
            bool hasVitamin = relics.Contains(ChipVitaminPill);

            bool any = hasKnifeBasic || hasKnifeSharp || hasFlashlight || hasHawkeye || hasDart
                || hasTarget || hasGoldenStar || hasHammer || hasAdrenaline || hasWhetstone
                || hasSandwich || hasBranch || hasVengeance || hasElectricSword || hasRailgun
                || hasWristband || hasPiercing || hasBookmark || hasVitamin;

            if (!any)
            {
                return new StackedDamageSummary
                {
                    HasAnyRelevantEffect = false,
                    BasePanelAtk = input.BasePanelAtk,
                    TotalAttackGeneral = input.BasePanelAtk,
                    TotalAttackVsMonster = input.BasePanelAtk,
                    BreakdownText = "",
                };
            }

            var sb = new StringBuilder();
            int nonTargetCombat = 0;
            int monsterOnlyBonus = 0;
            int markAttackBonus = 0;
            int effectCardBonus = 0;
            int heal = Math.Max(0, input.HealStacks);
            int starlight = Math.Max(0, input.StarlightStacks);
            int curMark = Math.Max(0, input.MaxMonsterMarkStacks);
            bool fullHp = input.MaxHp > 0 && input.Hp >= input.MaxHp;
            bool halfHp = input.MaxHp > 0 && input.Hp * 2 <= input.MaxHp;

            // Utility Knives: full-HP bonus is in Property.Atk if applied natively, heal stack bonus applies on attack!
            if (hasKnifeBasic)
            {
                nonTargetCombat += heal;
                AppendLine(sb, $"美工刀-初级: 攻击+{heal}（治愈{heal}层）" + (fullHp ? " · 满血+2已入面板" : " · 未满血无+2"));
            }
            if (hasKnifeSharp)
            {
                nonTargetCombat += heal;
                AppendLine(sb, $"美工刀-锋利: 攻击+{heal}（治愈{heal}层）" + (fullHp ? " · 满血+4已入面板" : " · 未满血无+4"));
            }
            if (hasVitamin && !hasKnifeBasic && !hasKnifeSharp)
            {
                AppendLine(sb, $"维生素药丸: 当前治愈 {heal} 层");
            }

            // Target / Mark series
            if (hasHawkeye)
            {
                int afterMark = curMark + 1;
                markAttackBonus += afterMark * 2;
                string tgt = string.IsNullOrEmpty(input.MarkTargetName) ? "目标" : input.MarkTargetName;
                AppendLine(sb, $"鹰眼瞄具: 先叠1层后 {afterMark} 层标记 -> 攻击+{afterMark * 2}（{tgt}当前{curMark}层）");
            }
            if (hasTarget)
            {
                AppendLine(sb, $"标靶: 面板+1 已生效 · 场内最高标记 {curMark} 层");
            }
            if (hasDart)
            {
                effectCardBonus += curMark;
                AppendLine(sb, $"忍术飞镖: 伤害效果牌 +{curMark} 伤（标记{curMark}层）");
            }

            // Starlight series
            if (hasFlashlight)
            {
                int starAtk = starlight / 4;
                monsterOnlyBonus += starAtk;
                AppendLine(sb, $"手电筒-强光: 攻怪+{starAtk} 攻（星光{starlight}层 ÷ 4）");
            }
            int goldenStarBossDmg = 0;
            if (hasGoldenStar)
            {
                goldenStarBossDmg = 2 + (input.HasBossMonster ? starlight : 0);
                AppendLine(sb, input.HasBossMonster
                    ? $"金色飞星: 放过首领造成 {goldenStarBossDmg} 伤（2 + 星光{starlight}）"
                    : $"金色飞星: 放过怪物造成 2 伤（星光{starlight}层）");
            }

            // Economy & conditional combat ATK chips
            if (hasHammer)
            {
                int hammerAtk = input.Gold > 20 ? (input.Gold * 3) / 10 : 0;
                nonTargetCombat += hammerAtk;
                AppendLine(sb, input.Gold > 20
                    ? $"星币锤: 攻击+{hammerAtk}（星币{input.Gold} × 30%）"
                    : $"星币锤: 星币{input.Gold}≤20 暂未触发");
            }
            if (hasWristband)
            {
                if (input.AnyTargetSlowed)
                {
                    monsterOnlyBonus += 4;
                    AppendLine(sb, "运动手环: 攻击移速受影响目标 攻击+4");
                }
                else
                {
                    AppendLine(sb, "运动手环: 防御方移速受影响时 攻击+4");
                }
            }
            if (hasAdrenaline)
            {
                AppendLine(sb, halfHp ? "肾上腺素: 血量≤50% 面板+8 已生效" : "肾上腺素: 血量>50% 未触发(+8)");
            }
            if (hasWhetstone)
            {
                AppendLine(sb, halfHp ? "磨刀石: 血量≤50% 面板+4 已生效" : "磨刀石: 血量>50% 未触发(+4)");
            }
            if (hasSandwich && input.ExtraMaxHp >= 2)
            {
                AppendLine(sb, $"夹心饼干: 额外上限+{input.ExtraMaxHp} -> 面板+{input.ExtraMaxHp / 2} 已生效");
            }
            if (hasBranch && input.SuperEnergyStacks > 0)
            {
                AppendLine(sb, $"完美的树枝: {input.SuperEnergyStacks}层超强精力 -> 面板+{input.SuperEnergyStacks * 2} 已生效");
            }
            if (hasVengeance && input.HasBlueCurse)
            {
                AppendLine(sb, "复仇之戟: 青之诅咒 面板+5 已生效");
            }
            if (hasElectricSword)
            {
                AppendLine(sb, input.ElectricStacks > 7
                    ? $"电流剑: 电流{input.ElectricStacks}>7 -> 面板+2 已生效"
                    : $"电流剑: 当前电流 {input.ElectricStacks}（>7时+2）");
            }

            int totalGeneral = input.BasePanelAtk + nonTargetCombat;
            int totalVsMonster = totalGeneral + monsterOnlyBonus + markAttackBonus;

            int railgunDmg = 0;
            if (hasRailgun)
            {
                if (input.ElectricStacks >= 4)
                {
                    railgunDmg = totalVsMonster / 2;
                    AppendLine(sb, $"电磁炮: 挑战后耗4电流(余{input.ElectricStacks}) 群伤 {railgunDmg}（攻击50%）");
                }
                else
                {
                    AppendLine(sb, $"电磁炮: 电流 {input.ElectricStacks}/4（满4格群伤50%攻击）");
                }
            }

            if (hasBookmark)
            {
                effectCardBonus += 2;
                AppendLine(sb, "书签: 效果牌伤害+2");
            }
            if (hasPiercing && input.MaxMonsterDefense > 0)
            {
                effectCardBonus += input.MaxMonsterDefense;
                AppendLine(sb, $"贯穿之铳: 效果牌附加目标防御 +{input.MaxMonsterDefense}");
            }

            return new StackedDamageSummary
            {
                HasAnyRelevantEffect = true,
                BasePanelAtk = input.BasePanelAtk,
                NonTargetCombatBonusAtk = nonTargetCombat,
                MonsterAttackBonusAtk = monsterOnlyBonus,
                MarkBonusVsTargetAtk = markAttackBonus,
                TotalAttackGeneral = totalGeneral,
                TotalAttackVsMonster = totalVsMonster,
                EffectCardBonusDmg = effectCardBonus,
                GoldenStarBossBonusDmg = goldenStarBossDmg,
                RailgunAoeDmg = railgunDmg,
                BreakdownText = sb.ToString(),
            };
        }

        private static void AppendLine(StringBuilder sb, string line)
        {
            if (sb.Length > 0) sb.Append('\n');
            sb.Append("• ").Append(line);
        }
    }
}
