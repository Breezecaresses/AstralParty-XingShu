using System;
using System.Collections.Generic;
using System.Globalization;
using XingShu.Cards;
using XingShuRuntime.Core;
using XingShuRuntime.MatchPort;
using XingShuRuntime.UI;
using UnityEngine;
using UnityEngine.UI;

namespace XingShuRuntime.Utilities
{
    internal sealed class StatsWidgetView : IDisposable
    {
        private const int PlayerCount = 4;
        private const float PadX = 10f;
        private const float PlayerColWidth = 140f;
        private const float ColGap = 6f;
        private const float RowTopY = 68f;
        private const float RowHeight = 32f;
        private const float RowStep = 35f;

        private static readonly Color PanelTint = new Color(0.45f, 0.54f, 0.70f, 1f);
        private static readonly Color HeaderTint = new Color(0.50f, 0.58f, 0.74f, 0.48f);
        private static readonly Color HeaderAccentColor = new Color(0.24f, 0.85f, 0.92f, 1f);
        private static readonly Color StatusGoldColor = new Color(0.96f, 0.78f, 0.35f, 1f);
        private static readonly Color HeaderBtnBg = new Color(0.24f, 0.30f, 0.42f, 0.90f);
        private static readonly Color HeaderBtnActiveBg = new Color(0.16f, 0.56f, 0.62f, 0.94f);
        private static readonly Color ColPillBg = new Color(0.05f, 0.08f, 0.14f, 0.82f);
        private static readonly Color RowBgEven = new Color(0.14f, 0.19f, 0.28f, 0.62f);
        private static readonly Color RowBgOdd = new Color(0.11f, 0.15f, 0.23f, 0.46f);
        private static readonly Color RowActiveOfferBg = new Color(0.14f, 0.36f, 0.44f, 0.68f);
        private static readonly Color RowLeaderFill = new Color(0.14f, 0.52f, 0.46f, 0.36f);
        private static readonly Color DetailDividerColor = new Color(0.24f, 0.85f, 0.92f, 0.35f);
        private static readonly Color TextPrimaryLight = new Color(0.96f, 0.98f, 1f, 1f);
        private static readonly Color TextSubtleLight = new Color(0.70f, 0.77f, 0.86f, 1f);
        private static readonly Color TextLeaderMint = new Color(0.32f, 0.95f, 0.70f, 1f);

        private static Sprite _solidSprite;

        private readonly Action _hide;
        internal readonly StatsWidgetPreferences Preferences = new StatsWidgetPreferences();
        private GameObject _root, _body, _detailSection, _detailContent;
        private RectTransform _widget, _heading, _dragHandle, _playerColLabel, _detailDividerRt, _detailScrollRt;
        private Image _background, _btnModeBg;
        private Text _title, _status, _footer, _btnModeText;
        private Button _btnMode, _btnCollapse, _btnSettings, _btnClose;
        private StatsWidgetDrag _drag;

        private readonly RectTransform[] _metricHeaders = new RectTransform[StatsWidgetMetricCatalog.Count];
        private readonly RectTransform[] _rowRects = new RectTransform[PlayerCount];
        private readonly RectTransform[] _rowFillRects = new RectTransform[PlayerCount];
        private readonly Image[] _rowFillImages = new Image[PlayerCount];
        private readonly RawImage[] _avatars = new RawImage[PlayerCount];
        private readonly string[] _loadedHeads = new string[PlayerCount];
        private readonly int[] _loadedHeroIds = new int[PlayerCount];
        private readonly Text[] _names = new Text[PlayerCount];
        private readonly Text[] _subs = new Text[PlayerCount];
        private readonly Text[,] _cells = new Text[PlayerCount, StatsWidgetMetricCatalog.Count];

        private readonly Button[] _detailTabBtns = new Button[4];
        private readonly Image[] _detailTabBgs = new Image[4];
        private readonly Button[] _detailPlayerBtns = new Button[5];
        private readonly Image[] _detailPlayerBgs = new Image[5];
        private readonly Text[] _detailPlayerLabels = new Text[5];
        private readonly long[] _detailPlayerIds = new long[5];
        private readonly List<GameObject> _detailRowPool = new List<GameObject>(24);
        private readonly List<Text> _detailRowTexts = new List<Text>(24);
        private readonly List<Image> _detailRowBgs = new List<Image>(24);

        private StatsWidgetFrame _frame;
        private int _metricMask = StatsWidgetMetricCatalog.DefaultMask;
        private bool _collapsed;
        private bool _detailedMode;
        private int _detailTab;
        private long _detailFilterPlayerId;
        private int _lastDetailLedgerVersion = -1;
        private int _lastDetailTab = -1;
        private long _lastDetailFilterPlayer = -1;
        private bool _lastDetailModeRendered;

        internal bool Ready => _root != null;
        internal bool SettingsVisible => false;
        internal Rect WidgetBounds => XingShuOverlayInput.ScreenRect(_widget);
        internal Rect SettingsBounds => default(Rect);

        internal StatsWidgetView(Action hide, Action<bool> observe) { _hide = hide; Load(); }

        private static Sprite GetSolidSprite()
        {
            if (_solidSprite != null) return _solidSprite;
            var tex = new Texture2D(1, 1, TextureFormat.RGBA32, false);
            tex.SetPixel(0, 0, Color.white);
            tex.Apply(false, true);
            _solidSprite = Sprite.Create(tex, new Rect(0, 0, 1, 1), new Vector2(0.5f, 0.5f));
            return _solidSprite;
        }

        private static Image AddSolidRect(Transform parent, string name, float x, float y, float w, float h, Color color)
        {
            var rt = XingShuDetailLayout.Box(parent, name, x, y, w, h);
            var img = rt.gameObject.AddComponent<Image>();
            img.sprite = GetSolidSprite();
            img.color = color;
            img.raycastTarget = false;
            return img;
        }

