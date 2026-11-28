using System;
using System.Collections.Generic;
using System.Reflection;
using Core.Scene;
using Core.Unit;
using FairyGUI;
using GameLogic;
using Tools;
using UI;
using UnityEngine;
using party.model;
using XingShuRuntime.Core;

namespace XingShuRuntime.Utilities;

/// <summary>Read-only plain-language defense advisor combining hand cards, combat rolls, and dodge odds.</summary>
internal sealed class DefensePointHint : MonoBehaviour
{
    private static DefensePointHint _instance;
    private const string ConfigKey = "XINGSHU_DEFENSE_POINT_HINT";
    private static readonly FieldInfo DodgeNoAvailableField =
        typeof(FightWindow).GetField("dodgeNoAvailable", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public);

    private bool _enabled;
    private float _scale = XingShuConfigKeys.DefenseHintScaleDefault;
    private float _nextTick;
    private GComponent _panel;
    private GGraph _background;
    private GGraph _accentBar;
    private GTextField _headline;
    private GTextField _body;

    internal static bool IsEnabled => _instance != null && _instance._enabled;
    internal static float Scale => _instance != null
        ? _instance._scale
        : Mathf.Clamp(XingShuConfigService.GetFloat(XingShuConfigKeys.DefenseHintScale, XingShuConfigKeys.DefenseHintScaleDefault),
            XingShuConfigKeys.DefenseHintScaleMin, XingShuConfigKeys.DefenseHintScaleMax);

    internal static void SetEnabled(bool value)
    {
        if (_instance == null) return;
        _instance._enabled = value;
        XingShuConfigService.SetBool(ConfigKey, value);
        XingShuConfigService.Save();
        if (!value) _instance.RemoveLabel();
    }

    internal static void SetScale(float value)
    {
        float clamped = Mathf.Clamp(value, XingShuConfigKeys.DefenseHintScaleMin, XingShuConfigKeys.DefenseHintScaleMax);
        if (_instance != null) _instance._scale = clamped;
        XingShuConfigService.SetFloat(XingShuConfigKeys.DefenseHintScale, clamped);
        XingShuConfigService.Save();
    }

    public static void Install(GameObject host)
    {
        if (_instance != null) return;
        _instance = host.AddComponent<DefensePointHint>();
        _instance._enabled = XingShuConfigService.GetBool(ConfigKey, true);
        _instance._scale = Mathf.Clamp(
            XingShuConfigService.GetFloat(XingShuConfigKeys.DefenseHintScale, XingShuConfigKeys.DefenseHintScaleDefault),
            XingShuConfigKeys.DefenseHintScaleMin,
            XingShuConfigKeys.DefenseHintScaleMax);
    }

    private void Update()
    {
        if (Time.unscaledTime < _nextTick) return;
        _nextTick = Time.unscaledTime + 0.1f;
        try { Tick(); }
        catch (Exception) { RemoveLabel(); }
    }

