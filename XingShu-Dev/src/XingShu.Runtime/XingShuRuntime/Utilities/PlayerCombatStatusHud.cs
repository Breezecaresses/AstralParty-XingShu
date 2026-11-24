using System;
using System.Collections.Generic;
using Core;
using Core.Scene;
using Core.Unit;
using FairyGUI;
using GameLogic;
using Tools;
using UI;
using UnityEngine;
using XingShuRuntime.CameraPort;
using XingShuRuntime.Core;

namespace XingShuRuntime.Utilities;

/// <summary>
/// Standalone board HUD module displaying each hero's active skill CD, HP, and base ATK/DEF
/// anchored on top of their 3D board character, with shared draggable &amp; slider-adjustable offset.
/// </summary>
public sealed class PlayerCombatStatusHud : MonoBehaviour
{
    private const float TextRefreshIntervalSeconds = 0.12f;

    private sealed class PillSlot
    {
        internal long PlayerId;
        internal GComponent Panel;
        internal GGraph Background;
        internal GGraph AccentBar;
        internal GTextField Label;
        internal float Width;
        internal float Height;
        internal float AnchorX;
        internal float AnchorY;
        internal string LastText = "";
        internal bool ActiveInFrame;
    }

    private static PlayerCombatStatusHud _instance;

    private readonly Dictionary<long, PillSlot> _pills = new Dictionary<long, PillSlot>(4);

    private bool _enabled = XingShuConfigKeys.PlayerCombatHudEnabledDefault;
    private float _offsetX = XingShuConfigKeys.PlayerCombatHudOffsetXDefault;
    private float _offsetY = XingShuConfigKeys.PlayerCombatHudOffsetYDefault;
    private float _scale = XingShuConfigKeys.PlayerCombatHudScaleDefault;
    private bool _locked = XingShuConfigKeys.PlayerCombatHudLockedDefault;
    private bool _showCd = XingShuConfigKeys.PlayerCombatHudShowCdDefault;
    private bool _showHp = XingShuConfigKeys.PlayerCombatHudShowHpDefault;
    private bool _showAtkDef = XingShuConfigKeys.PlayerCombatHudShowAtkDefDefault;

    private GComponent _attachedContainer;
    private float _nextTextRefresh;
    private long _draggingPlayerId;

    internal static bool IsEnabled => _instance != null
        ? _instance._enabled
        : XingShuConfigService.GetBool(XingShuConfigKeys.PlayerCombatHudEnabled, XingShuConfigKeys.PlayerCombatHudEnabledDefault);

    internal static float OffsetX => _instance != null
        ? _instance._offsetX
        : FloatingHintLayoutMath.FiniteClamp(
            XingShuConfigService.GetFloat(XingShuConfigKeys.PlayerCombatHudOffsetX, XingShuConfigKeys.PlayerCombatHudOffsetXDefault),
            XingShuConfigKeys.PlayerCombatHudOffsetXMin, XingShuConfigKeys.PlayerCombatHudOffsetXMax, XingShuConfigKeys.PlayerCombatHudOffsetXDefault);

    internal static float OffsetY => _instance != null
        ? _instance._offsetY
        : FloatingHintLayoutMath.FiniteClamp(
            XingShuConfigService.GetFloat(XingShuConfigKeys.PlayerCombatHudOffsetY, XingShuConfigKeys.PlayerCombatHudOffsetYDefault),
            XingShuConfigKeys.PlayerCombatHudOffsetYMin, XingShuConfigKeys.PlayerCombatHudOffsetYMax, XingShuConfigKeys.PlayerCombatHudOffsetYDefault);

    internal static float Scale => _instance != null
        ? _instance._scale
        : FloatingHintLayoutMath.FiniteClamp(
            XingShuConfigService.GetFloat(XingShuConfigKeys.PlayerCombatHudScale, XingShuConfigKeys.PlayerCombatHudScaleDefault),
            XingShuConfigKeys.PlayerCombatHudScaleMin, XingShuConfigKeys.PlayerCombatHudScaleMax, XingShuConfigKeys.PlayerCombatHudScaleDefault);

    internal static bool Locked => _instance != null
        ? _instance._locked
        : XingShuConfigService.GetBool(XingShuConfigKeys.PlayerCombatHudLocked, XingShuConfigKeys.PlayerCombatHudLockedDefault);

