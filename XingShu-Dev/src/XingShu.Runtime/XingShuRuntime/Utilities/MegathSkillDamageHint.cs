using System;
using System.Collections.Generic;
using System.Text;
using Core;
using Core.Scene;
using Core.Unit;
using FairyGUI;
using GameLogic;
using party.model;
using Tools;
using UI;
using UnityEngine;
using XingShuRuntime.Core;
using XingShuRuntime.MatchPort;

namespace XingShuRuntime.Utilities;

/// <summary>
/// Standalone board HUD module ("游戏理解", module ID "megath-damage") displaying:
/// - Fanny (102) potential skill 2-choice teammate reveal (selected & unselected)
/// - Megath (122) active skill ("轨道轰炸") theoretical max damage
/// - Mimi (108) active skill expected Star Coins & Vitamin Pill Heal stacks
/// - Universal stacked attack/damage calculator across Utility Knives, Heal, Mark/Target, Starlight & special chips.
/// </summary>
public sealed class MegathSkillDamageHint : MonoBehaviour
{
    private const float RefreshIntervalSeconds = 0.15f;

    private static MegathSkillDamageHint _instance;

    private readonly List<int> _costsBuffer = new List<int>(16);
    private readonly HashSet<int> _ownedRelicsBuffer = new HashSet<int>();

    private bool _enabled = XingShuConfigKeys.MegathDamageHintEnabledDefault;
    private bool _fannyEnabled = XingShuConfigKeys.GameInsightFannyEnabledDefault;
    private bool _mimiEnabled = XingShuConfigKeys.GameInsightMimiEnabledDefault;
    private bool _stackDamageEnabled = XingShuConfigKeys.GameInsightStackDamageEnabledDefault;
    private float _posX = XingShuConfigKeys.MegathDamageHintPosXDefault;
    private float _posY = XingShuConfigKeys.MegathDamageHintPosYDefault;
    private float _scale = XingShuConfigKeys.MegathDamageHintScaleDefault;
    private bool _locked = XingShuConfigKeys.MegathDamageHintLockedDefault;
    private bool _collapsed = XingShuConfigKeys.MegathDamageHintCollapsedDefault;
    private bool _sessionHidden;
    private long _lastSessionRoomId;
    private float _nextTick;

    private GComponent _attachedContainer;
    private GComponent _panel;
    private GGraph _background;
    private GGraph _headerBg;
    private GGraph _accentBar;
    private GTextField _titleLabel;
    private GTextField _summaryLabel;
    private GTextField _formulaLabel;
    private GComponent _btnCollapse;
    private GTextField _btnCollapseText;
    private GComponent _btnSettings;
    private GComponent _btnClose;
    private float _panelWidth = 264f;
    private float _panelHeight = 64f;
    private string _lastTitle = "";
    private string _lastFormula = "";
    private bool _lastCollapsedLayout;
    private bool _dragging;

    internal static bool IsEnabled => _instance != null
        ? _instance._enabled
        : XingShuConfigService.GetBool(XingShuConfigKeys.MegathDamageHintEnabled, XingShuConfigKeys.MegathDamageHintEnabledDefault);

    internal static bool FannyEnabled => _instance != null
        ? _instance._fannyEnabled
        : XingShuConfigService.GetBool(XingShuConfigKeys.GameInsightFannyEnabled, XingShuConfigKeys.GameInsightFannyEnabledDefault);

    internal static bool MimiEnabled => _instance != null
        ? _instance._mimiEnabled
        : XingShuConfigService.GetBool(XingShuConfigKeys.GameInsightMimiEnabled, XingShuConfigKeys.GameInsightMimiEnabledDefault);

    internal static bool StackDamageEnabled => _instance != null
        ? _instance._stackDamageEnabled
        : XingShuConfigService.GetBool(XingShuConfigKeys.GameInsightStackDamageEnabled, XingShuConfigKeys.GameInsightStackDamageEnabledDefault);

    internal static float PosX => _instance != null
        ? _instance._posX
        : FloatingHintLayoutMath.FiniteClamp(
            XingShuConfigService.GetFloat(XingShuConfigKeys.MegathDamageHintPosX, XingShuConfigKeys.MegathDamageHintPosXDefault),
            0f, 1f, XingShuConfigKeys.MegathDamageHintPosXDefault);

    internal static float PosY => _instance != null
        ? _instance._posY
        : FloatingHintLayoutMath.FiniteClamp(
            XingShuConfigService.GetFloat(XingShuConfigKeys.MegathDamageHintPosY, XingShuConfigKeys.MegathDamageHintPosYDefault),
            0f, 1f, XingShuConfigKeys.MegathDamageHintPosYDefault);

    internal static float Scale => _instance != null
        ? _instance._scale
        : FloatingHintLayoutMath.FiniteClamp(
            XingShuConfigService.GetFloat(XingShuConfigKeys.MegathDamageHintScale, XingShuConfigKeys.MegathDamageHintScaleDefault),
            XingShuConfigKeys.MegathDamageHintScaleMin, XingShuConfigKeys.MegathDamageHintScaleMax, XingShuConfigKeys.MegathDamageHintScaleDefault);

    internal static bool Locked => _instance != null
        ? _instance._locked
        : XingShuConfigService.GetBool(XingShuConfigKeys.MegathDamageHintLocked, XingShuConfigKeys.MegathDamageHintLockedDefault);