        private static Button CreateHeaderPillButton(Transform parent, string caption, float w, Action action)
        {
            var sprite = XingShuUIAssetService.GetSprite("hotkey_badge.png");
            var btn = XingShuUIFactory.CreateButton(parent.gameObject, "Btn_" + caption, caption,
                sprite, XingShuUIAssetService.IsFallbackSprite(sprite) ? HeaderBtnBg : HeaderBtnBg, TextPrimaryLight, action, 11);
            var rt = btn.GetComponent<RectTransform>();
            rt.anchorMin = rt.anchorMax = rt.pivot = new Vector2(0, 1);
            rt.sizeDelta = new Vector2(w, 22f);
            var label = btn.GetComponentInChildren<Text>();
            if (label != null) label.color = TextPrimaryLight;
            return btn;
        }

        internal void Build()
        {
            XingShuCentralInputManager.EnsureEventSystemAvailable("StatsWidget");
            _root = new GameObject("XINGSHU_StatsWidget", typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster));
            UnityEngine.Object.DontDestroyOnLoad(_root);
            var canvas = _root.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 30020;

            float width = CurrentPanelWidth;
            float height = CurrentPanelHeight;
            _widget = XingShuDetailLayout.Box(_root.transform, "Widget", 0, 0, width, height);
            _background = XingShuDetailLayout.Panel(_widget, "window_frame.png", Preferences.Background);
            _background.color = new Color(PanelTint.r, PanelTint.g, PanelTint.b, Preferences.Background);

            _heading = XingShuDetailLayout.Box(_widget, "Header", 0, 0, width, StatsWidgetPreferences.HeaderHeight);
            var headImg = XingShuDetailLayout.Panel(_heading, "header_bar.png", HeaderTint.a);
            headImg.color = HeaderTint;

            AddSolidRect(_heading, "Accent", 11, 11, 3, 16, HeaderAccentColor);
            _title = XingShuDetailLayout.Text(_heading, "对局统计", 20, 4, 68, 30, 14);
            _title.color = TextPrimaryLight;
            _title.fontStyle = FontStyle.Bold;

            _status = XingShuDetailLayout.Text(_heading, "实时参考", 90, 5, 110, 28, 10);
            _status.color = StatusGoldColor;

            var handle = XingShuDetailLayout.Box(_heading, "Drag", 0, 0, width - 120f, StatsWidgetPreferences.HeaderHeight);
            handle.gameObject.AddComponent<Image>().color = Color.clear;
            _dragHandle = handle;
            _drag = handle.gameObject.AddComponent<StatsWidgetDrag>();
            _drag.View = this;
            _drag.BindEvents();

            _btnMode = CreateHeaderPillButton(_heading, "详细", 46f, ToggleDetailedMode);
            _btnModeBg = _btnMode.GetComponent<Image>();
            _btnModeText = _btnMode.GetComponentInChildren<Text>();
            _btnCollapse = CreateHeaderPillButton(_heading, "−", 26f, ToggleCollapse);
            _btnSettings = CreateHeaderPillButton(_heading, "设置", 44f, XingShuUICenter.OpenBattleStatsPage);
            _btnClose = CreateHeaderPillButton(_heading, "×", 26f, () => { Show(false); _hide(); });

            _body = XingShuUIFactory.CreateUIObject("Body", _widget.gameObject);
            XingShuDetailLayout.Fill(_body.GetComponent<RectTransform>());

            _playerColLabel = XingShuDetailLayout.Box(_body.transform, "ColPlayer", PadX + 2f, 42f, PlayerColWidth, 22f);
            var playerColText = XingShuDetailLayout.Text(_playerColLabel, "玩家 / 角色", 2, 0, PlayerColWidth - 4f, 22f, 10);
            playerColText.color = TextSubtleLight;

            Sprite pillSprite = XingShuUIAssetService.GetSprite("hotkey_badge.png");
            for (int c = 0; c < StatsWidgetMetricCatalog.Count; c++)
            {
                var pillRt = XingShuDetailLayout.Box(_body.transform, "Col_" + c, 0, 42f, 44f, 21f);
                var pillImg = pillRt.gameObject.AddComponent<Image>();
                pillImg.sprite = pillSprite != null ? pillSprite : GetSolidSprite();
                pillImg.type = pillSprite != null ? Image.Type.Sliced : Image.Type.Simple;
                pillImg.color = ColPillBg;
                pillImg.raycastTarget = false;

                var colLabel = XingShuDetailLayout.Text(pillRt, StatsWidgetMetricCatalog.Labels[c], 2, 0, 40f, 21f, 10);
                colLabel.rectTransform.anchorMin = Vector2.zero;
                colLabel.rectTransform.anchorMax = Vector2.one;
                colLabel.rectTransform.offsetMin = new Vector2(2f, 0f);
                colLabel.rectTransform.offsetMax = new Vector2(-2f, 0f);
                colLabel.alignment = TextAnchor.MiddleCenter;
                colLabel.color = TextPrimaryLight;
                colLabel.resizeTextForBestFit = true;
                colLabel.resizeTextMinSize = 8;
                colLabel.resizeTextMaxSize = 10;
                _metricHeaders[c] = pillRt;
            }