    internal static bool ShowCd => _instance != null
        ? _instance._showCd
        : XingShuConfigService.GetBool(XingShuConfigKeys.PlayerCombatHudShowCd, XingShuConfigKeys.PlayerCombatHudShowCdDefault);

    internal static bool ShowHp => _instance != null
        ? _instance._showHp
        : XingShuConfigService.GetBool(XingShuConfigKeys.PlayerCombatHudShowHp, XingShuConfigKeys.PlayerCombatHudShowHpDefault);

    internal static bool ShowAtkDef => _instance != null
        ? _instance._showAtkDef
        : XingShuConfigService.GetBool(XingShuConfigKeys.PlayerCombatHudShowAtkDef, XingShuConfigKeys.PlayerCombatHudShowAtkDefDefault);

    internal static void SetEnabled(bool value)
    {
        XingShuConfigService.SetBool(XingShuConfigKeys.PlayerCombatHudEnabled, value);
        XingShuConfigService.Save();
        if (_instance != null)
        {
            _instance._enabled = value;
            _instance._nextTextRefresh = 0f;
            if (!value) _instance.HideAllPills();
        }
    }

    internal static void SetOffset(float offX, float offY)
    {
        float x = FloatingHintLayoutMath.FiniteClamp(offX, XingShuConfigKeys.PlayerCombatHudOffsetXMin, XingShuConfigKeys.PlayerCombatHudOffsetXMax, XingShuConfigKeys.PlayerCombatHudOffsetXDefault);
        float y = FloatingHintLayoutMath.FiniteClamp(offY, XingShuConfigKeys.PlayerCombatHudOffsetYMin, XingShuConfigKeys.PlayerCombatHudOffsetYMax, XingShuConfigKeys.PlayerCombatHudOffsetYDefault);
        XingShuConfigService.SetFloat(XingShuConfigKeys.PlayerCombatHudOffsetX, x);
        XingShuConfigService.SetFloat(XingShuConfigKeys.PlayerCombatHudOffsetY, y);
        XingShuConfigService.Save();
        if (_instance != null)
        {
            _instance._offsetX = x;
            _instance._offsetY = y;
        }
    }

    internal static void SetScale(float scale)
    {
        float clamped = FloatingHintLayoutMath.FiniteClamp(
            scale, XingShuConfigKeys.PlayerCombatHudScaleMin, XingShuConfigKeys.PlayerCombatHudScaleMax, XingShuConfigKeys.PlayerCombatHudScaleDefault);
        XingShuConfigService.SetFloat(XingShuConfigKeys.PlayerCombatHudScale, clamped);
        XingShuConfigService.Save();
        if (_instance != null)
        {
            _instance._scale = clamped;
        }
    }

    internal static void SetLocked(bool locked)
    {
        XingShuConfigService.SetBool(XingShuConfigKeys.PlayerCombatHudLocked, locked);
        XingShuConfigService.Save();
        if (_instance != null)
        {
            _instance._locked = locked;
            _instance.RefreshInteractionStates();
        }
    }

    internal static void SetShowCd(bool value) => SetSubToggle(XingShuConfigKeys.PlayerCombatHudShowCd, value, inst => inst._showCd = value);
    internal static void SetShowHp(bool value) => SetSubToggle(XingShuConfigKeys.PlayerCombatHudShowHp, value, inst => inst._showHp = value);
    internal static void SetShowAtkDef(bool value) => SetSubToggle(XingShuConfigKeys.PlayerCombatHudShowAtkDef, value, inst => inst._showAtkDef = value);

    private static void SetSubToggle(string key, bool value, Action<PlayerCombatStatusHud> apply)
    {
        XingShuConfigService.SetBool(key, value);
        XingShuConfigService.Save();
        if (_instance != null)
        {
            apply(_instance);
            _instance._nextTextRefresh = 0f;
            foreach (var pill in _instance._pills.Values)
            {
                pill.LastText = "";
            }
        }
    }

