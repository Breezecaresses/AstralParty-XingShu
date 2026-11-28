using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using Core.Net;
using Core.Scene;
using GameLogic;
using GameLogic.Data;
using Tools;
using UI;
using UnityEngine;
using XingShuRuntime.Core;

namespace XingShuRuntime.Utilities;

/// <summary>
/// Standalone official module `lazy-helper` (懒人助手):
/// Sequentially claims idle-lobby rewards per account with 7 independent toggles and
/// strict safety guards (free/star-coin shop, daily/weekly/achieve/guild tasks, passes,
/// mail attachments, non-optional random chests, and activities/sign-ins).
/// </summary>
internal sealed class LazyHelperRuntime : MonoBehaviour
{
    private static LazyHelperRuntime _instance;
    private static readonly FieldInfo ActivityPassDictField =
        typeof(ActivityPassLogic).GetField("activityPass", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public);

    private long _uid;
    private bool _online;

    private bool _masterEnabled;
    private bool _freeShopEnabled;
    private bool _starCoinShopEnabled;
    private bool _tasksEnabled;
    private bool _passesEnabled;
    private bool _mailEnabled;
    private bool _chestsEnabled;
    private bool _activitiesEnabled;

    private bool _shopBlocked;
    private string _day = "";
    private string _pendingShop = "";
    private string _completedShopDay = "";
    private string _status = "登录游戏后可按账号开启懒人助手；默认关闭";

    private float _nextTick;
    private float _readyAt;
    private float _sentAt;
    private float _nextClaimAt;
    private bool _manualRunRequested;
    private int _chestFailures;
    private readonly Dictionary<string, float> _cooldownUntil = new Dictionary<string, float>(StringComparer.Ordinal);
    private readonly List<string> _recentLogs = new List<string>(8);

    private RPCAsyncResult _shopRequest;
    private RPCAsyncResult _activeClaimRequest;
    private string _activeClaimLabel = "";

    internal static bool CanConfigure => _instance != null && _instance._online && _instance._uid > 0;
    internal static bool IsMasterEnabled => _instance != null && _instance._masterEnabled;
    internal static bool IsFreeShopEnabled => _instance != null && _instance._freeShopEnabled;
    internal static bool IsStarCoinShopEnabled => _instance != null && _instance._starCoinShopEnabled;
    internal static bool IsTasksEnabled => _instance != null && _instance._tasksEnabled;
    internal static bool IsPassesEnabled => _instance != null && _instance._passesEnabled;
    internal static bool IsMailEnabled => _instance != null && _instance._mailEnabled;
    internal static bool IsChestsEnabled => _instance != null && _instance._chestsEnabled;
    internal static bool IsActivitiesEnabled => _instance != null && _instance._activitiesEnabled;
    internal static string Status => _instance?._status ?? "等待懒人助手初始化";

    internal static string RecentLogsSummary
    {
        get
        {
            if (_instance == null || _instance._recentLogs.Count == 0) return "暂无自动领取记录";
            return string.Join("\n", _instance._recentLogs);
        }
    }

    public static void Install(GameObject host)
    {
        if (_instance == null && host != null)
        {
            _instance = host.AddComponent<LazyHelperRuntime>();
        }
    }

    internal static void SetMasterEnabled(bool enabled)
    {
        var self = _instance;
        if (self == null || !CanConfigure) return;
        self._masterEnabled = enabled;
        self._shopBlocked = false;
        self._completedShopDay = "";
        self._chestFailures = 0;
        self.SaveBool(LazyHelperPolicy.KeyMaster, enabled);
        if (enabled)
        {
            self._manualRunRequested = true;
            self._nextClaimAt = 0f;
            self._cooldownUntil.Clear();
            self._status = "已开启懒人助手；回到大厅空闲时自动依次领取已勾选项";
        }
        else
        {
            self._status = "已关闭懒人助手；不再发起自动领取与购买";
        }
    }

