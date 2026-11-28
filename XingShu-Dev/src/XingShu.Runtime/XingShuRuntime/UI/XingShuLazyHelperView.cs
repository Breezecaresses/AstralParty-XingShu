using UnityEngine;
using UnityEngine.UI;
using XingShuRuntime.Utilities;

namespace XingShuRuntime.UI
{
    /// <summary>
    /// Page view for Lazy Helper (懒人助手, Tab 24):
    /// Free/star-coin daily shop, daily/weekly/achieve/guild tasks, battle passes,
    /// mail attachment claim, activity sign-ins, and safe non-optional chest opening.
    /// </summary>
    internal sealed class XingShuLazyHelperView
    {
        private readonly GameObject _root;
        private Toggle _masterToggle;
        private Text _statusText;
        private Button _runNowBtn;
        private Toggle _freeShopToggle;
        private Toggle _starCoinShopToggle;
        private Toggle _tasksToggle;
        private Toggle _passesToggle;
        private Toggle _mailToggle;
        private Toggle _chestsToggle;
        private Toggle _activitiesToggle;
        private Text _logsText;
        private bool _suppressCallbacks;

        internal GameObject Root => _root;

        internal XingShuLazyHelperView(Transform parent)
        {
            _root = XingShuUIFactory.CreateUIObject("Page_LazyHelper", parent.gameObject);
            BuildUI();
            UpdateSync();
        }