    internal static void ResetLayout()
    {
        XingShuConfigService.SetFloat(XingShuConfigKeys.PlayerCombatHudOffsetX, XingShuConfigKeys.PlayerCombatHudOffsetXDefault);
        XingShuConfigService.SetFloat(XingShuConfigKeys.PlayerCombatHudOffsetY, XingShuConfigKeys.PlayerCombatHudOffsetYDefault);
        XingShuConfigService.SetFloat(XingShuConfigKeys.PlayerCombatHudScale, XingShuConfigKeys.PlayerCombatHudScaleDefault);
        XingShuConfigService.SetBool(XingShuConfigKeys.PlayerCombatHudLocked, XingShuConfigKeys.PlayerCombatHudLockedDefault);
        XingShuConfigService.SetBool(XingShuConfigKeys.PlayerCombatHudShowCd, XingShuConfigKeys.PlayerCombatHudShowCdDefault);
        XingShuConfigService.SetBool(XingShuConfigKeys.PlayerCombatHudShowHp, XingShuConfigKeys.PlayerCombatHudShowHpDefault);
        XingShuConfigService.SetBool(XingShuConfigKeys.PlayerCombatHudShowAtkDef, XingShuConfigKeys.PlayerCombatHudShowAtkDefDefault);
        XingShuConfigService.Save();
        if (_instance != null)
        {
            _instance._offsetX = XingShuConfigKeys.PlayerCombatHudOffsetXDefault;
            _instance._offsetY = XingShuConfigKeys.PlayerCombatHudOffsetYDefault;
            _instance._scale = XingShuConfigKeys.PlayerCombatHudScaleDefault;
            _instance._locked = XingShuConfigKeys.PlayerCombatHudLockedDefault;
            _instance._showCd = XingShuConfigKeys.PlayerCombatHudShowCdDefault;
            _instance._showHp = XingShuConfigKeys.PlayerCombatHudShowHpDefault;
            _instance._showAtkDef = XingShuConfigKeys.PlayerCombatHudShowAtkDefDefault;
            _instance._draggingPlayerId = 0L;
            _instance._nextTextRefresh = 0f;
            foreach (var pill in _instance._pills.Values)
            {
                pill.LastText = "";
            }
            _instance.RefreshInteractionStates();
        }
    }

    public static void Install(GameObject host)
    {
        if (_instance != null || host == null) return;
        _instance = host.AddComponent<PlayerCombatStatusHud>();
        _instance.LoadConfig();
    }

    private void LoadConfig()
    {
        _enabled = XingShuConfigService.GetBool(XingShuConfigKeys.PlayerCombatHudEnabled, XingShuConfigKeys.PlayerCombatHudEnabledDefault);
        _offsetX = FloatingHintLayoutMath.FiniteClamp(
            XingShuConfigService.GetFloat(XingShuConfigKeys.PlayerCombatHudOffsetX, XingShuConfigKeys.PlayerCombatHudOffsetXDefault),
            XingShuConfigKeys.PlayerCombatHudOffsetXMin, XingShuConfigKeys.PlayerCombatHudOffsetXMax, XingShuConfigKeys.PlayerCombatHudOffsetXDefault);
        _offsetY = FloatingHintLayoutMath.FiniteClamp(
            XingShuConfigService.GetFloat(XingShuConfigKeys.PlayerCombatHudOffsetY, XingShuConfigKeys.PlayerCombatHudOffsetYDefault),
            XingShuConfigKeys.PlayerCombatHudOffsetYMin, XingShuConfigKeys.PlayerCombatHudOffsetYMax, XingShuConfigKeys.PlayerCombatHudOffsetYDefault);
        _scale = FloatingHintLayoutMath.FiniteClamp(
            XingShuConfigService.GetFloat(XingShuConfigKeys.PlayerCombatHudScale, XingShuConfigKeys.PlayerCombatHudScaleDefault),
            XingShuConfigKeys.PlayerCombatHudScaleMin, XingShuConfigKeys.PlayerCombatHudScaleMax, XingShuConfigKeys.PlayerCombatHudScaleDefault);
        _locked = XingShuConfigService.GetBool(XingShuConfigKeys.PlayerCombatHudLocked, XingShuConfigKeys.PlayerCombatHudLockedDefault);
        _showCd = XingShuConfigService.GetBool(XingShuConfigKeys.PlayerCombatHudShowCd, XingShuConfigKeys.PlayerCombatHudShowCdDefault);
        _showHp = XingShuConfigService.GetBool(XingShuConfigKeys.PlayerCombatHudShowHp, XingShuConfigKeys.PlayerCombatHudShowHpDefault);
        _showAtkDef = XingShuConfigService.GetBool(XingShuConfigKeys.PlayerCombatHudShowAtkDef, XingShuConfigKeys.PlayerCombatHudShowAtkDefDefault);
    }