    internal static bool IsCollapsed => _instance != null
        ? _instance._collapsed
        : XingShuConfigService.GetBool(XingShuConfigKeys.MegathDamageHintCollapsed, XingShuConfigKeys.MegathDamageHintCollapsedDefault);

    internal static bool IsSessionHidden => _instance != null && _instance._sessionHidden;

    internal static void SetEnabled(bool value)
    {
        XingShuConfigService.SetBool(XingShuConfigKeys.MegathDamageHintEnabled, value);
        XingShuConfigService.Save();
        if (_instance != null)
        {
            _instance._enabled = value;
            if (value) _instance._sessionHidden = false;
            _instance._nextTick = 0f;
            if (!value) _instance.RemovePanel();
        }
    }

    internal static void SetCollapsed(bool collapsed)
    {
        XingShuConfigService.SetBool(XingShuConfigKeys.MegathDamageHintCollapsed, collapsed);
        XingShuConfigService.Save();
        if (_instance != null)
        {
            _instance._collapsed = collapsed;
            _instance._nextTick = 0f;
            if (_instance._panel != null && !_instance._panel.isDisposed && _instance._attachedContainer != null)
            {
                _instance.ApplyLayout(_instance._attachedContainer, _instance._lastTitle, _instance._lastFormula);
            }
        }
    }

    internal static void SetSessionHidden(bool hidden)
    {
        if (_instance == null) return;
        _instance._sessionHidden = hidden;
        _instance._nextTick = 0f;
        if (hidden)
        {
            _instance.RemovePanel();
        }
    }

    internal static void ToggleSessionVisible()
    {
        if (!IsEnabled)
        {
            SetEnabled(true);
            return;
        }
        SetSessionHidden(!IsSessionHidden);
    }

    internal static void SetFannyEnabled(bool value)
    {
        XingShuConfigService.SetBool(XingShuConfigKeys.GameInsightFannyEnabled, value);
        XingShuConfigService.Save();
        if (_instance != null)
        {
            _instance._fannyEnabled = value;
            _instance._nextTick = 0f;
        }
    }

    internal static void SetMimiEnabled(bool value)
    {
        XingShuConfigService.SetBool(XingShuConfigKeys.GameInsightMimiEnabled, value);
        XingShuConfigService.Save();
        if (_instance != null)
        {
            _instance._mimiEnabled = value;
            _instance._nextTick = 0f;
        }
    }

    internal static void SetStackDamageEnabled(bool value)
    {
        XingShuConfigService.SetBool(XingShuConfigKeys.GameInsightStackDamageEnabled, value);
        XingShuConfigService.Save();
        if (_instance != null)
        {
            _instance._stackDamageEnabled = value;
            _instance._nextTick = 0f;
        }
    }

    internal static void SetPosition(float normX, float normY)
    {
        float x = FloatingHintLayoutMath.FiniteClamp(normX, 0f, 1f, XingShuConfigKeys.MegathDamageHintPosXDefault);
        float y = FloatingHintLayoutMath.FiniteClamp(normY, 0f, 1f, XingShuConfigKeys.MegathDamageHintPosYDefault);
        XingShuConfigService.SetFloat(XingShuConfigKeys.MegathDamageHintPosX, x);
        XingShuConfigService.SetFloat(XingShuConfigKeys.MegathDamageHintPosY, y);
        XingShuConfigService.Save();
        if (_instance != null)
        {
            _instance._posX = x;
            _instance._posY = y;
            _instance.RefreshTransformOnly();
        }
    }

    internal static void SetScale(float scale)
    {
        float clamped = FloatingHintLayoutMath.FiniteClamp(
            scale, XingShuConfigKeys.MegathDamageHintScaleMin, XingShuConfigKeys.MegathDamageHintScaleMax, XingShuConfigKeys.MegathDamageHintScaleDefault);
        XingShuConfigService.SetFloat(XingShuConfigKeys.MegathDamageHintScale, clamped);
        XingShuConfigService.Save();
        if (_instance != null)
        {
            _instance._scale = clamped;
            _instance.RefreshTransformOnly();
        }
    }

    internal static void SetLocked(bool locked)
    {
        XingShuConfigService.SetBool(XingShuConfigKeys.MegathDamageHintLocked, locked);
        XingShuConfigService.Save();
        if (_instance != null)
        {
            _instance._locked = locked;
            _instance._lastTitle = "";
            _instance.RefreshInteractionState();
            _instance._nextTick = 0f;
        }
    }

    internal static void ResetLayout()
    {
        XingShuConfigService.SetFloat(XingShuConfigKeys.MegathDamageHintPosX, XingShuConfigKeys.MegathDamageHintPosXDefault);
        XingShuConfigService.SetFloat(XingShuConfigKeys.MegathDamageHintPosY, XingShuConfigKeys.MegathDamageHintPosYDefault);
        XingShuConfigService.SetFloat(XingShuConfigKeys.MegathDamageHintScale, XingShuConfigKeys.MegathDamageHintScaleDefault);
        XingShuConfigService.SetBool(XingShuConfigKeys.MegathDamageHintLocked, XingShuConfigKeys.MegathDamageHintLockedDefault);
        XingShuConfigService.SetBool(XingShuConfigKeys.MegathDamageHintCollapsed, XingShuConfigKeys.MegathDamageHintCollapsedDefault);
        XingShuConfigService.Save();
        if (_instance != null)
        {
            _instance._posX = XingShuConfigKeys.MegathDamageHintPosXDefault;
            _instance._posY = XingShuConfigKeys.MegathDamageHintPosYDefault;
            _instance._scale = XingShuConfigKeys.MegathDamageHintScaleDefault;
            _instance._locked = XingShuConfigKeys.MegathDamageHintLockedDefault;
            _instance._collapsed = XingShuConfigKeys.MegathDamageHintCollapsedDefault;
            _instance._sessionHidden = false;
            _instance._dragging = false;
            _instance._lastTitle = "";
            _instance.RefreshInteractionState();
            _instance.RefreshTransformOnly();
            _instance._nextTick = 0f;
        }
    }