    private void Tick()
    {
        if (!_enabled || !SimpleSingletonProvider<SceneManager>.hasInstance ||
            SimpleSingletonProvider<SceneManager>.inst.currentType == null ||
            SimpleSingletonProvider<SceneManager>.inst.currentType.Value != SceneType.Battle ||
            !SimpleSingletonProvider<GameLogicManager>.hasInstance ||
            !SimpleSingletonProvider<UIManager>.hasInstance)
        {
            RemoveLabel();
            return;
        }
        var logic = SimpleSingletonProvider<GameLogicManager>.inst;
        var fight = logic.fight?.battleFightData;
        if (fight == null || fight.isEnd || fight.attackerInfo == null || fight.defenderInfo == null ||
            logic.account == null ||
            fight.defenderInfo.PlayerId != logic.account.GetPlayerID() ||
            logic.battle?.PlayerDatas == null)
        {
            RemoveLabel();
            return;
        }
        // UIManager.Fight is a factory. Constructing it during login leaves CardPool
        // uninitialized and breaks the game's next scene unload in FightWindow.Dispose.
        var window = ShownNativeWindows.Find<FightWindow>(SimpleSingletonProvider<UIManager>.inst);
        var view = window?.contentPane as UIFightWindow;
        if (view == null || view.isDisposed || view.step == null ||
            (view.step.selectedIndex != 3 && view.step.selectedIndex != 5))
        {
            RemoveLabel();
            return;
        }
        BattlePlayerData attacker = null, defender = null;
        foreach (var player in logic.battle.PlayerDatas)
        {
            if (player?.player == null) continue;
            if (player.player.Id == fight.attackerInfo.PlayerId) attacker = player;
            if (player.player.Id == fight.defenderInfo.PlayerId) defender = player;
        }
        if (attacker?.Property == null || defender?.Property == null || defender.Property.HP.Value <= 0)
        {
            RemoveLabel();
            return;
        }
        if (fight.attackerInfo.MinAtk > fight.attackerInfo.MaxAtk || fight.defenderInfo.MinDef > fight.defenderInfo.MaxDef ||
            fight.attackerInfo.MinAtk < 0 || fight.defenderInfo.MinDef < 0)
        {
            RemoveLabel();
            return;
        }

        int point = fight.attackerInfo.Point;
        var director = BattleSceneController.inst?.directorManager;
        var attackerUI = director?.attacker?._UI;
        if ((point < 1 || point > 6) && attackerUI != null && !attackerUI.isDisposed &&
            attackerUI.com_Attack.showPoint.selectedIndex > 0)
        {
            int.TryParse(attackerUI.com_Attack.com_Point.txt_Point.text, out point);
        }
        if (point < 1 || point > 6) point = 0;

        if (!MonsterKillProbability.TryBuildRoleDistribution(fight.attackerInfo, true, out var atkDist, out _) || atkDist == null)
        {
            atkDist = KillProbabilityMath.Uniform(fight.attackerInfo.MinAtk, fight.attackerInfo.MaxAtk);
        }
        if (!MonsterKillProbability.TryBuildRoleDistribution(fight.defenderInfo, false, out var defDist, out _) || defDist == null)
        {
            defDist = KillProbabilityMath.Uniform(fight.defenderInfo.MinDef, fight.defenderInfo.MaxDef);
        }

        long hp = defender.Property.HP.Value;
        long bonus = MonsterKillProbability.SyncedPveMarkDamage(attacker, defender);
        int residueCost = Math.Max(0, fight.defenderInfo.Cost);
        bool dodgeAvailable = ResolveDodgeAvailable(window, view);
        List<HandDefenseCard> handDefCards = CollectHandDefenseCards(logic, defender, fight.defenderInfo);

        DefenseAdvicePlan plan = DefensePointMath.BuildAdvicePlan(
            atkDist,
            defDist,
            point,
            hp,
            bonus,
            handDefCards,
            residueCost,
            dodgeAvailable);

        if (window.width < 480f || window.height < 400f)
        {
            RemoveLabel();
            return;
        }

        RenderPanel(window, plan);
    }

    private static bool ResolveDodgeAvailable(FightWindow window, UIFightWindow view)
    {
        if (DodgeNoAvailableField != null && window != null)
        {
            try
            {
                object raw = DodgeNoAvailableField.GetValue(window);
                if (raw is bool noDodge) return !noDodge;
            }
            catch { }
        }
        try
        {
            if (view?.btn_Dodge?.available != null) return view.btn_Dodge.available.selectedIndex == 0;
        }
        catch { }
        return true;
    }

    private static List<HandDefenseCard> CollectHandDefenseCards(GameLogicManager logic, BattlePlayerData defender, BattleRole defenderRole)
    {
        var list = new List<HandDefenseCard>();
        var handDict = defender?.cardContainer?._HandCardData;
        if (handDict == null || handDict.Count == 0) return list;

        HashSet<int> used = null;
        if (defenderRole?.UseCards != null && defenderRole.UseCards.Count > 0)
        {
            used = new HashSet<int>(defenderRole.UseCards);
        }

        long defenderId = defender.player != null ? defender.player.Id : 0L;
        var cardActions = logic?.card?.cardActions;

        foreach (var kv in handDict)
        {
            if (used != null && used.Contains(kv.Key)) continue;
            var cardData = kv.Value;
            var cfg = cardData?.Config;
            if (cfg == null || cfg.EffectType != EffectType.Defense) continue;
            if (cfg.Params == null || cfg.Params.Count < 2) continue;

            int minBonus = cfg.Params[0];
            int maxBonus = cfg.Params[1];
            if (maxBonus < minBonus || maxBonus <= 0) continue;

            int cost = cfg.Cost;
            if (cardActions != null && defenderId > 0 && cardActions.TryGetValue(cfg.Id, out var action) && action != null)
            {
                try { cost = action.GetCostValue(defenderId, cardData); } catch { }
            }

            string cardName = null;
            try { cardName = cfg.NameID.GetLocal(UIStringType.Card); } catch { }
            if (string.IsNullOrEmpty(cardName)) cardName = "防御牌";

            list.Add(new HandDefenseCard
            {
                CardId = cfg.Id,
                Name = cardName,
                MinBonus = minBonus,
                MaxBonus = maxBonus,
                Cost = Math.Max(0, cost),
            });
        }
        return list;
    }

