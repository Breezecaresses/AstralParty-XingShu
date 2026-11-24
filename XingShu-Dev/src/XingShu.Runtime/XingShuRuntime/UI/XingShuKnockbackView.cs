using System;
using XingShuRuntime.Core;
using XingShuRuntime.Utilities;
using XingShuRuntime.Targeting;
using UnityEngine;
using UnityEngine.UI;

namespace XingShuRuntime.UI
{
    /// <summary>
    /// 功能中心 - 击飞预测 (Knockback Prediction) Modern UI 页面 (Phase 2D-1A)
    /// 纯粹的 View 层，100% 委托 MonsterKillProbability 底层状态与调整契约
    /// 遵循纯色半透拟态磨砂玻璃规范，嵌入 Tab Index 2
    /// </summary>
    internal sealed class XingShuKnockbackView
    {
        private readonly GameObject _root;

        // Card 1: Switch & Status
        private Toggle _enableToggle;
        private Text _statusText;
        private Toggle _targetingToggle;
        private Toggle _arrowBoostToggle;
        private Text _targetingSummary;
        private Toggle _defenseHintToggle;
        private Toggle _battleCardHintToggle;
        private Toggle _battleCardLockToggle;
        private Slider _battleCardScaleSlider;
        private Slider _battleCardMarginXSlider;
        private Slider _battleCardYSlider;
        private Text _battleCardScaleText;
        private Text _battleCardMarginXText;
        private Text _battleCardYText;
        private Toggle _megathEnabledToggle;
        private Toggle _megathLockToggle;
        private Slider _megathScaleSlider;
        private Slider _megathXSlider;
        private Slider _megathYSlider;
        private Text _megathScaleText;
        private Text _megathXText;
        private Text _megathYText;
        private Toggle _playerHudEnabledToggle;
        private Toggle _playerHudHeadToggle;
        private Toggle _playerHudAvatarToggle;
        private Toggle _playerHudLockToggle;
        private Toggle _playerHudCdToggle;
        private Toggle _playerHudHpToggle;
        private Toggle _playerHudAtkDefToggle;
        private Slider _playerHudScaleSlider;
        private Slider _playerHudOffXSlider;
        private Slider _playerHudOffYSlider;
        private Slider _playerHudHeadOffYSlider;
        private Text _playerHudScaleText;
        private Text _playerHudOffXText;
        private Text _playerHudOffYText;
        private Text _playerHudHeadOffYText;

        // Card 2: Target & Preview
        private Button _previewBtn;
        private Text _previewBtnText;
        private Button _prevTargetBtn;
        private Button _nextTargetBtn;
        private Button _detailPageBtn;
        private Text _targetSummaryText;

        // Card 3: Fight Text Style
        private Text _styleSummaryText;
        private Button _fontMinusBtn;
        private Button _fontPlusBtn;
        private Button _xLeftBtn;
        private Button _xRightBtn;
        private Button _yUpBtn;
        private Button _yDownBtn;
        private Button _resetStyleBtn;

        // Visual V3 Controls
        private Text _previewLine1Text;
        private Text _previewLine2Text;
        private Button _autoColorBtn;
        private Text _autoColorBtnText;
        private Button _manualColorBtn;
        private Text _manualColorBtnText;
        private Button _rainbow100Btn;
        private Text _rainbow100BtnText;

        private InputField _probColorInput;
        private Image _probColorSwatch;
        private Text _probColorErrorText;
        private InputField _targetColorInput;
        private Image _targetColorSwatch;
        private Text _targetColorErrorText;

        // Observed State for 0 GC projection
        private bool _suppressCallbacks;
        private bool _lastObservedEnabled;
        private bool _lastObservedPreview;
        private int _lastObservedFontSize = -1;
        private float _lastObservedFontX = float.MinValue;
        private float _lastObservedFontY = float.MinValue;
        private bool _lastObservedAutoColor;
        private bool _lastObservedRainbow100;
        private string _lastObservedProbColor = "";
        private string _lastObservedTargetColor = "";
        private string _lastObservedStatus = "";
        private string _lastObservedTargetSummary = "";

        internal GameObject Root => _root;

        internal XingShuKnockbackView(Transform parent)
        {
            _root = XingShuUIFactory.CreateUIObject("Page_Knockback", parent.gameObject);
            RectTransform rootRt = _root.GetComponent<RectTransform>();
            rootRt.anchorMin = Vector2.zero;
            rootRt.anchorMax = Vector2.one;
            rootRt.offsetMin = Vector2.zero;
            rootRt.offsetMax = Vector2.zero;

            BuildUI();
        }

        private void BuildUI()
        {
            ScrollRect scrollRect = XingShuUIFactory.CreateVerticalScrollView(_root, "KnockbackScrollView", out GameObject contentArea);
            VerticalLayoutGroup vlg = contentArea.GetComponent<VerticalLayoutGroup>();
            if (vlg != null)
            {
                vlg.spacing = 12f;
                vlg.padding = new RectOffset(0, 12, 4, 28);
            }

            // 1. 全局总开关控制 (Switch Card: 96px)
            BuildSwitchCard(contentArea);
            BuildDefenseHintCard(contentArea);
            BuildBattleCardHintCard(contentArea);
            BuildMegathDamageHintCard(contentArea);
            BuildPlayerCombatHudCard(contentArea);

            // 2. 目标与拖动卡预览 (Target & Preview Card: 180px)
            BuildTargetCard(contentArea);

            BuildMonsterTargetCard(contentArea);

            // 3. 局内战斗浮字样式 (Style Card: 200px)
            BuildStyleCard(contentArea);

            // 4. 计算口径与说明 (Info Card: 110px)
            BuildInfoCard(contentArea);

            // 初始状态同步
            UpdateSync(force: true);
        }