    private void LateUpdate()
    {
        try
        {
            Tick();
        }
        catch (Exception)
        {
            ClearAll();
        }
    }

    private void Tick()
    {
        if (!_enabled || (!_showCd && !_showHp && !_showAtkDef)
            || !SimpleSingletonProvider<SceneManager>.hasInstance
            || SimpleSingletonProvider<SceneManager>.inst.currentType == null
            || SimpleSingletonProvider<SceneManager>.inst.currentType.Value != SceneType.Battle
            || !SimpleSingletonProvider<GameLogicManager>.hasInstance
            || !SimpleSingletonProvider<UIManager>.hasInstance)
        {
            ClearAll();
            return;
        }

        var uiMgr = SimpleSingletonProvider<UIManager>.inst;
        var logic = SimpleSingletonProvider<GameLogicManager>.inst;
        var fight = logic.fight?.battleFightData;
        if ((fight != null && !fight.isEnd) || ShownNativeWindows.Find<FightWindow>(uiMgr) != null)
        {
            HideAllPills();
            return;
        }

        var battleInfoUi = logic.battle?.battleInfo?.UIObject;
        var players = logic.battle?.PlayerDatas;
        Camera cam = BattleSceneController.inst != null ? BattleSceneController.inst.mainCamera : null;
        if (cam == null) cam = Camera.main;

        if (battleInfoUi == null || battleInfoUi.isDisposed || !battleInfoUi.visible || !battleInfoUi.onStage
            || battleInfoUi.width < 320f || battleInfoUi.height < 240f
            || players == null || cam == null || cam.targetTexture != null)
        {
            HideAllPills();
            return;
        }

        if (_attachedContainer != battleInfoUi)
        {
            ClearAll();
            _attachedContainer = battleInfoUi;
        }

        bool refreshText = Time.unscaledTime >= _nextTextRefresh;
        if (refreshText)
        {
            _nextTextRefresh = Time.unscaledTime + TextRefreshIntervalSeconds;
        }

        foreach (var kv in _pills)
        {
            kv.Value.ActiveInFrame = false;
        }

        for (int i = 0; i < players.Count; i++)
        {
            var p = players[i];
            if (p == null || p.player?.Hero == null || p.characterType != CharacterType.Hero
                || p.CharacterInst == null || !p.CharacterInst.gameObject.activeInHierarchy)
            {
                continue;
            }

            if (!NativeHeadAnchor.TryGet(p.CharacterInst, cam, out Vector3 head) || head.z <= 0f)
            {
                continue;
            }

            Vector2 stagePt = battleInfoUi.GlobalToLocal(new Vector2(head.x, Screen.height - head.y));
            if (!PortMath.Finite(stagePt.x) || !PortMath.Finite(stagePt.y))
            {
                continue;
            }

            long pid = p.player.Id;
            PillSlot slot = EnsurePill(battleInfoUi, pid);
            slot.ActiveInFrame = true;

            if (refreshText || string.IsNullOrEmpty(slot.LastText))
            {
                string ubb = BuildStatusText(p);
                UpdatePillContent(slot, ubb);
            }

            slot.AnchorX = stagePt.x - slot.Width * 0.5f * _scale;
            slot.AnchorY = stagePt.y - slot.Height * _scale;

            if (slot.Panel != null && !slot.Panel.isDisposed)
            {
                slot.Panel.visible = true;
                slot.Panel.SetScale(_scale, _scale);
                if (_draggingPlayerId != pid)
                {
                    FloatingHintLayoutMath.ClampXYToBounds(
                        battleInfoUi.width, battleInfoUi.height,
                        slot.Width, slot.Height,
                        _scale,
                        slot.AnchorX + _offsetX, slot.AnchorY + _offsetY,
                        FloatingHintLayoutMath.DefaultScreenMargin,
                        out float finalX, out float finalY);
                    slot.Panel.SetXY(finalX, finalY);
                }
            }
        }

        foreach (var kv in _pills)
        {
            if (!kv.Value.ActiveInFrame && kv.Value.Panel != null && !kv.Value.Panel.isDisposed)
            {
                if (_draggingPlayerId == kv.Key) _draggingPlayerId = 0L;
                kv.Value.Panel.visible = false;
            }
        }
    }

