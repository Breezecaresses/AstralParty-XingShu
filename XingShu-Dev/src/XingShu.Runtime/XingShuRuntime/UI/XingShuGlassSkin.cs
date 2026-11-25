using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using XingShu.Runtime;

namespace XingShuRuntime.UI
{
    /// <summary>
    /// Procedural anti-aliased SDF rounded-glass sprite and theme renderer for XingShu Function Center v2.
    /// Designed cleanly on pure UnityEngine.UI (zero shaders/native P/Invoke) so both PC & Android render
    /// frosted translucent cards, hairline borders, and external IXingShuExternalPage plugin mounts identically.
    /// </summary>
    internal static class XingShuGlassSkin
    {
        internal static readonly Color BackdropDim = new Color(0.03f, 0.05f, 0.10f, 0.54f);
        internal static readonly Color ShellFill = new Color(0.08f, 0.11f, 0.17f, 0.84f);
        internal static readonly Color ShellBorder = new Color(1f, 1f, 1f, 0.18f);
        internal static readonly Color RailFill = new Color(0.11f, 0.15f, 0.23f, 0.72f);
        internal static readonly Color RailBorder = new Color(1f, 1f, 1f, 0.14f);
        internal static readonly Color HeaderFill = new Color(0.14f, 0.19f, 0.28f, 0.62f);

        internal static readonly Color CardFill = new Color(1f, 1f, 1f, 0.085f);
        internal static readonly Color CardAccentFill = new Color(0.36f, 0.68f, 1f, 0.14f);
        internal static readonly Color CardBorder = new Color(1f, 1f, 1f, 0.16f);
        internal static readonly Color CardAccentBorder = new Color(0.50f, 0.78f, 1f, 0.34f);

        internal static readonly Color TabNormalFill = new Color(1f, 1f, 1f, 0.05f);
        internal static readonly Color TabHoverFill = new Color(1f, 1f, 1f, 0.12f);
        internal static readonly Color TabSelectedFill = new Color(0.36f, 0.68f, 1f, 0.25f);
        internal static readonly Color TabSelectedBorder = new Color(0.55f, 0.82f, 1f, 0.65f);

        internal static readonly Color ButtonFill = new Color(1f, 1f, 1f, 0.12f);
        internal static readonly Color ButtonAccentFill = new Color(0.28f, 0.60f, 0.96f, 0.86f);
        internal static readonly Color InputFill = new Color(0.05f, 0.07f, 0.12f, 0.62f);

        internal static readonly Color TextPrimary = new Color(0.95f, 0.97f, 1.00f, 1f);
        internal static readonly Color TextSecondary = new Color(0.74f, 0.80f, 0.89f, 1f);
        internal static readonly Color TextMuted = new Color(0.56f, 0.64f, 0.75f, 1f);
        internal static readonly Color AccentBlue = new Color(0.42f, 0.75f, 1.00f, 1f);
        internal static readonly Color AccentMint = new Color(0.32f, 0.86f, 0.66f, 1f);
        internal static readonly Color DividerLine = new Color(1f, 1f, 1f, 0.12f);

        private static readonly Dictionary<string, Sprite> _spriteCache = new Dictionary<string, Sprite>();

        internal static Sprite GetRoundedPanelSprite(int radius, Color fill, Color border, float borderThickness = 1.5f)
        {
            string key = $"{radius}|{ColorToKey(fill)}|{ColorToKey(border)}|{borderThickness:0.0}";
            if (_spriteCache.TryGetValue(key, out Sprite cached) && cached != null)
            {
                return cached;
            }

            int r = Mathf.Clamp(radius, 4, 28);
            int size = Mathf.Max(r * 2 + 12, 48);
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false)
            {
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp,
                hideFlags = HideFlags.HideAndDontSave,
            };

            Color32[] pixels = new Color32[size * size];
            float half = size * 0.5f;
            float innerHalf = half - r - 0.5f;

            for (int y = 0; y < size; y++)
            {
                float dy = Mathf.Max(Mathf.Abs((y + 0.5f) - half) - innerHalf, 0f);
                for (int x = 0; x < size; x++)
                {
                    float dx = Mathf.Max(Mathf.Abs((x + 0.5f) - half) - innerHalf, 0f);
                    float dist = Mathf.Sqrt(dx * dx + dy * dy) - r;

                    // Outer anti-aliased edge
                    float shapeAlpha = Mathf.Clamp01(0.5f - dist);
                    if (shapeAlpha <= 0.001f)
                    {
                        pixels[y * size + x] = new Color32(0, 0, 0, 0);
                        continue;
                    }

                    // Inner border blend near outer perimeter
                    float borderBlend = border.a > 0.001f
                        ? Mathf.Clamp01((dist + borderThickness) / borderThickness)
                        : 0f;

                    Color px = Color.Lerp(fill, border, borderBlend);
                    px.a *= shapeAlpha;
                    pixels[y * size + x] = (Color32)px;
                }
            }

