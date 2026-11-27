using System;
using System.Collections.Generic;
using System.Reflection;
using FairyGUI;
using GameLogic;
using Tools;
using UI;
using UnityEngine;
using XingShuRuntime.Core;
using XingShuRuntime.Utilities;

namespace XingShuRuntime.Social
{
    /// <summary>
    /// Client-side dynamic gradient nickname renderer and UBB rich-text name repair runtime:
    /// 1) Fixes [color=...] rich nicknames truncated mid-tag in Battle left-side avatars & enables UBBEnabled cleanly.
    /// 2) Renders smooth flowing multi-color gradients on FairyGUI player name labels across Lobby, Room, Hero Select,
    ///    Battle avatars, and Settlement without mutating text strings or breaking TryScrollTextField marquee tweens.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class XingShuColorName : MonoBehaviour
    {
        private sealed class TrackedField
        {
            internal GTextField Field;
            internal bool IsSelf;
            internal bool IsBot;
            internal bool HasSaved;
            internal Color SavedColor;
            internal Color32[] SavedGradient;
            internal bool SavedBold;
            internal bool SavedItalic;
            internal bool SavedUnderline;
            internal bool AppliedGradient;
            internal readonly Color32[] GradientBuf = new Color32[4];
        }

        private const double ScanIntervalReal = 0.35d;
        private const double FrameIntervalReal = 0.05d;

        private static XingShuColorName _instance;
        private static readonly FieldInfo HeroPlayerDataField =
            typeof(UIRoomHero_Com_Player).GetField("playerData", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public);

        private readonly Dictionary<int, TrackedField> _tracked = new Dictionary<int, TrackedField>(16);
        private readonly List<int> _removeIds = new List<int>(8);
        private readonly List<GObject> _scanQueue = new List<GObject>(256);
        private readonly List<int> _scanDepth = new List<int>(256);
        private readonly HashSet<string> _botPlainNicks = new HashSet<string>(StringComparer.Ordinal);

        private double _nextScanReal;
        private double _nextFrameReal;
        private double _phaseAccumulator;
        private double _lastTickReal;

        public static XingShuColorName Instance => _instance;

        public static bool IsEnabled
        {
            get => XingShuConfigService.GetBool(XingShuConfigKeys.ColorNameEnabled, XingShuConfigKeys.ColorNameEnabledDefault);
            set
            {
                XingShuConfigService.SetBool(XingShuConfigKeys.ColorNameEnabled, value);
                XingShuConfigService.Save();
                OnConfigChanged();
            }
        }

        internal static int Scope
        {
            get
            {
                int v = XingShuConfigService.GetInt(XingShuConfigKeys.ColorNameScope, XingShuConfigKeys.ColorNameScopeDefault);
                return v == 1 ? 1 : 0;
            }
            set
            {
                XingShuConfigService.SetInt(XingShuConfigKeys.ColorNameScope, value == 1 ? 1 : 0);
                XingShuConfigService.Save();
                OnConfigChanged();
            }
        }

        internal static int Preset
        {
            get
            {
                int v = XingShuConfigService.GetInt(XingShuConfigKeys.ColorNamePreset, XingShuConfigKeys.ColorNamePresetDefault);
                if (v < 0 || v >= ColorNamePolicy.PresetNames.Length) return XingShuConfigKeys.ColorNamePresetDefault;
                return v;
            }
            set
            {
                int clamped = Mathf.Clamp(value, 0, ColorNamePolicy.PresetNames.Length - 1);
                XingShuConfigService.SetInt(XingShuConfigKeys.ColorNamePreset, clamped);
                XingShuConfigService.Save();
                OnConfigChanged();
            }
        }

        internal static float FlowSpeed
        {
            get => XingShuConfigService.GetFloat(
                XingShuConfigKeys.ColorNameSpeed,
                XingShuConfigKeys.ColorNameSpeedDefault,
                XingShuConfigKeys.ColorNameSpeedMin,
                XingShuConfigKeys.ColorNameSpeedMax);
            set
            {
                float clamped = Mathf.Clamp(value, XingShuConfigKeys.ColorNameSpeedMin, XingShuConfigKeys.ColorNameSpeedMax);
                clamped = (float)Math.Round(clamped, 1);
                XingShuConfigService.SetFloat(XingShuConfigKeys.ColorNameSpeed, clamped, XingShuConfigKeys.ColorNameSpeedMin, XingShuConfigKeys.ColorNameSpeedMax);
                XingShuConfigService.Save();
                OnConfigChanged();
            }
        }

        internal static bool IsBold
        {
            get => XingShuConfigService.GetBool(XingShuConfigKeys.ColorNameBold, XingShuConfigKeys.ColorNameBoldDefault);
            set
            {
                XingShuConfigService.SetBool(XingShuConfigKeys.ColorNameBold, value);
                XingShuConfigService.Save();
                OnConfigChanged();
            }
        }

        internal static bool IsItalic
        {
            get => XingShuConfigService.GetBool(XingShuConfigKeys.ColorNameItalic, XingShuConfigKeys.ColorNameItalicDefault);
            set
            {
                XingShuConfigService.SetBool(XingShuConfigKeys.ColorNameItalic, value);
                XingShuConfigService.Save();
                OnConfigChanged();
            }
        }

        internal static bool IsUnderline
        {
            get => XingShuConfigService.GetBool(XingShuConfigKeys.ColorNameUnderline, XingShuConfigKeys.ColorNameUnderlineDefault);
            set
            {
                XingShuConfigService.SetBool(XingShuConfigKeys.ColorNameUnderline, value);
                XingShuConfigService.Save();
                OnConfigChanged();
            }
        }

        public static void Install(GameObject host)
        {
            if (host != null && host.GetComponent<XingShuColorName>() == null)
            {
                host.AddComponent<XingShuColorName>();
            }
        }

        private static void OnConfigChanged()
        {
            if (_instance == null) return;
            _instance._nextScanReal = 0d;
            _instance._nextFrameReal = 0d;
            if (!IsEnabled)
            {
                _instance.RestoreAllTracked();
            }
        }

        private void Awake()
        {
            if (_instance == null)
            {
                _instance = this;
                _lastTickReal = ThinkingClock.RealSeconds();
            }
            else if (_instance != this)
            {
                Destroy(this);
            }
        }

        private void OnDestroy()
        {
            RestoreAllTracked();
            _tracked.Clear();
            if (_instance == this) _instance = null;
        }

        private void LateUpdate()
        {
            if (!LauncherModules.CanLoad(nameof(XingShuColorName)))
            {
                if (_tracked.Count > 0) RestoreAllTracked();
                return;
            }

            double now = ThinkingClock.RealSeconds();
            double dt = Math.Max(0d, Math.Min(0.5d, now - _lastTickReal));
            _lastTickReal = now;

            if (now >= _nextScanReal)
            {
                _nextScanReal = now + ScanIntervalReal;
                ScanStageNames();
            }

            bool enabled = IsEnabled;
            if (!enabled)
            {
                RestoreAllTracked();
                return;
            }

            if (now >= _nextFrameReal)
            {
                _nextFrameReal = now + FrameIntervalReal;
                _phaseAccumulator += dt * Math.Max(0.2d, FlowSpeed) * 0.42d;
                if (_phaseAccumulator >= 1000d) _phaseAccumulator -= 1000d;
                ApplyAnimatedGradients();
            }
        }

        private void ScanStageNames()
        {
            try
            {
                GRoot root = GRoot.inst;
                if (root == null || root.isDisposed) return;

                GameLogicManager logic = SimpleSingletonProvider<GameLogicManager>.hasInstance
                    ? SimpleSingletonProvider<GameLogicManager>.inst
                    : null;
                AccountLogic account = logic?.account;
                string localPlainNick = string.Empty;
                if (account != null)
                {
                    try { localPlainNick = ColorNamePolicy.StripRichTags(account.GetName() ?? string.Empty); } catch { }
                }

                _botPlainNicks.Clear();
                RoomInfo room = logic?.room?.curRoomInfo;
                if (room?.Players != null)
                {
                    for (int i = 0; i < room.Players.Count; i++)
                    {
                        RoomPlayer rp = room.Players[i];
                        if (rp != null && rp.IsBot)
                        {
                            try
                            {
                                string bn = ColorNamePolicy.StripRichTags(rp.GetNick(false) ?? string.Empty);
                                if (!string.IsNullOrEmpty(bn)) _botPlainNicks.Add(bn);
                            }
                            catch { }
                        }
                    }
                }

                _scanQueue.Clear();
                _scanDepth.Clear();
                _scanQueue.Add(root);
                _scanDepth.Add(0);

                for (int q = 0; q < _scanQueue.Count && _scanQueue.Count < 768; q++)
                {
                    GObject obj = _scanQueue[q];
                    int depth = _scanDepth[q];
                    if (obj == null || obj.isDisposed) continue;

                    if (obj is UIBattleInfo_Button_PlayerInfo battleBtn)
                    {
                        InspectBattlePlayerButton(battleBtn, account);
                    }
                    else if (obj is UIRoomPlayer_Com_PlayerLabel roomCard)
                    {
                        InspectRoomWaitCard(roomCard, account);
                    }
                    else if (obj is UIRoomHero_Com_Player heroCard)
                    {
                        InspectHeroSelectCard(heroCard, account);
                    }
                    else if (obj is UICom_PlayerLabel playerLabel)
                    {
                        InspectGenericPlayerLabel(playerLabel, localPlainNick);
                    }
                    else if (obj is GTextField tf && IsPlayerNameField(tf))
                    {
                        EnsureUbbForRichText(tf);
                    }

                    if (obj is GComponent comp && depth < 12)
                    {
                        int n = comp.numChildren;
                        for (int i = 0; i < n && _scanQueue.Count < 768; i++)
                        {
                            GObject child = comp.GetChildAt(i);
                            if (child != null && !child.isDisposed && child.visible)
                            {
                                _scanQueue.Add(child);
                                _scanDepth.Add(depth + 1);
                            }
                        }
                    }
                }
            }
            catch { }
        }

        private void InspectBattlePlayerButton(UIBattleInfo_Button_PlayerInfo btn, AccountLogic account)
        {
            BattlePlayerData bpd = btn.PlayerData;
            UICom_PlayerInfo info = btn.com_player as UICom_PlayerInfo;
            GTextField txt = info != null ? info.txt_PlayerName : null;
            if (bpd == null || bpd.player == null || txt == null || txt.isDisposed) return;

            string fullNick = string.Empty;
            try { fullNick = bpd.player.GetNick(true) ?? string.Empty; } catch { }
            if (ColorNamePolicy.ContainsRichTags(fullNick))
            {
                if (!txt.UBBEnabled) txt.UBBEnabled = true;
                string repaired = ColorNamePolicy.TruncatePreservingUbb(fullNick, 14);
                if (!string.IsNullOrEmpty(repaired) && txt.text != repaired)
                {
                    txt.text = repaired;
                }
            }

            bool isSelf = account != null && account.IsSelf(bpd.player.Id);
            bool isBot = bpd.player.IsBot;
            RegisterField(txt, isSelf, isBot);
        }

        private void InspectRoomWaitCard(UIRoomPlayer_Com_PlayerLabel card, AccountLogic account)
        {
            RoomPlayer rp = card.playerInfo;
            UICom_PlayerLabel lbl = card.com_Label as UICom_PlayerLabel;
            GTextField txt = lbl?.com_Name != null ? lbl.com_Name.txt_PlayerName : null;
            if (rp == null || txt == null || txt.isDisposed) return;

            EnsureUbbForRichText(txt);
            bool isSelf = account != null && account.IsSelf(rp.Id);
            RegisterField(txt, isSelf, rp.IsBot);
        }

        private void InspectHeroSelectCard(UIRoomHero_Com_Player card, AccountLogic account)
        {
            RoomPlayer rp = HeroPlayerDataField != null ? HeroPlayerDataField.GetValue(card) as RoomPlayer : null;
            UICom_PlayerLabel lbl = card.com_PlayerLabel as UICom_PlayerLabel;
            GTextField txt = lbl?.com_Name != null ? lbl.com_Name.txt_PlayerName : null;
            if (rp == null || txt == null || txt.isDisposed) return;

            EnsureUbbForRichText(txt);
            bool isSelf = account != null && account.IsSelf(rp.Id);
            RegisterField(txt, isSelf, rp.IsBot);
        }

        private void InspectGenericPlayerLabel(UICom_PlayerLabel lbl, string localPlainNick)
        {
            GTextField txt = lbl.com_Name != null ? lbl.com_Name.txt_PlayerName : null;
            if (txt == null || txt.isDisposed) return;
            EnsureUbbForRichText(txt);

            string raw = txt.text;
            if (string.IsNullOrEmpty(raw)) return;
            int id = txt.GetHashCode();
            if (_tracked.ContainsKey(id)) return;

            string plain = ColorNamePolicy.StripRichTags(raw);
            if (string.IsNullOrEmpty(plain) || plain == "等待玩家加入..." || plain == "等待玩家") return;

            bool isSelf = !string.IsNullOrEmpty(localPlainNick) && string.Equals(plain, localPlainNick, StringComparison.Ordinal);
            bool isBot = _botPlainNicks.Contains(plain) || plain.StartsWith("【Bot", StringComparison.OrdinalIgnoreCase);
            RegisterField(txt, isSelf, isBot);
        }

        private static bool IsPlayerNameField(GTextField tf)
        {
            string n = tf.name;
            return n == "txt_PlayerName" || n == "txt_PlayerNick" || n == "txt_NickName";
        }

        private static void EnsureUbbForRichText(GTextField tf)
        {
            try
            {
                if (tf != null && !tf.isDisposed && !tf.UBBEnabled && ColorNamePolicy.ContainsRichTags(tf.text))
                {
                    tf.UBBEnabled = true;
                }
            }
            catch { }
        }

        private void RegisterField(GTextField field, bool isSelf, bool isBot)
        {
            int key = field.GetHashCode();
            if (!_tracked.TryGetValue(key, out TrackedField entry) || entry == null || entry.Field != field)
            {
                entry = new TrackedField
                {
                    Field = field,
                    IsSelf = isSelf,
                    IsBot = isBot,
                };
                _tracked[key] = entry;
            }
            else
            {
                entry.IsSelf = isSelf;
                entry.IsBot = isBot;
            }
        }

        private void ApplyAnimatedGradients()
        {
            int scope = Scope;
            int preset = Preset;
            bool wantBold = IsBold;
            bool wantItalic = IsItalic;
            bool wantUnderline = IsUnderline;
            ColorNamePolicy.EvaluatePresetCorners(
                preset,
                _phaseAccumulator,
                out byte r0, out byte g0, out byte b0,
                out byte r1, out byte g1, out byte b1,
                out byte r2, out byte g2, out byte b2,
                out byte r3, out byte g3, out byte b3);

            _removeIds.Clear();
            foreach (var kv in _tracked)
            {
                TrackedField entry = kv.Value;
                GTextField tf = entry != null ? entry.Field : null;
                if (tf == null || tf.isDisposed)
                {
                    _removeIds.Add(kv.Key);
                    continue;
                }

                bool visible = tf.onStage && tf.visible;
                bool wantAnim = visible && !entry.IsBot && (scope == 1 || entry.IsSelf);
                if (!wantAnim)
                {
                    if (entry.AppliedGradient)
                    {
                        RestoreEntry(entry);
                    }
                    continue;
                }

                try
                {
                    TextFormat fmt = tf.textFormat;
                    if (fmt == null) continue;
                    if (!entry.HasSaved)
                    {
                        entry.HasSaved = true;
                        entry.SavedColor = fmt.color;
                        entry.SavedGradient = fmt.gradientColor != null ? (Color32[])fmt.gradientColor.Clone() : null;
                        entry.SavedBold = fmt.bold;
                        entry.SavedItalic = fmt.italic;
                        entry.SavedUnderline = fmt.underline;
                    }

                    entry.GradientBuf[0] = new Color32(r0, g0, b0, 255);
                    entry.GradientBuf[1] = new Color32(r1, g1, b1, 255);
                    entry.GradientBuf[2] = new Color32(r2, g2, b2, 255);
                    entry.GradientBuf[3] = new Color32(r3, g3, b3, 255);
                    fmt.gradientColor = entry.GradientBuf;
                    fmt.bold = wantBold || entry.SavedBold;
                    fmt.italic = wantItalic || entry.SavedItalic;
                    fmt.underline = wantUnderline || entry.SavedUnderline;
                    tf.textFormat = fmt;
                    entry.AppliedGradient = true;
                }
                catch { }
            }

            for (int i = 0; i < _removeIds.Count; i++)
            {
                _tracked.Remove(_removeIds[i]);
            }
        }

        private void RestoreAllTracked()
        {
            if (_tracked.Count == 0) return;
            _removeIds.Clear();
            foreach (var kv in _tracked)
            {
                TrackedField entry = kv.Value;
                if (entry == null || entry.Field == null || entry.Field.isDisposed)
                {
                    _removeIds.Add(kv.Key);
                    continue;
                }
                if (entry.AppliedGradient)
                {
                    RestoreEntry(entry);
                }
            }
            for (int i = 0; i < _removeIds.Count; i++)
            {
                _tracked.Remove(_removeIds[i]);
            }
        }

        private static void RestoreEntry(TrackedField entry)
        {
            try
            {
                TextFormat fmt = entry.Field.textFormat;
                if (fmt != null && entry.HasSaved)
                {
                    fmt.color = entry.SavedColor;
                    fmt.gradientColor = entry.SavedGradient != null ? (Color32[])entry.SavedGradient.Clone() : null;
                    fmt.bold = entry.SavedBold;
                    fmt.italic = entry.SavedItalic;
                    fmt.underline = entry.SavedUnderline;
                    entry.Field.textFormat = fmt;
                }
            }
            catch { }
            entry.AppliedGradient = false;
        }
    }
}