    public static void Install(GameObject host)
    {
        if (_instance != null || host == null) return;
        _instance = host.AddComponent<MegathSkillDamageHint>();
        _instance.LoadConfig();
        MatchProtocolObserver.EnsureInstalled(host);
        try
        {
            AssistBall.RegisterAction(
                "game_insight",
                "游戏理解",
                ToggleSessionVisible,
                31,
                "芬妮二选一 · 米米收益 · 梅加斯与叠加伤害浮窗",
                "理解",
                () => IsEnabled && !IsSessionHidden);
        }
        catch { }
    }

    private void LoadConfig()
    {
        _enabled = XingShuConfigService.GetBool(XingShuConfigKeys.MegathDamageHintEnabled, XingShuConfigKeys.MegathDamageHintEnabledDefault);
        _fannyEnabled = XingShuConfigService.GetBool(XingShuConfigKeys.GameInsightFannyEnabled, XingShuConfigKeys.GameInsightFannyEnabledDefault);
        _mimiEnabled = XingShuConfigService.GetBool(XingShuConfigKeys.GameInsightMimiEnabled, XingShuConfigKeys.GameInsightMimiEnabledDefault);
        _stackDamageEnabled = XingShuConfigService.GetBool(XingShuConfigKeys.GameInsightStackDamageEnabled, XingShuConfigKeys.GameInsightStackDamageEnabledDefault);
        _collapsed = XingShuConfigService.GetBool(XingShuConfigKeys.MegathDamageHintCollapsed, XingShuConfigKeys.MegathDamageHintCollapsedDefault);
        _posX = FloatingHintLayoutMath.FiniteClamp(
            XingShuConfigService.GetFloat(XingShuConfigKeys.MegathDamageHintPosX, XingShuConfigKeys.MegathDamageHintPosXDefault),
            0f, 1f, XingShuConfigKeys.MegathDamageHintPosXDefault);
        _posY = FloatingHintLayoutMath.FiniteClamp(
            XingShuConfigService.GetFloat(XingShuConfigKeys.MegathDamageHintPosY, XingShuConfigKeys.MegathDamageHintPosYDefault),
            0f, 1f, XingShuConfigKeys.MegathDamageHintPosYDefault);
        _scale = FloatingHintLayoutMath.FiniteClamp(
            XingShuConfigService.GetFloat(XingShuConfigKeys.MegathDamageHintScale, XingShuConfigKeys.MegathDamageHintScaleDefault),
            XingShuConfigKeys.MegathDamageHintScaleMin, XingShuConfigKeys.MegathDamageHintScaleMax, XingShuConfigKeys.MegathDamageHintScaleDefault);
        _locked = XingShuConfigService.GetBool(XingShuConfigKeys.MegathDamageHintLocked, XingShuConfigKeys.MegathDamageHintLockedDefault);
    }

    private void Update()
    {
        if (Time.unscaledTime < _nextTick) return;
        _nextTick = Time.unscaledTime + RefreshIntervalSeconds;
        try
        {
            Tick();
        }
        catch (Exception)
        {
            RemovePanel();
        }
    }