            tex.SetPixels32(pixels);
            tex.Apply(false, true);

            float b = r + 2f;
            Sprite sprite = Sprite.Create(
                tex,
                new Rect(0f, 0f, size, size),
                new Vector2(0.5f, 0.5f),
                100f,
                0,
                SpriteMeshType.FullRect,
                new Vector4(b, b, b, b));
            sprite.hideFlags = HideFlags.HideAndDontSave;
            _spriteCache[key] = sprite;
            return sprite;
        }

        private static int ColorToKey(Color c)
        {
            Color32 c32 = c;
            return (c32.r << 24) | (c32.g << 16) | (c32.b << 8) | c32.a;
        }

        internal static Sprite ShellSprite => GetRoundedPanelSprite(20, ShellFill, ShellBorder, 1.5f);
        internal static Sprite RailSprite => GetRoundedPanelSprite(16, RailFill, RailBorder, 1.2f);
        internal static Sprite CardSprite => GetRoundedPanelSprite(12, CardFill, CardBorder, 1.2f);
        internal static Sprite CardAccentSprite => GetRoundedPanelSprite(12, CardAccentFill, CardAccentBorder, 1.4f);
        internal static Sprite TabNormalSprite => GetRoundedPanelSprite(10, TabNormalFill, new Color(1f, 1f, 1f, 0.08f), 1f);
        internal static Sprite TabHoverSprite => GetRoundedPanelSprite(10, TabHoverFill, new Color(1f, 1f, 1f, 0.18f), 1f);
        internal static Sprite TabSelectedSprite => GetRoundedPanelSprite(10, TabSelectedFill, TabSelectedBorder, 1.4f);
        internal static Sprite ButtonSprite => GetRoundedPanelSprite(9, ButtonFill, new Color(1f, 1f, 1f, 0.22f), 1.2f);
        internal static Sprite ButtonAccentSprite => GetRoundedPanelSprite(9, ButtonAccentFill, new Color(0.75f, 0.90f, 1f, 0.45f), 1.2f);
        internal static Sprite PillBadgeSprite => GetRoundedPanelSprite(10, new Color(0.32f, 0.65f, 1f, 0.22f), new Color(0.52f, 0.80f, 1f, 0.42f), 1f);