            for (int row = 0; row < PlayerCount; row++)
            {
                var rowRt = XingShuDetailLayout.Box(_body.transform, "Row_" + row, PadX, RowTopY + row * RowStep, width - 2f * PadX, RowHeight);
                var bg = rowRt.gameObject.AddComponent<Image>();
                bg.sprite = GetSolidSprite();
                bg.color = row % 2 == 0 ? RowBgEven : RowBgOdd;
                bg.raycastTarget = false;
                _rowRects[row] = rowRt;

                var fillImg = AddSolidRect(rowRt, "Fill", 0, 0, 0, RowHeight, RowLeaderFill);
                _rowFillRects[row] = fillImg.rectTransform;
                _rowFillImages[row] = fillImg;

                var avatarRt = XingShuDetailLayout.Box(rowRt, "Avatar", 6f, 4f, 24f, 24f);
                var avatar = avatarRt.gameObject.AddComponent<RawImage>();
                avatar.raycastTarget = false;
                avatar.enabled = false;
                _avatars[row] = avatar;

                var nameText = XingShuDetailLayout.Text(rowRt, "P" + (row + 1) + " 等待中", 35f, 2f, 104f, 16f, 11);
                nameText.supportRichText = true;
                nameText.color = TextPrimaryLight;
                nameText.verticalOverflow = VerticalWrapMode.Truncate;
                nameText.fontStyle = FontStyle.Bold;
                _names[row] = nameText;

                var subText = XingShuDetailLayout.Text(rowRt, "P" + (row + 1) + " · 未入局", 35f, 17f, 104f, 13f, 9);
                subText.color = TextSubtleLight;
                subText.verticalOverflow = VerticalWrapMode.Truncate;
                _subs[row] = subText;

                for (int c = 0; c < StatsWidgetMetricCatalog.Count; c++)
                {
                    var cellText = XingShuDetailLayout.Text(rowRt, "—", 0, 0, 44f, RowHeight, 13);
                    cellText.alignment = TextAnchor.MiddleCenter;
                    cellText.color = TextPrimaryLight;
                    cellText.resizeTextForBestFit = true;
                    cellText.resizeTextMinSize = 9;
                    cellText.resizeTextMaxSize = 13;
                    _cells[row, c] = cellText;
                }
            }

            _detailSection = XingShuUIFactory.CreateUIObject("DetailSection", _body);
            XingShuDetailLayout.Fill(_detailSection.GetComponent<RectTransform>());

            var dividerImg = AddSolidRect(_detailSection.transform, "DetailDivider", PadX, 210f, width - 2f * PadX, 1f, DetailDividerColor);
            _detailDividerRt = dividerImg.rectTransform;

            string[] detailTabs = { "实时概览", "全部历史", "商店购牌", "筹码记录" };
            for (int t = 0; t < detailTabs.Length; t++)
            {
                int tabIndex = t;
                var tabBtn = CreateHeaderPillButton(_detailSection.transform, detailTabs[t], 82f, () => SelectDetailTab(tabIndex));
                tabBtn.GetComponent<RectTransform>().sizeDelta = new Vector2(82f, 21f);
                _detailTabBtns[t] = tabBtn;
                _detailTabBgs[t] = tabBtn.GetComponent<Image>();
            }

            for (int p = 0; p < _detailPlayerBtns.Length; p++)
            {
                int idx = p;
                var pBtn = CreateHeaderPillButton(_detailSection.transform, p == 0 ? "全部角色" : ("P" + p), 96f, () => SelectDetailPlayer(idx));
                var pRt = pBtn.GetComponent<RectTransform>();
                pRt.sizeDelta = new Vector2(96f, 20f);
                var pTxt = pBtn.GetComponentInChildren<Text>();
                if (pTxt != null)
                {
                    pTxt.fontSize = 10;
                    pTxt.resizeTextForBestFit = true;
                    pTxt.resizeTextMinSize = 8;
                    pTxt.resizeTextMaxSize = 10;
                }
                _detailPlayerBtns[p] = pBtn;
                _detailPlayerBgs[p] = pBtn.GetComponent<Image>();
                _detailPlayerLabels[p] = pTxt;
            }

            _detailScrollRt = XingShuDetailLayout.Box(_detailSection.transform, "DetailScrollBox", PadX, 266f, width - 2f * PadX, 196f);
            var scrollBg = _detailScrollRt.gameObject.AddComponent<Image>();
            scrollBg.sprite = GetSolidSprite();
            scrollBg.color = new Color(0.05f, 0.08f, 0.14f, 0.42f);
            scrollBg.raycastTarget = false;

            XingShuUIFactory.CreateVerticalScrollView(_detailScrollRt.gameObject, "DetailScroll", out _detailContent);
            var vlg = _detailContent.GetComponent<VerticalLayoutGroup>();
            if (vlg != null)
            {
                vlg.spacing = 4f;
                vlg.padding = new RectOffset(4, 8, 4, 4);
            }

            _footer = XingShuDetailLayout.Text(_body.transform, "4人同屏 · 实时参考", PadX + 2f, 210f, width - 2f * PadX - 4f, 16f, 9);
            _footer.color = TextSubtleLight;

            ReloadPreferences();
            Show(false);
        }

        internal bool DetailedMode => _detailedMode;

        private float CurrentPanelWidth => StatsWidgetPreferences.PanelWidth(StatsWidgetMetricCatalog.CountEnabled(_metricMask), _detailedMode);
        private float CurrentPanelHeight => StatsWidgetPreferences.PanelHeight(StatsWidgetMetricCatalog.CountEnabled(_metricMask), _collapsed, _detailedMode);

        internal void Show(bool show) { if (Ready) _root.SetActive(show); }