    private void Tick()
    {
        if (!_enabled
            || !SimpleSingletonProvider<SceneManager>.hasInstance
            || SimpleSingletonProvider<SceneManager>.inst.currentType == null
            || SimpleSingletonProvider<SceneManager>.inst.currentType.Value != SceneType.Battle
            || !SimpleSingletonProvider<GameLogicManager>.hasInstance
            || !SimpleSingletonProvider<UIManager>.hasInstance)
        {
            RemovePanel();
            return;
        }

        var uiMgr = SimpleSingletonProvider<UIManager>.inst;
        var logic = SimpleSingletonProvider<GameLogicManager>.inst;
        long roomId = logic.room?.curRoomInfo?.Id ?? 0L;
        if (roomId > 0L && roomId != _lastSessionRoomId)
        {
            _lastSessionRoomId = roomId;
            _sessionHidden = false;
        }
        if (_sessionHidden)
        {
            RemovePanel();
            return;
        }
        var fight = logic.fight?.battleFightData;
        if ((fight != null && !fight.isEnd) || ShownNativeWindows.Find<FightWindow>(uiMgr) != null)
        {
            RemovePanel();
            return;
        }

        var self = logic.battle?.GetSelfPlayerData();
        if (self == null || self.player?.Hero == null || self.characterType != CharacterType.Hero)
        {
            RemovePanel();
            return;
        }

        var battleInfoUi = logic.battle?.battleInfo?.UIObject;
        if (battleInfoUi == null || battleInfoUi.isDisposed || !battleInfoUi.visible || !battleInfoUi.onStage
            || battleInfoUi.width < 320f || battleInfoUi.height < 240f)
        {
            RemovePanel();
            return;
        }

        double realNow = ThinkingClock.RealSeconds();
        var body = new StringBuilder();
        string headline = "";
        int sectionCount = 0;

        // 1. Fanny (10202) 潜能二选一全队透视
        if (_fannyEnabled && MatchProtocolObserver.FannyEvents.HasVisibleNotice(realNow))
        {
            var entry = MatchProtocolObserver.FannyEvents.LatestEntry;
            if (entry != null)
            {
                sectionCount++;
                if (string.IsNullOrEmpty(headline))
                {
                    headline = entry.IsPending ? "芬妮二选一 · 待选" : "芬妮二选一 · 队友透视";
                }
                if (body.Length > 0) body.Append('\n');
                if (entry.IsPending)
                {
                    string a = entry.OfferedEventIds != null && entry.OfferedEventIds.Length > 0 ? FormatEventBrief(entry.OfferedEventIds[0]) : "事件?";
                    string b = entry.OfferedEventIds != null && entry.OfferedEventIds.Length > 1 ? FormatEventBrief(entry.OfferedEventIds[1]) : "";
                    body.Append($"[color=#7DD3FC]{entry.PlayerName}(R{entry.Round}) 待选[/color]\n");
                    body.Append($"• 选项1: {a}");
                    if (!string.IsNullOrEmpty(b)) body.Append($"\n• 选项2: {b}");
                }
                else
                {
                    string chosen = FormatEventBrief(entry.ChosenEventId);
                    string other = entry.UnchosenEventId > 0 ? FormatEventBrief(entry.UnchosenEventId) : "未记录";
                    body.Append($"[color=#7DD3FC]{entry.PlayerName}(R{entry.Round}) 二选一[/color]\n");
                    body.Append($"• [color=#6EE7B7]已选: {chosen}[/color]\n");
                    body.Append($"• [color=#FCA5A5]另一项: {other}[/color]");
                }
            }
        }

        // Collect self chips & buff stacks once for Mimi + Stacked Damage
        CollectOwnedRelics(self, _ownedRelicsBuffer);
        int healStacks = ReadSelfHealStacks(self);
        int starlightStacks = ReadSelfBuffByNameOrIcon(self, "星光", "kva0b2");
        int electricStacks = ReadSelfBuffByNameOrIcon(self, "电流", "y4hks8r");
        int superEnergyStacks = ReadSelfBuffByNameOrIcon(self, "超强精力", "");
        bool hasBlueCurse = HasSelfBuffName(self, "青之诅咒");

        // 2. Megath (122) 轨道轰炸
        int heroId = self.player.Hero.HeroId;
        if (heroId == MegathSkillDamageMath.MegathHeroId)
        {
            int skillId = self.player.GetBattleActiveSkillId();
            if (skillId <= 0)
            {
                skillId = HandCardDisplayManager.IsPVEMode() ? MegathSkillDamageMath.PveSkillId : MegathSkillDamageMath.PvpSkillId;
            }
            SkillInfoConfigure skillCfg = null;
            if (StaticConfigure.Skill?.InfoDict != null)
            {
                StaticConfigure.Skill.InfoDict.TryGetValue(skillId, out skillCfg);
            }
            _costsBuffer.Clear();
            var handCards = self.cardContainer?._HandCards;
            if (handCards != null)
            {
                for (int i = 0; i < handCards.Count; i++)
                {
                    var hc = handCards[i];
                    if (hc == null) continue;
                    int c = hc.BattleCost >= 0 ? hc.BattleCost : (hc.Config != null ? hc.Config.Cost : 0);
                    _costsBuffer.Add(Math.Max(0, c));
                }
            }
            bool hasPrecisionMarkedMonster = HasAliveMonsterWithBuff(
                logic.battle?.PlayerDatas,
                MegathSkillDamageMath.PrecisionStrikeBuffId);

            var summary = MegathSkillDamageMath.Compute(
                skillId,
                HandCardDisplayManager.IsPVEMode(),
                skillCfg?.Params,
                _costsBuffer,
                hasPrecisionMarkedMonster);

            int maxCd = skillCfg != null ? skillCfg.Round : 3;
            int curCd = self.Property?.activeSkillCD != null ? self.Property.activeSkillCD.Value : self.SkillCD;
            string cdSuffix = curCd > 0 ? $" [color=#9FB2C9](CD {curCd}/{Math.Max(curCd, maxCd)})[/color]" : "";
            sectionCount++;
            if (string.IsNullOrEmpty(headline))
            {
                headline = $"梅加斯 理论伤害 [color=#FFD54F]{summary.TotalDamage}[/color]{cdSuffix}";
            }
            else
            {
                if (body.Length > 0) body.Append('\n');
                body.Append($"[color=#FFD54F]梅加斯 轨道轰炸: {summary.TotalDamage}[/color]{cdSuffix}\n");
            }
            if (body.Length > 0 && headline.StartsWith("梅加斯")) body.Append('\n');
            body.Append(MegathSkillDamageMath.FormatFormulaLine(summary));
        }

        // 3. Mimi (108) 商品补货 / 过期回收 / 维生素药丸治愈
        if (_mimiEnabled && heroId == GameInsightMath.MimiHeroId)
        {
            var handCards = self.cardContainer?._HandCards;
            int handCount = handCards != null ? handCards.Count : 0;
            int battleCount = 0;
            if (handCards != null)
            {
                for (int i = 0; i < handCards.Count; i++)
                {
                    var hc = handCards[i];
                    if (hc?.Config == null) continue;
                    var ct = hc.Config.CardType;
                    if (ct == CardType.Attack || ct == CardType.Defend || ct == CardType.Counter)
                    {
                        battleCount++;
                    }
                }
            }
            bool hasVitamin = _ownedRelicsBuffer.Contains(GameInsightMath.ChipVitaminPill);
            int knifeCount = (_ownedRelicsBuffer.Contains(GameInsightMath.ChipUtilityKnifeBasic) ? 1 : 0)
                + (_ownedRelicsBuffer.Contains(GameInsightMath.ChipUtilityKnifeSharp) ? 1 : 0);
            int curCd = self.Property?.activeSkillCD != null ? self.Property.activeSkillCD.Value : self.SkillCD;
            var mimi = GameInsightMath.ComputeMimiSkill(handCount, battleCount, hasVitamin, healStacks, knifeCount, curCd);

            sectionCount++;
            if (string.IsNullOrEmpty(headline))
            {
                headline = $"米米 开技能: [color=#FFD54F]+{mimi.ExpectedStarCoins}星币[/color]";
                if (mimi.HasVitaminPill) headline += $" [color=#6EE7B7]+{mimi.ExpectedHealGain}治愈[/color]";
            }
            if (body.Length > 0) body.Append('\n');
            body.Append($"[color=#FDE68A]米米 补货[/color]: 弃{mimi.HandCount}抽{mimi.ExpectedDrawCount} · 战斗牌{mimi.BattleCardCount}张 -> [color=#FFD54F]+{mimi.ExpectedStarCoins}星币[/color]");
            if (mimi.HasVitaminPill)
            {
                body.Append($"\n• 维生素药丸: [color=#6EE7B7]+{mimi.ExpectedHealGain}治愈[/color]（{mimi.CurrentHealStacks}→{mimi.ProjectedHealStacks}层）");
                if (mimi.UtilityKnifeCount > 0)
                {
                    body.Append($" · 美工刀攻击额外 +{mimi.ProjectedKnifeBonusAtk}");
                }
            }
        }

        // 4. Universal Stacked Damage Calculator (All characters)
        if (_stackDamageEnabled && _ownedRelicsBuffer.Count > 0)
        {
            ReadMonsterSummary(
                logic.battle?.PlayerDatas,
                out int maxMonsterMark,
                out int maxMonsterDef,
                out bool hasBossMonster,
                out bool anyTargetSlowed,
                out string markTargetName);

            int panelAtk = self.Property?.ATK != null ? self.Property.ATK.Value : 0;
            int hp = self.Property?.HP != null ? self.Property.HP.Value : self.player.Hero.Hp;
            int maxHp = self.Property != null && self.Property.maxHP > 0 ? self.Property.maxHP : self.player.Hero.MaxHp;
            int baseHeroMaxHp = 0;
            try
            {
                var chCfg = heroId.GetCharacterConfigure();
                if (chCfg != null) baseHeroMaxHp = chCfg.Blood;
            }
            catch { }
            int extraMaxHp = baseHeroMaxHp > 0 ? Math.Max(0, maxHp - baseHeroMaxHp) : 0;
            int gold = self.Property?.gold != null ? self.Property.gold.Value : self.player.Hero.Gold;

            var stacked = GameInsightMath.ComputeStackedDamage(new StackedDamageInput
            {
                BasePanelAtk = panelAtk,
                Hp = hp,
                MaxHp = maxHp,
                ExtraMaxHp = extraMaxHp,
                Gold = gold,
                HealStacks = healStacks,
                StarlightStacks = starlightStacks,
                ElectricStacks = electricStacks,
                SuperEnergyStacks = superEnergyStacks,
                HasBlueCurse = hasBlueCurse,
                MaxMonsterMarkStacks = maxMonsterMark,
                MaxMonsterDefense = maxMonsterDef,
                HasBossMonster = hasBossMonster,
                AnyTargetSlowed = anyTargetSlowed,
                MarkTargetName = markTargetName,
                OwnedRelics = _ownedRelicsBuffer,
            });

            if (stacked.HasAnyRelevantEffect)
            {
                sectionCount++;
                int bonusVsMonster = stacked.TotalAttackVsMonster - stacked.BasePanelAtk;
                if (string.IsNullOrEmpty(headline))
                {
                    headline = bonusVsMonster > 0
                        ? $"叠加攻击 [color=#FFD54F]{stacked.TotalAttackVsMonster}[/color] [color=#9FB2C9](面板{stacked.BasePanelAtk} +{bonusVsMonster})[/color]"
                        : $"面板攻击 [color=#FFD54F]{stacked.BasePanelAtk}[/color] · 筹码详情";
                }
                else
                {
                    if (body.Length > 0) body.Append('\n');
                    body.Append(bonusVsMonster > 0
                        ? $"[color=#FDE68A]叠加攻击 {stacked.TotalAttackVsMonster}[/color] (面板{stacked.BasePanelAtk}+{bonusVsMonster})"
                        : $"[color=#FDE68A]筹码加成[/color] (面板{stacked.BasePanelAtk})");
                }
                if (stacked.EffectCardBonusDmg > 0)
                {
                    body.Append($"\n• 效果伤害牌附加: [color=#6EE7B7]+{stacked.EffectCardBonusDmg}[/color]");
                }
                if (!string.IsNullOrEmpty(stacked.BreakdownText))
                {
                    if (body.Length > 0) body.Append('\n');
                    body.Append(stacked.BreakdownText);
                }
            }
        }

        if (sectionCount == 0)
        {
            RemovePanel();
            return;
        }

        EnsurePanel(battleInfoUi);
        ApplyLayout(battleInfoUi, headline, body.ToString());
    }