    internal static bool GetSubToggle(string subKey)
    {
        var self = _instance;
        if (self == null) return false;
        switch (subKey)
        {
            case LazyHelperPolicy.KeyFreeShop: return self._freeShopEnabled;
            case LazyHelperPolicy.KeyStarCoinShop: return self._starCoinShopEnabled;
            case LazyHelperPolicy.KeyTasks: return self._tasksEnabled;
            case LazyHelperPolicy.KeyPasses: return self._passesEnabled;
            case LazyHelperPolicy.KeyMail: return self._mailEnabled;
            case LazyHelperPolicy.KeyChests: return self._chestsEnabled;
            case LazyHelperPolicy.KeyActivities: return self._activitiesEnabled;
            default: return false;
        }
    }

    internal static void SetSubToggle(string subKey, bool enabled)
    {
        var self = _instance;
        if (self == null || !CanConfigure) return;
        switch (subKey)
        {
            case LazyHelperPolicy.KeyFreeShop:
                self._freeShopEnabled = enabled;
                self._completedShopDay = "";
                self._shopBlocked = false;
                break;
            case LazyHelperPolicy.KeyStarCoinShop:
                self._starCoinShopEnabled = enabled;
                self._completedShopDay = "";
                self._shopBlocked = false;
                break;
            case LazyHelperPolicy.KeyTasks:
                self._tasksEnabled = enabled;
                break;
            case LazyHelperPolicy.KeyPasses:
                self._passesEnabled = enabled;
                break;
            case LazyHelperPolicy.KeyMail:
                self._mailEnabled = enabled;
                break;
            case LazyHelperPolicy.KeyChests:
                self._chestsEnabled = enabled;
                self._chestFailures = 0;
                break;
            case LazyHelperPolicy.KeyActivities:
                self._activitiesEnabled = enabled;
                break;
            default:
                return;
        }
        self.SaveBool(subKey, enabled);
        if (enabled)
        {
            self._manualRunRequested = true;
            self._nextClaimAt = 0f;
        }
    }

    internal static void TriggerRunNow()
    {
        var self = _instance;
        if (self == null || !CanConfigure) return;
        self._shopBlocked = false;
        self._completedShopDay = "";
        self._chestFailures = 0;
        self._cooldownUntil.Clear();
        self._manualRunRequested = true;
        self._nextClaimAt = 0f;
        self._nextTick = 0f;
        self._status = "已触发立即检查，等待空闲大厅窗口…";
    }

    private void SaveBool(string subKey, bool value)
    {
        if (_uid <= 0) return;
        XingShuConfigService.SetBool(LazyHelperPolicy.AccountConfigKey(_uid, subKey), value);
        if (subKey == LazyHelperPolicy.KeyStarCoinShop)
        {
            XingShuConfigService.SetBool(LazyHelperPolicy.LegacyStarCoinEnabledKey(_uid), value);
        }
        XingShuConfigService.Save();
    }