        private void BuildUI()
        {
            XingShuViewCardHelper.CreatePageScroll(_root, "LazyHelperScrollView", out GameObject content);

            // Card 1: 总开关与立即执行
            GameObject masterCard = XingShuViewCardHelper.CreateCardContainer(content, "Card_LazyHelperMaster", 148f, featureHeader: true);
            Text title = XingShuUIFactory.CreateText(masterCard, "Title", "懒人助手 · 自动化日常领取", 18, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            XingShuViewCardHelper.PlaceTopLeft(title.rectTransform, new Vector2(20f, -12f), new Vector2(400f, 26f));

            Text desc = XingShuUIFactory.CreateText(masterCard, "Description",
                "仅在回到大厅空闲且无确认弹窗时按账号独立运行；每日仅买免费与星币货架，绝不误开自选箱、绝不消耗钻石/星盘。",
                12, XingShuUITheme.SecondaryText, TextAnchor.UpperLeft);
            XingShuViewCardHelper.PlaceStretchTop(desc.rectTransform, 44f, 40f, 40f);

            _statusText = XingShuUIFactory.CreateText(masterCard, "Status", LazyHelperRuntime.Status, 12, XingShuUITheme.MutedText, TextAnchor.MiddleLeft);
            XingShuViewCardHelper.PlaceStretchTop(_statusText.rectTransform, 92f, 36f, 40f);

            _masterToggle = XingShuUIFactory.CreateToggle(masterCard, "LazyMasterToggle", "启用懒人助手", LazyHelperRuntime.IsMasterEnabled,
                v => { if (!_suppressCallbacks) { LazyHelperRuntime.SetMasterEnabled(v); UpdateSync(); } });
            XingShuViewCardHelper.PlaceTopRight(_masterToggle.GetComponent<RectTransform>(), new Vector2(-150f, -10f), new Vector2(168f, 34f));

            _runNowBtn = XingShuViewCardHelper.CreateActionButton(masterCard, "RunNowBtn", "立即执行一次",
                () => { LazyHelperRuntime.TriggerRunNow(); UpdateSync(); }, 122f, 32f, 12);
            XingShuViewCardHelper.PlaceTopRight(_runNowBtn.GetComponent<RectTransform>(), new Vector2(-20f, -11f), new Vector2(122f, 32f));

            // Card 2: 商店自动化（免费 & 星币）
            GameObject shopCard = XingShuViewCardHelper.CreateCardContainer(content, "Card_LazyShop", 162f);
            Text shopTitle = XingShuUIFactory.CreateText(shopCard, "Title", "每日商店自动购领", 17, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            XingShuViewCardHelper.PlaceTopLeft(shopTitle.rectTransform, new Vector2(20f, -12f), new Vector2(360f, 24f));

            Text freeDesc = XingShuUIFactory.CreateText(shopCard, "FreeDesc",
                "自动领取每日商店免费商品与官方免费 7 日礼包",
                12, XingShuUITheme.SecondaryText, TextAnchor.MiddleLeft);
            XingShuViewCardHelper.PlaceTopLeft(freeDesc.rectTransform, new Vector2(20f, -48f), new Vector2(460f, 28f));

            _freeShopToggle = XingShuUIFactory.CreateToggle(shopCard, "FreeShopToggle", "每日免费商品", LazyHelperRuntime.IsFreeShopEnabled,
                v => { if (!_suppressCallbacks) LazyHelperRuntime.SetSubToggle(LazyHelperPolicy.KeyFreeShop, v); });
            XingShuViewCardHelper.PlaceTopRight(_freeShopToggle.GetComponent<RectTransform>(), new Vector2(-20f, -46f), new Vector2(180f, 32f));

            Text coinDesc = XingShuUIFactory.CreateText(shopCard, "CoinDesc",
                "自动购买每日随机货架中的星币商品（沿用限购账本，余额不足跳过）",
                12, XingShuUITheme.SecondaryText, TextAnchor.MiddleLeft);
            XingShuViewCardHelper.PlaceTopLeft(coinDesc.rectTransform, new Vector2(20f, -94f), new Vector2(460f, 28f));

            _starCoinShopToggle = XingShuUIFactory.CreateToggle(shopCard, "StarCoinShopToggle", "每日星币商品", LazyHelperRuntime.IsStarCoinShopEnabled,
                v => { if (!_suppressCallbacks) LazyHelperRuntime.SetSubToggle(LazyHelperPolicy.KeyStarCoinShop, v); });
            XingShuViewCardHelper.PlaceTopRight(_starCoinShopToggle.GetComponent<RectTransform>(), new Vector2(-20f, -92f), new Vector2(180f, 32f));

            // Card 3: 奖励领取与随机箱
            GameObject claimCard = XingShuViewCardHelper.CreateCardContainer(content, "Card_LazyRewards", 288f);
            Text claimTitle = XingShuUIFactory.CreateText(claimCard, "Title", "任务 · 通行证 · 邮件 · 随机箱 · 活动", 17, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            XingShuViewCardHelper.PlaceTopLeft(claimTitle.rectTransform, new Vector2(20f, -12f), new Vector2(460f, 24f));

            AddFeatureRow(claimCard, "Tasks", 46f,
                "自动领取日常、周常、周常活跃度进度箱、七日/成就及社团已完成任务",
                "任务与活跃度", LazyHelperRuntime.IsTasksEnabled,
                v => LazyHelperRuntime.SetSubToggle(LazyHelperPolicy.KeyTasks, v), out _tasksToggle);

            AddFeatureRow(claimCard, "Passes", 92f,
                "自动领取赛季通行证任务与升级奖励、以及活动通行证已完成档位",
                "赛季/活动通行证", LazyHelperRuntime.IsPassesEnabled,
                v => LazyHelperRuntime.SetSubToggle(LazyHelperPolicy.KeyPasses, v), out _passesToggle);

            AddFeatureRow(claimCard, "Mail", 138f,
                "自动一键领取所有未领邮件附件（仅领取，绝不删除任何邮件）",
                "邮件附件一键领", LazyHelperRuntime.IsMailEnabled,
                v => LazyHelperRuntime.SetSubToggle(LazyHelperPolicy.KeyMail, v), out _mailToggle);

            AddFeatureRow(claimCard, "Activities", 184f,
                "自动完成每日签到、活动任务领奖与回归免费/签到奖励",
                "活动与签到奖励", LazyHelperRuntime.IsActivitiesEnabled,
                v => LazyHelperRuntime.SetSubToggle(LazyHelperPolicy.KeyActivities, v), out _activitiesToggle);

            AddFeatureRow(claimCard, "Chests", 230f,
                "自动打开背包纯随机箱（严格过滤，绝不打开任何自选宝箱；默认关闭）",
                "自动开随机箱", LazyHelperRuntime.IsChestsEnabled,
                v => LazyHelperRuntime.SetSubToggle(LazyHelperPolicy.KeyChests, v), out _chestsToggle);

            // Card 4: 最近领取记录
            GameObject logCard = XingShuViewCardHelper.CreateCardContainer(content, "Card_LazyLogs", 146f);
            Text logTitle = XingShuUIFactory.CreateText(logCard, "Title", "最近执行记录", 16, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            XingShuViewCardHelper.PlaceTopLeft(logTitle.rectTransform, new Vector2(20f, -10f), new Vector2(280f, 24f));

            _logsText = XingShuUIFactory.CreateText(logCard, "LogBody", LazyHelperRuntime.RecentLogsSummary, 12, XingShuUITheme.SecondaryText, TextAnchor.UpperLeft);
            XingShuViewCardHelper.PlaceStretchTop(_logsText.rectTransform, 38f, 96f, 40f);
        }

        private void AddFeatureRow(
            GameObject parent,
            string key,
            float yOffset,
            string descText,
            string toggleLabel,
            bool initialValue,
            System.Action<bool> onChanged,
            out Toggle toggle)
        {
            Text desc = XingShuUIFactory.CreateText(parent, key + "Desc", descText, 12, XingShuUITheme.SecondaryText, TextAnchor.MiddleLeft);
            XingShuViewCardHelper.PlaceTopLeft(desc.rectTransform, new Vector2(20f, -yOffset), new Vector2(480f, 28f));

            toggle = XingShuUIFactory.CreateToggle(parent, key + "Toggle", toggleLabel, initialValue,
                v => { if (!_suppressCallbacks) onChanged(v); });
            XingShuViewCardHelper.PlaceTopRight(toggle.GetComponent<RectTransform>(), new Vector2(-20f, -(yOffset - 2f)), new Vector2(180f, 32f));
        }

        internal void UpdateSync()
        {
            bool canCfg = LazyHelperRuntime.CanConfigure;
            _suppressCallbacks = true;
            if (_masterToggle != null) { _masterToggle.isOn = LazyHelperRuntime.IsMasterEnabled; _masterToggle.interactable = canCfg; }
            if (_freeShopToggle != null) { _freeShopToggle.isOn = LazyHelperRuntime.IsFreeShopEnabled; _freeShopToggle.interactable = canCfg; }
            if (_starCoinShopToggle != null) { _starCoinShopToggle.isOn = LazyHelperRuntime.IsStarCoinShopEnabled; _starCoinShopToggle.interactable = canCfg; }
            if (_tasksToggle != null) { _tasksToggle.isOn = LazyHelperRuntime.IsTasksEnabled; _tasksToggle.interactable = canCfg; }
            if (_passesToggle != null) { _passesToggle.isOn = LazyHelperRuntime.IsPassesEnabled; _passesToggle.interactable = canCfg; }
            if (_mailToggle != null) { _mailToggle.isOn = LazyHelperRuntime.IsMailEnabled; _mailToggle.interactable = canCfg; }
            if (_activitiesToggle != null) { _activitiesToggle.isOn = LazyHelperRuntime.IsActivitiesEnabled; _activitiesToggle.interactable = canCfg; }
            if (_chestsToggle != null) { _chestsToggle.isOn = LazyHelperRuntime.IsChestsEnabled; _chestsToggle.interactable = canCfg; }
            if (_runNowBtn != null) _runNowBtn.interactable = canCfg;
            _suppressCallbacks = false;

            if (_statusText != null && _statusText.text != LazyHelperRuntime.Status)
                _statusText.text = LazyHelperRuntime.Status;
            string logs = LazyHelperRuntime.RecentLogsSummary;
            if (_logsText != null && _logsText.text != logs)
                _logsText.text = logs;
        }
    }
}