    private void RenderPanel(FightWindow window, DefenseAdvicePlan plan)
    {
        bool mobile = Application.isMobilePlatform;
        int headSize = Mathf.RoundToInt((mobile ? 28 : 25) * _scale);
        int bodySize = Mathf.RoundToInt((mobile ? 22 : 19) * _scale);

        if (_panel == null || _panel.isDisposed || _panel.parent != window ||
            _background == null || _accentBar == null ||
            _headline == null || _headline.isDisposed ||
            _body == null || _body.isDisposed)
        {
            RemoveLabel();
            // Use the full-screen native fight window, not the animated defender
            // nameplate: that parent moves this text under the native top banner.
            _panel = new GComponent { name = "XINGSHU_DefensePointHintPanel", touchable = false, opaque = false };
            _background = new GGraph { touchable = false };
            _panel.AddChild(_background);
            _accentBar = new GGraph { touchable = false };
            _panel.AddChild(_accentBar);

            _headline = new GTextField
            {
                name = "XINGSHU_DefenseHeadline",
                touchable = false,
                autoSize = AutoSizeType.Height,
                align = AlignType.Left,
                UBBEnabled = true,
                stroke = 1.4f,
                strokeColor = new Color(0f, 0f, 0f, 0.92f)
            };
            _panel.AddChild(_headline);

            _body = new GTextField
            {
                name = "XINGSHU_DefensePointHint",
                touchable = false,
                autoSize = AutoSizeType.Height,
                align = AlignType.Left,
                UBBEnabled = true,
                stroke = 1.0f,
                strokeColor = new Color(0f, 0f, 0f, 0.90f)
            };
            _panel.AddChild(_body);
            window.AddChild(_panel);
        }

        Color accentColor;
        Color headColor;
        switch (plan.Tone)
        {
            case DefenseVerdictTone.Safe:
                accentColor = new Color(0.28f, 0.88f, 0.48f, 0.95f);
                headColor = new Color(0.45f, 0.97f, 0.62f, 1f);
                break;
            case DefenseVerdictTone.DangerDodge:
                accentColor = new Color(1.0f, 0.34f, 0.40f, 0.98f);
                headColor = new Color(1.0f, 0.50f, 0.46f, 1f);
                break;
            default:
                accentColor = new Color(1.0f, 0.78f, 0.28f, 0.95f);
                headColor = new Color(1.0f, 0.86f, 0.42f, 1f);
                break;
        }

        var headFmt = _headline.textFormat;
        if (headFmt.size != headSize || !headFmt.bold || headFmt.color != headColor)
        {
            headFmt.size = headSize;
            headFmt.bold = true;
            headFmt.lineSpacing = 4;
            headFmt.color = headColor;
            _headline.textFormat = headFmt;
        }

        var bodyFmt = _body.textFormat;
        if (bodyFmt.size != bodySize)
        {
            bodyFmt.size = bodySize;
            bodyFmt.lineSpacing = 5;
            bodyFmt.color = new Color(0.94f, 0.96f, 1.0f, 1f);
            _body.textFormat = bodyFmt;
        }

        float width = Mathf.Clamp(440f * _scale, 300f, Mathf.Min(560f, window.width * 0.31f));
        float textWidth = width - 34f;

        _headline.SetSize(textWidth, _headline.height);
        _headline.SetXY(20f, 12f);
        if (_headline.text != plan.Headline) _headline.text = plan.Headline;

        string bodyText = plan.CardActionLine + "\n" + plan.SummaryLine + "\n" + plan.DiceAndDodgeLine;
        _body.SetSize(textWidth, _body.height);
        _body.SetXY(20f, 12f + _headline.height + 6f);
        if (_body.text != bodyText) _body.text = bodyText;

        float height = 12f + _headline.height + 6f + _body.height + 14f;
        _panel.SetSize(width, height);
        _background.DrawRoundRect(width, height, new Color(0.05f, 0.065f, 0.095f, 0.90f), new float[] { 12f, 12f, 12f, 12f });
        _accentBar.SetXY(0f, 8f);
        _accentBar.DrawRoundRect(6f, Mathf.Max(20f, height - 16f), accentColor, new float[] { 4f, 4f, 4f, 4f });

        // Left arena margin requested by the player; stay off the fighters,
        // native top banner, and the right-side action buttons on both platforms.
        float posX = Mathf.Clamp(window.width * 0.125f, 16f, Mathf.Max(16f, window.width * 0.48f - width));
        float posY = Mathf.Clamp(window.height * 0.35f, 150f, Mathf.Max(150f, window.height - height - 165f));
        _panel.SetXY(posX, posY);
    }

    private void RemoveLabel()
    {
        if (_panel != null && !_panel.isDisposed) _panel.Dispose();
        _panel = null;
        _background = null;
        _accentBar = null;
        _headline = null;
        _body = null;
    }

    private void OnDestroy()
    {
        RemoveLabel();
        if (_instance == this) _instance = null;
    }
}