    private string BuildStatusText(BattlePlayerData p)
    {
        var hero = p.player.Hero;
        string line1 = "";
        if (_showCd)
        {
            int skillId = p.player.GetBattleActiveSkillId();
            int curCd = p.Property?.activeSkillCD != null ? p.Property.activeSkillCD.Value : p.SkillCD;
            int maxCd = 0;
            if (skillId > 0 && StaticConfigure.Skill?.InfoDict != null
                && StaticConfigure.Skill.InfoDict.TryGetValue(skillId, out var scfg) && scfg != null)
            {
                maxCd = scfg.Round;
            }

            if (skillId > 0 && maxCd > 0)
            {
                string cdCol = curCd <= 0 ? "#7CFF9B" : "#FFC857";
                line1 = $"[color={cdCol}]CD {curCd}/{maxCd}[/color]";
            }
            else
            {
                line1 = "[color=#B8C8DC]被动[/color]";
            }
        }

        if (_showHp)
        {
            int hp = p.Property?.HP != null ? p.Property.HP.Value : hero.Hp;
            int maxHp = (p.Property != null && p.Property.maxHP > 0) ? p.Property.maxHP : hero.MaxHp;
            string hpCol = hp <= 2 ? "#FF8DA1" : "#FFFFFF";
            string hpPart = $"[color={hpCol}]HP {hp}/{maxHp}[/color]";
            line1 = string.IsNullOrEmpty(line1) ? hpPart : (line1 + "  " + hpPart);
        }

        string line2 = "";
        if (_showAtkDef)
        {
            int baseAtk = hero.Attack;
            int baseDef = hero.Defense;
            int curAtk = p.Property?.ATK != null ? p.Property.ATK.Value : baseAtk;
            int curDef = p.Property?.DEF != null ? p.Property.DEF.Value : baseDef;

            string atkText = curAtk != baseAtk
                ? $"攻[color=#FF9E7D]{baseAtk}[/color][color=#82D8FF]({curAtk})[/color]"
                : $"攻[color=#FF9E7D]{baseAtk}[/color]";
            string defText = curDef != baseDef
                ? $"防[color=#82D8FF]{baseDef}[/color][color=#82D8FF]({curDef})[/color]"
                : $"防[color=#82D8FF]{baseDef}[/color]";
            line2 = atkText + "  " + defText;
        }

        if (!string.IsNullOrEmpty(line1) && !string.IsNullOrEmpty(line2))
        {
            return line1 + "\n" + line2;
        }
        return !string.IsNullOrEmpty(line1) ? line1 : line2;
    }

    private PillSlot EnsurePill(GComponent container, long playerId)
    {
        if (_pills.TryGetValue(playerId, out var slot)
            && slot.Panel != null && !slot.Panel.isDisposed && slot.Panel.parent == container)
        {
            return slot;
        }

        if (slot != null && slot.Panel != null && !slot.Panel.isDisposed)
        {
            slot.Panel.Dispose();
        }

        var panel = new GComponent
        {
            name = "XINGSHU_PlayerCombatHud_" + playerId,
            touchable = !_locked,
            opaque = !_locked,
            draggable = !_locked,
            sortingOrder = 2,
        };
        XingShuOverlayInput.Protect(panel);
        panel.SetPivot(0f, 0f, false);

        long capturedId = playerId;
        panel.onDragStart.Set((EventCallback0)delegate
        {
            _draggingPlayerId = capturedId;
        });
        panel.onDragMove.Set((EventCallback0)delegate
        {
            UpdateOffsetFromDrag(capturedId, saveConfig: false);
        });
        panel.onDragEnd.Set((EventCallback0)delegate
        {
            UpdateOffsetFromDrag(capturedId, saveConfig: true);
            _draggingPlayerId = 0L;
        });

        var bg = new GGraph { touchable = false };
        panel.AddChild(bg);

        var accent = new GGraph { touchable = false };
        panel.AddChild(accent);

        var label = new GTextField
        {
            name = "XINGSHU_PlayerCombatHudLabel",
            touchable = false,
            autoSize = AutoSizeType.Both,
            align = AlignType.Center,
            UBBEnabled = true,
            stroke = 1.2f,
            strokeColor = new Color(0f, 0f, 0f, 0.94f),
        };
        var tf = label.textFormat;
        tf.size = Application.isMobilePlatform ? 18 : 15;
        tf.lineSpacing = 3;
        tf.bold = true;
        tf.color = new Color(0.96f, 0.98f, 1f, 1f);
        label.textFormat = tf;
        panel.AddChild(label);

        container.AddChild(panel);

        slot = new PillSlot
        {
            PlayerId = playerId,
            Panel = panel,
            Background = bg,
            AccentBar = accent,
            Label = label,
        };
        _pills[playerId] = slot;
        return slot;
    }

