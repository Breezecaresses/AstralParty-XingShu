using System;
using XingShuRuntime.Core;
using XingShuRuntime.Utilities;
using UnityEngine;
using UnityEngine.UI;

namespace XingShuRuntime.UI
{
    /// <summary>
    /// 功能中心 - 高级设置 (Advanced Settings) Modern UI 页面 (Phase 2D-7A-R1)
    /// 纯 UGUI View 表现层组件：整合悬浮交互与全局显示适配。
    /// 所有配置读写严格通过 XingShuConfigService 完成，零直接 PlayerPrefs 操作。
    /// </summary>
    internal sealed class XingShuAdvancedSettingsView
    {
        private readonly GameObject _root;

        // Card B: 悬浮交互与辅助球 (Assist Ball & Menu)
        private Toggle _autoHideToggle;
        private Text _hotkeyDisplayText;
        private Slider _assistSizeSlider;
        private Text _assistSizeValueText;
        private Slider _assistAlphaSlider;
        private Text _assistAlphaValueText;
        private Slider _assistScaleSlider;
        private Text _assistScaleValueText;

        // Card C: 全局显示适配 (Global UI Scaling)
        private Slider _globalScaleSlider;
        private Text _globalScaleValueText;
        private Slider _mobilePanelScaleSlider;
        private Text _mobilePanelScaleValueText;
        private ScrollRect _scrollRect;

        // Card D: 恢复默认操作 (Track D)
        private Button _resetDefaultsBtn;
        private Text _resetDefaultsBtnText;
        private float _resetConfirmUntil;

        // Card Style: 功能中心外观风格 (原版游戏风 / 毛玻璃 v2)
        private Toggle _glassStyleToggle;
        private int _lastObservedStyle = -1;

        // 内部更新防重入与有界轮询缓存
        private bool _suppressCallbacks;
        private float _nextSyncTime;
        private bool? _lastObservedAutoHide = null;
        private string _lastObservedHotkey;
        private float _lastObservedSize = -1f;
        private float _lastObservedAlpha = -1f;
        private float _lastObservedDScale = -1f;
        private float _lastObservedGScale = -1f;
        private float _lastObservedPanelScale = -1f;

        internal GameObject Root => _root;

        internal XingShuAdvancedSettingsView(Transform parent)
        {
            _root = XingShuUIFactory.CreateUIObject("Page_AdvancedSettings", parent.gameObject);
            RectTransform rootRt = _root.GetComponent<RectTransform>();
            rootRt.anchorMin = Vector2.zero;
            rootRt.anchorMax = Vector2.one;
            rootRt.offsetMin = Vector2.zero;
            rootRt.offsetMax = Vector2.zero;

            BuildUI();
        }