        private void BuildDefenseHintCard(GameObject parent)
        {
            GameObject card = CreateCardContainer(parent, "DefenseHintCard", 110f);
            var title = XingShuUIFactory.CreateText(card, "Title", "防御点数提示", 18, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            title.rectTransform.anchorMin = title.rectTransform.anchorMax = new Vector2(0f, 1f);
            title.rectTransform.pivot = new Vector2(0f, 1f);
            title.rectTransform.anchoredPosition = new Vector2(20f, -12f);
            title.rectTransform.sizeDelta = new Vector2(450f, 28f);
            var desc = XingShuUIFactory.CreateText(card, "Description", "本人防御时显示压至最低伤害、避免击飞所需的总防御和骰点。\n含已同步防御牌；数值未完全揭示时按保守上限估算，不代替操作。", 13, XingShuUITheme.SecondaryText, TextAnchor.UpperLeft);
            desc.rectTransform.anchorMin = new Vector2(0f, 0f);
            desc.rectTransform.anchorMax = Vector2.one;
            desc.rectTransform.offsetMin = new Vector2(20f, 8f);
            desc.rectTransform.offsetMax = new Vector2(-20f, -52f);
            _defenseHintToggle = XingShuUIFactory.CreateToggle(card, "EnableDefenseHint", "显示提示", DefensePointHint.IsEnabled,
                value => { if (!_suppressCallbacks) DefensePointHint.SetEnabled(value); });
            var rt = _defenseHintToggle.GetComponent<RectTransform>();
            rt.anchorMin = rt.anchorMax = new Vector2(1f, 1f);
            rt.pivot = new Vector2(1f, 1f);
            rt.anchoredPosition = new Vector2(-20f, -12f);
            rt.sizeDelta = new Vector2(160f, 32f);
            card.SetActive(XingShuRuntime.Core.LauncherModules.CanLoad("DefensePointHint"));
        }

        private void BuildBattleCardHintCard(GameObject parent)
        {
            GameObject card = CreateCardContainer(parent, "BattleCardPointHintCard", 278f);
            var title = XingShuUIFactory.CreateText(card, "Title", "战斗卡牌点数提示", 17, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            title.rectTransform.anchorMin = title.rectTransform.anchorMax = new Vector2(0f, 1f);
            title.rectTransform.pivot = new Vector2(0f, 1f);
            title.rectTransform.anchoredPosition = new Vector2(20f, -12f);
            title.rectTransform.sizeDelta = new Vector2(450f, 26f);

            var desc = XingShuUIFactory.CreateText(card, "Description", "战斗时显示攻防双方卡牌与点数明细；未锁定时可在局内直接拖动调整位置", 12, XingShuUITheme.SecondaryText, TextAnchor.MiddleLeft);
            desc.rectTransform.anchorMin = new Vector2(0f, 1f);
            desc.rectTransform.anchorMax = new Vector2(1f, 1f);
            desc.rectTransform.pivot = new Vector2(0.5f, 1f);
            desc.rectTransform.anchoredPosition = new Vector2(0f, -38f);
            desc.rectTransform.sizeDelta = new Vector2(-40f, 20f);

            _battleCardHintToggle = XingShuUIFactory.CreateToggle(card, "EnableBattleCardHint", "显示点数", BattleCardPointHint.IsEnabled,
                value => { if (!_suppressCallbacks) BattleCardPointHint.SetEnabled(value); });
            var rt = _battleCardHintToggle.GetComponent<RectTransform>();
            rt.anchorMin = rt.anchorMax = new Vector2(1f, 1f);
            rt.pivot = new Vector2(1f, 1f);
            rt.anchoredPosition = new Vector2(-20f, -10f);
            rt.sizeDelta = new Vector2(165f, 34f);

            _battleCardLockToggle = XingShuUIFactory.CreateToggle(card, "BattleCardLockToggle", "锁定位置（禁止拖动）", BattleCardPointHint.Locked,
                value => { if (!_suppressCallbacks) BattleCardPointHint.SetLocked(value); });
            var lockRt = _battleCardLockToggle.GetComponent<RectTransform>();
            lockRt.anchorMin = lockRt.anchorMax = new Vector2(0f, 1f);
            lockRt.pivot = new Vector2(0f, 1f);
            lockRt.anchoredPosition = new Vector2(20f, -64f);
            lockRt.sizeDelta = new Vector2(240f, 32f);

            Button resetBtn = CreateActionButton(card, "ResetBattleCardLayout", "恢复默认",
                () => { BattleCardPointHint.ResetLayout(); SyncBattleCardControls(); }, 104f, 30f, 12);
            var resetRt = resetBtn.GetComponent<RectTransform>();
            resetRt.anchorMin = resetRt.anchorMax = new Vector2(1f, 1f);
            resetRt.pivot = new Vector2(1f, 1f);
            resetRt.anchoredPosition = new Vector2(-20f, -64f);

            AddPercentSliderRow(card, "BattleCardScale", "显示大小（60%–180%）", 104f,
                XingShuConfigKeys.BattleCardPointScaleMin, XingShuConfigKeys.BattleCardPointScaleMax,
                BattleCardPointHint.Scale,
                v => { BattleCardPointHint.SetScale(Mathf.Round(v * 20f) / 20f); SyncBattleCardControls(); },
                out _battleCardScaleSlider, out _battleCardScaleText);

            AddPercentSliderRow(card, "BattleCardMarginX", "两侧水平边距（0%–45%）", 158f,
                0f, 0.45f, Mathf.Clamp(BattleCardPointHint.AtkX, 0f, 0.45f),
                v => { BattleCardPointHint.SetMirrorMarginX(v); SyncBattleCardControls(); },
                out _battleCardMarginXSlider, out _battleCardMarginXText);

            AddPercentSliderRow(card, "BattleCardY", "垂直位置 Y（上 → 下）", 212f,
                0f, 1f, BattleCardPointHint.AtkY,
                v => { BattleCardPointHint.SetUnifiedY(v); SyncBattleCardControls(); },
                out _battleCardYSlider, out _battleCardYText);

            card.SetActive(LauncherModules.CanLoad("BattleCardPointHint"));
        }

        private void BuildMegathDamageHintCard(GameObject parent)
        {
            GameObject card = CreateCardContainer(parent, "MegathDamageHintCard", 278f);
            var title = XingShuUIFactory.CreateText(card, "Title", "梅加斯伤害计算面板", 17, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            title.rectTransform.anchorMin = title.rectTransform.anchorMax = new Vector2(0f, 1f);
            title.rectTransform.pivot = new Vector2(0f, 1f);
            title.rectTransform.anchoredPosition = new Vector2(20f, -12f);
            title.rectTransform.sizeDelta = new Vector2(450f, 26f);

            var desc = XingShuUIFactory.CreateText(card, "Description", "仅游玩梅加斯时显示主动技能「轨道轰炸」理论最大伤害；未锁定时可在局内直接拖动", 12, XingShuUITheme.SecondaryText, TextAnchor.MiddleLeft);
            desc.rectTransform.anchorMin = new Vector2(0f, 1f);
            desc.rectTransform.anchorMax = new Vector2(1f, 1f);
            desc.rectTransform.pivot = new Vector2(0.5f, 1f);
            desc.rectTransform.anchoredPosition = new Vector2(0f, -38f);
            desc.rectTransform.sizeDelta = new Vector2(-40f, 20f);

            _megathEnabledToggle = XingShuUIFactory.CreateToggle(card, "EnableMegathHint", "显示面板", MegathSkillDamageHint.IsEnabled,
                value => { if (!_suppressCallbacks) MegathSkillDamageHint.SetEnabled(value); });
            var rt = _megathEnabledToggle.GetComponent<RectTransform>();
            rt.anchorMin = rt.anchorMax = new Vector2(1f, 1f);
            rt.pivot = new Vector2(1f, 1f);
            rt.anchoredPosition = new Vector2(-20f, -10f);
            rt.sizeDelta = new Vector2(165f, 34f);

            _megathLockToggle = XingShuUIFactory.CreateToggle(card, "MegathLockToggle", "锁定位置（禁止拖动）", MegathSkillDamageHint.Locked,
                value => { if (!_suppressCallbacks) MegathSkillDamageHint.SetLocked(value); });
            var lockRt = _megathLockToggle.GetComponent<RectTransform>();
            lockRt.anchorMin = lockRt.anchorMax = new Vector2(0f, 1f);
            lockRt.pivot = new Vector2(0f, 1f);
            lockRt.anchoredPosition = new Vector2(20f, -64f);
            lockRt.sizeDelta = new Vector2(240f, 32f);

            Button resetBtn = CreateActionButton(card, "ResetMegathLayout", "恢复默认",
                () => { MegathSkillDamageHint.ResetLayout(); SyncMegathControls(); }, 104f, 30f, 12);
            var resetRt = resetBtn.GetComponent<RectTransform>();
            resetRt.anchorMin = resetRt.anchorMax = new Vector2(1f, 1f);
            resetRt.pivot = new Vector2(1f, 1f);
            resetRt.anchoredPosition = new Vector2(-20f, -64f);

            AddPercentSliderRow(card, "MegathScale", "显示大小（60%–180%）", 104f,
                XingShuConfigKeys.MegathDamageHintScaleMin, XingShuConfigKeys.MegathDamageHintScaleMax,
                MegathSkillDamageHint.Scale,
                v => { MegathSkillDamageHint.SetScale(Mathf.Round(v * 20f) / 20f); SyncMegathControls(); },
                out _megathScaleSlider, out _megathScaleText);

            AddPercentSliderRow(card, "MegathX", "水平位置 X（左 → 右）", 158f,
                0f, 1f, MegathSkillDamageHint.PosX,
                v => { MegathSkillDamageHint.SetPosition(v, MegathSkillDamageHint.PosY); SyncMegathControls(); },
                out _megathXSlider, out _megathXText);

            AddPercentSliderRow(card, "MegathY", "垂直位置 Y（上 → 下）", 212f,
                0f, 1f, MegathSkillDamageHint.PosY,
                v => { MegathSkillDamageHint.SetPosition(MegathSkillDamageHint.PosX, v); SyncMegathControls(); },
                out _megathYSlider, out _megathYText);

            card.SetActive(LauncherModules.CanLoad("MegathSkillDamageHint"));
        }

        private void BuildPlayerCombatHudCard(GameObject parent)
        {
            GameObject card = CreateCardContainer(parent, "PlayerCombatStatusHudCard", 408f);
            var title = XingShuUIFactory.CreateText(card, "Title", "角色状态显示（头顶与头像栏）", 17, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            title.rectTransform.anchorMin = title.rectTransform.anchorMax = new Vector2(0f, 1f);
            title.rectTransform.pivot = new Vector2(0f, 1f);
            title.rectTransform.anchoredPosition = new Vector2(20f, -12f);
            title.rectTransform.sizeDelta = new Vector2(450f, 26f);

            var desc = XingShuUIFactory.CreateText(card, "Description", "角色头顶与怪物推演同层锁死不可拖动；左侧头像星级栏下方状态条可自由拖动及微调", 12, XingShuUITheme.SecondaryText, TextAnchor.MiddleLeft);
            desc.rectTransform.anchorMin = new Vector2(0f, 1f);
            desc.rectTransform.anchorMax = new Vector2(1f, 1f);
            desc.rectTransform.pivot = new Vector2(0.5f, 1f);
            desc.rectTransform.anchoredPosition = new Vector2(0f, -38f);
            desc.rectTransform.sizeDelta = new Vector2(-40f, 20f);

            _playerHudEnabledToggle = XingShuUIFactory.CreateToggle(card, "EnablePlayerCombatHud", "显示状态", PlayerCombatStatusHud.IsEnabled,
                value => { if (!_suppressCallbacks) PlayerCombatStatusHud.SetEnabled(value); });
            var rt = _playerHudEnabledToggle.GetComponent<RectTransform>();
            rt.anchorMin = rt.anchorMax = new Vector2(1f, 1f);
            rt.pivot = new Vector2(1f, 1f);
            rt.anchoredPosition = new Vector2(-20f, -10f);
            rt.sizeDelta = new Vector2(165f, 34f);

            _playerHudHeadToggle = XingShuUIFactory.CreateToggle(card, "PlayerHudHeadToggle", "棋盘头顶(锁)", PlayerCombatStatusHud.ShowHead,
                value => { if (!_suppressCallbacks) PlayerCombatStatusHud.SetShowHead(value); });
            var headRt = _playerHudHeadToggle.GetComponent<RectTransform>();
            headRt.anchorMin = headRt.anchorMax = new Vector2(0f, 1f);
            headRt.pivot = new Vector2(0f, 1f);
            headRt.anchoredPosition = new Vector2(20f, -64f);
            headRt.sizeDelta = new Vector2(140f, 30f);

            _playerHudAvatarToggle = XingShuUIFactory.CreateToggle(card, "PlayerHudAvatarToggle", "头像下方栏", PlayerCombatStatusHud.ShowAvatar,
                value => { if (!_suppressCallbacks) PlayerCombatStatusHud.SetShowAvatar(value); });
            var avRt = _playerHudAvatarToggle.GetComponent<RectTransform>();
            avRt.anchorMin = avRt.anchorMax = new Vector2(0f, 1f);
            avRt.pivot = new Vector2(0f, 1f);
            avRt.anchoredPosition = new Vector2(168f, -64f);
            avRt.sizeDelta = new Vector2(138f, 30f);

            _playerHudLockToggle = XingShuUIFactory.CreateToggle(card, "PlayerHudLockToggle", "锁定头像栏", PlayerCombatStatusHud.Locked,
                value => { if (!_suppressCallbacks) PlayerCombatStatusHud.SetLocked(value); });
            var lockRt = _playerHudLockToggle.GetComponent<RectTransform>();
            lockRt.anchorMin = lockRt.anchorMax = new Vector2(0f, 1f);
            lockRt.pivot = new Vector2(0f, 1f);
            lockRt.anchoredPosition = new Vector2(314f, -64f);
            lockRt.sizeDelta = new Vector2(138f, 30f);

            Button resetBtn = CreateActionButton(card, "ResetPlayerHudLayout", "恢复默认",
                () => { PlayerCombatStatusHud.ResetLayout(); SyncPlayerCombatHudControls(); }, 104f, 30f, 12);
            var resetRt = resetBtn.GetComponent<RectTransform>();
            resetRt.anchorMin = resetRt.anchorMax = new Vector2(1f, 1f);
            resetRt.pivot = new Vector2(1f, 1f);
            resetRt.anchoredPosition = new Vector2(-20f, -64f);

            _playerHudCdToggle = XingShuUIFactory.CreateToggle(card, "PlayerHudCdToggle", "冷却 CD", PlayerCombatStatusHud.ShowCd,
                value => { if (!_suppressCallbacks) PlayerCombatStatusHud.SetShowCd(value); });
            var cdRt = _playerHudCdToggle.GetComponent<RectTransform>();
            cdRt.anchorMin = cdRt.anchorMax = new Vector2(0f, 1f);
            cdRt.pivot = new Vector2(0f, 1f);
            cdRt.anchoredPosition = new Vector2(20f, -102f);
            cdRt.sizeDelta = new Vector2(128f, 30f);

            _playerHudHpToggle = XingShuUIFactory.CreateToggle(card, "PlayerHudHpToggle", "头顶 HP", PlayerCombatStatusHud.ShowHp,
                value => { if (!_suppressCallbacks) PlayerCombatStatusHud.SetShowHp(value); });
            var hpRt = _playerHudHpToggle.GetComponent<RectTransform>();
            hpRt.anchorMin = hpRt.anchorMax = new Vector2(0f, 1f);
            hpRt.pivot = new Vector2(0f, 1f);
            hpRt.anchoredPosition = new Vector2(158f, -102f);
            hpRt.sizeDelta = new Vector2(128f, 30f);

            _playerHudAtkDefToggle = XingShuUIFactory.CreateToggle(card, "PlayerHudAtkDefToggle", "基础攻防", PlayerCombatStatusHud.ShowAtkDef,
                value => { if (!_suppressCallbacks) PlayerCombatStatusHud.SetShowAtkDef(value); });
            var adRt = _playerHudAtkDefToggle.GetComponent<RectTransform>();
            adRt.anchorMin = adRt.anchorMax = new Vector2(0f, 1f);
            adRt.pivot = new Vector2(0f, 1f);
            adRt.anchoredPosition = new Vector2(296f, -102f);
            adRt.sizeDelta = new Vector2(140f, 30f);

            AddPercentSliderRow(card, "PlayerHudScale", "显示大小（60%–180%）", 142f,
                XingShuConfigKeys.PlayerCombatHudScaleMin, XingShuConfigKeys.PlayerCombatHudScaleMax,
                PlayerCombatStatusHud.Scale,
                v => { PlayerCombatStatusHud.SetScale(Mathf.Round(v * 20f) / 20f); SyncPlayerCombatHudControls(); },
                out _playerHudScaleSlider, out _playerHudScaleText);

            AddSliderRow(card, "PlayerHudOffX", "头像栏水平偏移 X（-160–160 px）", 198f,
                XingShuConfigKeys.PlayerCombatHudOffsetXMin, XingShuConfigKeys.PlayerCombatHudOffsetXMax,
                PlayerCombatStatusHud.OffsetX, $"{Mathf.RoundToInt(PlayerCombatStatusHud.OffsetX)} px",
                v => { PlayerCombatStatusHud.SetOffset(Mathf.Round(v), PlayerCombatStatusHud.OffsetY); SyncPlayerCombatHudControls(); },
                out _playerHudOffXSlider, out _playerHudOffXText);

            AddSliderRow(card, "PlayerHudOffY", "头像栏垂直偏移 Y（-160–160 px）", 254f,
                XingShuConfigKeys.PlayerCombatHudOffsetYMin, XingShuConfigKeys.PlayerCombatHudOffsetYMax,
                PlayerCombatStatusHud.OffsetY, $"{Mathf.RoundToInt(PlayerCombatStatusHud.OffsetY)} px",
                v => { PlayerCombatStatusHud.SetOffset(PlayerCombatStatusHud.OffsetX, Mathf.Round(v)); SyncPlayerCombatHudControls(); },
                out _playerHudOffYSlider, out _playerHudOffYText);

            AddSliderRow(card, "PlayerHudHeadOffY", "棋盘头顶高度偏移 Y（-120–120 px）", 310f,
                XingShuConfigKeys.PlayerCombatHudHeadOffsetYMin, XingShuConfigKeys.PlayerCombatHudHeadOffsetYMax,
                PlayerCombatStatusHud.HeadOffsetY, $"{Mathf.RoundToInt(PlayerCombatStatusHud.HeadOffsetY)} px",
                v => { PlayerCombatStatusHud.SetHeadOffsetY(Mathf.Round(v)); SyncPlayerCombatHudControls(); },
                out _playerHudHeadOffYSlider, out _playerHudHeadOffYText);

            card.SetActive(LauncherModules.CanLoad("PlayerCombatStatusHud"));
        }

        private void AddPercentSliderRow(GameObject card, string id, string labelText, float topY, float min, float max, float initial,
            UnityEngine.Events.UnityAction<float> onChanged, out Slider slider, out Text valueText)
        {
            AddSliderRow(card, id, labelText, topY, min, max, initial, $"{Mathf.RoundToInt(initial * 100f)}%", onChanged, out slider, out valueText);
        }

        private void AddSliderRow(GameObject card, string id, string labelText, float topY, float min, float max, float initial, string initialValueText,
            UnityEngine.Events.UnityAction<float> onChanged, out Slider slider, out Text valueText)
        {
            GameObject pair = XingShuUIFactory.CreateUIObject("MetricPair_" + id, card);
            var pRt = pair.GetComponent<RectTransform>();
            pRt.anchorMin = new Vector2(0f, 1f);
            pRt.anchorMax = new Vector2(1f, 1f);
            pRt.pivot = new Vector2(0.5f, 1f);
            pRt.anchoredPosition = new Vector2(0f, -topY);
            pRt.sizeDelta = new Vector2(-40f, 22f);
            var hlg = pair.AddComponent<HorizontalLayoutGroup>();
            hlg.spacing = 8f;
            hlg.childControlWidth = true;
            hlg.childControlHeight = true;
            hlg.childForceExpandWidth = false;
            hlg.childForceExpandHeight = true;

            Text lbl = XingShuUIFactory.CreateText(pair, id + "Label", labelText, 12, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft);
            var lblLe = lbl.gameObject.AddComponent<LayoutElement>();
            lblLe.flexibleWidth = 1f;
            lblLe.minWidth = 140f;

            valueText = XingShuUIFactory.CreateText(pair, id + "Value", initialValueText, 12, XingShuUITheme.NumericAccent, TextAnchor.MiddleRight, FontStyle.Bold);
            var valLe = valueText.gameObject.AddComponent<LayoutElement>();
            valLe.minWidth = 60f;
            valLe.preferredWidth = 72f;
            valLe.flexibleWidth = 0f;

            slider = XingShuUIFactory.CreateSlider(card, id + "Slider", min, max, initial,
                v => { if (!_suppressCallbacks) onChanged(v); });
            var sRt = slider.GetComponent<RectTransform>();
            sRt.anchorMin = new Vector2(0f, 1f);
            sRt.anchorMax = new Vector2(1f, 1f);
            sRt.pivot = new Vector2(0.5f, 1f);
            sRt.anchoredPosition = new Vector2(0f, -(topY + 24f));
            sRt.sizeDelta = new Vector2(-40f, 26f);
        }

        private void SyncMegathControls()
        {
            float scale = MegathSkillDamageHint.Scale;
            float px = MegathSkillDamageHint.PosX;
            float py = MegathSkillDamageHint.PosY;
            bool locked = MegathSkillDamageHint.Locked;
            _suppressCallbacks = true;
            if (_megathEnabledToggle != null && _megathEnabledToggle.isOn != MegathSkillDamageHint.IsEnabled)
                _megathEnabledToggle.isOn = MegathSkillDamageHint.IsEnabled;
            if (_megathScaleSlider != null && Mathf.Abs(_megathScaleSlider.value - scale) > 0.005f)
                _megathScaleSlider.value = scale;
            if (_megathXSlider != null && Mathf.Abs(_megathXSlider.value - px) > 0.005f)
                _megathXSlider.value = px;
            if (_megathYSlider != null && Mathf.Abs(_megathYSlider.value - py) > 0.005f)
                _megathYSlider.value = py;
            if (_megathLockToggle != null && _megathLockToggle.isOn != locked)
                _megathLockToggle.isOn = locked;
            _suppressCallbacks = false;
            if (_megathScaleText != null) _megathScaleText.text = $"{Mathf.RoundToInt(scale * 100f)}%";
            if (_megathXText != null) _megathXText.text = $"{Mathf.RoundToInt(px * 100f)}%";
            if (_megathYText != null) _megathYText.text = $"{Mathf.RoundToInt(py * 100f)}%";
        }

        private void SyncPlayerCombatHudControls()
        {
            float scale = PlayerCombatStatusHud.Scale;
            float offX = PlayerCombatStatusHud.OffsetX;
            float offY = PlayerCombatStatusHud.OffsetY;
            float headOffY = PlayerCombatStatusHud.HeadOffsetY;
            bool locked = PlayerCombatStatusHud.Locked;
            _suppressCallbacks = true;
            if (_playerHudEnabledToggle != null && _playerHudEnabledToggle.isOn != PlayerCombatStatusHud.IsEnabled)
                _playerHudEnabledToggle.isOn = PlayerCombatStatusHud.IsEnabled;
            if (_playerHudHeadToggle != null && _playerHudHeadToggle.isOn != PlayerCombatStatusHud.ShowHead)
                _playerHudHeadToggle.isOn = PlayerCombatStatusHud.ShowHead;
            if (_playerHudAvatarToggle != null && _playerHudAvatarToggle.isOn != PlayerCombatStatusHud.ShowAvatar)
                _playerHudAvatarToggle.isOn = PlayerCombatStatusHud.ShowAvatar;
            if (_playerHudScaleSlider != null && Mathf.Abs(_playerHudScaleSlider.value - scale) > 0.005f)
                _playerHudScaleSlider.value = scale;
            if (_playerHudOffXSlider != null && Mathf.Abs(_playerHudOffXSlider.value - offX) > 0.5f)
                _playerHudOffXSlider.value = offX;
            if (_playerHudOffYSlider != null && Mathf.Abs(_playerHudOffYSlider.value - offY) > 0.5f)
                _playerHudOffYSlider.value = offY;
            if (_playerHudHeadOffYSlider != null && Mathf.Abs(_playerHudHeadOffYSlider.value - headOffY) > 0.5f)
                _playerHudHeadOffYSlider.value = headOffY;
            if (_playerHudLockToggle != null && _playerHudLockToggle.isOn != locked)
                _playerHudLockToggle.isOn = locked;
            if (_playerHudCdToggle != null && _playerHudCdToggle.isOn != PlayerCombatStatusHud.ShowCd)
                _playerHudCdToggle.isOn = PlayerCombatStatusHud.ShowCd;
            if (_playerHudHpToggle != null && _playerHudHpToggle.isOn != PlayerCombatStatusHud.ShowHp)
                _playerHudHpToggle.isOn = PlayerCombatStatusHud.ShowHp;
            if (_playerHudAtkDefToggle != null && _playerHudAtkDefToggle.isOn != PlayerCombatStatusHud.ShowAtkDef)
                _playerHudAtkDefToggle.isOn = PlayerCombatStatusHud.ShowAtkDef;
            _suppressCallbacks = false;
            if (_playerHudScaleText != null) _playerHudScaleText.text = $"{Mathf.RoundToInt(scale * 100f)}%";
            if (_playerHudOffXText != null) _playerHudOffXText.text = $"{Mathf.RoundToInt(offX)} px";
            if (_playerHudOffYText != null) _playerHudOffYText.text = $"{Mathf.RoundToInt(offY)} px";
            if (_playerHudHeadOffYText != null) _playerHudHeadOffYText.text = $"{Mathf.RoundToInt(headOffY)} px";
        }

        private void SyncBattleCardControls()
        {
            float scale = BattleCardPointHint.Scale;
            float marginX = Mathf.Clamp(BattleCardPointHint.AtkX, 0f, 0.45f);
            float posY = BattleCardPointHint.AtkY;
            bool locked = BattleCardPointHint.Locked;
            _suppressCallbacks = true;
            if (_battleCardScaleSlider != null && Mathf.Abs(_battleCardScaleSlider.value - scale) > 0.005f)
                _battleCardScaleSlider.value = scale;
            if (_battleCardMarginXSlider != null && Mathf.Abs(_battleCardMarginXSlider.value - marginX) > 0.005f)
                _battleCardMarginXSlider.value = marginX;
            if (_battleCardYSlider != null && Mathf.Abs(_battleCardYSlider.value - posY) > 0.005f)
                _battleCardYSlider.value = posY;
            if (_battleCardLockToggle != null && _battleCardLockToggle.isOn != locked)
                _battleCardLockToggle.isOn = locked;
            _suppressCallbacks = false;
            if (_battleCardScaleText != null) _battleCardScaleText.text = $"{Mathf.RoundToInt(scale * 100f)}%";
            if (_battleCardMarginXText != null) _battleCardMarginXText.text = $"{Mathf.RoundToInt(BattleCardPointHint.AtkX * 100f)}%";
            if (_battleCardYText != null) _battleCardYText.text = $"{Mathf.RoundToInt(posY * 100f)}%";
        }

        private GameObject CreateCardContainer(GameObject parent, string name, float height)
        {
            GameObject cardGo = XingShuUIFactory.CreateUIObject(name, parent);
            LayoutElement le = cardGo.AddComponent<LayoutElement>();
            le.preferredHeight = height;
            le.minHeight = height;
            le.flexibleHeight = 0f;

            Sprite cardSprite = XingShuUIAssetService.GetSprite("card_base.png");
            Image cardBg = cardGo.AddComponent<Image>();
            cardBg.sprite = cardSprite;
            cardBg.type = Image.Type.Sliced;
            cardBg.color = XingShuUIAssetService.IsFallbackSprite(cardSprite) ? XingShuUITheme.Card : Color.white;

            return cardGo;
        }

        private Button CreateActionButton(GameObject parent, string name, string label, Action onClick, float width, float height, int fontSize = 13)
        {
            Sprite btnSec = XingShuUIAssetService.GetSprite("button_secondary.png");
            Button btn = XingShuUIFactory.CreateButton(
                parent,
                name,
                label,
                btnSec,
                Color.white,
                XingShuUITheme.PrimaryText,
                onClick,
                fontSize
            );
            RectTransform rt = btn.GetComponent<RectTransform>();
            rt.sizeDelta = new Vector2(width, height);
            return btn;
        }

        private void BuildSwitchCard(GameObject parent)
        {
            GameObject cardGo = CreateCardContainer(parent, "SwitchCard", 96f);

            Text cardTitle = XingShuUIFactory.CreateText(cardGo, "CardTitle", "击飞预测总开关", 16, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            RectTransform ctRt = cardTitle.rectTransform;
            ctRt.anchorMin = new Vector2(0f, 1f);
            ctRt.anchorMax = new Vector2(0f, 1f);
            ctRt.pivot = new Vector2(0f, 1f);
            ctRt.anchoredPosition = new Vector2(24f, -16f);
            ctRt.sizeDelta = new Vector2(200f, 24f);

            _statusText = XingShuUIFactory.CreateText(cardGo, "StatusText", "等待进入对局", 13, XingShuUITheme.SecondaryText, TextAnchor.MiddleLeft);
            RectTransform htRt = _statusText.rectTransform;
            htRt.anchorMin = new Vector2(0f, 0f);
            htRt.anchorMax = new Vector2(0f, 0f);
            htRt.pivot = new Vector2(0f, 0f);
            htRt.anchoredPosition = new Vector2(24f, 16f);
            htRt.sizeDelta = new Vector2(460f, 22f);

            _enableToggle = XingShuUIFactory.CreateToggle(cardGo, "EnableToggle", "预测功能", MonsterKillProbability.IsEnabled, OnEnableToggleChanged);
            RectTransform tgRt = _enableToggle.GetComponent<RectTransform>();
            tgRt.anchorMin = new Vector2(1f, 0.5f);
            tgRt.anchorMax = new Vector2(1f, 0.5f);
            tgRt.pivot = new Vector2(1f, 0.5f);
            tgRt.anchoredPosition = new Vector2(-24f, 0f);
            tgRt.sizeDelta = new Vector2(180f, 32f);
        }

        private void BuildMonsterTargetCard(GameObject parent)
        {
            GameObject card = CreateCardContainer(parent, "MonsterTargetCard", 264f);
            Text title = XingShuUIFactory.CreateText(card, "Title", "怪物索敌 · 最大10格", 16, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            PlaceTargetControl(title.rectTransform, new Vector2(24f, -16f), new Vector2(360f, 28f));
            _targetingToggle = XingShuUIFactory.CreateToggle(card, "TargetingToggle", "地图索敌", MonsterTargetRuntime.IsEnabled,
                value => { if (!_suppressCallbacks) MonsterTargetRuntime.SetEnabled(value); });
            RectTransform toggleRt = _targetingToggle.GetComponent<RectTransform>();
            toggleRt.anchorMin = toggleRt.anchorMax = toggleRt.pivot = new Vector2(1f, 1f);
            toggleRt.anchoredPosition = new Vector2(-24f, -16f);
            toggleRt.sizeDelta = new Vector2(160f, 32f);
            _arrowBoostToggle = XingShuUIFactory.CreateToggle(card, "ArrowBoostToggle", "放大怪物箭头", MonsterTargetRuntime.ArrowBoostEnabled,
                value => { if (!_suppressCallbacks) MonsterTargetRuntime.SetArrowBoostEnabled(value); });
            RectTransform boostRt = _arrowBoostToggle.GetComponent<RectTransform>();
            boostRt.anchorMin = boostRt.anchorMax = boostRt.pivot = new Vector2(1f, 1f);
            boostRt.anchoredPosition = new Vector2(-196f, -16f);
            boostRt.sizeDelta = new Vector2(180f, 32f);
            Text hint = XingShuUIFactory.CreateText(card, "Hint", "沿怪物箭头前进，不掉头；最大10格（先行1格＋剩余9格），技能加步暂不计入。", 12, XingShuUITheme.SecondaryText, TextAnchor.MiddleLeft);
            PlaceTargetControl(hint.rectTransform, new Vector2(24f, -52f), new Vector2(820f, 24f));
            _targetingSummary = XingShuUIFactory.CreateText(card, "Summary", "等待进入 PVE 对局", 13, XingShuUITheme.PrimaryText, TextAnchor.UpperLeft);
            _targetingSummary.supportRichText = false;
            PlaceTargetControl(_targetingSummary.rectTransform, new Vector2(24f, -86f), new Vector2(820f, 116f));
            Button previous = CreateActionButton(card, "PreviousMonster", "◀ 上个怪物", () => MonsterTargetRuntime.Select(-1), 132f, 30f);
            Button next = CreateActionButton(card, "NextMonster", "下个怪物 ▶", () => MonsterTargetRuntime.Select(1), 132f, 30f);
            PlaceTargetControl(previous.GetComponent<RectTransform>(), new Vector2(24f, -218f), new Vector2(132f, 30f));
            PlaceTargetControl(next.GetComponent<RectTransform>(), new Vector2(172f, -218f), new Vector2(132f, 30f));
        }

        private static void PlaceTargetControl(RectTransform rt, Vector2 position, Vector2 size)
        {
            rt.anchorMin = rt.anchorMax = rt.pivot = new Vector2(0f, 1f);
            rt.anchoredPosition = position;
            rt.sizeDelta = size;
        }

        private void BuildTargetCard(GameObject parent)
        {
            GameObject cardGo = CreateCardContainer(parent, "TargetCard", 180f);

            Text cardTitle = XingShuUIFactory.CreateText(cardGo, "CardTitle", "战局目标与卡牌预览", 16, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            RectTransform ctRt = cardTitle.rectTransform;
            ctRt.anchorMin = new Vector2(0f, 1f);
            ctRt.anchorMax = new Vector2(0f, 1f);
            ctRt.pivot = new Vector2(0f, 1f);
            ctRt.anchoredPosition = new Vector2(24f, -16f);
            ctRt.sizeDelta = new Vector2(200f, 24f);

            _previewBtn = CreateActionButton(cardGo, "Btn_PreviewToggle", "拖动卡预览：开", OnPreviewToggleClicked, 140f, 30f, 12);
            RectTransform prevRt = _previewBtn.GetComponent<RectTransform>();
            prevRt.anchorMin = new Vector2(1f, 1f);
            prevRt.anchorMax = new Vector2(1f, 1f);
            prevRt.pivot = new Vector2(1f, 1f);
            prevRt.anchoredPosition = new Vector2(-24f, -12f);
            _previewBtnText = _previewBtn.GetComponentInChildren<Text>();

            _targetSummaryText = XingShuUIFactory.CreateText(cardGo, "TargetSummary", "当前无交战或可见怪物目标", 13, XingShuUITheme.PrimaryText, TextAnchor.UpperLeft);
            RectTransform sumRt = _targetSummaryText.rectTransform;
            sumRt.anchorMin = new Vector2(0f, 1f);
            sumRt.anchorMax = new Vector2(1f, 1f);
            sumRt.pivot = new Vector2(0f, 1f);
            sumRt.anchoredPosition = new Vector2(24f, -50f);
            sumRt.sizeDelta = new Vector2(-48f, 75f);
            _targetSummaryText.lineSpacing = 1.15f;

            float btnW = 120f;
            float btnH = 30f;
            float startX = 24f;
            float gap = 12f;

            _prevTargetBtn = CreateActionButton(cardGo, "Btn_PrevTarget", "◀ 上个目标", OnPrevTargetClicked, btnW, btnH, 12);
            RectTransform ptRt = _prevTargetBtn.GetComponent<RectTransform>();
            ptRt.anchorMin = new Vector2(0f, 0f);
            ptRt.anchorMax = new Vector2(0f, 0f);
            ptRt.pivot = new Vector2(0f, 0f);
            ptRt.anchoredPosition = new Vector2(startX, 14f);

            _detailPageBtn = CreateActionButton(cardGo, "Btn_DetailPage", "详情翻页", OnDetailPageClicked, btnW, btnH, 12);
            RectTransform dpRt = _detailPageBtn.GetComponent<RectTransform>();
            dpRt.anchorMin = new Vector2(0f, 0f);
            dpRt.anchorMax = new Vector2(0f, 0f);
            dpRt.pivot = new Vector2(0f, 0f);
            dpRt.anchoredPosition = new Vector2(startX + btnW + gap, 14f);

            _nextTargetBtn = CreateActionButton(cardGo, "Btn_NextTarget", "下个目标 ▶", OnNextTargetClicked, btnW, btnH, 12);
            RectTransform ntRt = _nextTargetBtn.GetComponent<RectTransform>();
            ntRt.anchorMin = new Vector2(0f, 0f);
            ntRt.anchorMax = new Vector2(0f, 0f);
            ntRt.pivot = new Vector2(0f, 0f);
            ntRt.anchoredPosition = new Vector2(startX + (btnW + gap) * 2, 14f);
        }

        private void BuildStyleCard(GameObject parent)
        {
            GameObject cardGo = CreateCardContainer(parent, "StyleCard", 376f);

            Text cardTitle = XingShuUIFactory.CreateText(cardGo, "CardTitle", "局内战斗浮字外观", 16, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            RectTransform ctRt = cardTitle.rectTransform;
            ctRt.anchorMin = new Vector2(0f, 1f);
            ctRt.anchorMax = new Vector2(0f, 1f);
            ctRt.pivot = new Vector2(0f, 1f);
            ctRt.anchoredPosition = new Vector2(24f, -16f);
            ctRt.sizeDelta = new Vector2(200f, 24f);

            _styleSummaryText = XingShuUIFactory.CreateText(cardGo, "StyleSummary", "当前样式：字号 26  |  X: 50  |  Y: -32", 13, XingShuUITheme.NumericAccent, TextAnchor.MiddleRight, FontStyle.Bold);
            RectTransform stRt = _styleSummaryText.rectTransform;
            stRt.anchorMin = new Vector2(1f, 1f);
            stRt.anchorMax = new Vector2(1f, 1f);
            stRt.pivot = new Vector2(1f, 1f);
            stRt.anchoredPosition = new Vector2(-24f, -16f);
            stRt.sizeDelta = new Vector2(340f, 24f);

            // Miniature Multi Live Preview Box
            GameObject previewBox = XingShuUIFactory.CreateUIObject("LivePreviewBox", cardGo);
            RectTransform pbRt = previewBox.GetComponent<RectTransform>();
            pbRt.anchorMin = new Vector2(0f, 1f);
            pbRt.anchorMax = new Vector2(1f, 1f);
            pbRt.pivot = new Vector2(0f, 1f);
            pbRt.anchoredPosition = new Vector2(24f, -44f);
            pbRt.sizeDelta = new Vector2(-48f, 58f);

            Sprite pbSprite = XingShuUIAssetService.GetSprite("button_secondary.png");
            Image pbBg = previewBox.AddComponent<Image>();
            pbBg.sprite = pbSprite ?? XingShuUIAssetService.WhiteSprite;
            pbBg.type = (pbSprite != null && pbSprite.border != Vector4.zero) ? Image.Type.Sliced : Image.Type.Simple;
            pbBg.color = new Color(0.10f, 0.13f, 0.18f, 0.90f);

            _previewLine1Text = XingShuUIFactory.CreateText(previewBox, "PreviewLine1", "", 20, Color.white, TextAnchor.MiddleLeft, FontStyle.Bold, HorizontalWrapMode.Overflow, VerticalWrapMode.Overflow);
            _previewLine1Text.supportRichText = true;
            RectTransform l1Rt = _previewLine1Text.rectTransform;
            l1Rt.anchorMin = new Vector2(0f, 1f);
            l1Rt.anchorMax = new Vector2(1f, 1f);
            l1Rt.pivot = new Vector2(0f, 1f);
            l1Rt.anchoredPosition = new Vector2(14f, -6f);
            l1Rt.sizeDelta = new Vector2(-28f, 22f);

            _previewLine2Text = XingShuUIFactory.CreateText(previewBox, "PreviewLine2", "", 20, Color.white, TextAnchor.MiddleLeft, FontStyle.Bold, HorizontalWrapMode.Overflow, VerticalWrapMode.Overflow);
            _previewLine2Text.supportRichText = true;
            RectTransform l2Rt = _previewLine2Text.rectTransform;
            l2Rt.anchorMin = new Vector2(0f, 1f);
            l2Rt.anchorMax = new Vector2(1f, 1f);
            l2Rt.pivot = new Vector2(0f, 1f);
            l2Rt.anchoredPosition = new Vector2(14f, -30f);
            l2Rt.sizeDelta = new Vector2(-28f, 22f);

            float bW = 150f;
            float bH = 28f;
            float startX = 24f;
            float col2X = startX + bW + 16f;

            // Row 1: Font Size (-2 / +2)
            _fontMinusBtn = CreateActionButton(cardGo, "Btn_FontMinus", "字号 −2", delegate { MonsterKillProbability.AdjustStyle(-2, 0f, 0f); UpdateSync(force: true); }, bW, bH, 12);
            RectTransform fmRt = _fontMinusBtn.GetComponent<RectTransform>();
            fmRt.anchorMin = new Vector2(0f, 1f);
            fmRt.anchorMax = new Vector2(0f, 1f);
            fmRt.pivot = new Vector2(0f, 1f);
            fmRt.anchoredPosition = new Vector2(startX, -112f);

            _fontPlusBtn = CreateActionButton(cardGo, "Btn_FontPlus", "字号 +2", delegate { MonsterKillProbability.AdjustStyle(2, 0f, 0f); UpdateSync(force: true); }, bW, bH, 12);
            RectTransform fpRt = _fontPlusBtn.GetComponent<RectTransform>();
            fpRt.anchorMin = new Vector2(0f, 1f);
            fpRt.anchorMax = new Vector2(0f, 1f);
            fpRt.pivot = new Vector2(0f, 1f);
            fpRt.anchoredPosition = new Vector2(col2X, -112f);

            // Row 2: X Offset (-10 / +10)
            _xLeftBtn = CreateActionButton(cardGo, "Btn_XLeft", "◀ 左移 10", delegate { MonsterKillProbability.AdjustStyle(0, -10f, 0f); UpdateSync(force: true); }, bW, bH, 12);
            RectTransform xlRt = _xLeftBtn.GetComponent<RectTransform>();
            xlRt.anchorMin = new Vector2(0f, 1f);
            xlRt.anchorMax = new Vector2(0f, 1f);
            xlRt.pivot = new Vector2(0f, 1f);
            xlRt.anchoredPosition = new Vector2(startX, -146f);

            _xRightBtn = CreateActionButton(cardGo, "Btn_XRight", "右移 10 ▶", delegate { MonsterKillProbability.AdjustStyle(0, 10f, 0f); UpdateSync(force: true); }, bW, bH, 12);
            RectTransform xrRt = _xRightBtn.GetComponent<RectTransform>();
            xrRt.anchorMin = new Vector2(0f, 1f);
            xrRt.anchorMax = new Vector2(0f, 1f);
            xrRt.pivot = new Vector2(0f, 1f);
            xrRt.anchoredPosition = new Vector2(col2X, -146f);

            // Row 3: Y Offset (-10 / +10)
            _yUpBtn = CreateActionButton(cardGo, "Btn_YUp", "▲ 上移 10", delegate { MonsterKillProbability.AdjustStyle(0, 0f, -10f); UpdateSync(force: true); }, bW, bH, 12);
            RectTransform yuRt = _yUpBtn.GetComponent<RectTransform>();
            yuRt.anchorMin = new Vector2(0f, 1f);
            yuRt.anchorMax = new Vector2(0f, 1f);
            yuRt.pivot = new Vector2(0f, 1f);
            yuRt.anchoredPosition = new Vector2(startX, -180f);

            _yDownBtn = CreateActionButton(cardGo, "Btn_YDown", "下移 10 ▼", delegate { MonsterKillProbability.AdjustStyle(0, 0f, 10f); UpdateSync(force: true); }, bW, bH, 12);
            RectTransform ydRt = _yDownBtn.GetComponent<RectTransform>();
            ydRt.anchorMin = new Vector2(0f, 1f);
            ydRt.anchorMax = new Vector2(0f, 1f);
            ydRt.pivot = new Vector2(0f, 1f);
            ydRt.anchoredPosition = new Vector2(col2X, -180f);

            // Row 4: Mode Selection & 100% Rainbow Highlight
            Text modeLbl = XingShuUIFactory.CreateText(cardGo, "Mode_Label", "概率颜色模式", 13, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft);
            RectTransform mlRt = modeLbl.rectTransform;
            mlRt.anchorMin = new Vector2(0f, 1f);
            mlRt.anchorMax = new Vector2(0f, 1f);
            mlRt.pivot = new Vector2(0f, 1f);
            mlRt.anchoredPosition = new Vector2(startX, -216f);
            mlRt.sizeDelta = new Vector2(80f, 28f);

            _autoColorBtn = CreateActionButton(cardGo, "Btn_AutoColor", "自动分段", delegate
            {
                MonsterKillProbability.AutoColorEnabled = true;
                UpdateSync(force: true);
            }, 84f, 28f, 12);
            _autoColorBtnText = _autoColorBtn.GetComponentInChildren<Text>();
            RectTransform acRt = _autoColorBtn.GetComponent<RectTransform>();
            acRt.anchorMin = new Vector2(0f, 1f);
            acRt.anchorMax = new Vector2(0f, 1f);
            acRt.pivot = new Vector2(0f, 1f);
            acRt.anchoredPosition = new Vector2(108f, -216f);

            _manualColorBtn = CreateActionButton(cardGo, "Btn_ManualColor", "手动", delegate
            {
                MonsterKillProbability.AutoColorEnabled = false;
                UpdateSync(force: true);
            }, 64f, 28f, 12);
            _manualColorBtnText = _manualColorBtn.GetComponentInChildren<Text>();
            RectTransform mcRt = _manualColorBtn.GetComponent<RectTransform>();
            mcRt.anchorMin = new Vector2(0f, 1f);
            mcRt.anchorMax = new Vector2(0f, 1f);
            mcRt.pivot = new Vector2(0f, 1f);
            mcRt.anchoredPosition = new Vector2(198f, -216f);

            _rainbow100Btn = CreateActionButton(cardGo, "Btn_Rainbow100", "100%炫彩高亮：关", delegate
            {
                MonsterKillProbability.Rainbow100Enabled = !MonsterKillProbability.Rainbow100Enabled;
                UpdateSync(force: true);
            }, 160f, 28f, 12);
            _rainbow100BtnText = _rainbow100Btn.GetComponentInChildren<Text>();
            RectTransform rbRt = _rainbow100Btn.GetComponent<RectTransform>();
            rbRt.anchorMin = new Vector2(0f, 1f);
            rbRt.anchorMax = new Vector2(0f, 1f);
            rbRt.pivot = new Vector2(0f, 1f);
            rbRt.anchoredPosition = new Vector2(268f, -216f);

            // Row 5: Probability Color (Manual)
            CreateColorRow(
                cardGo,
                "ProbColor",
                "手动概率色",
                -252f,
                MonsterKillProbability.ProbabilityColorHex,
                out _probColorInput,
                out _probColorSwatch,
                out _probColorErrorText,
                delegate(string hex)
                {
                    MonsterKillProbability.SetProbabilityColor(hex);
                    MonsterKillProbability.AutoColorEnabled = false;
                }
            );

            // Row 6: Target Color (Fixed Name)
            CreateColorRow(
                cardGo,
                "TargetColor",
                "目标名字颜色",
                -288f,
                MonsterKillProbability.TargetColorHex,
                out _targetColorInput,
                out _targetColorSwatch,
                out _targetColorErrorText,
                delegate(string hex) { MonsterKillProbability.SetTargetColor(hex); }
            );

            // Row 7: Reset Button
            _resetStyleBtn = CreateActionButton(cardGo, "Btn_ResetStyle", "恢复默认文字与颜色样式 (字号26/X:50/Y:-32/自动分段)", delegate
            {
                MonsterKillProbability.AdjustStyle(0, 0f, 0f, reset: true);
                if (_probColorErrorText != null) _probColorErrorText.text = "";
                if (_targetColorErrorText != null) _targetColorErrorText.text = "";
                UpdateSync(force: true);
            }, bW * 2 + 16f, 28f, 12);
            RectTransform rstRt = _resetStyleBtn.GetComponent<RectTransform>();
            rstRt.anchorMin = new Vector2(0f, 1f);
            rstRt.anchorMax = new Vector2(0f, 1f);
            rstRt.pivot = new Vector2(0f, 1f);
            rstRt.anchoredPosition = new Vector2(startX, -326f);
        }

        private void CreateColorRow(
            GameObject parent,
            string rowName,
            string labelTitle,
            float yPos,
            string initialHex,
            out InputField inputField,
            out Image swatchImg,
            out Text errorText,
            Action<string> onColorApplied)
        {
            // 1. Label
            Text label = XingShuUIFactory.CreateText(parent, rowName + "_Label", labelTitle, 13, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft);
            RectTransform lblRt = label.rectTransform;
            lblRt.anchorMin = new Vector2(0f, 1f);
            lblRt.anchorMax = new Vector2(0f, 1f);
            lblRt.pivot = new Vector2(0f, 1f);
            lblRt.anchoredPosition = new Vector2(24f, yPos);
            lblRt.sizeDelta = new Vector2(80f, 28f);

            // 2. Swatch Image
            GameObject swatchObj = XingShuUIFactory.CreateUIObject(rowName + "_Swatch", parent);
            RectTransform swatchRt = swatchObj.GetComponent<RectTransform>();
            swatchRt.anchorMin = new Vector2(0f, 1f);
            swatchRt.anchorMax = new Vector2(0f, 1f);
            swatchRt.pivot = new Vector2(0f, 1f);
            swatchRt.anchoredPosition = new Vector2(108f, yPos);
            swatchRt.sizeDelta = new Vector2(26f, 26f);

            Sprite swatchSprite = XingShuUIAssetService.GetSprite("hotkey_badge.png") ?? XingShuUIAssetService.WhiteSprite;
            swatchImg = swatchObj.AddComponent<Image>();
            swatchImg.sprite = swatchSprite;
            swatchImg.type = (swatchSprite != null && swatchSprite.border != Vector4.zero) ? Image.Type.Sliced : Image.Type.Simple;
            Color initCol;
            MonsterKillProbability.TryParseHexColor(initialHex, out initCol, out _);
            swatchImg.color = initCol;

            // 3. InputField
            inputField = XingShuUIFactory.CreateInputField(
                parent,
                rowName + "_Input",
                "#RRGGBB",
                initialHex,
                "Knockback." + rowName,
                null,
                null,
                12
            );
            RectTransform inputRt = inputField.GetComponent<RectTransform>();
            inputRt.anchorMin = new Vector2(0f, 1f);
            inputRt.anchorMax = new Vector2(0f, 1f);
            inputRt.pivot = new Vector2(0f, 1f);
            inputRt.anchoredPosition = new Vector2(142f, yPos);
            inputRt.sizeDelta = new Vector2(96f, 28f);

            InputField capturedInput = inputField;
            Image capturedSwatch = swatchImg;

            // 4. Preset Swatch Buttons
            var presets = new[]
            {
                new { Name = "金色", Hex = "#FFD85A", Col = new Color(1f, 0.847f, 0.353f, 1f) },
                new { Name = "白色", Hex = "#F4F7FF", Col = new Color(0.957f, 0.969f, 1f, 1f) },
                new { Name = "青色", Hex = "#38BDF8", Col = new Color(0.22f, 0.741f, 0.973f, 1f) },
                new { Name = "绿色", Hex = "#4ADE80", Col = new Color(0.29f, 0.871f, 0.502f, 1f) },
                new { Name = "红色", Hex = "#F87171", Col = new Color(0.973f, 0.443f, 0.443f, 1f) }
            };

            // 5. Error hint text
            errorText = XingShuUIFactory.CreateText(parent, rowName + "_Error", "", 11, XingShuUITheme.Danger, TextAnchor.MiddleLeft);
            RectTransform errRt = errorText.rectTransform;
            errRt.anchorMin = new Vector2(0f, 1f);
            errRt.anchorMax = new Vector2(0f, 1f);
            errRt.pivot = new Vector2(0f, 1f);
            errRt.anchoredPosition = new Vector2(504f, yPos);
            errRt.sizeDelta = new Vector2(180f, 28f);
            Text capturedErr = errorText;

            float pStartX = 246f;
            float pWidth = 46f;
            float pGap = 5f;
            for (int i = 0; i < presets.Length; i++)
            {
                var p = presets[i];
                Button pBtn = CreateActionButton(parent, $"{rowName}_Preset_{i}", p.Name, delegate
                {
                    capturedInput.text = p.Hex;
                    capturedSwatch.color = p.Col;
                    capturedErr.text = "";
                    onColorApplied(p.Hex);
                    UpdateSync(force: true);
                }, pWidth, 26f, 11);
                RectTransform pRt = pBtn.GetComponent<RectTransform>();
                pRt.anchorMin = new Vector2(0f, 1f);
                pRt.anchorMax = new Vector2(0f, 1f);
                pRt.pivot = new Vector2(0f, 1f);
                pRt.anchoredPosition = new Vector2(pStartX + i * (pWidth + pGap), yPos);
            }

            capturedInput.onValueChanged.AddListener(delegate(string val)
            {
                if (_suppressCallbacks) return;
                Color col;
                string canonical;
                if (MonsterKillProbability.TryParseHexColor(val, out col, out canonical))
                {
                    capturedSwatch.color = col;
                    capturedErr.text = "";
                    onColorApplied(canonical);
                    UpdateSync(force: false);
                }
            });

            capturedInput.onEndEdit.AddListener(delegate(string val)
            {
                if (_suppressCallbacks) return;
                Color col;
                string canonical;
                if (MonsterKillProbability.TryParseHexColor(val, out col, out canonical))
                {
                    capturedInput.text = canonical;
                    capturedSwatch.color = col;
                    capturedErr.text = "";
                    onColorApplied(canonical);
                    UpdateSync(force: true);
                }
                else
                {
                    capturedErr.text = "格式无效 (需 #RRGGBB)";
                    UpdateSync(force: true);
                }
            });
        }

        private void BuildInfoCard(GameObject parent)
        {
            GameObject cardGo = CreateCardContainer(parent, "InfoCard", 110f);

            Text cardTitle = XingShuUIFactory.CreateText(cardGo, "CardTitle", "计算口径与说明", 14, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            RectTransform ctRt = cardTitle.rectTransform;
            ctRt.anchorMin = new Vector2(0f, 1f);
            ctRt.anchorMax = new Vector2(0f, 1f);
            ctRt.pivot = new Vector2(0f, 1f);
            ctRt.anchoredPosition = new Vector2(24f, -14f);
            ctRt.sizeDelta = new Vector2(200f, 20f);

            Text infoText = XingShuUIFactory.CreateText(cardGo, "InfoContent",
                "• 一次攻击击飞，防御方按防御计算；双方普通 1–6 骰。\n• 概率按高低分色；主动技能冷却仅在地图上显示，战斗浮字不显示冷却。\n• 原版名字与血量保留；关闭功能中心不会停用后台预测。",
                12, XingShuUITheme.SecondaryText, TextAnchor.UpperLeft);
            RectTransform infoRt = infoText.rectTransform;
            infoRt.anchorMin = new Vector2(0f, 1f);
            infoRt.anchorMax = new Vector2(1f, 1f);
            infoRt.pivot = new Vector2(0f, 1f);
            infoRt.anchoredPosition = new Vector2(24f, -38f);
            infoRt.sizeDelta = new Vector2(-48f, 64f);
            infoText.lineSpacing = 1.2f;
        }

        private void OnEnableToggleChanged(bool value)
        {
            if (_suppressCallbacks) return;
            MonsterKillProbability.IsEnabled = value;
            UpdateSync(force: true);
        }

        private void OnPreviewToggleClicked()
        {
            MonsterKillProbability.PreviewCards = !MonsterKillProbability.PreviewCards;
            UpdateSync(force: true);
        }

        private void OnPrevTargetClicked()
        {
            MonsterKillProbability.PreviousTarget();
            UpdateSync(force: true);
        }

        private void OnNextTargetClicked()
        {
            MonsterKillProbability.NextTarget();
            UpdateSync(force: true);
        }

        private void OnDetailPageClicked()
        {
            MonsterKillProbability.NextDetail();
            UpdateSync(force: true);
        }

        internal void UpdateSync(bool force = false)
        {
            _suppressCallbacks = true;
            if (_defenseHintToggle != null) _defenseHintToggle.isOn = DefensePointHint.IsEnabled;
            if (_battleCardHintToggle != null) _battleCardHintToggle.isOn = BattleCardPointHint.IsEnabled;
            _suppressCallbacks = false;
            SyncBattleCardControls();
            SyncMegathControls();
            SyncPlayerCombatHudControls();
            // This module is independent from the kill-probability switch and status.
            if (_targetingSummary != null && _targetingSummary.text != MonsterTargetRuntime.Summary)
                _targetingSummary.text = MonsterTargetRuntime.Summary;
            if (_targetingToggle != null && _targetingToggle.isOn != MonsterTargetRuntime.IsEnabled)
            {
                _suppressCallbacks = true;
                _targetingToggle.isOn = MonsterTargetRuntime.IsEnabled;
                _suppressCallbacks = false;
            }
            if (_arrowBoostToggle != null && _arrowBoostToggle.isOn != MonsterTargetRuntime.ArrowBoostEnabled)
            {
                _suppressCallbacks = true;
                _arrowBoostToggle.isOn = MonsterTargetRuntime.ArrowBoostEnabled;
                _suppressCallbacks = false;
            }
            bool curEnabled = MonsterKillProbability.IsEnabled;
            bool curPreview = MonsterKillProbability.PreviewCards;
            int curFontSize = MonsterKillProbability.FightFontSize;
            float curFontX = MonsterKillProbability.FightX;
            float curFontY = MonsterKillProbability.FightY;
            bool curAutoColor = MonsterKillProbability.AutoColorEnabled;
            bool curRainbow100 = MonsterKillProbability.Rainbow100Enabled;
            string curProbColor = MonsterKillProbability.ProbabilityColorHex;
            string curTargetColor = MonsterKillProbability.TargetColorHex;
            string curStatus = MonsterKillProbability.StatusText;
            string curTargetSummary = MonsterKillProbability.GetCurrentTargetSummary();

            bool needsLiveRainbow = curRainbow100;

            if (!force && !needsLiveRainbow &&
                curEnabled == _lastObservedEnabled &&
                curPreview == _lastObservedPreview &&
                curFontSize == _lastObservedFontSize &&
                Mathf.Approximately(curFontX, _lastObservedFontX) &&
                Mathf.Approximately(curFontY, _lastObservedFontY) &&
                curAutoColor == _lastObservedAutoColor &&
                curRainbow100 == _lastObservedRainbow100 &&
                curProbColor == _lastObservedProbColor &&
                curTargetColor == _lastObservedTargetColor &&
                curStatus == _lastObservedStatus &&
                curTargetSummary == _lastObservedTargetSummary)
            {
                return;
            }

            _suppressCallbacks = true;
            try
            {
                if (curEnabled != _lastObservedEnabled || force)
                {
                    _enableToggle.isOn = curEnabled;
                    _lastObservedEnabled = curEnabled;
                }

                if (curPreview != _lastObservedPreview || force)
                {
                    if (_previewBtnText != null)
                    {
                        _previewBtnText.text = curPreview ? "拖动卡预览：开" : "拖动卡预览：关";
                        _previewBtnText.color = curPreview ? XingShuUITheme.LimeAccent : XingShuUITheme.SecondaryText;
                    }
                    _lastObservedPreview = curPreview;
                }

                if (curFontSize != _lastObservedFontSize ||
                    !Mathf.Approximately(curFontX, _lastObservedFontX) ||
                    !Mathf.Approximately(curFontY, _lastObservedFontY) ||
                    curAutoColor != _lastObservedAutoColor ||
                    curRainbow100 != _lastObservedRainbow100 || force)
                {
                    if (_styleSummaryText != null)
                    {
                        string modeStr = curAutoColor ? "自动分段" : "手动色";
                        if (curRainbow100) modeStr += "+炫彩";
                        _styleSummaryText.text = $"当前样式：字号 {curFontSize}  |  X: {curFontX:F0}  |  Y: {curFontY:F0}  |  {modeStr}";
                    }
                    _lastObservedFontSize = curFontSize;
                    _lastObservedFontX = curFontX;
                    _lastObservedFontY = curFontY;
                }

                if (curAutoColor != _lastObservedAutoColor || force)
                {
                    if (_autoColorBtnText != null)
                    {
                        _autoColorBtnText.color = curAutoColor ? XingShuUITheme.LimeAccent : XingShuUITheme.SecondaryText;
                    }
                    if (_manualColorBtnText != null)
                    {
                        _manualColorBtnText.color = (!curAutoColor) ? XingShuUITheme.LimeAccent : XingShuUITheme.SecondaryText;
                    }
                    _lastObservedAutoColor = curAutoColor;
                }

                if (curRainbow100 != _lastObservedRainbow100 || force)
                {
                    if (_rainbow100BtnText != null)
                    {
                        _rainbow100BtnText.text = curRainbow100 ? "100%炫彩高亮：开" : "100%炫彩高亮：关";
                        _rainbow100BtnText.color = curRainbow100 ? XingShuUITheme.LimeAccent : XingShuUITheme.SecondaryText;
                    }
                    _lastObservedRainbow100 = curRainbow100;
                }

                if (curProbColor != _lastObservedProbColor || force)
                {
                    if (_probColorInput != null && !_probColorInput.isFocused)
                    {
                        _probColorInput.text = curProbColor;
                    }
                    if (_probColorSwatch != null)
                    {
                        _probColorSwatch.color = MonsterKillProbability.ProbabilityColor;
                    }
                    _lastObservedProbColor = curProbColor;
                }

                if (curTargetColor != _lastObservedTargetColor || force)
                {
                    if (_targetColorInput != null && !_targetColorInput.isFocused)
                    {
                        _targetColorInput.text = curTargetColor;
                    }
                    if (_targetColorSwatch != null)
                    {
                        _targetColorSwatch.color = MonsterKillProbability.TargetColor;
                    }
                    _lastObservedTargetColor = curTargetColor;
                }

                int previewBase = Mathf.Clamp(curFontSize, 12, 20);
                string targetCol = curTargetColor;
                string p16Col = MonsterKillProbability.GetPreviewProbabilityColorHex(0.167f);
                string p100Col = MonsterKillProbability.GetPreviewProbabilityColorHex(1.000f);

                if (_previewLine1Text != null)
                {
                    _previewLine1Text.fontSize = XingShuMobileUIHelper.IsMobile ? Mathf.RoundToInt(Mathf.Max(22, previewBase) * XingShuMobilePageLayout.TextScale) : previewBase;
                    _previewLine1Text.text = $"<b><size={_previewLine1Text.fontSize}><color={p16Col}>击飞 16.7%</color>  <color={targetCol}>典狱长</color></size></b>";
                }
                if (_previewLine2Text != null)
                {
                    _previewLine2Text.fontSize = XingShuMobileUIHelper.IsMobile ? Mathf.RoundToInt(Mathf.Max(22, previewBase) * XingShuMobilePageLayout.TextScale) : previewBase;
                    _previewLine2Text.text = $"<b><size={_previewLine2Text.fontSize}><color={p100Col}>击飞 100%</color>  <color={targetCol}>闹钟猫头鹰</color></size></b>";
                }

                if (curStatus != _lastObservedStatus || force)
                {
                    if (_statusText != null)
                    {
                        _statusText.text = curStatus;
                    }
                    _lastObservedStatus = curStatus;
                }

                if (curTargetSummary != _lastObservedTargetSummary || force)
                {
                    if (_targetSummaryText != null)
                    {
                        _targetSummaryText.text = curTargetSummary;
                    }
                    _lastObservedTargetSummary = curTargetSummary;
                }
            }
            finally
            {
                _suppressCallbacks = false;
            }
        }
    }
}