        internal void Refresh(StatsWidgetFrame frame)
        {
            if (!Ready || frame == null) return;
            _frame = frame;

            bool settled = false;
            for (int i = 0; i < frame.Players.Length; i++)
            {
                if (frame.Players[i] != null && frame.Players[i].State == "已结算") { settled = true; break; }
            }
            if (_detailedMode)
            {
                int round = Math.Max(1, MatchProtocolObserver.EconomyLedger.CurrentRound);
                _title.text = "详细对局统计";
                _status.text = !frame.Enabled ? "已关闭" : settled ? $"已结算 · R{round}" : $"第{round}回合 · 实时明细";
            }
            else
            {
                _title.text = "对局统计";
                _status.text = !frame.Enabled ? "已关闭" : settled ? "已结算" : (frame.Partial ? "部分数据" : "实时参考");
            }

            // Compute column max numeric value per metric to highlight leaders cleanly in mint green.
            double[] colMax = new double[StatsWidgetMetricCatalog.Count];
            double[,] parsed = new double[PlayerCount, StatsWidgetMetricCatalog.Count];
            for (int row = 0; row < PlayerCount; row++)
            {
                var p = frame.Players[row];
                for (int c = 0; c < StatsWidgetMetricCatalog.Count; c++)
                {
                    double val = ParseNumeric(p?.Metrics[StatsWidgetMetricCatalog.FrameMetricIndices[c]]);
                    parsed[row, c] = val;
                    if (val > colMax[c]) colMax[c] = val;
                }
            }

            // Pick a representative score/metric ratio for the subtle horizontal bar fill per row (Score -> Damage -> ActualDamage -> Steps -> Coins).
            double bestRowStrength = 0d;
            double[] rowStrength = new double[PlayerCount];
            for (int row = 0; row < PlayerCount; row++)
            {
                var p = frame.Players[row];
                if (p == null) continue;
                double s = ParseNumeric(p.Score);
                if (s <= 0d) s = parsed[row, 2] > 0d ? parsed[row, 2] : (parsed[row, 3] > 0d ? parsed[row, 3] : (parsed[row, 8] > 0d ? parsed[row, 8] : parsed[row, 6]));
                rowStrength[row] = s;
                if (s > bestRowStrength) bestRowStrength = s;
            }

            float usableRowW = CurrentPanelWidth - 2f * PadX;
            for (int row = 0; row < PlayerCount; row++)
            {
                var p = frame.Players[row];
                _names[row].text = p == null ? "等待玩家" : StatsWidgetPresenter.Name(p.Name);
                string charName = p?.Character ?? "未入局";
                string prefix = (p != null && p.Mvp) ? "MVP · " : "";
                _subs[row].text = prefix + "P" + (row + 1) + " · " + charName;
                _subs[row].color = (p != null && p.Mvp)
                    ? new Color(StatusGoldColor.r, StatusGoldColor.g, StatusGoldColor.b, Preferences.TextAlpha)
                    : new Color(TextSubtleLight.r, TextSubtleLight.g, TextSubtleLight.b, Preferences.TextAlpha);

                float fillW = (bestRowStrength > 0d && rowStrength[row] > 0d)
                    ? usableRowW * Mathf.Clamp01((float)(rowStrength[row] / bestRowStrength))
                    : 0f;
                _rowFillRects[row].sizeDelta = new Vector2(fillW, RowHeight);

                for (int c = 0; c < StatsWidgetMetricCatalog.Count; c++)
                {
                    string text = p?.Metrics[StatsWidgetMetricCatalog.FrameMetricIndices[c]] ?? "—";
                    var cell = _cells[row, c];
                    cell.text = text;
                    bool isLeader = colMax[c] > 0d && parsed[row, c] > 0d && Math.Abs(parsed[row, c] - colMax[c]) < 0.0001d;
                    Color baseColor = isLeader ? TextLeaderMint : TextPrimaryLight;
                    cell.color = new Color(baseColor.r, baseColor.g, baseColor.b, Preferences.TextAlpha);
                }

                RefreshAvatar(row, p);
            }

            _footer.text = _detailedMode
                ? "普通 / 详细卡片一键切换 · 支持滚轮翻页与按角色/商店/筹码筛选"
                : frame.Footer;
            if (_detailedMode)
            {
                RefreshDetailSection(force: false);
            }
            Layout();
        }

        private void RefreshAvatar(int slot, StatsWidgetFrame.Player player)
        {
            int heroId = player?.HeroId ?? 0;
            string head = player?.HeadUrl ?? "";
            if (head == _loadedHeads[slot] && heroId == _loadedHeroIds[slot]) return;

            _loadedHeads[slot] = head;
            _loadedHeroIds[slot] = heroId;
            var avatar = _avatars[slot];
            avatar.texture = null;

            var candidates = new List<string>(2);
            if (heroId > 0)
            {
                string emote = CharacterEmoteRegistry.PickStaticEmote(heroId, slot);
                if (!string.IsNullOrEmpty(emote)) candidates.Add(emote);
            }
            if (!string.IsNullOrEmpty(head)) candidates.Add(head);

            avatar.enabled = candidates.Count > 0;
            if (avatar.enabled)
            {
                XingShuDetailImages.Load(avatar, candidates, 0, () => _loadedHeads[slot] == head && _loadedHeroIds[slot] == heroId);
            }
        }

