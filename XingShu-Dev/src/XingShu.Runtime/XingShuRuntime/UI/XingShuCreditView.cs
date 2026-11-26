using System;
using System.Collections.Generic;
using System.Globalization;
using XingShuRuntime.Core;
using XingShuRuntime.Utilities;
using UnityEngine;
using UnityEngine.UI;

namespace XingShuRuntime.UI
{
    /// <summary>
    /// Standalone dual-platform control view for XingShu Community Credit Guard &amp; High-Credit Fleet (Tab 19).
    /// </summary>
    internal sealed class XingShuCreditView
    {
        private static readonly string[] ReasonKeys = { "afk", "griefing", "disconnect", "harassment", "cheating" };
        private static readonly string[] ReasonLabels = { "恶意挂机/摆烂", "故意送头/坑人", "频繁恶意拔线", "言语辱骂/骚扰", "疑似异常/作弊" };
        private static readonly int[] MinCreditPresets = { 70, 80, 85, 90, 95 };
        private static readonly int[] MaxGiveUpPresets = { 10, 15, 20, 30 };

        private readonly GameObject _root;
        private int _subTab;
        private bool _suppressCallbacks;

        private Text _statusBannerText;
        private Toggle _enabledToggle;
        private Toggle _hudStripToggle;
        private Button[] _subTabBtns;
        private GameObject[] _subPanels;

        // SubTab 0: Peers & Feedback
        private readonly GameObject[] _peerRows = new GameObject[4];
        private readonly Text[] _peerTexts = new Text[4];
        private readonly long[] _peerUids = new long[4];
        private readonly string[] _peerNicks = new string[4];
        private readonly Button[] _peerBlkBtns = new Button[4];
        private readonly Text[] _peerBlkLabels = new Text[4];
        private readonly Button[] _peerKickBtns = new Button[4];
        private long _reportTargetUid;
        private string _reportTargetNick = string.Empty;
        private int _reportReasonIdx;
        private Text _reportTargetText;
        private Text _reportReasonBtnText;
        private InputField _reportDetailInput;

        // SubTab 1: Fleet Host & Browser
        private Text _minCreditValText;
        private Text _maxGiveUpValText;
        private Toggle _blockBlkToggle;
        private Toggle _autoKickToggle;
        private Text _hostStatusText;
        private readonly GameObject[] _fleetRows = new GameObject[5];
        private readonly Text[] _fleetTexts = new Text[5];
        private readonly string[] _fleetRoomIds = new string[5];
        private readonly string[] _fleetHostUids = new string[5];

        // SubTab 2: AutoFollow & Squad
        private InputField _followUidInput;
        private Toggle _autoReadyToggle;
        private Button _followToggleBtn;
        private Text _followToggleBtnText;
        private Text _followStatusText;
        private InputField _squadCodeInput;
        private Text _squadSummaryText;
        private Button _squadReadyBtn;
        private Button _squadPublishBtn;
        private Button _squadLeaveBtn;

        // SubTab 3: Blacklist & Auth
        private readonly GameObject[] _blkRows = new GameObject[6];
        private readonly Text[] _blkTexts = new Text[6];
        private readonly string[] _blkUids = new string[6];
        private Text _authStatusText;
        private InputField _authTokenInput;

        private float _lastAutoRefresh;

        internal GameObject Root => _root;

        internal XingShuCreditView(Transform parent)
        {
            _root = XingShuUIFactory.CreateUIObject("Page_CreditGuard", parent.gameObject);
            BuildUI();
            UpdateSync();
        }