    private void UpdatePillContent(PillSlot slot, string ubbText)
    {
        if (slot.LastText == ubbText && slot.Width > 0f) return;
        slot.LastText = ubbText;
        slot.Label.text = ubbText;
        float w = Mathf.Max(Application.isMobilePlatform ? 132f : 112f, slot.Label.width + 20f);
        float h = Mathf.Max(26f, slot.Label.height + 12f);
        slot.Label.SetXY((w - slot.Label.width) * 0.5f + 1.5f, 6f);
        slot.Width = w;
        slot.Height = h;
        slot.Panel.SetSize(w, h);
        slot.Background.DrawRoundRect(w, h, new Color(0.055f, 0.068f, 0.11f, 0.84f), new[] { 8f, 8f, 8f, 8f });
        slot.AccentBar.DrawRoundRect(3f, Mathf.Max(14f, h - 12f), new Color(0.94f, 0.16f, 0.47f, 1f), new[] { 2f, 2f, 2f, 2f });
        slot.AccentBar.SetXY(4f, 6f);
    }

    private void UpdateOffsetFromDrag(long playerId, bool saveConfig)
    {
        if (_attachedContainer == null || _attachedContainer.isDisposed) return;
        if (!_pills.TryGetValue(playerId, out var slot) || slot.Panel == null || slot.Panel.isDisposed) return;

        FloatingHintLayoutMath.ClampXYToBounds(
            _attachedContainer.width, _attachedContainer.height,
            slot.Width, slot.Height,
            _scale, slot.Panel.x, slot.Panel.y,
            FloatingHintLayoutMath.DefaultScreenMargin,
            out float cx, out float cy);
        slot.Panel.SetXY(cx, cy);

        float nextX = FloatingHintLayoutMath.FiniteClamp(
            cx - slot.AnchorX,
            XingShuConfigKeys.PlayerCombatHudOffsetXMin, XingShuConfigKeys.PlayerCombatHudOffsetXMax, _offsetX);
        float nextY = FloatingHintLayoutMath.FiniteClamp(
            cy - slot.AnchorY,
            XingShuConfigKeys.PlayerCombatHudOffsetYMin, XingShuConfigKeys.PlayerCombatHudOffsetYMax, _offsetY);

        if (saveConfig)
        {
            SetOffset(nextX, nextY);
        }
        else
        {
            _offsetX = nextX;
            _offsetY = nextY;
        }
    }

    private void RefreshInteractionStates()
    {
        foreach (var kv in _pills)
        {
            var panel = kv.Value.Panel;
            if (panel == null || panel.isDisposed) continue;
            panel.touchable = !_locked;
            panel.opaque = !_locked;
            panel.draggable = !_locked;
        }
    }

    private void HideAllPills()
    {
        _draggingPlayerId = 0L;
        foreach (var kv in _pills)
        {
            if (kv.Value.Panel != null && !kv.Value.Panel.isDisposed)
            {
                kv.Value.Panel.visible = false;
            }
        }
    }

    private void ClearAll()
    {
        _draggingPlayerId = 0L;
        foreach (var kv in _pills)
        {
            if (kv.Value.Panel != null && !kv.Value.Panel.isDisposed)
            {
                kv.Value.Panel.Dispose();
            }
        }
        _pills.Clear();
        _attachedContainer = null;
    }

    private void OnDestroy()
    {
        ClearAll();
        if (_instance == this) _instance = null;
    }
}