        private static double ParseNumeric(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return 0d;
            string s = raw.Trim();
            if (s == "—" || s == "-") return 0d;
            if (s.StartsWith("≥") || s.StartsWith("≈")) s = s.Substring(1).Trim();
            double mul = 1d;
            if (s.EndsWith("万亿")) { mul = 1e12; s = s.Substring(0, s.Length - 2); }
            else if (s.EndsWith("亿")) { mul = 1e8; s = s.Substring(0, s.Length - 1); }
            else if (s.EndsWith("万")) { mul = 1e4; s = s.Substring(0, s.Length - 1); }
            s = s.Replace(",", "");
            double value;
            return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out value) ? value * mul : 0d;
        }

        private void PreserveAnchorOnResize(Action applyStateChange)
        {
            if (!Ready)
            {
                applyStateChange();
                return;
            }
            Rect safe = XingShuMobileUIHelper.SafeScreenRect;
            float safeTop = Screen.height - safe.yMax;
            var oldBounds = Preferences.Layout(safe.x, safeTop, safe.width, safe.height, BaseScale, CurrentPanelWidth, CurrentPanelHeight);
            applyStateChange();
            var newBounds = Preferences.Layout(safe.x, safeTop, safe.width, safe.height, BaseScale, CurrentPanelWidth, CurrentPanelHeight);
            float margin = Math.Min(12f, Math.Min(safe.width, safe.height) * 0.025f);
            float availW = Math.Max(1f, safe.width - 2f * margin);
            float availH = Math.Max(1f, safe.height - 2f * margin);
            float newRangeX = Math.Max(0f, availW - newBounds.Width);
            float newRangeY = Math.Max(0f, availH - newBounds.Height);
            if (newRangeX > 0.01f)
            {
                Preferences.X = StatsWidgetPreferences.Limit((oldBounds.X - (safe.x + margin)) / newRangeX, 0f, 1f, Preferences.X);
            }
            if (newRangeY > 0.01f)
            {
                Preferences.Y = StatsWidgetPreferences.Limit((oldBounds.Y - (safeTop + margin)) / newRangeY, 0f, 1f, Preferences.Y);
            }
        }

        private void ToggleCollapse()
        {
            if (!Ready) return;
            PreserveAnchorOnResize(() =>
            {
                _collapsed = !_collapsed;
                var collapseLabel = _btnCollapse != null ? _btnCollapse.GetComponentInChildren<Text>() : null;
                if (collapseLabel != null) collapseLabel.text = _collapsed ? "+" : "−";
            });
            Layout();
        }

        internal void SetDetailedMode(bool detailed)
        {
            XingShuConfigService.SetBool(XingShuConfigKeys.StatsWidgetDetailedMode, detailed);
            XingShuConfigService.Save();
            if (_detailedMode == detailed && (!detailed || !_collapsed))
            {
                UpdateModeButtonVisual();
                return;
            }
            PreserveAnchorOnResize(() =>
            {
                _detailedMode = detailed;
                if (_detailedMode && _collapsed)
                {
                    _collapsed = false;
                    var collapseLabel = _btnCollapse != null ? _btnCollapse.GetComponentInChildren<Text>() : null;
                    if (collapseLabel != null) collapseLabel.text = "−";
                }
            });
            UpdateModeButtonVisual();
            if (_detailedMode)
            {
                RefreshDetailSection(force: true);
            }
            if (_frame != null) Refresh(_frame);
            else Layout();
        }

        internal void ToggleDetailedMode()
        {
            SetDetailedMode(!_detailedMode);
        }

        private void SelectDetailTab(int tabIndex)
        {
            _detailTab = Math.Max(0, Math.Min(3, tabIndex));
            RefreshDetailSection(force: true);
        }

        private void SelectDetailPlayer(int buttonIdx)
        {
            if (buttonIdx <= 0 || buttonIdx >= _detailPlayerIds.Length)
            {
                _detailFilterPlayerId = 0L;
            }
            else
            {
                long pid = _detailPlayerIds[buttonIdx];
                _detailFilterPlayerId = pid > 0 ? pid : 0L;
            }
            RefreshDetailSection(force: true);
        }

        private void UpdateModeButtonVisual()
        {
            if (_btnModeText != null)
            {
                _btnModeText.text = _detailedMode ? "普通" : "详细";
            }
            if (_btnModeBg != null)
            {
                _btnModeBg.color = _detailedMode ? HeaderBtnActiveBg : HeaderBtnBg;
            }
        }

        private void Layout()
        {
            if (!Ready) return;
            float panelWidth = CurrentPanelWidth;
            float panelHeight = CurrentPanelHeight;
            _body.SetActive(!_collapsed);
            _widget.sizeDelta = new Vector2(panelWidth, panelHeight);
            _heading.sizeDelta = new Vector2(panelWidth, StatsWidgetPreferences.HeaderHeight);
            _dragHandle.sizeDelta = new Vector2(Math.Max(100f, panelWidth - 168f), StatsWidgetPreferences.HeaderHeight);

            _title.rectTransform.sizeDelta = new Vector2(_detailedMode ? 96f : 68f, 30f);
            _status.rectTransform.anchoredPosition = new Vector2(_detailedMode ? 118f : 90f, -5f);
            _status.rectTransform.sizeDelta = new Vector2(_detailedMode ? 160f : 72f, 28f);

            _btnMode.GetComponent<RectTransform>().anchoredPosition = new Vector2(panelWidth - 162f, -8f);
            _btnCollapse.GetComponent<RectTransform>().anchoredPosition = new Vector2(panelWidth - 112f, -8f);
            _btnSettings.GetComponent<RectTransform>().anchoredPosition = new Vector2(panelWidth - 82f, -8f);
            _btnClose.GetComponent<RectTransform>().anchoredPosition = new Vector2(panelWidth - 34f, -8f);
            UpdateModeButtonVisual();

            int enabledCount = StatsWidgetMetricCatalog.CountEnabled(_metricMask);
            float colWidth = enabledCount <= 4 ? 56f : 46f;
            float rowW = panelWidth - 2f * PadX;
            float playerColW = Math.Max(PlayerColWidth, rowW - ColGap - enabledCount * colWidth);
            float metricStartX = PadX + playerColW + ColGap;

            _playerColLabel.sizeDelta = new Vector2(playerColW, 22f);
            float textBoxW = Math.Max(68f, playerColW - 38f);

            int pos = 0;
            for (int c = 0; c < StatsWidgetMetricCatalog.Count; c++)
            {
                bool on = StatsWidgetMetricCatalog.IsEnabled(_metricMask, c);
                _metricHeaders[c].gameObject.SetActive(on);
                for (int row = 0; row < PlayerCount; row++) _cells[row, c].gameObject.SetActive(on);
                if (!on) continue;

                float headerX = metricStartX + pos * colWidth;
                _metricHeaders[c].anchoredPosition = new Vector2(headerX + 2f, -42f);
                _metricHeaders[c].sizeDelta = new Vector2(colWidth - 4f, 21f);

                float cellX = playerColW + ColGap + pos * colWidth;
                for (int row = 0; row < PlayerCount; row++)
                {
                    var cellRt = _cells[row, c].rectTransform;
                    cellRt.anchoredPosition = new Vector2(cellX + 2f, 0f);
                    cellRt.sizeDelta = new Vector2(colWidth - 4f, RowHeight);
                }
                pos++;
            }

            for (int row = 0; row < PlayerCount; row++)
            {
                _rowRects[row].anchoredPosition = new Vector2(PadX, -(RowTopY + row * RowStep));
                _rowRects[row].sizeDelta = new Vector2(rowW, RowHeight);
                _names[row].rectTransform.sizeDelta = new Vector2(textBoxW, 16f);
                _subs[row].rectTransform.sizeDelta = new Vector2(textBoxW, 13f);
            }

            if (_detailSection != null)
            {
                _detailSection.SetActive(_detailedMode && !_collapsed);
                if (_detailedMode && !_collapsed)
                {
                    _detailDividerRt.anchoredPosition = new Vector2(PadX, -210f);
                    _detailDividerRt.sizeDelta = new Vector2(rowW, 1f);

                    float tabW = Mathf.Floor((rowW - 18f) / 4f);
                    for (int t = 0; t < _detailTabBtns.Length; t++)
                    {
                        var trt = _detailTabBtns[t].GetComponent<RectTransform>();
                        trt.anchoredPosition = new Vector2(PadX + t * (tabW + 6f), -216f);
                        trt.sizeDelta = new Vector2(tabW, 21f);
                    }

                    int visiblePlayers = 1;
                    for (int p = 1; p < _detailPlayerBtns.Length; p++)
                    {
                        if (_detailPlayerIds[p] > 0) visiblePlayers++;
                    }
                    float pGap = 5f;
                    float pBtnW = Mathf.Min(118f, Mathf.Floor((rowW - (visiblePlayers - 1) * pGap) / Math.Max(1, visiblePlayers)));
                    float px = PadX;
                    for (int p = 0; p < _detailPlayerBtns.Length; p++)
                    {
                        bool activePill = (p == 0 || _detailPlayerIds[p] > 0);
                        _detailPlayerBtns[p].gameObject.SetActive(activePill);
                        if (!activePill) continue;
                        var prt = _detailPlayerBtns[p].GetComponent<RectTransform>();
                        prt.anchoredPosition = new Vector2(px, -241f);
                        prt.sizeDelta = new Vector2(pBtnW, 20f);
                        px += pBtnW + pGap;
                    }

                    _detailScrollRt.anchoredPosition = new Vector2(PadX, -266f);
                    _detailScrollRt.sizeDelta = new Vector2(rowW, 196f);
                }
            }

            _footer.rectTransform.anchoredPosition = new Vector2(PadX + 2f, _detailedMode ? -468f : -210f);
            _footer.rectTransform.sizeDelta = new Vector2(rowW - 4f, 16f);

            Rect safe = XingShuMobileUIHelper.SafeScreenRect;
            var bounds = Preferences.Layout(safe.x, Screen.height - safe.yMax, safe.width, safe.height, BaseScale, panelWidth, panelHeight);
            _widget.anchoredPosition = new Vector2(bounds.X, -bounds.Y);
            _widget.localScale = new Vector3(bounds.Scale, bounds.Scale, 1);
        }

        private void RefreshDetailSection(bool force)
        {
            if (_detailSection == null || _detailContent == null) return;
            var ledger = MatchProtocolObserver.EconomyLedger;
            int version = ledger.Version;
            if (!force && _lastDetailModeRendered == _detailedMode
                && _lastDetailLedgerVersion == version
                && _lastDetailTab == _detailTab
                && _lastDetailFilterPlayer == _detailFilterPlayerId)
            {
                return;
            }
            _lastDetailModeRendered = _detailedMode;
            _lastDetailLedgerVersion = version;
            _lastDetailTab = _detailTab;
            _lastDetailFilterPlayer = _detailFilterPlayerId;

            for (int t = 0; t < _detailTabBgs.Length; t++)
            {
                if (_detailTabBgs[t] != null)
                {
                    _detailTabBgs[t].color = (_detailTab == t) ? HeaderBtnActiveBg : HeaderBtnBg;
                }
            }

            var snapshots = ledger.GetPlayerSnapshots();
            bool filterStillValid = _detailFilterPlayerId == 0L;
            _detailPlayerIds[0] = 0L;
            for (int i = 1; i < _detailPlayerBtns.Length; i++)
            {
                int sIdx = i - 1;
                if (sIdx < snapshots.Count)
                {
                    var s = snapshots[sIdx];
                    _detailPlayerIds[i] = s.PlayerId;
                    if (_detailFilterPlayerId == s.PlayerId) filterStillValid = true;
                    string label = !string.IsNullOrEmpty(s.HeroName) ? $"{TrimLabel(s.HeroName, 4)}({TrimLabel(s.PlayerName, 4)})" : TrimLabel(s.PlayerName, 8);
                    if (_detailPlayerLabels[i] != null) _detailPlayerLabels[i].text = label;
                }
                else
                {
                    _detailPlayerIds[i] = 0L;
                }
            }
            if (!filterStillValid) _detailFilterPlayerId = 0L;

            for (int i = 0; i < _detailPlayerBgs.Length; i++)
            {
                if (_detailPlayerBgs[i] != null)
                {
                    bool selected = (i == 0 && _detailFilterPlayerId == 0L) || (i > 0 && _detailPlayerIds[i] == _detailFilterPlayerId);
                    _detailPlayerBgs[i].color = selected ? HeaderBtnActiveBg : HeaderBtnBg;
                }
            }

            int usedRows = 0;
            if (_detailTab == 0)
            {
                int liveCount = 0;
                for (int i = 0; i < snapshots.Count; i++)
                {
                    var s = snapshots[i];
                    if (_detailFilterPlayerId > 0 && s.PlayerId != _detailFilterPlayerId) continue;
                    if (s.ActiveShopVisit != null && s.ActiveShopVisit.IsActive)
                    {
                        liveCount++;
                        var v = s.ActiveShopVisit;
                        string bought = v.BoughtCardIds.Count > 0 ? JoinCardNames(v.BoughtCardIds) : "尚未购买";
                        string shelf = v.OfferedCardIds != null && v.OfferedCardIds.Length > 0 ? JoinCardNames(v.OfferedCardIds) : "无";
                        BindDetailRow(ref usedRows, RowActiveOfferBg,
                            $"<b>[实时·第{v.Round}回合] {FormatPlayerHero(s.PlayerName, s.HeroName)} · {v.ShopKind}</b>\n" +
                            $"<color=#6EE7B7>已购买:</color> {bought}\n" +
                            $"<color=#FDE68A>货架牌:</color> {shelf}");
                    }
                    if (s.ActiveRelicChoice != null && s.ActiveRelicChoice.IsPending)
                    {
                        liveCount++;
                        var r = s.ActiveRelicChoice;
                        string pool = r.OfferedRelicIds != null && r.OfferedRelicIds.Length > 0 ? JoinRelicNames(r.OfferedRelicIds) : "无";
                        BindDetailRow(ref usedRows, RowActiveOfferBg,
                            $"<b>[实时·第{r.Round}回合] {FormatPlayerHero(s.PlayerName, s.HeroName)} · 筹码三选一中</b>\n" +
                            $"<color=#7DD3FC>当前候选:</color> {pool}");
                    }
                }

                if (liveCount == 0 && snapshots.Count == 0)
                {
                    BindDetailRow(ref usedRows, RowBgOdd,
                        "<b>等待商店与筹码事件</b>\n开局后将自动记录每回合商店货架、购牌及筹码三选一（含未选与刷新跳过）。");
                }
                else
                {
                    for (int i = 0; i < snapshots.Count; i++)
                    {
                        var s = snapshots[i];
                        if (_detailFilterPlayerId > 0 && s.PlayerId != _detailFilterPlayerId) continue;
                        string owned = s.OwnedRelicIds.Count > 0 ? JoinRelicNames(s.OwnedRelicIds) : "暂无筹码";
                        BindDetailRow(ref usedRows, (i % 2 == 0) ? RowBgEven : RowBgOdd,
                            $"<b>{FormatPlayerHero(s.PlayerName, s.HeroName)}</b>  " +
                            $"<color=#94A3B8>购牌 {s.TotalBoughtCards} 张 · 选筹码 {s.TotalChosenRelics} 个 · 未选/跳过 {s.TotalSkippedRelics} 个</color>\n" +
                            $"<color=#CBD5E1>持有筹码({s.OwnedRelicIds.Count}):</color> {owned}");
                    }
                }
            }
            else
            {
                int cat = _detailTab == 2 ? 1 : (_detailTab == 3 ? 2 : 0);
                var entries = ledger.GetFilteredHistory(_detailFilterPlayerId, cat, newestFirst: true);
                if (entries.Count == 0)
                {
                    BindDetailRow(ref usedRows, RowBgOdd,
                        "<b>暂无符合条件的记录</b>\n玩家进入商店或触发筹码三选一后，将在此按回合实时更新历史明细。");
                }
                else
                {
                    int limit = Math.Min(entries.Count, 80);
                    for (int i = 0; i < limit; i++)
                    {
                        var e = entries[i];
                        Color bgColor = (i % 2 == 0) ? RowBgEven : RowBgOdd;
                        if (e.Kind == EconomyEventKind.ShopVisit && e.ShopVisit != null)
                        {
                            var v = e.ShopVisit;
                            string stateTag = v.IsActive ? " [浏览中]" : "";
                            string assistTag = "";
                            if (v.AssistPlayerIds.Count > 0)
                            {
                                var names = new List<string>(v.AssistPlayerIds.Count);
                                for (int a = 0; a < v.AssistPlayerIds.Count; a++)
                                {
                                    GameTextResolver.ResolvePlayerLabels(v.AssistPlayerIds[a], out string an, out _);
                                    names.Add(an);
                                }
                                assistTag = " · 代付:" + string.Join("、", names.ToArray());
                            }
                            string bought = v.BoughtCardIds.Count > 0 ? JoinCardNames(v.BoughtCardIds) : "未购牌";
                            string shelf = v.OfferedCardIds != null && v.OfferedCardIds.Length > 0 ? JoinCardNames(v.OfferedCardIds) : "无";
                            BindDetailRow(ref usedRows, v.IsActive ? RowActiveOfferBg : bgColor,
                                $"<b>[第{v.Round}回合] {FormatPlayerHero(v.PlayerName, v.HeroName)} · {v.ShopKind}{stateTag}{assistTag}</b>\n" +
                                $"<color=#6EE7B7>已购:</color> {bought}\n" +
                                $"<color=#FDE68A>货架:</color> {shelf}");
                        }
                        else if (e.RelicChoice != null)
                        {
                            var r = e.RelicChoice;
                            if (r.IsShopBuy)
                            {
                                BindDetailRow(ref usedRows, bgColor,
                                    $"<b>[第{r.Round}回合] {FormatPlayerHero(r.PlayerName, r.HeroName)} · 筹码商店</b>\n" +
                                    $"<color=#FDE68A>购买:</color> {GameTextResolver.GetRelicName(r.ChosenRelicId)}");
                            }
                            else if (r.IsPending)
                            {
                                BindDetailRow(ref usedRows, RowActiveOfferBg,
                                    $"<b>[第{r.Round}回合] {FormatPlayerHero(r.PlayerName, r.HeroName)} · 筹码三选一 [选择中]</b>\n" +
                                    $"<color=#7DD3FC>候选:</color> {JoinRelicNames(r.OfferedRelicIds)}");
                            }
                            else if (r.IsReroll || r.ChosenRelicId <= 0)
                            {
                                BindDetailRow(ref usedRows, bgColor,
                                    $"<b>[第{r.Round}回合] {FormatPlayerHero(r.PlayerName, r.HeroName)} · 筹码刷新/跳过</b>\n" +
                                    $"<color=#FCA5A5>未选弃置:</color> {JoinRelicNames(r.UnchosenRelicIds)}");
                            }
                            else
                            {
                                string unchosen = r.UnchosenRelicIds != null && r.UnchosenRelicIds.Length > 0 ? JoinRelicNames(r.UnchosenRelicIds) : "无";
                                BindDetailRow(ref usedRows, bgColor,
                                    $"<b>[第{r.Round}回合] {FormatPlayerHero(r.PlayerName, r.HeroName)} · 筹码三选一</b>\n" +
                                    $"<color=#6EE7B7>已选:</color> {GameTextResolver.GetRelicName(r.ChosenRelicId)}  " +
                                    $"<color=#FCA5A5>未选:</color> {unchosen}");
                            }
                        }
                    }
                }
            }

            for (int i = usedRows; i < _detailRowPool.Count; i++)
            {
                if (_detailRowPool[i] != null) _detailRowPool[i].SetActive(false);
            }
            LayoutRebuilder.ForceRebuildLayoutImmediate(_detailContent.GetComponent<RectTransform>());
        }

        private void BindDetailRow(ref int idx, Color bgColor, string richContent)
        {
            while (_detailRowPool.Count <= idx)
            {
                var card = XingShuUIFactory.CreateUIObject("DetailRow_" + _detailRowPool.Count, _detailContent);
                var img = card.AddComponent<Image>();
                img.sprite = GetSolidSprite();
                img.raycastTarget = false;

                var vlg = card.AddComponent<VerticalLayoutGroup>();
                vlg.padding = new RectOffset(8, 8, 5, 5);
                vlg.childControlWidth = true;
                vlg.childControlHeight = true;
                vlg.childForceExpandWidth = true;
                vlg.childForceExpandHeight = false;

                var txt = XingShuUIFactory.CreateText(card, "Label", "", 11,
                    new Color(TextPrimaryLight.r, TextPrimaryLight.g, TextPrimaryLight.b, Preferences.TextAlpha),
                    TextAnchor.UpperLeft);
                txt.lineSpacing = 1.15f;
                txt.supportRichText = true;
                txt.horizontalOverflow = HorizontalWrapMode.Wrap;
                txt.verticalOverflow = VerticalWrapMode.Overflow;
                txt.raycastTarget = false;

                _detailRowPool.Add(card);
                _detailRowBgs.Add(img);
                _detailRowTexts.Add(txt);
            }

            var rowGo = _detailRowPool[idx];
            rowGo.SetActive(true);
            _detailRowBgs[idx].color = bgColor;
            var label = _detailRowTexts[idx];
            label.color = new Color(TextPrimaryLight.r, TextPrimaryLight.g, TextPrimaryLight.b, Preferences.TextAlpha);
            label.text = richContent;
            idx++;
        }

        private static string FormatPlayerHero(string playerName, string heroName)
        {
            if (string.IsNullOrEmpty(heroName)) return string.IsNullOrEmpty(playerName) ? "玩家" : playerName;
            if (string.IsNullOrEmpty(playerName)) return heroName;
            return $"{playerName} ({heroName})";
        }

        private static string TrimLabel(string value, int maxChars)
        {
            if (string.IsNullOrEmpty(value)) return "";
            return value.Length > maxChars ? value.Substring(0, maxChars) : value;
        }

        private static string JoinCardNames(IList<int> ids)
        {
            if (ids == null || ids.Count == 0) return "无";
            var parts = new string[ids.Count];
            for (int i = 0; i < ids.Count; i++) parts[i] = GameTextResolver.GetCardName(ids[i]);
            return string.Join(" / ", parts);
        }

        private static string JoinRelicNames(IList<int> ids)
        {
            if (ids == null || ids.Count == 0) return "无";
            var parts = new string[ids.Count];
            for (int i = 0; i < ids.Count; i++) parts[i] = GameTextResolver.GetRelicName(ids[i]);
            return string.Join(" / ", parts);
        }

        internal void Tick() { Layout(); }

        internal void Drag(Vector2 delta)
        {
            var safe = XingShuMobileUIHelper.SafeScreenRect;
            Preferences.Move(delta.x, -delta.y, safe.width, safe.height, BaseScale, CurrentPanelWidth, CurrentPanelHeight);
            Layout();
        }

        private static float BaseScale => XingShuMobileUIHelper.WidgetScaleFactor;
        internal void SuspendInteraction() { if (_drag != null) _drag.Cancel(); }
        private static string Key(string pc, string mobile) => XingShuMobileUIHelper.IsMobile ? mobile : pc;

        private void Load()
        {
            _metricMask = XingShuStatsMetricsPanel.ReadMask();
            _detailedMode = XingShuConfigService.GetBool(XingShuConfigKeys.StatsWidgetDetailedMode, XingShuConfigKeys.StatsWidgetDetailedModeDefault);
            Preferences.Background = XingShuConfigService.GetFloat(Key(XingShuConfigKeys.StatsWidgetPcBackground, XingShuConfigKeys.StatsWidgetAndroidBackground), .78f);
            Preferences.TextAlpha = XingShuConfigService.GetFloat(Key(XingShuConfigKeys.StatsWidgetPcText, XingShuConfigKeys.StatsWidgetAndroidText), .96f);
            Preferences.Scale = XingShuConfigService.GetFloat(Key(XingShuConfigKeys.StatsWidgetPcScale, XingShuConfigKeys.StatsWidgetAndroidScale),
                XingShuMobileUIHelper.IsMobile ? XingShuConfigKeys.StatsWidgetAndroidScaleDefault : XingShuConfigKeys.StatsWidgetScaleDefault);
            Preferences.X = XingShuConfigService.GetFloat(Key(XingShuConfigKeys.StatsWidgetPcX, XingShuConfigKeys.StatsWidgetAndroidX), 1);
            Preferences.Y = XingShuConfigService.GetFloat(Key(XingShuConfigKeys.StatsWidgetPcY, XingShuConfigKeys.StatsWidgetAndroidY), .12f);
            Preferences.Locked = XingShuConfigService.GetBool(Key(XingShuConfigKeys.StatsWidgetPcLock, XingShuConfigKeys.StatsWidgetAndroidLock), false);
            Preferences.Normalize();
        }

        internal void ReloadPreferences()
        {
            Load();
            if (!Ready) return;
            _background.color = new Color(PanelTint.r, PanelTint.g, PanelTint.b, Preferences.Background);
            foreach (var text in _body.GetComponentsInChildren<Text>(true))
            {
                var color = text.color;
                color.a = Preferences.TextAlpha;
                text.color = color;
            }
            if (_frame != null) Refresh(_frame);
            if (_detailedMode) RefreshDetailSection(force: true);
            XingShuUITheme.RefreshFonts(_root);
            Layout();
        }

        internal void Save()
        {
            XingShuConfigService.SetFloat(Key(XingShuConfigKeys.StatsWidgetPcX, XingShuConfigKeys.StatsWidgetAndroidX), Preferences.X);
            XingShuConfigService.SetFloat(Key(XingShuConfigKeys.StatsWidgetPcY, XingShuConfigKeys.StatsWidgetAndroidY), Preferences.Y);
            XingShuConfigService.Save();
        }

        public void Dispose()
        {
            if (!Ready) return;
            Save();
            UnityEngine.Object.Destroy(_root);
            _root = null;
        }
    }
}