        private void BuildUI()
        {
            XingShuViewCardHelper.CreatePageScroll(_root, "CreditScrollView", out GameObject content);

            // Header Card
            GameObject headerCard = XingShuViewCardHelper.CreateCardContainer(content, "Card_CreditHeader", 140f, featureHeader: true);
            Text title = XingShuUIFactory.CreateText(headerCard, "Title", "星枢社区信誉监护 & 高信誉车队", 18, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            XingShuViewCardHelper.PlaceTopLeft(title.rectTransform, new Vector2(20f, -10f), new Vector2(380f, 24f));

            _enabledToggle = XingShuUIFactory.CreateToggle(headerCard, "EnableCreditToggle", "启用信誉监护",
                CreditGuardRuntime.Instance == null || CreditGuardRuntime.Instance.IsEnabled,
                v => { if (!_suppressCallbacks && CreditGuardRuntime.Instance != null) CreditGuardRuntime.Instance.IsEnabled = v; });
            XingShuViewCardHelper.PlaceTopRight(_enabledToggle.GetComponent<RectTransform>(), new Vector2(-180f, -8f), new Vector2(150f, 30f));

            _hudStripToggle = XingShuUIFactory.CreateToggle(headerCard, "CreditHudToggle", "房内角标条",
                CreditGuardRuntime.Instance == null || CreditGuardRuntime.Instance.HudStripEnabled,
                v => { if (!_suppressCallbacks && CreditGuardRuntime.Instance != null) CreditGuardRuntime.Instance.HudStripEnabled = v; });
            XingShuViewCardHelper.PlaceTopRight(_hudStripToggle.GetComponent<RectTransform>(), new Vector2(-16f, -8f), new Vector2(148f, 30f));

            _statusBannerText = XingShuUIFactory.CreateText(headerCard, "StatusBanner", "就绪", 12, XingShuUITheme.SecondaryText, TextAnchor.MiddleLeft);
            XingShuViewCardHelper.PlaceStretchTop(_statusBannerText.rectTransform, 44f, 26f, 40f);

            string[] subLabels = { "队友信誉与反馈", "高信誉车队", "自动跟房与组队", "黑名单与授权" };
            _subTabBtns = new Button[subLabels.Length];
            for (int i = 0; i < subLabels.Length; i++)
            {
                int idx = i;
                Button b = XingShuViewCardHelper.CreateActionButton(headerCard, "SubTab_" + i, subLabels[i],
                    () => SelectSubTab(idx), 124f, 32f, 12);
                XingShuViewCardHelper.PlaceTopLeft(b.GetComponent<RectTransform>(), new Vector2(20f + i * 132f, -86f), new Vector2(124f, 32f));
                _subTabBtns[i] = b;
            }

            _subPanels = new GameObject[4];
            BuildSubTabPeers(content);
            BuildSubTabFleet(content);
            BuildSubTabFollowAndSquad(content);
            BuildSubTabBlacklistAndAuth(content);
            SelectSubTab(0);
        }

        private void BuildSubTabPeers(GameObject parent)
        {
            GameObject wrap = XingShuUIFactory.CreateUIObject("SubPanel_Peers", parent);
            var vlg = wrap.AddComponent<VerticalLayoutGroup>();
            vlg.spacing = 12f;
            vlg.childControlWidth = true;
            vlg.childControlHeight = true;
            vlg.childForceExpandWidth = true;
            vlg.childForceExpandHeight = false;
            _subPanels[0] = wrap;

            GameObject peersCard = XingShuViewCardHelper.CreateCardContainer(wrap, "Card_Peers", 296f);
            Text pTitle = XingShuUIFactory.CreateText(peersCard, "Title", "当前/最近同局玩家星枢信誉分", 16, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            XingShuViewCardHelper.PlaceTopLeft(pTitle.rectTransform, new Vector2(20f, -12f), new Vector2(360f, 24f));

            Button refBtn = XingShuViewCardHelper.CreateActionButton(peersCard, "RefreshPeersBtn", "刷新信誉分",
                () => { CreditGuardRuntime.Instance?.RefreshRoomProfilesNow(); UpdateSync(); }, 104f, 28f, 12);
            XingShuViewCardHelper.PlaceTopRight(refBtn.GetComponent<RectTransform>(), new Vector2(-20f, -10f), new Vector2(104f, 28f));

            for (int i = 0; i < 4; i++)
            {
                int rowIdx = i;
                float top = 48f + i * 60f;
                GameObject row = XingShuUIFactory.CreateUIObject("PeerRow_" + i, peersCard);
                var rt = row.GetComponent<RectTransform>();
                XingShuViewCardHelper.PlaceStretchTop(rt, top, 52f, 36f);
                _peerRows[i] = row;

                Text txt = XingShuUIFactory.CreateText(row, "Info", "", 13, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft);
                XingShuViewCardHelper.PlaceTopLeft(txt.rectTransform, new Vector2(4f, -4f), new Vector2(350f, 44f));
                _peerTexts[i] = txt;

                Button likeBtn = XingShuViewCardHelper.CreateActionButton(row, "Like", "点赞",
                    () => { if (_peerUids[rowIdx] > 0) CreditGuardRuntime.Instance?.LikePlayer(_peerUids[rowIdx]); }, 58f, 30f, 12);
                XingShuViewCardHelper.PlaceTopRight(likeBtn.GetComponent<RectTransform>(), new Vector2(-212f, -10f), new Vector2(58f, 30f));

                Button blkBtn = XingShuViewCardHelper.CreateActionButton(row, "Blk", "拉黑",
                    () => { if (_peerUids[rowIdx] > 0) CreditGuardRuntime.Instance?.ToggleBlacklist(_peerUids[rowIdx]); }, 58f, 30f, 12);
                XingShuViewCardHelper.PlaceTopRight(blkBtn.GetComponent<RectTransform>(), new Vector2(-148f, -10f), new Vector2(58f, 30f));
                _peerBlkBtns[i] = blkBtn;
                _peerBlkLabels[i] = blkBtn.GetComponentInChildren<Text>();

                Button repBtn = XingShuViewCardHelper.CreateActionButton(row, "Rep", "反馈",
                    () =>
                    {
                        if (_peerUids[rowIdx] > 0)
                        {
                            _reportTargetUid = _peerUids[rowIdx];
                            _reportTargetNick = _peerNicks[rowIdx] ?? string.Empty;
                            UpdateSync();
                        }
                    }, 58f, 30f, 12);
                XingShuViewCardHelper.PlaceTopRight(repBtn.GetComponent<RectTransform>(), new Vector2(-84f, -10f), new Vector2(58f, 30f));

                Button kickBtn = XingShuViewCardHelper.CreateActionButton(row, "Kick", "踢出",
                    () => { if (_peerUids[rowIdx] > 0) CreditGuardRuntime.Instance?.KickPeer(_peerUids[rowIdx]); }, 58f, 30f, 12);
                XingShuViewCardHelper.PlaceTopRight(kickBtn.GetComponent<RectTransform>(), new Vector2(-20f, -10f), new Vector2(58f, 30f));
                _peerKickBtns[i] = kickBtn;
            }

            GameObject repCard = XingShuViewCardHelper.CreateCardContainer(wrap, "Card_FeedbackForm", 196f);
            Text fTitle = XingShuUIFactory.CreateText(repCard, "FTitle", "提交星枢官方反馈工单（非游戏官方，进星枢后台审核）", 15, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            XingShuViewCardHelper.PlaceTopLeft(fTitle.rectTransform, new Vector2(20f, -12f), new Vector2(490f, 22f));

            _reportTargetText = XingShuUIFactory.CreateText(repCard, "TargetInfo", "未选择玩家：请点击上方列表右侧「反馈」按钮选中目标", 12, XingShuUITheme.SecondaryText, TextAnchor.MiddleLeft);
            XingShuViewCardHelper.PlaceStretchTop(_reportTargetText.rectTransform, 42f, 22f, 40f);

            Button reasonBtn = XingShuViewCardHelper.CreateActionButton(repCard, "ReasonCycle", "原因：" + ReasonLabels[0],
                () =>
                {
                    _reportReasonIdx = (_reportReasonIdx + 1) % ReasonKeys.Length;
                    UpdateSync();
                }, 200f, 32f, 12);
            XingShuViewCardHelper.PlaceTopLeft(reasonBtn.GetComponent<RectTransform>(), new Vector2(20f, -74f), new Vector2(200f, 32f));
            _reportReasonBtnText = reasonBtn.GetComponentInChildren<Text>();

            Button submitBtn = XingShuViewCardHelper.CreateActionButton(repCard, "SubmitFeedback", "提交至星枢后台",
                () =>
                {
                    CreditGuardRuntime.Instance?.SubmitFeedback(
                        _reportTargetUid,
                        _reportTargetNick,
                        ReasonKeys[_reportReasonIdx],
                        _reportDetailInput != null ? _reportDetailInput.text : string.Empty);
                    if (_reportDetailInput != null) _reportDetailInput.text = string.Empty;
                }, 144f, 32f, 12);
            XingShuViewCardHelper.PlaceTopRight(submitBtn.GetComponent<RectTransform>(), new Vector2(-20f, -74f), new Vector2(144f, 32f));

            _reportDetailInput = XingShuUIFactory.CreateInputField(repCard, "FeedbackDetail",
                "简述问题经过（会自动附带房间号/录像ID提交星枢管理员审核）", string.Empty, "credit_feedback_detail");
            XingShuViewCardHelper.PlaceStretchTop(_reportDetailInput.GetComponent<RectTransform>(), 120f, 36f, 40f);
        }

        private void BuildSubTabFleet(GameObject parent)
        {
            GameObject wrap = XingShuUIFactory.CreateUIObject("SubPanel_Fleet", parent);
            var vlg = wrap.AddComponent<VerticalLayoutGroup>();
            vlg.spacing = 12f;
            vlg.childControlWidth = true;
            vlg.childControlHeight = true;
            vlg.childForceExpandWidth = true;
            vlg.childForceExpandHeight = false;
            _subPanels[1] = wrap;

            GameObject hostCard = XingShuViewCardHelper.CreateCardContainer(wrap, "Card_FleetHost", 200f);
            Text hTitle = XingShuUIFactory.CreateText(hostCard, "HTitle", "高信誉密码开房 & 房主门禁规则", 16, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            XingShuViewCardHelper.PlaceTopLeft(hTitle.rectTransform, new Vector2(20f, -12f), new Vector2(360f, 24f));

            Button minBtn = XingShuViewCardHelper.CreateActionButton(hostCard, "MinCreditCycle", "信誉门槛 ≥ 85",
                () =>
                {
                    CreditGuardRuntime rt = CreditGuardRuntime.Instance;
                    if (rt == null) return;
                    int idx = Array.IndexOf(MinCreditPresets, rt.MinCredit);
                    rt.MinCredit = MinCreditPresets[(idx + 1) % MinCreditPresets.Length];
                    UpdateSync();
                }, 148f, 30f, 12);
            XingShuViewCardHelper.PlaceTopLeft(minBtn.GetComponent<RectTransform>(), new Vector2(20f, -46f), new Vector2(148f, 30f));
            _minCreditValText = minBtn.GetComponentInChildren<Text>();

            Button guBtn = XingShuViewCardHelper.CreateActionButton(hostCard, "MaxGiveUpCycle", "拔线上限 ≤ 15%",
                () =>
                {
                    CreditGuardRuntime rt = CreditGuardRuntime.Instance;
                    if (rt == null) return;
                    int idx = Array.IndexOf(MaxGiveUpPresets, rt.MaxGiveUpRate);
                    rt.MaxGiveUpRate = MaxGiveUpPresets[(idx + 1) % MaxGiveUpPresets.Length];
                    UpdateSync();
                }, 148f, 30f, 12);
            XingShuViewCardHelper.PlaceTopLeft(guBtn.GetComponent<RectTransform>(), new Vector2(178f, -46f), new Vector2(148f, 30f));
            _maxGiveUpValText = guBtn.GetComponentInChildren<Text>();

            _blockBlkToggle = XingShuUIFactory.CreateToggle(hostCard, "BlockBlacklistToggle", "拦截黑名单",
                CreditGuardRuntime.Instance == null || CreditGuardRuntime.Instance.BlockBlacklisted,
                v => { if (!_suppressCallbacks && CreditGuardRuntime.Instance != null) CreditGuardRuntime.Instance.BlockBlacklisted = v; });
            XingShuViewCardHelper.PlaceTopLeft(_blockBlkToggle.GetComponent<RectTransform>(), new Vector2(20f, -86f), new Vector2(150f, 30f));

            _autoKickToggle = XingShuUIFactory.CreateToggle(hostCard, "AutoKickToggle", "房主自动踢低信誉",
                CreditGuardRuntime.Instance != null && CreditGuardRuntime.Instance.AutoKick,
                v => { if (!_suppressCallbacks && CreditGuardRuntime.Instance != null) CreditGuardRuntime.Instance.AutoKick = v; });
            XingShuViewCardHelper.PlaceTopLeft(_autoKickToggle.GetComponent<RectTransform>(), new Vector2(182f, -86f), new Vector2(190f, 30f));

            Button createBtn = XingShuViewCardHelper.CreateActionButton(hostCard, "CreateFleetBtn", "一键开高信誉密码房",
                () => CreditGuardRuntime.Instance?.CreateHighCreditRoom(), 164f, 34f, 12);
            XingShuViewCardHelper.PlaceTopLeft(createBtn.GetComponent<RectTransform>(), new Vector2(20f, -126f), new Vector2(164f, 34f));

            Button pubBtn = XingShuViewCardHelper.CreateActionButton(hostCard, "PublishCurrentBtn", "托管当前房间",
                () => CreditGuardRuntime.Instance?.PublishCurrentRoomToFleet(), 126f, 34f, 12);
            XingShuViewCardHelper.PlaceTopLeft(pubBtn.GetComponent<RectTransform>(), new Vector2(194f, -126f), new Vector2(126f, 34f));

            Button stopBtn = XingShuViewCardHelper.CreateActionButton(hostCard, "StopHostBtn", "停止广播",
                () => CreditGuardRuntime.Instance?.StopHostingFleetRoom(), 96f, 34f, 12);
            XingShuViewCardHelper.PlaceTopLeft(stopBtn.GetComponent<RectTransform>(), new Vector2(330f, -126f), new Vector2(96f, 34f));

            _hostStatusText = XingShuUIFactory.CreateText(hostCard, "HostStatus", "", 12, XingShuUITheme.MutedText, TextAnchor.MiddleLeft);
            XingShuViewCardHelper.PlaceStretchTop(_hostStatusText.rectTransform, 166f, 22f, 40f);

            GameObject listCard = XingShuViewCardHelper.CreateCardContainer(wrap, "Card_FleetList", 336f);
            Text lTitle = XingShuUIFactory.CreateText(listCard, "LTitle", "星枢高信誉车队大厅（通过门槛后自动直连密码进房）", 15, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            XingShuViewCardHelper.PlaceTopLeft(lTitle.rectTransform, new Vector2(20f, -12f), new Vector2(440f, 24f));

            Button refFleetBtn = XingShuViewCardHelper.CreateActionButton(listCard, "RefreshFleetBtn", "刷新车队",
                () => CreditGuardRuntime.Instance?.RefreshFleetRooms(), 96f, 28f, 12);
            XingShuViewCardHelper.PlaceTopRight(refFleetBtn.GetComponent<RectTransform>(), new Vector2(-20f, -10f), new Vector2(96f, 28f));

            for (int i = 0; i < 5; i++)
            {
                int idx = i;
                GameObject row = XingShuUIFactory.CreateUIObject("FleetRow_" + i, listCard);
                XingShuViewCardHelper.PlaceStretchTop(row.GetComponent<RectTransform>(), 46f + i * 56f, 48f, 36f);
                _fleetRows[i] = row;

                Text txt = XingShuUIFactory.CreateText(row, "Info", "", 12, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft);
                XingShuViewCardHelper.PlaceTopLeft(txt.rectTransform, new Vector2(4f, -2f), new Vector2(360f, 44f));
                _fleetTexts[i] = txt;

                Button joinBtn = XingShuViewCardHelper.CreateActionButton(row, "Join", "一键进房",
                    () => { if (!string.IsNullOrEmpty(_fleetRoomIds[idx])) CreditGuardRuntime.Instance?.JoinFleetRoom(_fleetRoomIds[idx]); }, 82f, 30f, 12);
                XingShuViewCardHelper.PlaceTopRight(joinBtn.GetComponent<RectTransform>(), new Vector2(-108f, -8f), new Vector2(82f, 30f));

                Button followBtn = XingShuViewCardHelper.CreateActionButton(row, "Follow", "跟此房主",
                    () =>
                    {
                        if (!string.IsNullOrEmpty(_fleetHostUids[idx]))
                        {
                            CreditGuardRuntime.Instance?.StartAutoFollowHost(_fleetHostUids[idx]);
                            SelectSubTab(2);
                        }
                    }, 82f, 30f, 12);
                XingShuViewCardHelper.PlaceTopRight(followBtn.GetComponent<RectTransform>(), new Vector2(-20f, -8f), new Vector2(82f, 30f));
            }
        }

        private void BuildSubTabFollowAndSquad(GameObject parent)
        {
            GameObject wrap = XingShuUIFactory.CreateUIObject("SubPanel_FollowSquad", parent);
            var vlg = wrap.AddComponent<VerticalLayoutGroup>();
            vlg.spacing = 12f;
            vlg.childControlWidth = true;
            vlg.childControlHeight = true;
            vlg.childForceExpandWidth = true;
            vlg.childForceExpandHeight = false;
            _subPanels[2] = wrap;

            GameObject followCard = XingShuViewCardHelper.CreateCardContainer(wrap, "Card_AutoFollow", 174f);
            Text flTitle = XingShuUIFactory.CreateText(followCard, "FLTitle", "自动跟房（追随指定高信誉车头）", 16, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            XingShuViewCardHelper.PlaceTopLeft(flTitle.rectTransform, new Vector2(20f, -12f), new Vector2(360f, 24f));

            _autoReadyToggle = XingShuUIFactory.CreateToggle(followCard, "AutoReadyToggle", "跟房自动准备",
                CreditGuardRuntime.Instance == null || CreditGuardRuntime.Instance.AutoReady,
                v => { if (!_suppressCallbacks && CreditGuardRuntime.Instance != null) CreditGuardRuntime.Instance.AutoReady = v; });
            XingShuViewCardHelper.PlaceTopRight(_autoReadyToggle.GetComponent<RectTransform>(), new Vector2(-20f, -10f), new Vector2(150f, 30f));

            _followUidInput = XingShuUIFactory.CreateInputField(followCard, "FollowHostUidInput", "输入车头数字 UID（或在车队大厅点跟此房主）",
                string.Empty, "credit_follow_uid");
            XingShuViewCardHelper.PlaceTopLeft(_followUidInput.GetComponent<RectTransform>(), new Vector2(20f, -52f), new Vector2(300f, 34f));

            _followToggleBtn = XingShuViewCardHelper.CreateActionButton(followCard, "FollowToggleBtn", "开启自动跟房",
                () =>
                {
                    CreditGuardRuntime rt = CreditGuardRuntime.Instance;
                    if (rt == null) return;
                    if (rt.AutoFollowActive) rt.StopAutoFollowHost();
                    else rt.StartAutoFollowHost(_followUidInput != null ? _followUidInput.text : string.Empty);
                    UpdateSync();
                }, 130f, 34f, 12);
            XingShuViewCardHelper.PlaceTopRight(_followToggleBtn.GetComponent<RectTransform>(), new Vector2(-20f, -52f), new Vector2(130f, 34f));
            _followToggleBtnText = _followToggleBtn.GetComponentInChildren<Text>();

            _followStatusText = XingShuUIFactory.CreateText(followCard, "FollowStatus", "未开启自动跟房；一局打完退回大厅后，车头开新房会自动直连跟进", 12, XingShuUITheme.SecondaryText, TextAnchor.UpperLeft);
            XingShuViewCardHelper.PlaceStretchTop(_followStatusText.rectTransform, 100f, 52f, 40f);

            GameObject squadCard = XingShuViewCardHelper.CreateCardContainer(wrap, "Card_Squad", 248f);
            Text sqTitle = XingShuUIFactory.CreateText(squadCard, "SQTitle", "星枢高信誉组队模式（先攒满 2–4 人小队再全员跟进同一房）", 15, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            XingShuViewCardHelper.PlaceTopLeft(sqTitle.rectTransform, new Vector2(20f, -12f), new Vector2(520f, 24f));

            Button createSqBtn = XingShuViewCardHelper.CreateActionButton(squadCard, "CreateSquadBtn", "创建小队",
                () => CreditGuardRuntime.Instance?.CreateSquad(), 100f, 34f, 12);
            XingShuViewCardHelper.PlaceTopLeft(createSqBtn.GetComponent<RectTransform>(), new Vector2(20f, -46f), new Vector2(100f, 34f));

            _squadCodeInput = XingShuUIFactory.CreateInputField(squadCard, "SquadJoinCodeInput", "6 位小队邀请码", string.Empty, "credit_squad_code");
            XingShuViewCardHelper.PlaceTopLeft(_squadCodeInput.GetComponent<RectTransform>(), new Vector2(132f, -46f), new Vector2(150f, 34f));

            Button joinSqBtn = XingShuViewCardHelper.CreateActionButton(squadCard, "JoinSquadBtn", "加入小队",
                () => CreditGuardRuntime.Instance?.JoinSquadByCode(_squadCodeInput != null ? _squadCodeInput.text : string.Empty), 96f, 34f, 12);
            XingShuViewCardHelper.PlaceTopLeft(joinSqBtn.GetComponent<RectTransform>(), new Vector2(292f, -46f), new Vector2(96f, 34f));

            _squadSummaryText = XingShuUIFactory.CreateText(squadCard, "SquadSummary", "暂未加入星枢小队", 12, XingShuUITheme.PrimaryText, TextAnchor.UpperLeft);
            XingShuViewCardHelper.PlaceStretchTop(_squadSummaryText.rectTransform, 92f, 96f, 40f);

            _squadReadyBtn = XingShuViewCardHelper.CreateActionButton(squadCard, "SquadReadyBtn", "切换准备",
                () => CreditGuardRuntime.Instance?.ToggleSquadReady(), 100f, 32f, 12);
            XingShuViewCardHelper.PlaceTopLeft(_squadReadyBtn.GetComponent<RectTransform>(), new Vector2(20f, -198f), new Vector2(100f, 32f));

            _squadPublishBtn = XingShuViewCardHelper.CreateActionButton(squadCard, "SquadPublishBtn", "队长拉全员进当前房",
                () => CreditGuardRuntime.Instance?.PublishSquadRoomToTeam(), 164f, 32f, 12);
            XingShuViewCardHelper.PlaceTopLeft(_squadPublishBtn.GetComponent<RectTransform>(), new Vector2(130f, -198f), new Vector2(164f, 32f));

            _squadLeaveBtn = XingShuViewCardHelper.CreateActionButton(squadCard, "SquadLeaveBtn", "退出小队",
                () => CreditGuardRuntime.Instance?.LeaveSquad(), 96f, 32f, 12);
            XingShuViewCardHelper.PlaceTopLeft(_squadLeaveBtn.GetComponent<RectTransform>(), new Vector2(304f, -198f), new Vector2(96f, 32f));
        }

        private void BuildSubTabBlacklistAndAuth(GameObject parent)
        {
            GameObject wrap = XingShuUIFactory.CreateUIObject("SubPanel_BlkAuth", parent);
            var vlg = wrap.AddComponent<VerticalLayoutGroup>();
            vlg.spacing = 12f;
            vlg.childControlWidth = true;
            vlg.childControlHeight = true;
            vlg.childForceExpandWidth = true;
            vlg.childForceExpandHeight = false;
            _subPanels[3] = wrap;

            GameObject authCard = XingShuViewCardHelper.CreateCardContainer(wrap, "Card_CreditAuth", 142f);
            Text aTitle = XingShuUIFactory.CreateText(authCard, "ATitle", "星枢账号授权状态（用于点赞、拉黑、反馈与车队进房鉴权）", 15, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            XingShuViewCardHelper.PlaceTopLeft(aTitle.rectTransform, new Vector2(20f, -12f), new Vector2(490f, 24f));

            _authStatusText = XingShuUIFactory.CreateText(authCard, "AuthStatus", "", 12, XingShuUITheme.SecondaryText, TextAnchor.MiddleLeft);
            XingShuViewCardHelper.PlaceStretchTop(_authStatusText.rectTransform, 40f, 24f, 40f);

            _authTokenInput = XingShuUIFactory.CreateInputField(authCard, "ManualTokenInput", "如未自动同步授权，可粘贴星枢会话令牌…",
                string.Empty, "credit_auth_token");
            XingShuViewCardHelper.PlaceTopLeft(_authTokenInput.GetComponent<RectTransform>(), new Vector2(20f, -82f), new Vector2(290f, 34f));

            Button saveTokBtn = XingShuViewCardHelper.CreateActionButton(authCard, "SaveTokBtn", "保存令牌",
                () =>
                {
                    CreditGuardRuntime.Instance?.SaveManualAuthToken(_authTokenInput != null ? _authTokenInput.text : string.Empty);
                    if (_authTokenInput != null) _authTokenInput.text = string.Empty;
                    UpdateSync();
                }, 88f, 34f, 12);
            XingShuViewCardHelper.PlaceTopLeft(saveTokBtn.GetComponent<RectTransform>(), new Vector2(320f, -82f), new Vector2(88f, 34f));

            Button clrTokBtn = XingShuViewCardHelper.CreateActionButton(authCard, "ClrTokBtn", "清除",
                () => { CreditGuardRuntime.Instance?.ClearManualAuthToken(); UpdateSync(); }, 68f, 34f, 12);
            XingShuViewCardHelper.PlaceTopLeft(clrTokBtn.GetComponent<RectTransform>(), new Vector2(416f, -82f), new Vector2(68f, 34f));

            GameObject blkCard = XingShuViewCardHelper.CreateCardContainer(wrap, "Card_Blacklist", 336f);
            Text bTitle = XingShuUIFactory.CreateText(blkCard, "BTitle", "我的星枢云端黑名单（开房/选房自动屏蔽）", 15, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            XingShuViewCardHelper.PlaceTopLeft(bTitle.rectTransform, new Vector2(20f, -12f), new Vector2(380f, 24f));

            Button refBlkBtn = XingShuViewCardHelper.CreateActionButton(blkCard, "RefreshBlkBtn", "刷新黑名单",
                () => CreditGuardRuntime.Instance?.RefreshBlacklist(), 100f, 28f, 12);
            XingShuViewCardHelper.PlaceTopRight(refBlkBtn.GetComponent<RectTransform>(), new Vector2(-20f, -10f), new Vector2(100f, 28f));

            for (int i = 0; i < 6; i++)
            {
                int idx = i;
                GameObject row = XingShuUIFactory.CreateUIObject("BlkRow_" + i, blkCard);
                XingShuViewCardHelper.PlaceStretchTop(row.GetComponent<RectTransform>(), 48f + i * 46f, 40f, 36f);
                _blkRows[i] = row;

                Text txt = XingShuUIFactory.CreateText(row, "Info", "", 12, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft);
                XingShuViewCardHelper.PlaceTopLeft(txt.rectTransform, new Vector2(4f, -2f), new Vector2(390f, 36f));
                _blkTexts[i] = txt;

                Button unblkBtn = XingShuViewCardHelper.CreateActionButton(row, "Unblock", "解除拉黑",
                    () =>
                    {
                        if (long.TryParse(_blkUids[idx], NumberStyles.Integer, CultureInfo.InvariantCulture, out long u) && u > 0)
                        {
                            CreditGuardRuntime.Instance?.ToggleBlacklist(u);
                        }
                    }, 88f, 28f, 12);
                XingShuViewCardHelper.PlaceTopRight(unblkBtn.GetComponent<RectTransform>(), new Vector2(-20f, -6f), new Vector2(88f, 28f));
            }
        }

        private void SelectSubTab(int idx)
        {
            _subTab = Mathf.Clamp(idx, 0, _subPanels.Length - 1);
            for (int i = 0; i < _subPanels.Length; i++)
            {
                if (_subPanels[i] != null) _subPanels[i].SetActive(i == _subTab);
                if (_subTabBtns[i] != null)
                {
                    Image img = _subTabBtns[i].GetComponent<Image>();
                    if (img != null)
                    {
                        img.color = i == _subTab ? new Color(0.86f, 0.94f, 1.0f, 1f) : Color.white;
                    }
                }
            }
            if (_subTab == 1) CreditGuardRuntime.Instance?.RefreshFleetRooms();
            else if (_subTab == 2) CreditGuardRuntime.Instance?.PollSquadState();
            else if (_subTab == 3) CreditGuardRuntime.Instance?.RefreshBlacklist();
            UpdateSync();
        }

        internal void UpdateSync()
        {
            CreditGuardRuntime rt = CreditGuardRuntime.Instance;
            if (rt == null) return;

            float now = Time.realtimeSinceStartup;
            if (now - _lastAutoRefresh > 2.0f)
            {
                _lastAutoRefresh = now;
                rt.RefreshRoomProfilesNow();
            }

            _suppressCallbacks = true;
            try
            {
                if (_enabledToggle != null) _enabledToggle.isOn = rt.IsEnabled;
                if (_hudStripToggle != null) _hudStripToggle.isOn = rt.HudStripEnabled;
                if (_statusBannerText != null) _statusBannerText.text = "状态：" + rt.StatusMessage;

                // SubTab 0
                IList<CreditGuardRuntime.RoomPeerModel> peers = rt.ActivePeers;
                for (int i = 0; i < 4; i++)
                {
                    if (_peerRows[i] == null) continue;
                    if (i >= peers.Count)
                    {
                        _peerRows[i].SetActive(false);
                        _peerUids[i] = 0;
                        continue;
                    }
                    _peerRows[i].SetActive(true);
                    CreditGuardRuntime.RoomPeerModel peer = peers[i];
                    _peerUids[i] = peer.Uid;
                    _peerNicks[i] = peer.PlainNick;
                    CreditGuardRuntime.CreditProfileModel prof = rt.GetCachedProfile(peer.UidStr);
                    string nick = string.IsNullOrEmpty(peer.PlainNick) ? peer.UidStr : peer.PlainNick;
                    string scoreText = prof != null
                        ? string.Format(CultureInfo.InvariantCulture, "信誉 {0}({1}) · 拔{2:F1}% ({3}局){4}",
                            prof.Score, prof.TierLabel, prof.GiveUpRate, prof.RecordedMatches,
                            string.IsNullOrEmpty(prof.TagsText) ? "" : " · " + prof.TagsText)
                        : "正在拉取信誉档案…";
                    _peerTexts[i].text = string.Format(CultureInfo.InvariantCulture, "{0}{1} (UID {2})\n{3}",
                        nick, peer.IsHost ? " [房主]" : peer.IsSelf ? " [本人]" : "", peer.UidStr, scoreText);
                    if (_peerBlkLabels[i] != null)
                    {
                        _peerBlkLabels[i].text = (prof != null && prof.BlacklistedByMe) ? "解黑" : "拉黑";
                    }
                    if (_peerKickBtns[i] != null)
                    {
                        _peerKickBtns[i].gameObject.SetActive(rt.InRoom && rt.IsRoomHost && rt.InWaitRoom && !peer.IsSelf);
                    }
                }

                if (_reportTargetText != null)
                {
                    _reportTargetText.text = _reportTargetUid > 0
                        ? "当前反馈目标：" + (string.IsNullOrEmpty(_reportTargetNick) ? _reportTargetUid.ToString(CultureInfo.InvariantCulture) : _reportTargetNick) + " (UID " + _reportTargetUid + ")"
                        : "未选择玩家：请点击上方列表右侧「反馈」按钮选中目标";
                }
                if (_reportReasonBtnText != null)
                {
                    _reportReasonBtnText.text = "原因：" + ReasonLabels[_reportReasonIdx];
                }

                // SubTab 1
                if (_minCreditValText != null) _minCreditValText.text = "信誉门槛 ≥ " + rt.MinCredit;
                if (_maxGiveUpValText != null) _maxGiveUpValText.text = "拔线上限 ≤ " + rt.MaxGiveUpRate + "%";
                if (_blockBlkToggle != null) _blockBlkToggle.isOn = rt.BlockBlacklisted;
                if (_autoKickToggle != null) _autoKickToggle.isOn = rt.AutoKick;
                if (_hostStatusText != null)
                {
                    _hostStatusText.text = rt.HostingFleetRoom
                        ? "正在车队大厅广播中 · 房号 #" + rt.CurrentRoomId + "（已启用随机密码门禁）"
                        : rt.InRoom
                            ? (rt.IsRoomHost ? "当前在房 #" + rt.CurrentRoomId + "，点击「托管当前房间」可开放高信誉门禁" : "当前已在别人房间 #" + rt.CurrentRoomId)
                            : "当前未在房间；大厅点击「一键开高信誉密码房」将自动设密码并注册车队";
                }

                IList<CreditGuardRuntime.FleetRoomModel> rooms = rt.FleetRooms;
                for (int i = 0; i < 5; i++)
                {
                    if (_fleetRows[i] == null) continue;
                    if (i >= rooms.Count)
                    {
                        _fleetRows[i].SetActive(false);
                        _fleetRoomIds[i] = string.Empty;
                        _fleetHostUids[i] = string.Empty;
                        continue;
                    }
                    _fleetRows[i].SetActive(true);
                    CreditGuardRuntime.FleetRoomModel r = rooms[i];
                    _fleetRoomIds[i] = r.RoomId;
                    _fleetHostUids[i] = r.HostUid;
                    string mapLabel = string.IsNullOrEmpty(r.MapName) ? ("模式 " + r.Mode) : r.MapName;
                    string gate = r.Eligible ? "可进" : ("拦截:" + r.IneligibleReason);
                    _fleetTexts[i].text = string.Format(CultureInfo.InvariantCulture,
                        "{0} ({1} {2}/{3}) · 均分 {4:F0}\n门槛≥{5} 拔≤{6:F0}% · {7}",
                        r.RoomName, mapLabel, r.PlayerCount, r.MaxPlayers, r.AvgCredit, r.MinCredit, r.MaxGiveUpRate, gate);
                }

                // SubTab 2
                if (_autoReadyToggle != null) _autoReadyToggle.isOn = rt.AutoReady;
                if (_followToggleBtnText != null) _followToggleBtnText.text = rt.AutoFollowActive ? "停止跟房" : "开启自动跟房";
                if (_followStatusText != null)
                {
                    _followStatusText.text = rt.AutoFollowActive
                        ? "自动跟房开启中 · 目标车头 UID " + rt.AutoFollowHostUid + "（回到大厅后每 4 秒检测车头新房并直连）"
                        : "未开启自动跟房；一局打完退回大厅后，车头开新房会自动直连跟进";
                }

                CreditGuardRuntime.SquadModel sq = rt.CurrentSquad;
                if (_squadSummaryText != null)
                {
                    if (sq == null)
                    {
                        _squadSummaryText.text = "暂未加入星枢高信誉小队；可点击「创建小队」生成邀请码分享给固定队友。";
                    }
                    else
                    {
                        var lines = new List<string>(6)
                        {
                            string.Format(CultureInfo.InvariantCulture, "{0} · 邀请码 [{1}] · {2}/{3}人 · 均分 {4:F0}",
                                sq.Title, sq.JoinCode, sq.Members.Count, sq.MaxMembers, sq.AvgCredit)
                        };
                        foreach (CreditGuardRuntime.SquadMemberModel m in sq.Members)
                        {
                            lines.Add(string.Format(CultureInfo.InvariantCulture, "· {0} (UID {1}) | {2}分 | {3}",
                                string.IsNullOrEmpty(m.Nick) ? m.Uid : m.Nick, m.Uid, m.Score, m.Ready ? "已准备" : "未准备"));
                        }
                        if (!string.IsNullOrEmpty(sq.ActiveRoomId))
                        {
                            lines.Add("队长已发布房间 #" + sq.ActiveRoomId);
                        }
                        _squadSummaryText.text = string.Join("\n", lines.ToArray());
                    }
                }
                bool inSquad = sq != null;
                if (_squadReadyBtn != null) _squadReadyBtn.gameObject.SetActive(inSquad);
                if (_squadLeaveBtn != null) _squadLeaveBtn.gameObject.SetActive(inSquad);
                if (_squadPublishBtn != null)
                {
                    _squadPublishBtn.gameObject.SetActive(inSquad && rt.LocalUid > 0 && sq.LeaderUid == rt.LocalUid.ToString(CultureInfo.InvariantCulture));
                }

                // SubTab 3
                if (_authStatusText != null)
                {
                    _authStatusText.text = rt.HasAuthToken
                        ? "已获取星枢授权令牌（UID " + rt.LocalUid + "），点赞/拉黑/反馈/车队/组队已全部解锁。"
                        : "当前未检测到星枢授权令牌：仅支持只读查看队友信誉；安卓请先完成「手机助手绑定」，或下方粘贴令牌。";
                }
                IList<CreditGuardRuntime.BlacklistEntryModel> blks = rt.BlacklistEntries;
                for (int i = 0; i < 6; i++)
                {
                    if (_blkRows[i] == null) continue;
                    if (i >= blks.Count)
                    {
                        _blkRows[i].SetActive(false);
                        _blkUids[i] = string.Empty;
                        continue;
                    }
                    _blkRows[i].SetActive(true);
                    CreditGuardRuntime.BlacklistEntryModel b = blks[i];
                    _blkUids[i] = b.TargetUid;
                    string bNick = string.IsNullOrEmpty(b.TargetNick) ? b.TargetUid : b.TargetNick;
                    _blkTexts[i].text = string.Format(CultureInfo.InvariantCulture,
                        "{0} (UID {1}) · 信誉 {2} 拔{3:F1}%{4}",
                        bNick, b.TargetUid, b.Score, b.GiveUpRate, string.IsNullOrEmpty(b.Note) ? "" : " · " + b.Note);
                }
            }
            finally
            {
                _suppressCallbacks = false;
            }
        }
    }
}