        /// <summary>
        /// Walks existing module page GameObjects and translates opaque light/game-colored surfaces,
        /// outlines, and dark text into clean translucent frosted glass styling so all 22+ views work
        /// seamlessly inside the Glassmorphism v2 container.
        /// </summary>
        internal static void RestylePageForGlass(GameObject pageRoot)
        {
            if (pageRoot == null) return;
            XingShuNativeGameUI.ClearPendingBindingsUnder(pageRoot);

            Image[] images = pageRoot.GetComponentsInChildren<Image>(true);
            for (int i = 0; i < images.Length; i++)
            {
                Image img = images[i];
                if (img == null) continue;

                string n = img.gameObject.name;
                bool isToggleVisual = n == "Background" || n == "Checkmark";
                if (isToggleVisual)
                {
                    if (n == "Background")
                    {
                        img.sprite = GetRoundedPanelSprite(8, new Color(1f, 1f, 1f, 0.10f), new Color(1f, 1f, 1f, 0.35f), 1.4f);
                        img.color = Color.white;
                        img.type = Image.Type.Sliced;
                    }
                    else
                    {
                        img.sprite = GetRoundedPanelSprite(6, AccentMint, Color.clear, 1f);
                        img.color = Color.white;
                        img.type = Image.Type.Sliced;
                    }
                    continue;
                }

                if (img.GetComponent<Button>() != null)
                {
                    // Avoid turning small dot/icon buttons completely opaque; keep crisp glass pills.
                    img.sprite = ButtonSprite;
                    img.type = Image.Type.Sliced;
                    img.color = Color.white;
                    continue;
                }

                if (img.GetComponent<InputField>() != null)
                {
                    img.sprite = GetRoundedPanelSprite(8, InputFill, new Color(1f, 1f, 1f, 0.24f), 1.2f);
                    img.type = Image.Type.Sliced;
                    img.color = Color.white;
                    continue;
                }

                if (n.IndexOf("Fill", StringComparison.OrdinalIgnoreCase) >= 0 && img.transform.parent != null && img.transform.parent.name.IndexOf("Fill Area", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    img.sprite = GetRoundedPanelSprite(6, AccentBlue, Color.clear, 1f);
                    img.type = Image.Type.Sliced;
                    img.color = Color.white;
                    continue;
                }

                if (n.IndexOf("Handle", StringComparison.OrdinalIgnoreCase) >= 0 && img.transform.parent != null && img.transform.parent.name.IndexOf("Handle", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    img.sprite = GetRoundedPanelSprite(12, Color.white, AccentBlue, 1.5f);
                    img.type = Image.Type.Simple;
                    img.color = Color.white;
                    continue;
                }

                bool looksLikeCard = n.StartsWith("Card", StringComparison.OrdinalIgnoreCase)
                    || n.IndexOf("Card_", StringComparison.OrdinalIgnoreCase) >= 0
                    || n.IndexOf("Feature", StringComparison.OrdinalIgnoreCase) >= 0
                    || n.IndexOf("Panel", StringComparison.OrdinalIgnoreCase) >= 0;

                if (looksLikeCard)
                {
                    bool accent = n.IndexOf("Header", StringComparison.OrdinalIgnoreCase) >= 0 || n.IndexOf("Feature", StringComparison.OrdinalIgnoreCase) >= 0;
                    img.sprite = accent ? CardAccentSprite : CardSprite;
                    img.type = Image.Type.Sliced;
                    img.color = Color.white;
                    continue;
                }

                if (img.color.a > 0.08f && img.sprite != null)
                {
                    string sp = img.sprite.name ?? "";
                    if (sp.IndexOf("card_base", StringComparison.OrdinalIgnoreCase) >= 0
                        || sp.IndexOf("card_feature", StringComparison.OrdinalIgnoreCase) >= 0
                        || sp.IndexOf("UISprite", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        img.sprite = CardSprite;
                        img.type = Image.Type.Sliced;
                        img.color = Color.white;
                    }
                    else if (sp.IndexOf("button_", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        img.sprite = ButtonSprite;
                        img.type = Image.Type.Sliced;
                        img.color = Color.white;
                    }
                }
            }

            // Strip heavy black outlines so glass typography stays clean and crisp
            Outline[] outlines = pageRoot.GetComponentsInChildren<Outline>(true);
            for (int i = 0; i < outlines.Length; i++)
            {
                if (outlines[i] != null) UnityEngine.Object.Destroy(outlines[i]);
            }

            Text[] texts = pageRoot.GetComponentsInChildren<Text>(true);
            for (int i = 0; i < texts.Length; i++)
            {
                Text txt = texts[i];
                if (txt == null) continue;
                Color c = txt.color;
                float lum = 0.299f * c.r + 0.587f * c.g + 0.114f * c.b;
                string name = txt.gameObject.name;

                if (txt.fontStyle == FontStyle.Bold || name == "Title" || name == "Text")
                {
                    txt.color = lum < 0.55f ? TextPrimary : c;
                }
                else if (name.IndexOf("Value", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    txt.color = AccentBlue;
                }
                else if (name.IndexOf("Status", StringComparison.OrdinalIgnoreCase) >= 0 || name.IndexOf("Hint", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    txt.color = lum < 0.62f ? AccentMint : c;
                }
                else if (lum < 0.60f)
                {
                    txt.color = TextSecondary;
                }
            }
        }
    }

    /// <summary>
    /// Built-in overview page inside the Glassmorphism v2 Function Center listing
    /// mounted external optimization mods & plugins registered via XingShuCenterPluginHost.
    /// </summary>
    internal sealed class XingShuPluginHubView
    {
        private readonly GameObject _root;
        private readonly Action _onSwitchOriginalStyle;
        private Text _pluginSummaryText;
        private GameObject _content;
        private int _lastCount = -1;

        internal GameObject Root => _root;

        internal XingShuPluginHubView(Transform parent, Action onSwitchOriginalStyle)
        {
            _onSwitchOriginalStyle = onSwitchOriginalStyle;
            _root = XingShuUIFactory.CreateUIObject("Page_PluginHub", parent.gameObject);
            BuildUI();
            UpdateSync();
        }

        private void BuildUI()
        {
            XingShuViewCardHelper.CreatePageScroll(_root, "PluginHubScroll", out _content);

            GameObject hero = XingShuViewCardHelper.CreateCardContainer(_content, "Card_GlassFrameworkHeader", 156f, featureHeader: true);
            Text title = XingShuUIFactory.CreateText(hero, "Title", "毛玻璃扩展框架 · 外部优化 Mod / 插件宿主 (v2)", 18, XingShuGlassSkin.TextPrimary, TextAnchor.MiddleLeft, FontStyle.Bold);
            XingShuViewCardHelper.PlaceTopLeft(title.rectTransform, new Vector2(20f, -12f), new Vector2(560f, 28f));

            Text desc = XingShuUIFactory.CreateText(
                hero,
                "Description",
                "本界面为未来第三方优化 Mod 与外部功能插件提供统一毛玻璃圆角容器。所有插件通过 XingShuCenterPluginHost 注册后自动出现在左侧「扩展框架」栏位中，PC 与安卓端共享同一宿主契约。",
                13,
                XingShuGlassSkin.TextSecondary,
                TextAnchor.UpperLeft);
            XingShuViewCardHelper.PlaceStretchTop(desc.rectTransform, 44f, 44f, 40f);

            _pluginSummaryText = XingShuUIFactory.CreateText(hero, "Status", "", 13, XingShuGlassSkin.AccentMint, TextAnchor.MiddleLeft);
            XingShuViewCardHelper.PlaceStretchTop(_pluginSummaryText.rectTransform, 94f, 26f, 240f);

            Button backBtn = XingShuViewCardHelper.CreateActionButton(hero, "SwitchToOriginal", "切换原版游戏风 UI", () => _onSwitchOriginalStyle?.Invoke(), 172f, 34f, 13);
            XingShuViewCardHelper.PlaceTopRight(backBtn.GetComponent<RectTransform>(), new Vector2(-20f, -102f), new Vector2(172f, 34f));

            RebuildMountedPluginCards();
        }

        private void RebuildMountedPluginCards()
        {
            IXingShuExternalPage[] pages = XingShuCenterPluginHost.GetPagesSnapshot();
            _lastCount = pages.Length;

            if (_pluginSummaryText != null)
            {
                _pluginSummaryText.text = pages.Length > 0
                    ? $"已挂载外部扩展页：{pages.Length} 个 · 运行时：{XingShuRuntimeHost.RuntimeVersion}"
                    : $"当前暂无外部插件注册页面（内置模块均已自适应毛玻璃外观）· 运行时：{XingShuRuntimeHost.RuntimeVersion}";
            }

            if (_content == null) return;
            for (int i = _content.transform.childCount - 1; i >= 1; i--)
            {
                UnityEngine.Object.Destroy(_content.transform.GetChild(i).gameObject);
            }

            if (pages.Length == 0)
            {
                GameObject guide = XingShuViewCardHelper.CreateCardContainer(_content, "Card_PluginSdkHint", 136f);
                Text gTitle = XingShuUIFactory.CreateText(guide, "Title", "外部优化 Mod 接入说明", 16, XingShuGlassSkin.TextPrimary, TextAnchor.MiddleLeft, FontStyle.Bold);
                XingShuViewCardHelper.PlaceTopLeft(gTitle.rectTransform, new Vector2(20f, -12f), new Vector2(400f, 24f));

                Text gDesc = XingShuUIFactory.CreateText(
                    guide,
                    "Description",
                    "外部 C# 插件或优化模块只需调用：\nXingShuCenterPluginHost.RegisterSimplePage(id, title, category, subtitle, order, buildContent, onSync)\n即可免改星枢核心代码，直接拥有毛玻璃侧边栏入口、滚动容器与统一卡片控件。",
                    13,
                    XingShuGlassSkin.TextSecondary,
                    TextAnchor.UpperLeft);
                XingShuViewCardHelper.PlaceStretchTop(gDesc.rectTransform, 42f, 76f, 40f);
            }
            else
            {
                for (int i = 0; i < pages.Length; i++)
                {
                    IXingShuExternalPage p = pages[i];
                    GameObject card = XingShuViewCardHelper.CreateCardContainer(_content, "Card_Ext_" + p.Id, 92f);
                    Text t = XingShuUIFactory.CreateText(card, "Title", $"{p.Title}  ({p.Category})", 16, XingShuGlassSkin.TextPrimary, TextAnchor.MiddleLeft, FontStyle.Bold);
                    XingShuViewCardHelper.PlaceTopLeft(t.rectTransform, new Vector2(20f, -12f), new Vector2(560f, 26f));

                    Text s = XingShuUIFactory.CreateText(card, "Description", string.IsNullOrEmpty(p.Subtitle) ? $"标识：{p.Id} · 排序：{p.Order}" : p.Subtitle, 13, XingShuGlassSkin.TextSecondary, TextAnchor.MiddleLeft);
                    XingShuViewCardHelper.PlaceStretchTop(s.rectTransform, 44f, 30f, 40f);
                }
            }
            XingShuGlassSkin.RestylePageForGlass(_root);
        }

        internal void UpdateSync()
        {
            IXingShuExternalPage[] pages = XingShuCenterPluginHost.GetPagesSnapshot();
            if (pages.Length != _lastCount)
            {
                RebuildMountedPluginCards();
            }
        }
    }
}