    private static string FormatEventBrief(int eventId)
    {
        string name = GameTextResolver.GetEventName(eventId);
        string desc = GameTextResolver.GetEventDesc(eventId);
        if (!string.IsNullOrEmpty(desc) && desc.Length > 26)
        {
            desc = desc.Substring(0, 26) + "…";
        }
        return string.IsNullOrEmpty(desc) ? name : $"{name}({desc})";
    }

    private static void CollectOwnedRelics(BattlePlayerData self, HashSet<int> target)
    {
        target.Clear();
        var rel = self.player?.Hero?.SelectRelics;
        if (rel == null) return;
        foreach (var kv in rel)
        {
            if (kv.Key > 0 && kv.Value) target.Add(kv.Key);
        }
    }

    private static int ReadSelfHealStacks(BattlePlayerData self)
    {
        int propCure = 0;
        try
        {
            if (self.Property?.CureCount?.property != null)
            {
                propCure = Math.Max(0, self.Property.CureCount.property.Value);
            }
        }
        catch { }
        int dictCure = ReadSelfBuffByNameOrIcon(self, "治愈", "kva0b0");
        return Math.Max(propCure, dictCure);
    }

    private static int ReadSelfBuffByNameOrIcon(BattlePlayerData unit, string nameMatch, string iconToken)
    {
        int best = 0;
        var dict = unit?.buffContainer?._buffDict;
        if (dict == null || dict.Count == 0) return 0;
        foreach (var b in dict.Values)
        {
            if (b == null || b.BuffId <= 0) continue;
            string bName = GameTextResolver.GetBuffName(b.BuffId);
            string bIcon = GameTextResolver.GetBuffIcon(b.BuffId);
            bool hit = (!string.IsNullOrEmpty(nameMatch) && bName.IndexOf(nameMatch, StringComparison.OrdinalIgnoreCase) >= 0)
                || (!string.IsNullOrEmpty(iconToken) && bIcon.IndexOf(iconToken, StringComparison.OrdinalIgnoreCase) >= 0);
            if (hit)
            {
                best = Math.Max(best, Math.Max(1, b.Progress));
            }
        }
        return best;
    }