    private void AddLog(string msg)
    {
        if (string.IsNullOrEmpty(msg)) return;
        string stamp = DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture);
        _recentLogs.Insert(0, stamp + " · " + msg);
        while (_recentLogs.Count > 6) _recentLogs.RemoveAt(_recentLogs.Count - 1);
    }

    private void LoadAccountConfig(long uid)
    {
        _uid = uid;
        _shopBlocked = false;
        _completedShopDay = "";
        _day = "";
        _shopRequest = null;
        _activeClaimRequest = null;
        _activeClaimLabel = "";
        _chestFailures = 0;
        _cooldownUntil.Clear();
        _recentLogs.Clear();

        string masterKey = LazyHelperPolicy.AccountConfigKey(uid, LazyHelperPolicy.KeyMaster);
        string starKey = LazyHelperPolicy.AccountConfigKey(uid, LazyHelperPolicy.KeyStarCoinShop);
        string legacyKey = LazyHelperPolicy.LegacyStarCoinEnabledKey(uid);

        bool hasMaster = XingShuConfigService.HasKey(masterKey);
        bool savedMaster = XingShuConfigService.GetBool(masterKey, false);
        bool hasStar = XingShuConfigService.HasKey(starKey);
        bool savedStar = XingShuConfigService.GetBool(starKey, false);
        bool hasLegacy = XingShuConfigService.HasKey(legacyKey);
        bool legacyVal = XingShuConfigService.GetBool(legacyKey, false);

        LazyHelperPolicy.ResolveMigratedDefaults(
            hasMaster, savedMaster, hasStar, savedStar, hasLegacy, legacyVal,
            out _masterEnabled, out _starCoinShopEnabled, out bool migrated);

        _freeShopEnabled = XingShuConfigService.GetBool(LazyHelperPolicy.AccountConfigKey(uid, LazyHelperPolicy.KeyFreeShop), true);
        _tasksEnabled = XingShuConfigService.GetBool(LazyHelperPolicy.AccountConfigKey(uid, LazyHelperPolicy.KeyTasks), true);
        _passesEnabled = XingShuConfigService.GetBool(LazyHelperPolicy.AccountConfigKey(uid, LazyHelperPolicy.KeyPasses), true);
        _mailEnabled = XingShuConfigService.GetBool(LazyHelperPolicy.AccountConfigKey(uid, LazyHelperPolicy.KeyMail), true);
        _chestsEnabled = XingShuConfigService.GetBool(LazyHelperPolicy.AccountConfigKey(uid, LazyHelperPolicy.KeyChests), false);
        _activitiesEnabled = XingShuConfigService.GetBool(LazyHelperPolicy.AccountConfigKey(uid, LazyHelperPolicy.KeyActivities), true);

        if (migrated)
        {
            XingShuConfigService.SetBool(masterKey, true);
            XingShuConfigService.SetBool(starKey, true);
            XingShuConfigService.Save();
            AddLog("已自动继承原每日星币商店开关配置");
        }

        _pendingShop = XingShuConfigService.GetString("XINGSHU_DAILY_STARCOIN_" + uid.ToString(CultureInfo.InvariantCulture) + "_PENDING", "");
        _readyAt = Time.realtimeSinceStartup + 2.5f;
    }

    private void Update()
    {
        if (Time.realtimeSinceStartup < _nextTick) return;
        _nextTick = Time.realtimeSinceStartup + 0.9f;
        try { Tick(); }
        catch (Exception ex)
        {
            _activeClaimRequest = null;
            _activeClaimLabel = "";
            _nextClaimAt = Time.realtimeSinceStartup + 5f;
            _status = "本次自动处理已暂停：" + ex.GetType().Name;
            Debug.LogWarning("[XingShu LazyHelper] Paused: " + ex);
        }
    }

    private void Tick()
    {
        var logic = SimpleSingletonProvider<GameLogicManager>.hasInstance ? SimpleSingletonProvider<GameLogicManager>.inst : null;
        bool online = logic?.account != null && logic.account.online &&
            MonoSingletonProvider<NetManager>.hasInstance &&
            MonoSingletonProvider<NetManager>.inst.IsConnected;
        long uid = online ? logic.account.GetPlayerID() : 0L;

        if (!online || uid <= 0)
        {
            _online = false;
            _uid = 0;
            _shopRequest = null;
            _activeClaimRequest = null;
            _activeClaimLabel = "";
            _status = "登录游戏后可按账号开启懒人助手；默认关闭";
            return;
        }

        if (!_online || _uid != uid)
        {
            _online = true;
            LoadAccountConfig(uid);
        }

        // Wait for any in-flight general claim request first.
        if (_activeClaimRequest != null)
        {
            if (!_activeClaimRequest.keepWaiting)
            {
                if (_activeClaimRequest.errId != 0)
                {
                    AddLog(_activeClaimLabel + " 返回错误码 " + _activeClaimRequest.errId + "，已冷却跳过");
                    _cooldownUntil[_activeClaimLabel] = Time.realtimeSinceStartup + 30f;
                    if (_activeClaimLabel.StartsWith("开箱", StringComparison.Ordinal))
                    {
                        _chestFailures++;
                    }
                }
                else
                {
                    AddLog("已领取：" + _activeClaimLabel);
                    if (_activeClaimLabel.StartsWith("开箱", StringComparison.Ordinal))
                    {
                        _chestFailures = 0;
                    }
                }
                _activeClaimRequest = null;
                _activeClaimLabel = "";
                _nextClaimAt = Time.realtimeSinceStartup + 0.85f;
                return;
            }
            if (Time.realtimeSinceStartup - _sentAt < 12f)
            {
                _status = "正在处理：" + _activeClaimLabel + "…";
                return;
            }
            _cooldownUntil[_activeClaimLabel] = Time.realtimeSinceStartup + 30f;
            _activeClaimRequest = null;
            _activeClaimLabel = "";
        }

        if (!_masterEnabled && !_manualRunRequested)
        {
            _status = "已关闭；不会自动购买或领取（可点击“立即执行一次”）";
            return;
        }

        string day = DailyStarCoinShopPolicy.Day(MonoSingletonProvider<NetManager>.inst.ServerTime);
        if (_day != day)
        {
            _day = day;
            _completedShopDay = "";
            if (!string.IsNullOrEmpty(_pendingShop) && !_pendingShop.StartsWith(day + "|", StringComparison.Ordinal))
            {
                ClearPendingShop();
            }
        }

        if (Time.realtimeSinceStartup < _readyAt)
        {
            _status = "等待官方登录数据就绪…";
            return;
        }

        bool inHomeScene = SimpleSingletonProvider<SceneManager>.hasInstance &&
            SimpleSingletonProvider<SceneManager>.inst.currentType != null &&
            SimpleSingletonProvider<SceneManager>.inst.currentType.Value == SceneType.Home;
        bool inRoom = logic.room != null && (logic.room.IsInRoom ||
            (logic.room.roomController != null && logic.room.roomController.roomStateType != RoomStateType.NONE));
        bool matchTimerActive = logic.match != null && logic.match.CheckTimer();
        var matchData = logic.match?.matchData;

        if (!DailyStarCoinShopPolicy.IsLobbyIdleForAutoBuy(inHomeScene, logic.connectRoomId != 0L, inRoom,
                matchTimerActive, matchData != null && matchData.InTeam, matchData?.TeamId ?? 0L))
        {
            _status = "当前在对局/房间/匹配中，已暂停懒人助手";
            return;
        }

        var ui = SimpleSingletonProvider<UIManager>.hasInstance ? SimpleSingletonProvider<UIManager>.inst : null;
        if (ui == null || (!(ui.currentPanel is HomePanel) && !(ui.currentPanel is ProductRecommendationPanel)) ||
            ShownNativeWindows.Find<PurchaseWindow>(ui) != null ||
            ShownNativeWindows.Find<MessageBoxWindow>(ui) != null ||
            ShownNativeWindows.Find<MatchInfoWindow>(ui) != null)
        {
            _status = "等待返回主大厅界面后再自动领取";
            return;
        }

        // Handle persisted pending shop journal safely before dispatching any new request.
        if (TryHandlePendingShopJournal(logic, day)) return;

        if (Time.realtimeSinceStartup < _nextClaimAt) return;

        // Priority pipeline: dispatch at most 1 RPC per tick.
        if (_freeShopEnabled || _starCoinShopEnabled)
        {
            if (TryDispatchShopClaim(logic, day)) return;
        }
        if (_tasksEnabled && TryDispatchTaskClaim(logic)) return;
        if (_passesEnabled && TryDispatchPassClaim(logic)) return;
        if (_mailEnabled && TryDispatchMailClaim(logic)) return;
        if (_activitiesEnabled && TryDispatchActivityAndSignInClaim(logic)) return;
        if (_chestsEnabled && _chestFailures < 3 && TryDispatchChestOpen(logic)) return;

        _manualRunRequested = false;
        _nextClaimAt = Time.realtimeSinceStartup + 8f;
        _status = "今日可领取项目已巡检完成（持续在后台空闲守护）";
    }

    private bool IsCoolingDown(string key)
    {
        return _cooldownUntil.TryGetValue(key, out float until) && Time.realtimeSinceStartup < until;
    }

    private void BeginClaim(string label, RPCAsyncResult rpc)
    {
        if (rpc == null)
        {
            _cooldownUntil[label] = Time.realtimeSinceStartup + 20f;
            return;
        }
        _activeClaimLabel = label;
        _activeClaimRequest = rpc;
        _sentAt = Time.realtimeSinceStartup;
        _status = "正在领取：" + label;
    }

    private bool TryHandlePendingShopJournal(GameLogicManager logic, string day)
    {
        if (string.IsNullOrEmpty(_pendingShop) || logic.store == null) return false;
        string[] p = _pendingShop.Split('|');
        if (p.Length != 4 || !int.TryParse(p[1], out int goods) || !int.TryParse(p[2], out int before) ||
            !int.TryParse(p[3], out int count) || goods <= 0 || before < 0 || count <= 0)
        {
            _shopBlocked = true;
            _status = "商店购买记录格式异常，已跳过每日商店";
            return false;
        }
        if (p[0] != day || (long)logic.store.GetGoodsRecord(2, goods) >= (long)before + count)
        {
            ClearPendingShop();
            AddLog("已核对每日商店购买 #" + goods);
            _shopRequest = null;
            _nextClaimAt = Time.realtimeSinceStartup + 0.8f;
            return true;
        }
        if (_shopRequest != null && !_shopRequest.keepWaiting && _shopRequest.errId != 0)
        {
            _shopBlocked = true;
            _shopRequest = null;
            _status = "每日商店返回错误，已安全暂停商店项（其余领取继续）";
            return false;
        }
        _status = (_shopRequest != null && Time.realtimeSinceStartup - _sentAt < 18f)
            ? "正在核对每日商店购买记录…" : "上笔每日商店记录待确认，跳过商店购买";
        return _shopRequest != null && Time.realtimeSinceStartup - _sentAt < 18f;
    }

    private void ClearPendingShop()
    {
        _pendingShop = "";
        XingShuConfigService.ResetKey("XINGSHU_DAILY_STARCOIN_" + _uid.ToString(CultureInfo.InvariantCulture) + "_PENDING");
        XingShuConfigService.Save();
    }

    private bool TryDispatchShopClaim(GameLogicManager logic, string day)
    {
        if (_shopBlocked || logic.store == null || logic.bag == null) return false;

        // 1. Free 7-day gift rewards (never create paid orders)
        if (_freeShopEnabled)
        {
            ShopTabType[] tabs = { ShopTabType.Day7GiftPackage, ShopTabType.Day7GiftPackagePve, ShopTabType.Day7GiftPackagePveYear };
            foreach (var tab in tabs)
            {
                string ck = "7day:" + (int)tab;
                if (IsCoolingDown(ck)) continue;
                try
                {
                    var gift = logic.store.Get7DailyGiftPackageConfig(tab);
                    if (gift != null && logic.store.Get7DailyGiftStatus(tab) && gift.RewardStatus && !gift.NoAvailTime && gift.giftConfig != null && gift.SalePrice == 0)
                    {
                        BeginClaim(ck, logic.store.RequestGetDay7RewardC2S(gift.goodsId));
                        return true;
                    }
                }
                catch { }
            }
        }

        // 2. Daily refresh shelf
        if (_completedShopDay == day) return false;
        List<DailRefreshGoods> shelf;
        try { shelf = logic.store.GetDailyRefresh(); }
        catch { return false; }
        if (shelf == null || shelf.Count == 0 || shelf.Count > 64) return false;

        var offers = new List<DailyStarCoinShopPolicy.Offer>(shelf.Count);
        var seenIds = new HashSet<int>();
        foreach (var goods in shelf)
        {
            if (goods == null || goods.itemConfig == null || !seenIds.Add(goods.goodsId)) continue;
            offers.Add(new DailyStarCoinShopPolicy.Offer
            {
                Id = goods.goodsId,
                Currency = goods.currencyID,
                Price = goods.SalePrice,
                Limit = goods.LimitNum(),
                Purchased = logic.store.GetGoodsRecord(2, goods.goodsId),
                Owned = goods.IsOwn(),
            });
        }

        var next = LazyHelperPolicy.NextShopOffer(offers, logic.bag.GetItemCount(1), _freeShopEnabled, _starCoinShopEnabled, out bool budgetShort);
        if (next == null)
        {
            if (!budgetShort && _freeShopEnabled && _starCoinShopEnabled) _completedShopDay = day;
            return false;
        }

        _pendingShop = day + "|" + next.Id + "|" + next.Purchased + "|" + next.Remaining;
        XingShuConfigService.SetString("XINGSHU_DAILY_STARCOIN_" + _uid.ToString(CultureInfo.InvariantCulture) + "_PENDING", _pendingShop);
        XingShuConfigService.Save();
        _sentAt = Time.realtimeSinceStartup;
        _shopRequest = logic.store.RequestMallBuy(2, next.Id, next.Remaining);
        _status = next.Price == 0 ? "正在领取每日免费商品…" : "正在购买每日星币商品…";
        return true;
    }

    private bool TryDispatchTaskClaim(GameLogicManager logic)
    {
        var task = logic.task;
        if (task != null)
        {
            if (task.taskDataDict != null)
            {
                foreach (var kv in task.taskDataDict)
                {
                    var t = kv.Value;
                    if (t == null || t._Config == null || !t._FinishStatus || !t.TaskRunning) continue;
                    string ck = "任务(日常)#" + t._Config.Id;
                    if (IsCoolingDown(ck)) continue;
                    BeginClaim(ck, task.RequestTaskRewardC2S(t._Config.Id, 1));
                    return true;
                }
            }
            if (task.weekTaskDataDict != null)
            {
                foreach (var kv in task.weekTaskDataDict)
                {
                    var t = kv.Value;
                    if (t == null || t._Config == null || !t._FinishStatus || !t.TaskRunning) continue;
                    string ck = "周常#" + t._Config.Id;
                    if (IsCoolingDown(ck)) continue;
                    BeginClaim(ck, task.RequestTaskRewardC2S(t._Config.Id, 2));
                    return true;
                }
            }
            if (task.achieveDataDict != null)
            {
                foreach (var kv in task.achieveDataDict)
                {
                    var t = kv.Value;
                    if (t == null || t._Config == null || !t._FinishStatus || !t.TaskRunning) continue;
                    string ck = "成就#" + t._Config.Id;
                    if (IsCoolingDown(ck)) continue;
                    BeginClaim(ck, task.RequestTaskRewardC2S(t._Config.Id, 3));
                    return true;
                }
            }
            if (logic.bag != null && StaticConfigure.Task?.WeeklyProgresss != null && task.weekLivenessFinishIds != null)
            {
                int liveness = logic.bag.GetItemCount(52);
                foreach (var wp in StaticConfigure.Task.WeeklyProgresss)
                {
                    if (wp == null || liveness < wp.Progress || task.weekLivenessFinishIds.Contains(wp.Id)) continue;
                    string ck = "周常活跃度#" + wp.Id;
                    if (IsCoolingDown(ck)) continue;
                    BeginClaim(ck, task.RequestTaskRewardC2S(wp.Id, 4));
                    return true;
                }
            }
            if (task.sevenDayData != null)
            {
                int maxDay = Math.Max(7, task.sevenDayData.GetRunningTaskDay());
                for (int d = 1; d <= maxDay; d++)
                {
                    var list = task.sevenDayData.GetSevenDayTaskByDay(d);
                    if (list == null) continue;
                    for (int i = 0; i < list.Count; i++)
                    {
                        var t = list[i];
                        if (t == null || t._Config == null || !t._FinishStatus || !t.TaskRunning) continue;
                        string ck = "七日任务#" + t._Config.Id;
                        if (IsCoolingDown(ck)) continue;
                        BeginClaim(ck, task.RequestTaskRewardC2S(t._Config.Id, 5));
                        return true;
                    }
                }
            }
        }

        var guild = logic.guild;
        if (guild != null && guild.IsJoined && guild.HasClaimableGuildMission && guild.GuildMissionDatas != null)
        {
            for (int i = 0; i < guild.GuildMissionDatas.Count; i++)
            {
                var gm = guild.GuildMissionDatas[i];
                if (gm == null || !gm.CanClaimReward) continue;
                int id = gm._Id;
                string ck = "社团任务#" + id;
                if (IsCoolingDown(ck)) continue;
                BeginClaim(ck, guild.RequestGuildMissionReward(id));
                return true;
            }
        }
        return false;
    }

    private bool TryDispatchPassClaim(GameLogicManager logic)
    {
        var bp = logic.battlePass;
        var bpData = bp?.BattlePassData;
        if (bp != null && bpData != null)
        {
            if (bpData.taskDataDict != null)
            {
                foreach (var kv in bpData.taskDataDict)
                {
                    var t = kv.Value;
                    if (t == null || !t._FinishStatus || !t.TaskRunning) continue;
                    int id = t._Id;
                    string ck = "通行证任务#" + id;
                    if (IsCoolingDown(ck)) continue;
                    BeginClaim(ck, bp.RequestBattlePassTaskRewardC2S(id));
                    return true;
                }
            }
            bool hasFree = bpData.LV > bp.GetFinishRewardLV(BattlePassGearType.FREE);
            bool hasPaid = bpData.gearType != BattlePassGearType.FREE &&
                           bpData.gearType != BattlePassGearType.NONE &&
                           bpData.LV > bp.GetFinishRewardLV(bpData.gearType);
            if ((hasFree || hasPaid) && !IsCoolingDown("通行证等级奖励"))
            {
                BeginClaim("通行证等级奖励", bp.RequestBattlePassGetRewardC2S());
                return true;
            }
        }

        var ap = logic.activityPass;
        if (ap != null)
        {
            var apDict = ActivityPassDictField?.GetValue(ap) as Dictionary<int, ActivityPassData>;
            if (apDict != null)
            {
                foreach (var kv in apDict)
                {
                    if (TryDispatchSingleActivityPass(ap, kv.Value)) return true;
                }
            }
            else if (ap.ActivityPassData != null)
            {
                if (TryDispatchSingleActivityPass(ap, ap.ActivityPassData)) return true;
            }
        }
        return false;
    }

    private bool TryDispatchSingleActivityPass(ActivityPassLogic ap, ActivityPassData passData)
    {
        if (passData?.PassInfoConfig == null || passData.PassItemData == null) return false;
        int passId = passData.PassInfoConfig.Id;
        string ck = "活动通行证#" + passId;
        if (IsCoolingDown(ck)) return false;

        foreach (var kv in passData.PassItemData)
        {
            var item = kv.Value;
            if (item == null) continue;
            bool freeReady = item.FreeReward != null && item.FreeReward.GetRewardType() == ActivityPassItemReward.RewardType.Completed;
            bool premReady = item.PremiumReward != null && item.PremiumReward.GetRewardType() == ActivityPassItemReward.RewardType.Completed;
            if (freeReady || premReady)
            {
                BeginClaim(ck, ap.RequestReceiveReward(passId));
                return true;
            }
        }
        return false;
    }

    private bool TryDispatchMailClaim(GameLogicManager logic)
    {
        var container = logic.mail?._container;
        if (container == null || !container.MailRewardStatus() || IsCoolingDown("邮件一键领取")) return false;
        BeginClaim("邮件一键领取", logic.mail.RequestMailGetRewardC2S(0));
        return true;
    }

    private bool TryDispatchActivityAndSignInClaim(GameLogicManager logic)
    {
        var signIn = logic.signIn;
        if (signIn != null)
        {
            int? baseId = signIn.GetSignInID();
            if (baseId.HasValue && baseId.Value > 0 && signIn.GetCanSignInToday(baseId.Value))
            {
                string ck = "每日签到#" + baseId.Value;
                if (!IsCoolingDown(ck))
                {
                    BeginClaim(ck, signIn.SignIn(baseId.Value));
                    return true;
                }
            }
            if (logic.activity?.activityDict != null)
            {
                foreach (var kv in logic.activity.activityDict)
                {
                    int sid = signIn.GetSignInByActivityId(kv.Key);
                    if (sid > 0 && signIn.GetCanSignInToday(sid))
                    {
                        string ck = "活动签到#" + sid;
                        if (!IsCoolingDown(ck))
                        {
                            BeginClaim(ck, signIn.SignIn(sid));
                            return true;
                        }
                    }
                }
            }
        }

        if (logic.activity?.activityDict != null)
        {
            foreach (var kv in logic.activity.activityDict)
            {
                int actId = kv.Key;
                var taskData = logic.activity.GetTaskActivityData(actId);
                if (taskData?.taskDataDict == null) continue;
                foreach (var tkv in taskData.taskDataDict)
                {
                    var t = tkv.Value;
                    if (t == null || !t._FinishStatus || !t.TaskRunning || !t.ValidityTime()) continue;
                    string ck = "活动任务#" + actId + "_" + t._Id;
                    if (IsCoolingDown(ck)) continue;
                    BeginClaim(ck, logic.activity.OnRequestTaskReward(actId, t));
                    return true;
                }
            }
        }

        var cb = logic.comeback;
        var cbData = cb?.Data;
        if (cb != null && cbData != null && cbData.IsInPeriod() && cbData.ReturnInfo != null)
        {
            if (!cbData.ReturnInfo.FreeGiftClaimed && !IsCoolingDown("回归免费礼"))
            {
                BeginClaim("回归免费礼", cb.RequestFreeGift());
                return true;
            }
            var rs = cbData.ReturnInfo.SignIn;
            if (rs != null)
            {
                for (int d = 1; d <= rs.UnlockDay; d++)
                {
                    if ((rs.FreeClaimedDays == null || !rs.FreeClaimedDays.Contains(d)))
                    {
                        string ck = "回归签到#" + d;
                        if (!IsCoolingDown(ck))
                        {
                            BeginClaim(ck, cb.RequestSignInClaim(d, false));
                            return true;
                        }
                    }
                    if (rs.AdvUnlocked && (rs.AdvClaimedDays == null || !rs.AdvClaimedDays.Contains(d)))
                    {
                        string ck = "回归进阶签到#" + d;
                        if (!IsCoolingDown(ck))
                        {
                            BeginClaim(ck, cb.RequestSignInClaim(d, true));
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    private bool TryDispatchChestOpen(GameLogicManager logic)
    {
        if (logic.bag == null || !MonoSingletonProvider<NetManager>.hasInstance || !MonoSingletonProvider<NetManager>.inst.IsConnected) return false;
        var itemIds = logic.bag.GetItemsByType(ItemType.Chest);
        if (itemIds == null || itemIds.Count == 0) return false;

        var candidates = new List<LazyHelperPolicy.ChestCandidate>(itemIds.Count);
        for (int i = 0; i < itemIds.Count; i++)
        {
            var chest = logic.bag.GetItem<ChestItem>(itemIds[i]);
            if (chest?.config == null || chest.chestConfig == null || chest.count == null) continue;
            string name = "随机箱 #" + chest.config.Id;
            try
            {
                string local = chest.config.NameID.GetLocal(UIStringType.Item);
                if (!string.IsNullOrEmpty(local)) name = local;
            }
            catch { }

            candidates.Add(new LazyHelperPolicy.ChestCandidate
            {
                DefId = chest.config.Id,
                Name = name,
                IsChestType = chest.config.ItemType == ItemType.Chest,
                IsValidItem = chest.config.IsVailItem(),
                IsOptional = chest.chestConfig.IsOptional,
                OptionalRewardCount = chest.chestConfig.OptionalReward != null ? chest.chestConfig.OptionalReward.Count : 0,
                OwnedCount = chest.count.Value,
                UseMax = chest.chestConfig.UseMax,
            });
        }

        var pick = LazyHelperPolicy.NextRandomChest(candidates);
        if (pick == null) return false;
        string ck = "开箱:" + pick.Name;
        if (IsCoolingDown(ck)) return false;

        int batch = LazyHelperPolicy.ComputeChestOpenBatch(pick.OwnedCount, pick.UseMax);
        if (batch <= 0) return false;
        var req = new party.protocol.UseTreasureC2S { DefId = pick.DefId, Count = batch };
        BeginClaim(ck, MonoSingletonProvider<NetManager>.inst.RPC.UseTreasureC2S.UseTreasureC2SCall(req));
        return true;
    }

    private void OnDestroy()
    {
        if (_instance == this) _instance = null;
    }
}