        private void BuildUI()
        {
            _suppressCallbacks = true;
            try
            {
                _scrollRect = XingShuUIFactory.CreateVerticalScrollView(_root, "AdvancedSettingsScrollView", out GameObject contentArea);
                VerticalLayoutGroup vlg = contentArea.GetComponent<VerticalLayoutGroup>();
                if (vlg != null)
                {
                    vlg.spacing = 14f;
                    vlg.padding = new RectOffset(0, 10, 0, 24);
                }

                // 0. 特色功能卡片 (Feature Header Card: 76px)
                BuildHeaderCard(contentArea);

                // 0B. 界面外观风格 (原版游戏风 / 毛玻璃框架 v2)
                BuildStyleCard(contentArea);

                // 1. 卡片 B: 悬浮交互与辅助球设置 (Card B: 320px)
                BuildAssistBallCard(contentArea);

                // 2. 卡片 C: 全局显示适配
                BuildDisplayScaleCard(contentArea);

                // 3. 卡片 D: 恢复默认操作 (Card D: 76px)
                BuildResetDefaultsCard(contentArea);

                // 初始化控件数值
                SyncFromConfig();
            }
            finally
            {
                _suppressCallbacks = false;
            }
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

        private void BuildHeaderCard(GameObject parent)
        {
            GameObject headerGo = XingShuUIFactory.CreateUIObject("FeatureHeaderCard", parent);
            LayoutElement le = headerGo.AddComponent<LayoutElement>();
            le.preferredHeight = 76f;
            le.minHeight = 76f;
            le.flexibleHeight = 0f;

            Sprite cfhSprite = XingShuUIAssetService.GetSprite("card_feature_header.png");
            Image headerBg = headerGo.AddComponent<Image>();
            headerBg.sprite = cfhSprite;
            headerBg.type = Image.Type.Sliced;
            headerBg.color = XingShuUIAssetService.IsFallbackSprite(cfhSprite) ? XingShuUITheme.CardFeatureBase : Color.white;

            Text titleText = XingShuUIFactory.CreateText(headerGo, "Title", "高级设置", 20, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            RectTransform titleRt = titleText.rectTransform;
            titleRt.anchorMin = new Vector2(0f, 0.5f);
            titleRt.anchorMax = new Vector2(0f, 0.5f);
            titleRt.pivot = new Vector2(0f, 0.5f);
            titleRt.anchoredPosition = new Vector2(24f, 12f);
            titleRt.sizeDelta = new Vector2(300f, 26f);

            Text descText = XingShuUIFactory.CreateText(headerGo, "Description", "悬浮交互与辅助球样式 · 全局渲染显示适配", 13, XingShuUITheme.SecondaryText, TextAnchor.MiddleLeft);
            RectTransform descRt = descText.rectTransform;
            descRt.anchorMin = new Vector2(0f, 0.5f);
            descRt.anchorMax = new Vector2(0f, 0.5f);
            descRt.pivot = new Vector2(0f, 0.5f);
            descRt.anchoredPosition = new Vector2(24f, -14f);
            descRt.sizeDelta = new Vector2(500f, 22f);
        }

        private void BuildAssistBallCard(GameObject parent)
        {
            GameObject cardGo = CreateCardContainer(parent, "Card_AssistBallSettings", 320f);

            Text cardTitle = XingShuUIFactory.CreateText(cardGo, "CardTitle", "悬浮交互与辅助球", 16, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            RectTransform ctRt = cardTitle.rectTransform;
            ctRt.anchorMin = new Vector2(0f, 1f);
            ctRt.anchorMax = new Vector2(0f, 1f);
            ctRt.pivot = new Vector2(0f, 1f);
            ctRt.anchoredPosition = new Vector2(24f, -14f);
            ctRt.sizeDelta = new Vector2(240f, 22f);

            Text subtitle = XingShuUIFactory.CreateText(cardGo, "Subtitle", "全局悬浮快捷入口物理尺寸、不透明度、贴边隐藏与呼出热键", 12, XingShuUITheme.SecondaryText, TextAnchor.MiddleLeft);
            RectTransform stRt = subtitle.rectTransform;
            stRt.anchorMin = new Vector2(0f, 1f);
            stRt.anchorMax = new Vector2(0f, 1f);
            stRt.pivot = new Vector2(0f, 1f);
            stRt.anchoredPosition = new Vector2(24f, -38f);
            stRt.sizeDelta = new Vector2(460f, 18f);

            // Row 1: 贴边自动隐藏 ToggleRow (左侧标签，右侧开关)
            bool initAutoHide = XingShuConfigService.GetBool(XingShuConfigKeys.AssistAutoHide, XingShuConfigKeys.AssistAutoHideDefault);
            _autoHideToggle = XingShuUIFactory.CreateToggleRow(cardGo, "AutoHideToggle", "贴边自动隐藏", initAutoHide, OnAutoHideToggleChanged);
            RectTransform ahtRt = _autoHideToggle.GetComponent<RectTransform>();
            ahtRt.anchoredPosition = new Vector2(0f, -64f);
            ahtRt.sizeDelta = new Vector2(0f, 32f);

            // Row 2: 快捷呼出键显示行 (左侧标题，右侧键名显示)
            Text hkLabel = XingShuUIFactory.CreateText(cardGo, "HotkeyLabel", "悬浮球快捷键（在「快捷键」页修改）", 13, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft);
            RectTransform hklRt = hkLabel.rectTransform;
            hklRt.anchorMin = new Vector2(0f, 1f);
            hklRt.anchorMax = new Vector2(0f, 1f);
            hklRt.pivot = new Vector2(0f, 1f);
            hklRt.anchoredPosition = new Vector2(24f, -100f);
            hklRt.sizeDelta = new Vector2(200f, 20f);

            string initHotkey = XingShuHotkeys.Display(XingShuShortcut.AssistVisibility);
            _hotkeyDisplayText = XingShuUIFactory.CreateText(cardGo, "HotkeyDisplay", $"{initHotkey}", 12, XingShuUITheme.CyanAccent, TextAnchor.MiddleRight);
            RectTransform hkRt = _hotkeyDisplayText.rectTransform;
            hkRt.anchorMin = new Vector2(1f, 1f);
            hkRt.anchorMax = new Vector2(1f, 1f);
            hkRt.pivot = new Vector2(1f, 1f);
            hkRt.anchoredPosition = new Vector2(-24f, -100f);
            hkRt.sizeDelta = new Vector2(280f, 20f);

            // Row 3: 悬浮球大小 Slider
            Text sizeLabel = XingShuUIFactory.CreateText(cardGo, "SizeLabel", "悬浮球大小", 13, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft);
            RectTransform slRt = sizeLabel.rectTransform;
            slRt.anchorMin = new Vector2(0f, 1f);
            slRt.anchorMax = new Vector2(0f, 1f);
            slRt.pivot = new Vector2(0f, 1f);
            slRt.anchoredPosition = new Vector2(24f, -126f);
            slRt.sizeDelta = new Vector2(160f, 20f);

            float initSize = XingShuConfigService.GetFloat(XingShuConfigKeys.AssistSize, XingShuMobileUIHelper.IsMobile ? XingShuConfigKeys.AssistSizeMobileDefault : XingShuConfigKeys.AssistSizeDesktopDefault);
            _assistSizeValueText = XingShuUIFactory.CreateText(cardGo, "SizeValue", $"{Mathf.RoundToInt(initSize)} px", 13, XingShuUITheme.CyanAccent, TextAnchor.MiddleRight, FontStyle.Bold);
            RectTransform svRt = _assistSizeValueText.rectTransform;
            svRt.anchorMin = new Vector2(1f, 1f);
            svRt.anchorMax = new Vector2(1f, 1f);
            svRt.pivot = new Vector2(1f, 1f);
            svRt.anchoredPosition = new Vector2(-24f, -126f);
            svRt.sizeDelta = new Vector2(80f, 20f);

            _assistSizeSlider = XingShuUIFactory.CreateSlider(cardGo, "SizeSlider", XingShuMobileUIHelper.IsMobile ? XingShuConfigKeys.AssistSizeMobileMin : XingShuConfigKeys.AssistSizeMin, XingShuConfigKeys.AssistSizeMax, initSize, OnAssistSizeSliderChanged);
            RectTransform ssRt = _assistSizeSlider.GetComponent<RectTransform>();
            ssRt.anchorMin = new Vector2(0f, 1f);
            ssRt.anchorMax = new Vector2(1f, 1f);
            ssRt.pivot = new Vector2(0.5f, 1f);
            ssRt.anchoredPosition = new Vector2(0f, -148f);
            ssRt.sizeDelta = new Vector2(-48f, 24f);

            // Row 4: 悬浮球透明度 Slider
            Text alphaLabel = XingShuUIFactory.CreateText(cardGo, "AlphaLabel", "悬浮球透明度", 13, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft);
            RectTransform alRt = alphaLabel.rectTransform;
            alRt.anchorMin = new Vector2(0f, 1f);
            alRt.anchorMax = new Vector2(0f, 1f);
            alRt.pivot = new Vector2(0f, 1f);
            alRt.anchoredPosition = new Vector2(24f, -178f);
            alRt.sizeDelta = new Vector2(160f, 20f);

            float initAlpha = XingShuConfigService.GetFloat(XingShuConfigKeys.AssistAlpha, XingShuConfigKeys.AssistAlphaDefault);
            _assistAlphaValueText = XingShuUIFactory.CreateText(cardGo, "AlphaValue", $"{Mathf.RoundToInt(initAlpha * 100f)}%", 13, XingShuUITheme.CyanAccent, TextAnchor.MiddleRight, FontStyle.Bold);
            RectTransform avRt = _assistAlphaValueText.rectTransform;
            avRt.anchorMin = new Vector2(1f, 1f);
            avRt.anchorMax = new Vector2(1f, 1f);
            avRt.pivot = new Vector2(1f, 1f);
            avRt.anchoredPosition = new Vector2(-24f, -178f);
            avRt.sizeDelta = new Vector2(80f, 20f);

            _assistAlphaSlider = XingShuUIFactory.CreateSlider(cardGo, "AlphaSlider", 0.2f, 1.0f, initAlpha, OnAssistAlphaSliderChanged);
            RectTransform asRt = _assistAlphaSlider.GetComponent<RectTransform>();
            asRt.anchorMin = new Vector2(0f, 1f);
            asRt.anchorMax = new Vector2(1f, 1f);
            asRt.pivot = new Vector2(0.5f, 1f);
            asRt.anchoredPosition = new Vector2(0f, -200f);
            asRt.sizeDelta = new Vector2(-48f, 24f);

            // Row 5: 悬浮菜单缩放 Slider
            Text dScaleLabel = XingShuUIFactory.CreateText(cardGo, "DScaleLabel", "悬浮菜单缩放", 13, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft);
            RectTransform dslRt = dScaleLabel.rectTransform;
            dslRt.anchorMin = new Vector2(0f, 1f);
            dslRt.anchorMax = new Vector2(0f, 1f);
            dslRt.pivot = new Vector2(0f, 1f);
            dslRt.anchoredPosition = new Vector2(24f, -230f);
            dslRt.sizeDelta = new Vector2(160f, 20f);

            float initDScale = XingShuConfigService.GetFloat(XingShuConfigKeys.AssistDesktopScale, XingShuConfigKeys.AssistDesktopScaleDefault);
            _assistScaleValueText = XingShuUIFactory.CreateText(cardGo, "DScaleValue", $"{initDScale:F2}x", 13, XingShuUITheme.CyanAccent, TextAnchor.MiddleRight, FontStyle.Bold);
            RectTransform dsvRt = _assistScaleValueText.rectTransform;
            dsvRt.anchorMin = new Vector2(1f, 1f);
            dsvRt.anchorMax = new Vector2(1f, 1f);
            dsvRt.pivot = new Vector2(1f, 1f);
            dsvRt.anchoredPosition = new Vector2(-24f, -230f);
            dsvRt.sizeDelta = new Vector2(80f, 20f);

            _assistScaleSlider = XingShuUIFactory.CreateSlider(cardGo, "DScaleSlider", 1.0f, 3.0f, initDScale, OnAssistScaleSliderChanged);
            RectTransform dssRt = _assistScaleSlider.GetComponent<RectTransform>();
            dssRt.anchorMin = new Vector2(0f, 1f);
            dssRt.anchorMax = new Vector2(1f, 1f);
            dssRt.pivot = new Vector2(0.5f, 1f);
            dssRt.anchoredPosition = new Vector2(0f, -252f);
            dssRt.sizeDelta = new Vector2(-48f, 24f);

            Text noteText = XingShuUIFactory.CreateText(cardGo, "Note", "热键目前维持默认配置读取与安全绑定；悬浮菜单缩放影响快捷菜单渲染尺寸", 11, XingShuUITheme.MutedText, TextAnchor.MiddleLeft);
            RectTransform ntRt = noteText.rectTransform;
            ntRt.anchorMin = new Vector2(0f, 0f);
            ntRt.anchorMax = new Vector2(1f, 0f);
            ntRt.pivot = new Vector2(0f, 0f);
            ntRt.anchoredPosition = new Vector2(24f, 8f);
            ntRt.sizeDelta = new Vector2(-48f, 18f);
        }

        private void BuildDisplayScaleCard(GameObject parent)
        {
            GameObject cardGo = CreateCardContainer(parent, "Card_DisplaySettings", XingShuMobileUIHelper.IsMobile ? 305f : 196f);

            Text cardTitle = XingShuUIFactory.CreateText(cardGo, "CardTitle", "显示适配", 16, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            RectTransform ctRt = cardTitle.rectTransform;
            ctRt.anchorMin = new Vector2(0f, 1f);
            ctRt.anchorMax = new Vector2(0f, 1f);
            ctRt.pivot = new Vector2(0f, 1f);
            ctRt.anchoredPosition = new Vector2(24f, -14f);
            ctRt.sizeDelta = new Vector2(240f, 22f);

            Text subtitle = XingShuUIFactory.CreateText(cardGo, "Subtitle", "功能中心默认全屏铺满安全区域，支持双端自定义尺寸与重置居中", 12, XingShuUITheme.SecondaryText, TextAnchor.MiddleLeft);
            RectTransform stRt = subtitle.rectTransform;
            stRt.anchorMin = new Vector2(0f, 1f);
            stRt.anchorMax = new Vector2(0f, 1f);
            stRt.pivot = new Vector2(0f, 1f);
            stRt.anchoredPosition = new Vector2(24f, -38f);
            stRt.sizeDelta = new Vector2(500f, 18f);

            // Row 1 (PC & Android Unified): 功能中心大小 (65% - 100%)
            Text panelTitle = XingShuUIFactory.CreateText(cardGo, "PanelScaleLabel", "功能中心大小 (65% - 100%)", 13, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft);
            RectTransform ptlRt = panelTitle.rectTransform;
            ptlRt.anchorMin = new Vector2(0f, 1f);
            ptlRt.anchorMax = new Vector2(0f, 1f);
            ptlRt.pivot = new Vector2(0f, 1f);
            ptlRt.anchoredPosition = new Vector2(24f, -66f);
            ptlRt.sizeDelta = new Vector2(220f, 20f);

            float initPanelScale = XingShuUICenter.PanelScale;
            _mobilePanelScaleValueText = XingShuUIFactory.CreateText(cardGo, "PanelScaleValue",
                initPanelScale >= 0.985f ? "100% (全屏)" : $"{Mathf.RoundToInt(initPanelScale * 100f)}%",
                13, XingShuUITheme.CyanAccent, TextAnchor.MiddleRight, FontStyle.Bold);
            RectTransform psvRt = _mobilePanelScaleValueText.rectTransform;
            psvRt.anchorMin = new Vector2(1f, 1f);
            psvRt.anchorMax = new Vector2(1f, 1f);
            psvRt.pivot = new Vector2(1f, 1f);
            psvRt.anchoredPosition = new Vector2(-24f, -66f);
            psvRt.sizeDelta = new Vector2(120f, 20f);

            _mobilePanelScaleSlider = XingShuUIFactory.CreateSlider(cardGo, "CenterPanelScaleSlider",
                XingShuUICenter.CenterScaleMin, XingShuUICenter.CenterScaleMax,
                initPanelScale, OnMobilePanelScaleChanged);
            RectTransform psRt = _mobilePanelScaleSlider.GetComponent<RectTransform>();
            psRt.anchorMin = new Vector2(0f, 1f);
            psRt.anchorMax = new Vector2(1f, 1f);
            psRt.pivot = new Vector2(0.5f, 1f);
            psRt.anchoredPosition = new Vector2(0f, -88f);
            psRt.sizeDelta = new Vector2(-48f, 24f);

            if (XingShuMobileUIHelper.IsMobile)
            {
                Text scaleLabel = XingShuUIFactory.CreateText(cardGo, "GlobalScaleLabel", "手机文字大小", 13, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft);
                RectTransform gslRt = scaleLabel.rectTransform;
                gslRt.anchorMin = new Vector2(0f, 1f);
                gslRt.anchorMax = new Vector2(0f, 1f);
                gslRt.pivot = new Vector2(0f, 1f);
                gslRt.anchoredPosition = new Vector2(24f, -124f);
                gslRt.sizeDelta = new Vector2(160f, 20f);

                float initGScale = XingShuMobilePageLayout.TextScale;
                _globalScaleValueText = XingShuUIFactory.CreateText(cardGo, "GlobalScaleValue", $"{initGScale:F2}x", 13, XingShuUITheme.CyanAccent, TextAnchor.MiddleRight, FontStyle.Bold);
                RectTransform gsvRt = _globalScaleValueText.rectTransform;
                gsvRt.anchorMin = new Vector2(1f, 1f);
                gsvRt.anchorMax = new Vector2(1f, 1f);
                gsvRt.pivot = new Vector2(1f, 1f);
                gsvRt.anchoredPosition = new Vector2(-24f, -124f);
                gsvRt.sizeDelta = new Vector2(80f, 20f);

                _globalScaleSlider = XingShuUIFactory.CreateSlider(cardGo, "GlobalScaleSlider",
                    XingShuConfigKeys.MobileTextScaleMin, XingShuConfigKeys.MobileTextScaleMax,
                    initGScale, OnGlobalScaleSliderChanged);
                RectTransform gssRt = _globalScaleSlider.GetComponent<RectTransform>();
                gssRt.anchorMin = new Vector2(0f, 1f);
                gssRt.anchorMax = new Vector2(1f, 1f);
                gssRt.pivot = new Vector2(0.5f, 1f);
                gssRt.anchoredPosition = new Vector2(0f, -146f);
                gssRt.sizeDelta = new Vector2(-48f, 24f);

                Button resetWinBtn = XingShuDetailLayout.Button(cardGo.transform, "恢复标准大小", 24, 190, 220, 40, XingShuUICenter.ResetWindowCenter);
            }
            else
            {
                Button resetWinBtn = XingShuDetailLayout.Button(cardGo.transform, "恢复标准大小", 24, 124, 160, 32, XingShuUICenter.ResetWindowCenter);
            }

            string noteStr = XingShuMobileUIHelper.IsMobile
                ? "默认对齐游戏设置标准尺寸；缩小窗口后可拖动顶部自由移动，右上角「标准」按钮也可切换"
                : "默认对齐游戏设置标准尺寸，可调 65%–100%；缩小后可拖动顶部自由移动，右上角「标准」按钮可切换";
            Text noteText = XingShuUIFactory.CreateText(cardGo, "Note", noteStr, 11, XingShuUITheme.MutedText, TextAnchor.MiddleLeft);
            RectTransform ntRt = noteText.rectTransform;
            ntRt.anchorMin = new Vector2(0f, 0f);
            ntRt.anchorMax = new Vector2(1f, 0f);
            ntRt.pivot = new Vector2(0f, 0f);
            ntRt.anchoredPosition = new Vector2(24f, 6f);
            ntRt.sizeDelta = new Vector2(-48f, 24f);
        }

        private void BuildStyleCard(GameObject parent)
        {
            GameObject cardGo = CreateCardContainer(parent, "Card_CenterStyle", 84f);

            Text cardTitle = XingShuUIFactory.CreateText(cardGo, "CardTitle", "功能中心界面风格 (v2 框架)", 15, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            RectTransform ctRt = cardTitle.rectTransform;
            ctRt.anchorMin = new Vector2(0f, 1f); ctRt.anchorMax = new Vector2(0f, 1f); ctRt.pivot = new Vector2(0f, 1f);
            ctRt.anchoredPosition = new Vector2(24f, -14f); ctRt.sizeDelta = new Vector2(360f, 22f);

            Text subtitle = XingShuUIFactory.CreateText(cardGo, "Subtitle", "开启后切换为毛玻璃圆角通透 UI 并显示外部优化 Mod 扩展框架；关闭即保留原版游戏风", 12, XingShuUITheme.SecondaryText, TextAnchor.MiddleLeft);
            RectTransform stRt = subtitle.rectTransform;
            stRt.anchorMin = new Vector2(0f, 1f); stRt.anchorMax = new Vector2(1f, 1f); stRt.pivot = new Vector2(0f, 1f);
            stRt.anchoredPosition = new Vector2(24f, -42f); stRt.sizeDelta = new Vector2(-240f, 22f);

            _glassStyleToggle = XingShuUIFactory.CreateToggle(cardGo, "GlassStyleToggle", "毛玻璃框架", XingShuUICenter.CenterStyle == 1, val =>
            {
                if (_suppressCallbacks) return;
                XingShuUICenter.SetCenterStyle(val ? 1 : 0);
            });
            RectTransform tRt = _glassStyleToggle.GetComponent<RectTransform>();
            tRt.anchorMin = new Vector2(1f, 0.5f); tRt.anchorMax = new Vector2(1f, 0.5f); tRt.pivot = new Vector2(1f, 0.5f);
            tRt.anchoredPosition = new Vector2(-24f, 0f); tRt.sizeDelta = new Vector2(180f, 32f);
        }

        private void BuildResetDefaultsCard(GameObject parent)
        {
            GameObject cardGo = CreateCardContainer(parent, "Card_ResetDefaults", 76f);

            Text cardTitle = XingShuUIFactory.CreateText(cardGo, "CardTitle", "恢复默认设置", 15, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            RectTransform ctRt = cardTitle.rectTransform;
            ctRt.anchorMin = new Vector2(0f, 1f);
            ctRt.anchorMax = new Vector2(0f, 1f);
            ctRt.pivot = new Vector2(0f, 1f);
            ctRt.anchoredPosition = new Vector2(24f, -14f);
            ctRt.sizeDelta = new Vector2(240f, 22f);

            Text subtitle = XingShuUIFactory.CreateText(cardGo, "Subtitle", "仅将本页各项设置恢复为官方初始默认值，不影响其他功能配置", 12, XingShuUITheme.SecondaryText, TextAnchor.MiddleLeft);
            RectTransform stRt = subtitle.rectTransform;
            stRt.anchorMin = new Vector2(0f, 1f);
            stRt.anchorMax = new Vector2(0f, 1f);
            stRt.pivot = new Vector2(0f, 1f);
            stRt.anchoredPosition = new Vector2(24f, -40f);
            stRt.sizeDelta = new Vector2(460f, 18f);

            Sprite btnSprite = XingShuUIAssetService.GetSprite("button_secondary.png");
            _resetDefaultsBtn = XingShuUIFactory.CreateButton(cardGo, "ResetDefaultsBtn", "恢复本页默认设置",
                btnSprite,
                XingShuUIAssetService.IsFallbackSprite(btnSprite) ? XingShuUITheme.ButtonSecondaryBase : Color.white,
                XingShuUITheme.PrimaryText,
                OnResetDefaultsClicked, 13);
            _resetDefaultsBtnText = _resetDefaultsBtn.GetComponentInChildren<Text>();
            RectTransform rdbRt = _resetDefaultsBtn.GetComponent<RectTransform>();
            rdbRt.anchorMin = new Vector2(1f, 0.5f);
            rdbRt.anchorMax = new Vector2(1f, 0.5f);
            rdbRt.pivot = new Vector2(1f, 0.5f);
            rdbRt.anchoredPosition = new Vector2(-24f, 0f);
            rdbRt.sizeDelta = new Vector2(170f, 32f);
        }

        private void SyncFromConfig()
        {
            _suppressCallbacks = true;
            try
            {
                // Card Style
                int curStyle = XingShuUICenter.CenterStyle;
                if (_lastObservedStyle != curStyle)
                {
                    _lastObservedStyle = curStyle;
                    if (_glassStyleToggle != null) XingShuUIFactory.SetToggleRowStateWithoutNotify(_glassStyleToggle, curStyle == 1);
                }

                // Card B
                bool autoHide = XingShuConfigService.GetBool(XingShuConfigKeys.AssistAutoHide, XingShuConfigKeys.AssistAutoHideDefault);
                if (!_lastObservedAutoHide.HasValue || _lastObservedAutoHide.Value != autoHide)
                {
                    _lastObservedAutoHide = autoHide;
                    if (_autoHideToggle != null) XingShuUIFactory.SetToggleRowStateWithoutNotify(_autoHideToggle, autoHide);
                }

                string hotkey = XingShuHotkeys.Display(XingShuShortcut.AssistVisibility);
                if (_lastObservedHotkey != hotkey)
                {
                    _lastObservedHotkey = hotkey;
                    if (_hotkeyDisplayText != null) _hotkeyDisplayText.text = $"{hotkey}";
                }

                float size = XingShuConfigService.GetFloat(XingShuConfigKeys.AssistSize, XingShuMobileUIHelper.IsMobile ? XingShuConfigKeys.AssistSizeMobileDefault : XingShuConfigKeys.AssistSizeDesktopDefault);
                if (!Mathf.Approximately(_lastObservedSize, size))
                {
                    _lastObservedSize = size;
                    if (_assistSizeSlider != null) _assistSizeSlider.SetValueWithoutNotify(size);
                    if (_assistSizeValueText != null) _assistSizeValueText.text = $"{Mathf.RoundToInt(size)} px";
                }

                float alpha = XingShuConfigService.GetFloat(XingShuConfigKeys.AssistAlpha, XingShuConfigKeys.AssistAlphaDefault);
                if (!Mathf.Approximately(_lastObservedAlpha, alpha))
                {
                    _lastObservedAlpha = alpha;
                    if (_assistAlphaSlider != null) _assistAlphaSlider.SetValueWithoutNotify(alpha);
                    if (_assistAlphaValueText != null) _assistAlphaValueText.text = $"{Mathf.RoundToInt(alpha * 100f)}%";
                }

                float dscale = XingShuConfigService.GetFloat(XingShuConfigKeys.AssistDesktopScale, XingShuConfigKeys.AssistDesktopScaleDefault);
                if (!Mathf.Approximately(_lastObservedDScale, dscale))
                {
                    _lastObservedDScale = dscale;
                    if (_assistScaleSlider != null) _assistScaleSlider.SetValueWithoutNotify(dscale);
                    if (_assistScaleValueText != null) _assistScaleValueText.text = $"{dscale:F2}x";
                }

                // Card C
                if (XingShuMobileUIHelper.IsMobile)
                {
                    float gscale = XingShuMobilePageLayout.TextScale;
                    if (!Mathf.Approximately(_lastObservedGScale, gscale))
                    {
                        _lastObservedGScale = gscale;
                        if (_globalScaleSlider != null) _globalScaleSlider.SetValueWithoutNotify(gscale);
                        if (_globalScaleValueText != null) _globalScaleValueText.text = $"{gscale:F2}x";
                    }
                }
                float panelScale = XingShuUICenter.PanelScale;
                if (!Mathf.Approximately(_lastObservedPanelScale, panelScale))
                {
                    _lastObservedPanelScale = panelScale;
                    _mobilePanelScaleSlider?.SetValueWithoutNotify(panelScale);
                    if (_mobilePanelScaleValueText != null)
                        _mobilePanelScaleValueText.text = panelScale >= 0.985f ? "100% (标准)" : $"{Mathf.RoundToInt(panelScale * 100f)}%";
                }
            }
            finally
            {
                _suppressCallbacks = false;
            }
        }

        // ==========================================
        // Card B 回调
        // ==========================================
        private void OnAutoHideToggleChanged(bool val)
        {
            if (_suppressCallbacks) return;
            XingShuConfigService.SetBool(XingShuConfigKeys.AssistAutoHide, val);
            XingShuConfigService.Save();
            if (AssistBallGUI.Instance != null)
            {
                AssistBallGUI.Instance.SetAutoHide(val);
            }
            else
            {
                AssistBallGUI.RefreshFromConfig();
            }
        }

        private void OnAssistSizeSliderChanged(float val)
        {
            if (_assistSizeValueText != null) _assistSizeValueText.text = $"{Mathf.RoundToInt(val)} px";
            if (_suppressCallbacks) return;
            XingShuConfigService.SetFloat(XingShuConfigKeys.AssistSize, val);
            XingShuConfigService.Save();
            AssistBallGUI.RefreshFromConfig();
        }

        private void OnAssistAlphaSliderChanged(float val)
        {
            if (_assistAlphaValueText != null) _assistAlphaValueText.text = $"{Mathf.RoundToInt(val * 100f)}%";
            if (_suppressCallbacks) return;
            XingShuConfigService.SetFloat(XingShuConfigKeys.AssistAlpha, val);
            XingShuConfigService.Save();
            AssistBallGUI.RefreshFromConfig();
        }

        private void OnAssistScaleSliderChanged(float val)
        {
            if (_assistScaleValueText != null) _assistScaleValueText.text = $"{val:F2}x";
            if (_suppressCallbacks) return;
            XingShuConfigService.SetFloat(XingShuConfigKeys.AssistDesktopScale, val);
            XingShuConfigService.Save();
            AssistBallGUI.RefreshFromConfig();
        }

        // ==========================================
        // Card C 回调
        // ==========================================
        private void OnMobilePanelScaleChanged(float val)
        {
            if (_suppressCallbacks) return;
            val = XingShuMobileUIHelper.FiniteClamp(val, XingShuUICenter.CenterScaleMin, XingShuUICenter.CenterScaleMax, XingShuUICenter.CenterScaleDefault);
            if (_mobilePanelScaleValueText != null)
                _mobilePanelScaleValueText.text = val >= 0.985f ? "100% (标准)" : $"{Mathf.RoundToInt(val * 100f)}%";
            XingShuUICenter.SetPanelScale(val);
        }

        private void OnGlobalScaleSliderChanged(float val)
        {
            if (XingShuMobileUIHelper.IsMobile)
            {
                val = XingShuMobileUIHelper.FiniteClamp(val, XingShuConfigKeys.MobileTextScaleMin, XingShuConfigKeys.MobileTextScaleMax, XingShuConfigKeys.MobileTextScaleDefault);
                if (_globalScaleValueText != null) _globalScaleValueText.text = $"{val:F2}x";
                if (_suppressCallbacks) return;
                XingShuConfigService.SetFloat(XingShuConfigKeys.MobileTextScale, val);
                XingShuConfigService.Save();
                XingShuUICenter.RefreshMobileText();
                return;
            }
            if (!XingShuMobileUIHelper.IsMobile)
            {
                val = XingShuMobileUIHelper.FiniteClamp(val, XingShuConfigKeys.FunctionCenterDesktopScaleMin, XingShuConfigKeys.FunctionCenterDesktopScaleMax, XingShuConfigKeys.FunctionCenterDesktopScaleDefault);
            }
            if (_globalScaleValueText != null) _globalScaleValueText.text = $"{val:F2}x";
            if (_suppressCallbacks) return;
            XingShuConfigService.SetFloat(XingShuConfigKeys.MobileUserScale, val);
            XingShuMobileUIHelper.UserScaleMultiplier = val;
            XingShuConfigService.Save();
            XingShuUICenter.ApplyUserScale(val);
            AssistBallGUI.RefreshFromConfig();
        }

        // ==========================================
        // Card D 回调: 恢复本页默认设置
        // ==========================================
        private void OnResetDefaultsClicked()
        {
            if (Time.unscaledTime < _resetConfirmUntil)
            {
                _resetConfirmUntil = 0f;
                UpdateResetDefaultsBtnText();
                PerformResetDefaults();
            }
            else
            {
                _resetConfirmUntil = Time.unscaledTime + 3f;
                UpdateResetDefaultsBtnText();
            }
        }

        private void UpdateResetDefaultsBtnText()
        {
            if (_resetDefaultsBtnText != null)
            {
                bool isConfirming = Time.unscaledTime < _resetConfirmUntil;
                _resetDefaultsBtnText.text = isConfirming ? "再次点击确认恢复默认" : "恢复本页默认设置";
                _resetDefaultsBtnText.color = isConfirming ? XingShuUITheme.NumericAccent : XingShuUITheme.PrimaryText;
            }
        }

        private void PerformResetDefaults()
        {
            // G. Assist AutoHide
            XingShuConfigService.SetBool(XingShuConfigKeys.AssistAutoHide, XingShuConfigKeys.AssistAutoHideDefault);

            // H. Assist Size
            float defSize = XingShuMobileUIHelper.IsMobile ? XingShuConfigKeys.AssistSizeMobileDefault : XingShuConfigKeys.AssistSizeDesktopDefault;
            XingShuConfigService.SetFloat(XingShuConfigKeys.AssistSize, defSize);

            // I. Assist Alpha
            XingShuConfigService.SetFloat(XingShuConfigKeys.AssistAlpha, XingShuConfigKeys.AssistAlphaDefault);

            // J. Assist Desktop Scale
            if (!XingShuMobileUIHelper.IsMobile)
            {
                XingShuConfigService.SetFloat(XingShuConfigKeys.AssistDesktopScale, XingShuConfigKeys.AssistDesktopScaleDefault);
            }

            // K. Global UI Scale (Function Center desktop scale)
            float defUserScale = XingShuMobileUIHelper.IsMobile ? XingShuConfigKeys.MobileUserScaleDefault : XingShuConfigKeys.FunctionCenterDesktopScaleDefault;
            if (XingShuMobileUIHelper.IsMobile)
            {
                XingShuConfigService.SetFloat(XingShuConfigKeys.MobileTextScale, XingShuConfigKeys.MobileTextScaleDefault);
                XingShuConfigService.SetFloat(XingShuConfigKeys.MobilePanelScale, 1f);
                XingShuUICenter.RefreshMobileText();
                XingShuUICenter.RefreshMobileWindow();
            }
            XingShuUICenter.ResetWindowCenter();
            XingShuConfigService.SetFloat(XingShuConfigKeys.MobileUserScale, defUserScale);
            XingShuMobileUIHelper.UserScaleMultiplier = defUserScale;

            // Single batch save
            XingShuConfigService.Save();

            // Immediately apply to active runtimes
            AssistBallGUI.RefreshFromConfig();
            XingShuUICenter.ApplyUserScale(defUserScale);

            // Sync all page controls to reflected defaults
            SyncFromConfig();
        }

        internal void FocusSection(string section)
        {
            if (_scrollRect != null)
            {
                _scrollRect.verticalNormalizedPosition = 1f;
            }
        }

        internal void UpdateSync()
        {
            if (_resetConfirmUntil > 0f && Time.unscaledTime >= _resetConfirmUntil)
            {
                _resetConfirmUntil = 0f;
                UpdateResetDefaultsBtnText();
            }

            // 有界轮询 (0.25s / 约 4Hz)，仅在数值改变时更新 UI 控件，避免与滑动条交互冲突
            if (Time.unscaledTime < _nextSyncTime)
            {
                return;
            }
            _nextSyncTime = Time.unscaledTime + 0.25f;

            SyncFromConfig();
        }
    }
}