    private static bool HasSelfBuffName(BattlePlayerData unit, string nameMatch)
    {
        var dict = unit?.buffContainer?._buffDict;
        if (dict == null || dict.Count == 0) return false;
        foreach (var b in dict.Values)
        {
            if (b == null || b.BuffId <= 0) continue;
            string bName = GameTextResolver.GetBuffName(b.BuffId);
            if (!string.IsNullOrEmpty(bName) && bName.IndexOf(nameMatch, StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return true;
            }
        }
        return false;
    }

    private static void ReadMonsterSummary(
        List<BattlePlayerData> players,
        out int maxMark,
        out int maxDef,
        out bool hasBoss,
        out bool anySlowed,
        out string targetName)
    {
        maxMark = 0;
        maxDef = 0;
        hasBoss = false;
        anySlowed = false;
        targetName = "";
        if (players == null) return;
        for (int i = 0; i < players.Count; i++)
        {
            var p = players[i];
            if (p == null || p.characterType != CharacterType.Monster) continue;
            if (p.Property?.HP == null || p.Property.HP.Value <= 0) continue;
            if (p.player?.Hero != null && p.player.Hero.MonsterType == Hero.Types.MonsterType.PveAllyMonster) continue;
            if (p.player?.Hero != null && (p.player.Hero.MonsterType == Hero.Types.MonsterType.Boss || p.player.Hero.MonsterType == Hero.Types.MonsterType.PveBoss))
            {
                hasBoss = true;
            }
            int def = p.Property?.DEF != null ? p.Property.DEF.Value : 0;
            if (def > maxDef) maxDef = def;

            int propMark = 0;
            try
            {
                if (p.Property?.MarkCount?.property != null)
                {
                    propMark = Math.Max(0, p.Property.MarkCount.property.Value);
                }
            }
            catch { }
            int buffMark = ReadSelfBuffByNameOrIcon(p, "标记", "kva0b1");
            int mark = Math.Max(propMark, buffMark);
            if (mark > maxMark)
            {
                maxMark = mark;
                string mNick = p.player != null ? p.player.GetNick() : null;
                targetName = !string.IsNullOrEmpty(mNick) ? GameTextResolver.StripRichTags(mNick) : "怪物";
            }

            if (p.Property != null && p.Property.ExtraMovePoint < 0)
            {
                anySlowed = true;
            }
        }
    }

    private static bool HasAliveMonsterWithBuff(List<BattlePlayerData> players, int buffId)
    {
        if (players == null) return false;
        for (int i = 0; i < players.Count; i++)
        {
            var p = players[i];
            if (p == null || p.characterType != CharacterType.Monster) continue;
            if (p.Property?.HP == null || p.Property.HP.Value <= 0) continue;
            var dict = p.buffContainer?._buffDict;
            if (dict == null || dict.Count == 0) continue;
            foreach (var buff in dict.Values)
            {
                if (buff != null && buff.BuffId == buffId)
                {
                    return true;
                }
            }
        }
        return false;
    }

    private static GComponent CreateHeaderButton(string caption, float width, float height, System.Action onClick, out GTextField labelField)
    {
        var btn = new GComponent
        {
            name = "XINGSHU_InsightBtn_" + caption,
            touchable = true,
            opaque = true,
        };
        btn.SetSize(width, height);

        var bg = new GGraph { touchable = false };
        bg.DrawRoundRect(width, height, new Color(0.24f, 0.30f, 0.42f, 0.92f), new[] { 4f, 4f, 4f, 4f });
        btn.AddChild(bg);

        labelField = new GTextField
        {
            touchable = false,
            autoSize = AutoSizeType.None,
            align = AlignType.Center,
            verticalAlign = VertAlignType.Middle,
            text = caption,
        };
        labelField.SetSize(width, height);
        var tf = labelField.textFormat;
        tf.size = Application.isMobilePlatform ? 15 : 12;
        tf.bold = true;
        tf.color = new Color(0.96f, 0.98f, 1f, 1f);
        labelField.textFormat = tf;
        btn.AddChild(labelField);

        btn.onTouchBegin.Add((EventCallback1)(ctx =>
        {
            if (ctx != null) ctx.StopPropagation();
        }));
        btn.onClick.Add((EventCallback1)(ctx =>
        {
            if (ctx != null) ctx.StopPropagation();
            onClick?.Invoke();
        }));
        return btn;
    }

    private void EnsurePanel(GComponent container)
    {
        if (_panel != null && !_panel.isDisposed && _panel.parent == container && _attachedContainer == container
            && _background != null && _headerBg != null && _titleLabel != null && _summaryLabel != null
            && _formulaLabel != null && _btnCollapse != null && _btnSettings != null && _btnClose != null)
        {
            return;
        }

        RemovePanel();
        _attachedContainer = container;

        _panel = new GComponent
        {
            name = "XINGSHU_MegathSkillDamagePanel",
            touchable = true,
            opaque = true,
            draggable = !_locked,
            sortingOrder = 0,
        };
        XingShuOverlayInput.Protect(_panel);
        _panel.SetPivot(0f, 0f, false);
        _panel.onDragStart.Set((EventCallback0)delegate
        {
            _dragging = true;
        });
        _panel.onDragMove.Set((EventCallback0)delegate
        {
            ClampCurrentPanelBounds();
        });
        _panel.onDragEnd.Set((EventCallback0)delegate
        {
            CommitDraggedPosition();
        });

        _background = new GGraph { touchable = false };
        _panel.AddChild(_background);

        _headerBg = new GGraph { touchable = false };
        _panel.AddChild(_headerBg);

        _accentBar = new GGraph { touchable = false };
        _panel.AddChild(_accentBar);

        _titleLabel = new GTextField
        {
            name = "XINGSHU_MegathDmgTitle",
            touchable = false,
            autoSize = AutoSizeType.Both,
            align = AlignType.Left,
            UBBEnabled = true,
            stroke = 1.0f,
            strokeColor = new Color(0f, 0f, 0f, 0.90f),
            text = "游戏理解",
        };
        var tfTitle = _titleLabel.textFormat;
        tfTitle.size = Application.isMobilePlatform ? 18 : 14;
        tfTitle.bold = true;
        tfTitle.color = new Color(0.96f, 0.98f, 1f, 1f);
        _titleLabel.textFormat = tfTitle;
        _panel.AddChild(_titleLabel);

        _summaryLabel = new GTextField
        {
            name = "XINGSHU_MegathDmgSummary",
            touchable = false,
            autoSize = AutoSizeType.Both,
            align = AlignType.Left,
            UBBEnabled = true,
            stroke = 1.0f,
            strokeColor = new Color(0f, 0f, 0f, 0.88f),
        };
        var tfSummary = _summaryLabel.textFormat;
        tfSummary.size = Application.isMobilePlatform ? 14 : 11;
        tfSummary.color = new Color(0.96f, 0.78f, 0.35f, 1f);
        _summaryLabel.textFormat = tfSummary;
        _panel.AddChild(_summaryLabel);

        bool mobile = Application.isMobilePlatform;
        float btnH = mobile ? 26f : 21f;
        _btnCollapse = CreateHeaderButton(_collapsed ? "+" : "−", mobile ? 32f : 26f, btnH, () => SetCollapsed(!_collapsed), out _btnCollapseText);
        _btnSettings = CreateHeaderButton("设置", mobile ? 52f : 42f, btnH, XingShuRuntime.UI.XingShuUICenter.OpenGameInsightPage, out _);
        _btnClose = CreateHeaderButton("×", mobile ? 32f : 26f, btnH, () => SetSessionHidden(true), out _);
        _panel.AddChild(_btnCollapse);
        _panel.AddChild(_btnSettings);
        _panel.AddChild(_btnClose);

        _formulaLabel = new GTextField
        {
            name = "XINGSHU_MegathDmgFormula",
            touchable = false,
            autoSize = AutoSizeType.Both,
            align = AlignType.Left,
            UBBEnabled = true,
            stroke = 1f,
            strokeColor = new Color(0f, 0f, 0f, 0.88f),
        };
        var tfFormula = _formulaLabel.textFormat;
        tfFormula.size = mobile ? 18 : 14;
        tfFormula.color = new Color(1f, 0.88f, 0.48f, 1f);
        _formulaLabel.textFormat = tfFormula;
        _panel.AddChild(_formulaLabel);

        container.AddChild(_panel);
        _lastTitle = "__init__";
        _lastFormula = "__init__";
        _lastCollapsedLayout = !_collapsed;
    }

    private void ApplyLayout(GComponent container, string summary, string formula)
    {
        summary = summary ?? "";
        formula = formula ?? "";
        bool changed = _lastCollapsedLayout != _collapsed;
        if (_lastTitle != summary)
        {
            _lastTitle = summary;
            _summaryLabel.text = summary;
            changed = true;
        }
        if (_lastFormula != formula)
        {
            _lastFormula = formula;
            _formulaLabel.text = formula;
            changed = true;
        }

        if (changed)
        {
            _lastCollapsedLayout = _collapsed;
            bool mobile = Application.isMobilePlatform;
            float headerH = mobile ? 38f : 32f;
            float btnH = mobile ? 26f : 21f;
            float wCollapse = mobile ? 32f : 26f;
            float wSettings = mobile ? 52f : 42f;
            float wClose = mobile ? 32f : 26f;
            float btnGroupW = wCollapse + wSettings + wClose + 16f;

            float titleY = (headerH - _titleLabel.height) * 0.5f;
            float sumY = (headerH - _summaryLabel.height) * 0.5f;
            _titleLabel.SetXY(16f, titleY);
            _summaryLabel.SetXY(16f + _titleLabel.width + 8f, sumY);

            float headerNeedW = 16f + _titleLabel.width + 8f + _summaryLabel.width + 10f + btnGroupW;
            float bodyW = _collapsed ? 0f : (_formulaLabel.width + 24f);
            float minW = mobile ? 310f : 264f;
            float width = Mathf.Clamp(Mathf.Max(headerNeedW, bodyW), minW, Mathf.Max(minW, container.width * 0.44f));

            _formulaLabel.visible = !_collapsed;
            _formulaLabel.SetXY(12f, headerH + 6f);
            float height = _collapsed ? headerH : (headerH + 6f + _formulaLabel.height + 10f);

            if (_btnCollapseText != null)
            {
                _btnCollapseText.text = _collapsed ? "+" : "−";
            }

            float btnY = (headerH - btnH) * 0.5f;
            float closeX = width - wClose - 8f;
            float settingsX = closeX - 4f - wSettings;
            float collapseX = settingsX - 4f - wCollapse;
            _btnClose.SetXY(closeX, btnY);
            _btnSettings.SetXY(settingsX, btnY);
            _btnCollapse.SetXY(collapseX, btnY);

            _panelWidth = width;
            _panelHeight = height;
            _panel.SetSize(width, height);
            _background.DrawRoundRect(width, height, new Color(0.08f, 0.11f, 0.18f, 0.84f), new[] { 9f, 9f, 9f, 9f });
            float[] headerRadii = _collapsed ? new[] { 9f, 9f, 9f, 9f } : new[] { 9f, 9f, 0f, 0f };
            _headerBg.DrawRoundRect(width, headerH, new Color(0.16f, 0.21f, 0.30f, 0.72f), headerRadii);
            _accentBar.DrawRoundRect(3f, 16f, new Color(0.24f, 0.85f, 0.92f, 1f), new[] { 1.5f, 1.5f, 1.5f, 1.5f });
            _accentBar.SetXY(8f, (headerH - 16f) * 0.5f);
        }

        RefreshInteractionState();
        RefreshTransformOnly();
    }

    private void RefreshInteractionState()
    {
        if (_panel == null || _panel.isDisposed) return;
        _panel.touchable = true;
        _panel.opaque = true;
        _panel.draggable = !_locked;
    }

    private void RefreshTransformOnly()
    {
        if (_panel == null || _panel.isDisposed || _attachedContainer == null || _attachedContainer.isDisposed) return;
        _panel.SetScale(_scale, _scale);
        if (_dragging) return;
        FloatingHintLayoutMath.ComputeClampedXY(
            _attachedContainer.width, _attachedContainer.height,
            _panelWidth, _panelHeight,
            _scale, _posX, _posY,
            FloatingHintLayoutMath.DefaultScreenMargin,
            out float posX, out float posY);
        _panel.SetXY(posX, posY);
    }

    private void ClampCurrentPanelBounds()
    {
        if (_panel == null || _panel.isDisposed || _attachedContainer == null || _attachedContainer.isDisposed) return;
        FloatingHintLayoutMath.ClampXYToBounds(
            _attachedContainer.width, _attachedContainer.height,
            _panelWidth, _panelHeight,
            _scale, _panel.x, _panel.y,
            FloatingHintLayoutMath.DefaultScreenMargin,
            out float cx, out float cy);
        _panel.SetXY(cx, cy);
    }

    private void CommitDraggedPosition()
    {
        _dragging = false;
        if (_panel == null || _panel.isDisposed || _attachedContainer == null || _attachedContainer.isDisposed) return;
        ClampCurrentPanelBounds();
        FloatingHintLayoutMath.ComputeNormalizedFromXY(
            _attachedContainer.width, _attachedContainer.height,
            _panelWidth, _panelHeight,
            _scale, _panel.x, _panel.y,
            FloatingHintLayoutMath.DefaultScreenMargin,
            out float nx, out float ny);
        SetPosition(nx, ny);
    }

    private void RemovePanel()
    {
        _dragging = false;
        if (_panel != null && !_panel.isDisposed)
        {
            _panel.Dispose();
        }
        _panel = null;
        _background = null;
        _headerBg = null;
        _accentBar = null;
        _titleLabel = null;
        _summaryLabel = null;
        _formulaLabel = null;
        _btnCollapse = null;
        _btnCollapseText = null;
        _btnSettings = null;
        _btnClose = null;
        _attachedContainer = null;
        _lastTitle = "";
        _lastFormula = "";
    }

    private void OnDestroy()
    {
        RemovePanel();
        if (_instance == this)
        {
            _instance = null;
            try { AssistBall.Unregister("game_insight"); } catch { }
        }
    }
}
