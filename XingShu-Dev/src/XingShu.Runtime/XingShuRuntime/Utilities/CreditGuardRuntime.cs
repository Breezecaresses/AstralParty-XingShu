using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Core.Net;
using Core.Scene;
using FairyGUI;
using GameLogic;
using Tools;
using UI;
using UnityEngine;
using UnityEngine.Networking;
using XingShu.Bridge;
using XingShu.Runtime;
using XingShuRuntime.Core;

namespace XingShuRuntime.Utilities
{
    /// <summary>
    /// Dual-platform (PC &amp; Android IL2CPP compatible) community credit score, like/blacklist/feedback,
    /// high-credit gated fleet room host/browser, auto-follow host, and squad sync runtime.
    /// </summary>
    internal sealed class CreditGuardRuntime : MonoBehaviour
    {
        private const string ApiOrigin = "https://124.221.176.134";
        private const string PrefTokenPrefix = "XingShu_CreditAuthTok_";
        private const string PrefTokenFallback = "XingShu_CreditAuthTok_Default";
        private const string PrefDeviceIdKey = "XingShu_CreditDeviceId_v1";
        private const double RoomScanInterval = 1.0d;
        private const double ProfileCacheTtl = 45.0d;
        private const double FleetHeartbeatInterval = 15.0d;
        private const double FollowPollInterval = 4.0d;
        private const double CardOverlayInterval = 0.25d;
        private const double DevicePollInterval = 2.5d;
        private const double HttpRequestTimeoutSeconds = 15.0d;
        private const double HubProbeTimeoutSeconds = 4.0d;
        private const string CardBadgeName = "XINGSHU_CreditCardBadge";
        private const string RoomWarnBannerName = "XINGSHU_RoomLowCreditBanner";

        internal sealed class CreditProfileModel
        {
            public string Uid = string.Empty;
            public string Nick = string.Empty;
            public int Score = 90;
            public string Tier = "excellent";
            public string TierLabel = "极佳";
            public bool Observing;
            public int RecordedMatches;
            public int GiveUpCount;
            public double GiveUpRate;
            public int LikesCount;
            public int BlacklistCount;
            public bool FleetBanned;
            public bool BlacklistedByMe;
            public bool LikedByMe;
            public string TagsText = string.Empty;
            public double FetchedAt;
        }

        internal sealed class RoomPeerModel
        {
            public long Uid;
            public string UidStr = string.Empty;
            public string RawNick = string.Empty;
            public string PlainNick = string.Empty;
            public bool IsHost;
            public bool IsSelf;
            public bool IsReady;
        }

        internal sealed class FleetRoomModel
        {
            public string RoomId = string.Empty;
            public int RoomServerId;
            public bool HasPassword;
            public string RoomName = string.Empty;
            public string HostUid = string.Empty;
            public string HostNick = string.Empty;
            public string Mode = "PVE";
            public int MapId;
            public string MapName = string.Empty;
            public int Difficulty;
            public int MinCredit;
            public double MaxGiveUpRate;
            public int PlayerCount;
            public int MaxPlayers = 4;
            public double AvgCredit;
            public bool Eligible = true;
            public string IneligibleReason = string.Empty;
            public bool HasBlacklistedMember;
        }

        internal sealed class BlacklistEntryModel
        {
            public string TargetUid = string.Empty;
            public string TargetNick = string.Empty;
            public int Score = 90;
            public double GiveUpRate;
            public string Note = string.Empty;
        }

        internal sealed class SquadMemberModel
        {
            public string Uid = string.Empty;
            public string Nick = string.Empty;
            public bool Ready;
            public bool IsLeader;
            public int Score = 90;
            public double GiveUpRate;
        }

        internal sealed class SquadModel
        {
            public string SquadId = string.Empty;
            public string JoinCode = string.Empty;
            public string Title = string.Empty;
            public string LeaderUid = string.Empty;
            public int MinCredit = 80;
            public int MaxMembers = 4;
            public double AvgCredit;
            public readonly List<SquadMemberModel> Members = new List<SquadMemberModel>();
            public string ActiveRoomId = string.Empty;
            public int ActiveRoomServerId;
            public string ActiveRoomPwd = string.Empty;
        }

        private sealed class PendingHttp
        {
            public UnityWebRequest Request;
            public Action<bool, long, string> Callback;
            public double StartedAt;
            public double TimeoutSeconds;
        }

        private static CreditGuardRuntime _instance;

        internal static CreditGuardRuntime Instance => _instance;
        internal static bool HasInstance => _instance != null;

        private readonly Dictionary<string, CreditProfileModel> _profiles =
            new Dictionary<string, CreditProfileModel>(StringComparer.Ordinal);
        private readonly List<RoomPeerModel> _currentPeers = new List<RoomPeerModel>(8);
        private readonly List<RoomPeerModel> _recentPeers = new List<RoomPeerModel>(8);
        private readonly List<FleetRoomModel> _fleetRooms = new List<FleetRoomModel>(16);
        private readonly List<BlacklistEntryModel> _blacklistEntries = new List<BlacklistEntryModel>(32);
        private readonly List<PendingHttp> _httpInFlight = new List<PendingHttp>(6);
        private readonly HashSet<string> _kickedInRoom = new HashSet<string>(StringComparer.Ordinal);
        private readonly System.Random _rng = new System.Random();

        private bool _enabled = XingShuConfigKeys.CreditGuardEnabledDefault;
        private bool _hudStripEnabled = XingShuConfigKeys.CreditGuardHudStripDefault;
        private int _minCredit = XingShuConfigKeys.CreditGuardMinCreditDefault;
        private int _maxGiveUpRate = XingShuConfigKeys.CreditGuardMaxGiveUpRateDefault;
        private bool _blockBlacklisted = XingShuConfigKeys.CreditGuardBlockBlacklistedDefault;
        private bool _autoKick = XingShuConfigKeys.CreditGuardAutoKickDefault;
        private bool _autoReady = XingShuConfigKeys.CreditGuardAutoReadyDefault;
        private bool _extendRoomWait = XingShuConfigKeys.CreditGuardExtendRoomWaitDefault;
        private int _roomWaitMinutes = XingShuConfigKeys.CreditGuardRoomWaitMinutesDefault;

        private long _localUid;
        private string _localNick = string.Empty;
        private bool _inRoom;
        private bool _inWaitRoom;
        private bool _isRoomHost;
        private long _currentRoomId;
        private int _currentRoomServerId;
        private string _currentRoomName = string.Empty;
        private string _currentRoomPwd = string.Empty;
        private int _currentMapId;
        private int _currentMapType = 4;
        private int _currentDifficulty;
        private string _lastReplayId = string.Empty;

        private bool _pendingCreateAndPublish;
        private string _pendingHostPwd = string.Empty;
        private string _pendingHostName = string.Empty;
        private bool _hostingFleetRoom;
        private string _hostedRoomId = string.Empty;
        private string _hostedRoomPwd = string.Empty;
        private double _lastHeartbeatAt;

        private bool _autoFollowActive;
        private string _autoFollowHostUid = string.Empty;
        private string _lastFollowJoinedRoomId = string.Empty;
        private double _lastFollowPollAt;

        private SquadModel _currentSquad;
        private string _lastSquadJoinedRoomId = string.Empty;
        private double _lastSquadPollAt;
        private long _autoReadyDoneRoomId;

        private double _lastRoomScanAt;
        private double _lastProfileFetchAt;
        private bool _profileFetchInFlight;
        private double _nextProfileRetryAt;
        private int _profileConsecutiveFails;
        private string _lastProfileError = string.Empty;
        private double _lastKickAt;
        private double _lastCardOverlayAt;
        private bool _cardOverlayActive;
        private string _statusMessage = "信誉分与车队模块已就绪";

        // Official room wait stay extension (real wall-clock, immune to game speedup)
        private double _roomWaitEnteredRealSec;
        private long _roomWaitTrackedRoomId;
        private static readonly FieldInfo RoomWaitRoomTimerField =
            typeof(RoomWaitPanel).GetField("roomTimer", BindingFlags.Instance | BindingFlags.NonPublic);
        private static readonly FieldInfo RoomWaitMasterKickTimerField =
            typeof(RoomWaitPanel).GetField("masterKickTimer", BindingFlags.Instance | BindingFlags.NonPublic);
        private static readonly FieldInfo HeroPlayerDataField =
            typeof(UIRoomHero_Com_Player).GetField("playerData", BindingFlags.Instance | BindingFlags.NonPublic);
        private static MethodInfo _timerCancelMethod;

        // Native FairyGUI player card credit badges & low-credit warning frame
        private sealed class CardBadgeVisual
        {
            public GComponent HostCard;
            public GComponent Root;
            public GGraph PillBg;
            public GTextField PillText;
            public GGraph BorderTop;
            public GGraph BorderBottom;
            public GGraph BorderLeft;
            public GGraph BorderRight;
            public bool IsRisky;
        }
        private readonly List<CardBadgeVisual> _cardBadges = new List<CardBadgeVisual>(8);
        private GComponent _roomWarnBanner;
        private GGraph _roomWarnBg;
        private GTextField _roomWarnText;

        // Built-in one-click PKCE browser login (/auth/device + /auth/device/poll)
        private bool _deviceLoginPending;
        private string _deviceLoginRequestId = string.Empty;
        private string _deviceLoginVerifier = string.Empty;
        private string _deviceLoginUrl = string.Empty;
        private double _deviceLoginDeadline;
        private double _lastDevicePollAt;
        private bool _devicePollInFlight;

        // PC Desktop Hub localhost proxy auto-reuse (no re-login, no game kick)
        private bool _hubProxyReachable;
        private bool _hubProxySignedIn;
        private int _hubProxyPort;
        private string _hubProxyNonce = string.Empty;
        private double _lastHubProxyProbeAt = -1000d;
        private bool _hubProxyProbeInFlight;
        private int _hubProxyConsecutiveFails;

        // Official PVE map & difficulty presets (matches room_host.py OFFICIAL_MAPS)
        internal static readonly int[] FleetPveMapIds = { 82017, 82016, 82015, 82014, 82013, 82012, 82010, 82008, 82007 };
        internal static readonly string[] FleetPveMapNames =
        {
            "森秋幻境", "异变图书馆", "园林中庭", "幽魂暗巷", "龙宫游乐园",
            "魔法学院", "水乡古镇", "御魂庆典", "星趴·梦想号"
        };
        internal static readonly string[] FleetDifficultyNames = { "普通", "困难", "噩梦", "疯狂" };
        private int _fleetMapId = 82017;
        private int _fleetDifficulty = 2;

        private GUIStyle _hudTitleStyle;
        private GUIStyle _hudRowStyle;
        private GUIStyle _hudWarnStyle;
        private bool _guiInitFailed;

        internal bool IsEnabled
        {
            get => _enabled;
            set
            {
                if (_enabled == value) return;
                _enabled = value;
                XingShuConfigService.SetBool(XingShuConfigKeys.CreditGuardEnabled, value);
                XingShuConfigService.Save();
            }
        }

        internal bool HudStripEnabled
        {
            get => _hudStripEnabled;
            set
            {
                if (_hudStripEnabled == value) return;
                _hudStripEnabled = value;
                XingShuConfigService.SetBool(XingShuConfigKeys.CreditGuardHudStrip, value);
                XingShuConfigService.Save();
            }
        }

        internal int MinCredit
        {
            get => _minCredit;
            set
            {
                int next = Mathf.Clamp(value, 0, 100);
                if (_minCredit == next) return;
                _minCredit = next;
                XingShuConfigService.SetInt(XingShuConfigKeys.CreditGuardMinCredit, next);
                XingShuConfigService.Save();
            }
        }

        internal int MaxGiveUpRate
        {
            get => _maxGiveUpRate;
            set
            {
                int next = Mathf.Clamp(value, 5, 100);
                if (_maxGiveUpRate == next) return;
                _maxGiveUpRate = next;
                XingShuConfigService.SetInt(XingShuConfigKeys.CreditGuardMaxGiveUpRate, next);
                XingShuConfigService.Save();
            }
        }

        internal bool BlockBlacklisted
        {
            get => _blockBlacklisted;
            set
            {
                if (_blockBlacklisted == value) return;
                _blockBlacklisted = value;
                XingShuConfigService.SetBool(XingShuConfigKeys.CreditGuardBlockBlacklisted, value);
                XingShuConfigService.Save();
            }
        }

        internal bool AutoKick
        {
            get => _autoKick;
            set
            {
                if (_autoKick == value) return;
                _autoKick = value;
                XingShuConfigService.SetBool(XingShuConfigKeys.CreditGuardAutoKick, value);
                XingShuConfigService.Save();
            }
        }

        internal bool AutoReady
        {
            get => _autoReady;
            set
            {
                if (_autoReady == value) return;
                _autoReady = value;
                XingShuConfigService.SetBool(XingShuConfigKeys.CreditGuardAutoReady, value);
                XingShuConfigService.Save();
            }
        }

        internal bool ExtendRoomWait
        {
            get => _extendRoomWait;
            set
            {
                if (_extendRoomWait == value) return;
                _extendRoomWait = value;
                XingShuConfigService.SetBool(XingShuConfigKeys.CreditGuardExtendRoomWait, value);
                XingShuConfigService.Save();
            }
        }

        internal int RoomWaitMinutes
        {
            get => _roomWaitMinutes;
            set
            {
                int next = value <= 0 ? 0 : Mathf.Clamp(value, 10, 360);
                if (_roomWaitMinutes == next) return;
                _roomWaitMinutes = next;
                XingShuConfigService.SetInt(XingShuConfigKeys.CreditGuardRoomWaitMinutes, next);
                XingShuConfigService.Save();
            }
        }

        internal double RoomWaitElapsedSeconds =>
            _inWaitRoom && _roomWaitEnteredRealSec > 0d
                ? Math.Max(0d, ThinkingClock.RealSeconds() - _roomWaitEnteredRealSec)
                : 0d;

        internal bool IsDeviceLoginPending => _deviceLoginPending;
        internal string DeviceLoginUrl => _deviceLoginUrl;
        internal bool IsHubProxyReachable => _hubProxyReachable;
        internal bool IsUsingHubProxy => _hubProxyReachable && _hubProxySignedIn;
        internal int FleetMapId
        {
            get => _fleetMapId;
            set => _fleetMapId = Array.IndexOf(FleetPveMapIds, value) >= 0 ? value : 82017;
        }
        internal int FleetDifficulty
        {
            get => _fleetDifficulty;
            set => _fleetDifficulty = Mathf.Clamp(value, 0, 3);
        }
        internal string FleetMapName
        {
            get
            {
                int idx = Array.IndexOf(FleetPveMapIds, _fleetMapId);
                return idx >= 0 ? FleetPveMapNames[idx] : "森秋幻境";
            }
        }
        internal string FleetDifficultyName => FleetDifficultyNames[Mathf.Clamp(_fleetDifficulty, 0, 3)];

        internal long LocalUid => _localUid;
        internal bool InRoom => _inRoom;
        internal bool InWaitRoom => _inWaitRoom;
        internal bool IsRoomHost => _isRoomHost;
        internal long CurrentRoomId => _currentRoomId;
        internal bool HostingFleetRoom => _hostingFleetRoom;
        internal bool AutoFollowActive => _autoFollowActive;
        internal string AutoFollowHostUid => _autoFollowHostUid;
        internal SquadModel CurrentSquad => _currentSquad;
        internal string StatusMessage => _statusMessage;
        internal string LastProfileError => _lastProfileError;
        internal bool IsProfileFetchInFlight => _profileFetchInFlight;
        internal IList<RoomPeerModel> ActivePeers => _currentPeers.Count > 0 ? _currentPeers : _recentPeers;
        internal IList<FleetRoomModel> FleetRooms => _fleetRooms;
        internal IList<BlacklistEntryModel> BlacklistEntries => _blacklistEntries;

        public static void Install(GameObject host)
        {
            if (_instance != null || host == null) return;
            _instance = host.AddComponent<CreditGuardRuntime>();
            _instance.LoadConfig();
        }

        private void LoadConfig()
        {
            _enabled = XingShuConfigService.GetBool(XingShuConfigKeys.CreditGuardEnabled, XingShuConfigKeys.CreditGuardEnabledDefault);
            _hudStripEnabled = XingShuConfigService.GetBool(XingShuConfigKeys.CreditGuardHudStrip, XingShuConfigKeys.CreditGuardHudStripDefault);
            _minCredit = Mathf.Clamp(XingShuConfigService.GetInt(XingShuConfigKeys.CreditGuardMinCredit, XingShuConfigKeys.CreditGuardMinCreditDefault), 0, 100);
            _maxGiveUpRate = Mathf.Clamp(XingShuConfigService.GetInt(XingShuConfigKeys.CreditGuardMaxGiveUpRate, XingShuConfigKeys.CreditGuardMaxGiveUpRateDefault), 5, 100);
            _blockBlacklisted = XingShuConfigService.GetBool(XingShuConfigKeys.CreditGuardBlockBlacklisted, XingShuConfigKeys.CreditGuardBlockBlacklistedDefault);
            _autoKick = XingShuConfigService.GetBool(XingShuConfigKeys.CreditGuardAutoKick, XingShuConfigKeys.CreditGuardAutoKickDefault);
            _autoReady = XingShuConfigService.GetBool(XingShuConfigKeys.CreditGuardAutoReady, XingShuConfigKeys.CreditGuardAutoReadyDefault);
            _extendRoomWait = XingShuConfigService.GetBool(XingShuConfigKeys.CreditGuardExtendRoomWait, XingShuConfigKeys.CreditGuardExtendRoomWaitDefault);
            _roomWaitMinutes = XingShuConfigService.GetInt(XingShuConfigKeys.CreditGuardRoomWaitMinutes, XingShuConfigKeys.CreditGuardRoomWaitMinutesDefault);
            RefreshHubProxyNow();
        }

        internal bool HasAuthToken => IsUsingHubProxy || !string.IsNullOrEmpty(GetAuthToken());

        internal void RefreshHubProxyNow()
        {
            _lastHubProxyProbeAt = -1000d;
            ProbeHubProxy();
        }

        private void ProbeHubProxy()
        {
#if !XINGSHU_ANDROID_PREVIEW
            if (_hubProxyProbeInFlight) return;
            try
            {
                string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                if (string.IsNullOrEmpty(localApp)) return;
                string cfgPath = Path.Combine(localApp, "XingShu-Hub", "credit-proxy.json");
                if (!File.Exists(cfgPath))
                {
                    _hubProxyReachable = false;
                    _hubProxySignedIn = false;
                    return;
                }
                string raw = File.ReadAllText(cfgPath, Encoding.UTF8);
                var d = BridgeJson.Parse(raw) as Dictionary<string, object>;
                int port = Int(d, "port");
                string nonce = Str(d, "nonce");
                if (port <= 0 || port > 65535 || string.IsNullOrEmpty(nonce))
                {
                    _hubProxyReachable = false;
                    _hubProxySignedIn = false;
                    return;
                }
                _hubProxyPort = port;
                _hubProxyNonce = nonce;
                _hubProxyProbeInFlight = true;

                var req = new UnityWebRequest(string.Format(CultureInfo.InvariantCulture, "http://127.0.0.1:{0}/_status", port), "GET");
                req.downloadHandler = new DownloadHandlerBuffer();
                req.timeout = 0;
                req.SetRequestHeader("X-XingShu-Proxy-Nonce", nonce);
                req.SendWebRequest();
                _httpInFlight.Add(new PendingHttp
                {
                    Request = req,
                    StartedAt = ThinkingClock.RealSeconds(),
                    TimeoutSeconds = HubProbeTimeoutSeconds,
                    Callback = (ok, code, text) =>
                    {
                        _hubProxyProbeInFlight = false;
                        if (!ok)
                        {
                            _hubProxyReachable = false;
                            _hubProxySignedIn = false;
                            _hubProxyConsecutiveFails = Math.Min(_hubProxyConsecutiveFails + 1, 10);
                            return;
                        }
                        var st = BridgeJson.Parse(text) as Dictionary<string, object>;
                        bool wasUsing = IsUsingHubProxy;
                        _hubProxyReachable = st != null && Bool(st, "ok");
                        _hubProxySignedIn = _hubProxyReachable && Bool(st, "signedIn");
                        _hubProxyConsecutiveFails = 0;
                        if (!wasUsing && IsUsingHubProxy)
                        {
                            _nextProfileRetryAt = 0d;
                            _profileConsecutiveFails = 0;
                            _statusMessage = "已自动复用桌面端 Hub 星枢登录态（无需重复登录）";
                            RefreshBlacklist();
                            RefreshRoomProfilesNow(false);
                        }
                    }
                });
            }
            catch
            {
                _hubProxyReachable = false;
                _hubProxySignedIn = false;
                _hubProxyProbeInFlight = false;
                _hubProxyConsecutiveFails = Math.Min(_hubProxyConsecutiveFails + 1, 10);
            }
#endif
        }

        internal string GetAuthToken()
        {
#if XINGSHU_ANDROID_PREVIEW
            string androidTok = AndroidCloudHands.ActiveSessionToken;
            if (!string.IsNullOrEmpty(androidTok))
            {
                return androidTok;
            }
#endif
            if (_localUid > 0)
            {
                string perUid = PlayerPrefs.GetString(PrefTokenPrefix + _localUid.ToString(CultureInfo.InvariantCulture), string.Empty);
                if (!string.IsNullOrEmpty(perUid)) return perUid;
            }
            return PlayerPrefs.GetString(PrefTokenFallback, string.Empty);
        }

        internal void SaveManualAuthToken(string token)
        {
            string clean = (token ?? string.Empty).Trim();
            if (clean.Length < 16)
            {
                _statusMessage = "授权令牌格式过短，请粘贴有效的星枢会话令牌";
                return;
            }
            if (_localUid > 0)
            {
                PlayerPrefs.SetString(PrefTokenPrefix + _localUid.ToString(CultureInfo.InvariantCulture), clean);
            }
            PlayerPrefs.SetString(PrefTokenFallback, clean);
            PlayerPrefs.Save();
            _statusMessage = "已保存星枢授权令牌";
            RefreshBlacklist();
        }

        internal void ClearManualAuthToken()
        {
            CancelDeviceLogin();
            if (_localUid > 0)
            {
                PlayerPrefs.DeleteKey(PrefTokenPrefix + _localUid.ToString(CultureInfo.InvariantCulture));
            }
            PlayerPrefs.DeleteKey(PrefTokenFallback);
            PlayerPrefs.Save();
            _statusMessage = "已退出星枢账号授权";
        }

        internal void StartDeviceLogin()
        {
            if (_deviceLoginPending)
            {
                if (!string.IsNullOrEmpty(_deviceLoginUrl))
                {
                    try { Application.OpenURL(_deviceLoginUrl); } catch { }
                    _statusMessage = "已重新打开浏览器登录页，请完成授权…";
                }
                return;
            }
            string deviceId = GetOrCreateDeviceId();
            string verifier = GeneratePkceVerifier();
            string challenge = ComputePkceChallenge(verifier);
            _deviceLoginVerifier = verifier;
            _deviceLoginRequestId = string.Empty;
            _deviceLoginUrl = string.Empty;
            _deviceLoginPending = true;
            _devicePollInFlight = false;
            _deviceLoginDeadline = ThinkingClock.RealSeconds() + 180d;
            _lastDevicePollAt = ThinkingClock.RealSeconds();
            _statusMessage = "正在发起星枢浏览器一键登录…";

            var body = new Dictionary<string, object>
            {
                ["device_id"] = deviceId,
                ["code_challenge"] = challenge,
                ["label"] = Application.isMobilePlatform ? "星枢局内插件 (手机)" : "星枢局内插件 (电脑)"
            };
            SendJsonRequest("POST", "/auth/device", body, requireAuth: false, (ok, code, text) =>
            {
                if (!ok)
                {
                    _deviceLoginPending = false;
                    _statusMessage = ExtractError(text, "发起星枢登录失败，请稍后重试");
                    return;
                }
                var d = BridgeJson.Parse(text) as Dictionary<string, object>;
                string reqId = Str(d, "request_id");
                string loginUrl = Str(d, "login_url");
                if (string.IsNullOrEmpty(reqId) || string.IsNullOrEmpty(loginUrl))
                {
                    _deviceLoginPending = false;
                    _statusMessage = "服务器未返回有效登录链接";
                    return;
                }
                _deviceLoginRequestId = reqId;
                _deviceLoginUrl = loginUrl;
                _deviceLoginDeadline = ThinkingClock.RealSeconds() + Math.Max(60d, Int(d, "expires_in", 180));
                _lastDevicePollAt = ThinkingClock.RealSeconds();
                try { Application.OpenURL(loginUrl); } catch { }
                _statusMessage = "已在浏览器打开星枢登录页，完成登录后将自动同步授权…";
            });
        }

        internal void CancelDeviceLogin()
        {
            _deviceLoginPending = false;
            _deviceLoginRequestId = string.Empty;
            _deviceLoginVerifier = string.Empty;
            _deviceLoginUrl = string.Empty;
            _devicePollInFlight = false;
        }

        private void PollDeviceLogin()
        {
            if (!_deviceLoginPending || _devicePollInFlight || string.IsNullOrEmpty(_deviceLoginRequestId)) return;
            if (ThinkingClock.RealSeconds() > _deviceLoginDeadline)
            {
                CancelDeviceLogin();
                _statusMessage = "星枢登录已超时，请重新点击「浏览器一键登录」";
                return;
            }
            _devicePollInFlight = true;
            var body = new Dictionary<string, object>
            {
                ["request_id"] = _deviceLoginRequestId,
                ["code_verifier"] = _deviceLoginVerifier
            };
            SendJsonRequest("POST", "/auth/device/poll", body, requireAuth: false, (ok, code, text) =>
            {
                _devicePollInFlight = false;
                if (!_deviceLoginPending || !ok) return;
                var d = BridgeJson.Parse(text) as Dictionary<string, object>;
                string st = Str(d, "status");
                if (st == "succeeded")
                {
                    string tok = Str(d, "access_token");
                    CancelDeviceLogin();
                    if (!string.IsNullOrEmpty(tok))
                    {
                        if (_localUid > 0)
                        {
                            PlayerPrefs.SetString(PrefTokenPrefix + _localUid.ToString(CultureInfo.InvariantCulture), tok);
                        }
                        PlayerPrefs.SetString(PrefTokenFallback, tok);
                        PlayerPrefs.Save();
                        _statusMessage = "星枢账号登录成功！点赞、拉黑、反馈与高信誉车队已全部解锁";
                        RefreshBlacklist();
                        RefreshRoomProfilesNow(false);
                    }
                }
                else if (st == "expired" || st == "rejected" || st == "failed")
                {
                    CancelDeviceLogin();
                    _statusMessage = "登录已过期或取消，请重新点击「浏览器一键登录」";
                }
            });
        }

        private static string GetOrCreateDeviceId()
        {
            try
            {
                string existing = PlayerPrefs.GetString(PrefDeviceIdKey, string.Empty);
                if (!string.IsNullOrEmpty(existing) && existing.Length >= 16) return existing;
            }
            catch { }
            string created = Guid.NewGuid().ToString("N");
            try
            {
                PlayerPrefs.SetString(PrefDeviceIdKey, created);
                PlayerPrefs.Save();
            }
            catch { }
            return created;
        }

        private static string GeneratePkceVerifier()
        {
            return Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
        }

        private static string ComputePkceChallenge(string verifier)
        {
            using (SHA256 sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(verifier));
                return Convert.ToBase64String(hash).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            }
        }

        internal CreditProfileModel GetCachedProfile(string uid)
        {
            if (string.IsNullOrEmpty(uid)) return null;
            _profiles.TryGetValue(uid, out CreditProfileModel prof);
            return prof;
        }

        internal bool IsPeerRisky(string uid, out string riskReason)
        {
            riskReason = string.Empty;
            CreditProfileModel p = GetCachedProfile(uid);
            if (p == null) return false;
            if (p.BlacklistedByMe)
            {
                riskReason = "个人黑名单";
                return true;
            }
            if (p.FleetBanned)
            {
                riskReason = "限制车队";
                return true;
            }
            if (p.Score < _minCredit)
            {
                riskReason = "信誉分" + p.Score + "<" + _minCredit;
                return true;
            }
            if (p.RecordedMatches >= 5 && p.GiveUpRate > _maxGiveUpRate)
            {
                riskReason = string.Format(CultureInfo.InvariantCulture, "拔线{0:F0}%>{1}%", p.GiveUpRate, _maxGiveUpRate);
                return true;
            }
            return false;
        }

        private void Update()
        {
            TickHttpRequests();

            double now = ThinkingClock.RealSeconds();
            double probeInterval = IsUsingHubProxy ? 20.0d : (_hubProxyConsecutiveFails >= 2 ? 15.0d : 6.0d);
            if (now - _lastHubProxyProbeAt >= probeInterval)
            {
                _lastHubProxyProbeAt = now;
                ProbeHubProxy();
            }

            if (_deviceLoginPending && now - _lastDevicePollAt >= DevicePollInterval)
            {
                _lastDevicePollAt = now;
                PollDeviceLogin();
            }

            if (!_enabled)
            {
                if (_cardBadges.Count > 0 || _roomWarnBanner != null)
                {
                    DisposeCardOverlays();
                }
                _cardOverlayActive = false;
                return;
            }

            if (now - _lastRoomScanAt >= RoomScanInterval)
            {
                _lastRoomScanAt = now;
                ScanGameRoomAndPeers(now);
            }

            if (now - _lastCardOverlayAt >= CardOverlayInterval)
            {
                _lastCardOverlayAt = now;
                TickRoomWaitKeepAlive();
                TickNativeCardOverlays();
            }
            else if (_cardBadges.Count > 0)
            {
                PulseRiskyBorders(now);
            }

            if (_hostingFleetRoom && _inRoom && _isRoomHost && now - _lastHeartbeatAt >= FleetHeartbeatInterval)
            {
                _lastHeartbeatAt = now;
                SendFleetRoomHeartbeat();
            }

            if (_autoFollowActive && !_inRoom && !string.IsNullOrEmpty(_autoFollowHostUid) && now - _lastFollowPollAt >= FollowPollInterval)
            {
                _lastFollowPollAt = now;
                PollFollowHost();
            }

            if (_currentSquad != null && now - _lastSquadPollAt >= FollowPollInterval)
            {
                _lastSquadPollAt = now;
                PollSquadState();
            }
        }

        private void ScanGameRoomAndPeers(double now)
        {
            try
            {
                long nextLocalUid = XingShuRuntimeHost.CurrentLocalPlayerId;
                if (nextLocalUid > 0) _localUid = nextLocalUid;

                if (!SimpleSingletonProvider<GameLogicManager>.hasInstance) return;
                GameLogicManager logic = SimpleSingletonProvider<GameLogicManager>.inst;
                if (logic == null) return;

                if (logic.account != null)
                {
                    try
                    {
                        string nm = logic.account.GetName();
                        if (!string.IsNullOrEmpty(nm)) _localNick = StripRichTags(nm);
                    }
                    catch { }
                }

                RoomLogic room = logic.room;
                RoomInfo info = room != null ? room.curRoomInfo : null;
                bool prevInRoom = _inRoom;
                long prevRoomId = _currentRoomId;

                _inRoom = room != null && room.IsInRoom && info != null;
                if (!_inRoom)
                {
                    _inWaitRoom = false;
                    _isRoomHost = false;
                    _currentRoomId = 0;
                    _currentRoomServerId = 0;
                    _currentPeers.Clear();
                    _kickedInRoom.Clear();

                    if (prevInRoom && prevRoomId > 0)
                    {
                        if (_hostingFleetRoom && _hostedRoomId == prevRoomId.ToString(CultureInfo.InvariantCulture))
                        {
                            CloseHostedFleetRoom();
                        }
                    }
                    return;
                }

                _currentRoomId = info.Id;
                _currentRoomServerId = info.info != null ? info.info.RoomServerId : 0;
                _currentRoomName = StripRichTags(info.Name ?? string.Empty);
                _currentRoomPwd = info.Pwd ?? string.Empty;
                _currentMapId = info.MapId;
                _currentMapType = info.MapType;
                _currentDifficulty = info.Difficulty;
                _isRoomHost = logic.account != null && logic.account.IsSelf(info.MasterId);
                _inWaitRoom = room.roomController != null && room.roomController.roomStateType == RoomStateType.WAIT;

                if (prevRoomId != _currentRoomId)
                {
                    _kickedInRoom.Clear();
                    if (_autoReady && _currentRoomId != _autoReadyDoneRoomId && !_isRoomHost && _inWaitRoom &&
                        (_autoFollowActive || _currentSquad != null))
                    {
                        _autoReadyDoneRoomId = _currentRoomId;
                        try { room.RequestRoomReadyC2S(true); } catch { }
                    }
                }

                if (_pendingCreateAndPublish && _isRoomHost && _currentRoomId > 0)
                {
                    _pendingCreateAndPublish = false;
                    _hostingFleetRoom = true;
                    _hostedRoomId = _currentRoomId.ToString(CultureInfo.InvariantCulture);
                    _hostedRoomPwd = !string.IsNullOrEmpty(_pendingHostPwd) ? _pendingHostPwd : _currentRoomPwd;
                    _lastHeartbeatAt = now;
                    SendFleetRoomHeartbeat();
                }

                _currentPeers.Clear();
                var neededUids = new List<string>(4);
                if (info.Players != null)
                {
                    foreach (RoomPlayer p in info.Players)
                    {
                        if (p == null || p.IsBot || p.Id <= 0) continue;
                        string rawNick = string.Empty;
                        try { rawNick = p.GetNick(false) ?? string.Empty; } catch { }
                        string uidStr = p.Id.ToString(CultureInfo.InvariantCulture);
                        var peer = new RoomPeerModel
                        {
                            Uid = p.Id,
                            UidStr = uidStr,
                            RawNick = rawNick,
                            PlainNick = StripRichTags(rawNick),
                            IsHost = p.Id == info.MasterId,
                            IsSelf = p.Id == _localUid,
                            IsReady = p.RoomReady
                        };
                        _currentPeers.Add(peer);
                        if (!_profiles.TryGetValue(uidStr, out CreditProfileModel cached) || (now - cached.FetchedAt) > ProfileCacheTtl)
                        {
                            neededUids.Add(uidStr);
                        }
                    }
                }

                if (_currentPeers.Count > 0)
                {
                    _recentPeers.Clear();
                    _recentPeers.AddRange(_currentPeers);
                }

                if (neededUids.Count > 0 && !_profileFetchInFlight && now >= _nextProfileRetryAt && now - _lastProfileFetchAt >= 2.0d)
                {
                    FetchProfiles(neededUids, manual: false);
                }

                if (_isRoomHost && _inWaitRoom && _autoKick && now - _lastKickAt >= 1.5f)
                {
                    foreach (RoomPeerModel peer in _currentPeers)
                    {
                        if (peer.IsSelf || _kickedInRoom.Contains(peer.UidStr)) continue;
                        if (IsPeerRisky(peer.UidStr, out string reason))
                        {
                            _kickedInRoom.Add(peer.UidStr);
                            _lastKickAt = now;
                            KickPeer(peer.Uid, reason);
                            break;
                        }
                    }
                }
            }
            catch { }
        }

        internal void RefreshRoomProfilesNow(bool manual = true)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var list = new List<string>(4);
            foreach (RoomPeerModel p in ActivePeers)
            {
                if (!string.IsNullOrEmpty(p.UidStr) && seen.Add(p.UidStr)) list.Add(p.UidStr);
            }
            if (list.Count == 0) return;
            if (manual)
            {
                _nextProfileRetryAt = 0d;
            }
            FetchProfiles(list, manual);
        }

        internal void EnsureActivePeersLoaded()
        {
            double now = ThinkingClock.RealSeconds();
            if (_profileFetchInFlight || now < _nextProfileRetryAt || (now - _lastProfileFetchAt) < 2.0d) return;

            var seen = new HashSet<string>(StringComparer.Ordinal);
            var needed = new List<string>(4);
            foreach (RoomPeerModel p in ActivePeers)
            {
                if (string.IsNullOrEmpty(p.UidStr) || !seen.Add(p.UidStr)) continue;
                if (!_profiles.TryGetValue(p.UidStr, out CreditProfileModel cached) || (now - cached.FetchedAt) > ProfileCacheTtl)
                {
                    needed.Add(p.UidStr);
                }
            }
            if (needed.Count > 0)
            {
                FetchProfiles(needed, manual: false);
            }
        }

        private void FetchProfiles(List<string> uids, bool manual = false)
        {
            if (uids == null || uids.Count == 0) return;
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var uniqueUids = new List<string>(uids.Count);
            for (int i = 0; i < uids.Count; i++)
            {
                string u = uids[i];
                if (!string.IsNullOrEmpty(u) && seen.Add(u)) uniqueUids.Add(u);
            }
            if (uniqueUids.Count == 0) return;

            if (_profileFetchInFlight)
            {
                if (manual) _statusMessage = "正在查询同房玩家信誉分，请稍候…";
                return;
            }

            double now = ThinkingClock.RealSeconds();
            if (!manual && now < _nextProfileRetryAt) return;

            _profileFetchInFlight = true;
            _lastProfileFetchAt = now;
            var body = new Dictionary<string, object> { ["uids"] = uniqueUids };
            SendJsonRequest("POST", "/api/credit/profiles", body, requireAuth: false, (ok, code, text) =>
            {
                _profileFetchInFlight = false;
                if (!ok)
                {
                    _profileConsecutiveFails = Math.Min(_profileConsecutiveFails + 1, 5);
                    double backoff = _profileConsecutiveFails == 1 ? 3.0d : (_profileConsecutiveFails == 2 ? 6.0d : 10.0d);
                    _nextProfileRetryAt = ThinkingClock.RealSeconds() + backoff;
                    _lastProfileError = ExtractError(text, code > 0 ? ("HTTP " + code) : "网络连接失败");
                    _statusMessage = "信誉分查询暂未完成：" + _lastProfileError + "（稍后自动重试）";
                    return;
                }
                var root = BridgeJson.Parse(text) as Dictionary<string, object>;
                if (root == null || !(root.TryGetValue("profiles", out object profObj) && profObj is Dictionary<string, object> profMap))
                {
                    _profileConsecutiveFails = Math.Min(_profileConsecutiveFails + 1, 5);
                    double backoff = _profileConsecutiveFails == 1 ? 3.0d : (_profileConsecutiveFails == 2 ? 6.0d : 10.0d);
                    _nextProfileRetryAt = ThinkingClock.RealSeconds() + backoff;
                    _lastProfileError = "服务响应格式异常";
                    _statusMessage = "信誉分查询暂未完成：服务响应格式异常（稍后自动重试）";
                    return;
                }
                _profileConsecutiveFails = 0;
                _nextProfileRetryAt = 0d;
                _lastProfileError = string.Empty;
                double ts = ThinkingClock.RealSeconds();
                int parsedCount = 0;
                foreach (var kv in profMap)
                {
                    if (kv.Value is Dictionary<string, object> d)
                    {
                        _profiles[kv.Key] = ParseProfile(d, ts);
                        parsedCount++;
                    }
                }
                if (manual ||
                    _statusMessage.IndexOf("信誉分查询", StringComparison.Ordinal) >= 0 ||
                    _statusMessage.IndexOf("请求过于频繁", StringComparison.Ordinal) >= 0 ||
                    _statusMessage.IndexOf("正在查询", StringComparison.Ordinal) >= 0)
                {
                    _statusMessage = "已同步 " + parsedCount + " 位玩家星枢信誉分";
                }
            });
        }

        internal void LikePlayer(long targetUid)
        {
            if (targetUid <= 0) return;
            var body = new Dictionary<string, object>
            {
                ["targetUid"] = targetUid.ToString(CultureInfo.InvariantCulture),
                ["replayId"] = _lastReplayId ?? string.Empty,
                ["roomId"] = _currentRoomId > 0 ? _currentRoomId.ToString(CultureInfo.InvariantCulture) : string.Empty
            };
            SendJsonRequest("POST", "/api/credit/like", body, requireAuth: true, (ok, code, text) =>
            {
                if (!ok)
                {
                    _statusMessage = ExtractError(text, "点赞未完成 (" + code + ")");
                    return;
                }
                var root = BridgeJson.Parse(text) as Dictionary<string, object>;
                if (root != null && root.TryGetValue("profile", out object pObj) && pObj is Dictionary<string, object> pDict)
                {
                    CreditProfileModel p = ParseProfile(pDict, ThinkingClock.RealSeconds());
                    _profiles[p.Uid] = p;
                    _statusMessage = "已为 " + (string.IsNullOrEmpty(p.Nick) ? p.Uid : p.Nick) + " 点赞（当前信誉 " + p.Score + "）";
                }
                else
                {
                    _statusMessage = "点赞成功";
                }
            });
        }

        internal void ToggleBlacklist(long targetUid, string note = "")
        {
            if (targetUid <= 0) return;
            string uidStr = targetUid.ToString(CultureInfo.InvariantCulture);
            CreditProfileModel cached = GetCachedProfile(uidStr);
            if (cached != null && cached.BlacklistedByMe)
            {
                SendJsonRequest("DELETE", "/api/credit/blacklist/" + uidStr, null, requireAuth: true, (ok, code, text) =>
                {
                    if (!ok)
                    {
                        _statusMessage = ExtractError(text, "解除拉黑失败");
                        return;
                    }
                    UpdateCachedProfileFromResponse(text);
                    _statusMessage = "已将该玩家移出你的星枢个人黑名单";
                    RefreshBlacklist();
                });
            }
            else
            {
                var body = new Dictionary<string, object>
                {
                    ["targetUid"] = uidStr,
                    ["note"] = note ?? string.Empty
                };
                SendJsonRequest("POST", "/api/credit/blacklist", body, requireAuth: true, (ok, code, text) =>
                {
                    if (!ok)
                    {
                        _statusMessage = ExtractError(text, "拉黑失败");
                        return;
                    }
                    UpdateCachedProfileFromResponse(text);
                    _statusMessage = "已拉黑 UID " + uidStr + "，高信誉开房将自动避雷";
                    RefreshBlacklist();
                });
            }
        }

        internal void RefreshBlacklist()
        {
            if (!HasAuthToken) return;
            SendJsonRequest("GET", "/api/credit/blacklist", null, requireAuth: true, (ok, code, text) =>
            {
                if (!ok) return;
                var root = BridgeJson.Parse(text) as Dictionary<string, object>;
                if (root == null || !(root.TryGetValue("items", out object itemsObj) && itemsObj is List<object> list)) return;
                _blacklistEntries.Clear();
                double ts = ThinkingClock.RealSeconds();
                foreach (object item in list)
                {
                    if (!(item is Dictionary<string, object> d)) continue;
                    var entry = new BlacklistEntryModel
                    {
                        TargetUid = Str(d, "targetUid"),
                        Note = Str(d, "note")
                    };
                    if (d.TryGetValue("profile", out object pObj) && pObj is Dictionary<string, object> pDict)
                    {
                        CreditProfileModel p = ParseProfile(pDict, ts);
                        _profiles[p.Uid] = p;
                        entry.TargetNick = p.Nick;
                        entry.Score = p.Score;
                        entry.GiveUpRate = p.GiveUpRate;
                    }
                    _blacklistEntries.Add(entry);
                }
            });
        }

        internal void SubmitFeedback(long targetUid, string targetNick, string reason, string detail)
        {
            if (targetUid <= 0)
            {
                _statusMessage = "请先选择要反馈的玩家";
                return;
            }
            var parts = new List<Dictionary<string, object>>(4);
            foreach (RoomPeerModel peer in ActivePeers)
            {
                parts.Add(new Dictionary<string, object>
                {
                    ["uid"] = peer.UidStr,
                    ["nick"] = peer.PlainNick,
                });
            }
            var body = new Dictionary<string, object>
            {
                ["targetUid"] = targetUid.ToString(CultureInfo.InvariantCulture),
                ["targetNick"] = targetNick ?? string.Empty,
                ["reason"] = string.IsNullOrEmpty(reason) ? "afk" : reason,
                ["detail"] = (detail ?? string.Empty).Trim(),
                ["replayId"] = _lastReplayId ?? string.Empty,
                ["roomId"] = _currentRoomId > 0 ? _currentRoomId.ToString(CultureInfo.InvariantCulture) : string.Empty,
                ["participants"] = parts
            };
            SendJsonRequest("POST", "/api/credit/reports", body, requireAuth: true, (ok, code, text) =>
            {
                _statusMessage = ok
                    ? "已提交星枢官方反馈工单（非游戏官方），管理员审核后会同步处理"
                    : ExtractError(text, "提交反馈工单失败 (" + code + ")");
            });
        }

        internal void KickPeer(long targetUid, string reason = "")
        {
            if (!_inRoom || !_isRoomHost || !_inWaitRoom || targetUid <= 0 || targetUid == _localUid) return;
            try
            {
                GameLogicManager logic = SimpleSingletonProvider<GameLogicManager>.hasInstance ? SimpleSingletonProvider<GameLogicManager>.inst : null;
                logic?.room?.RequestKickPlayer(targetUid);
                _statusMessage = string.IsNullOrEmpty(reason)
                    ? "已请求移出玩家 UID " + targetUid
                    : "已自动踢出 UID " + targetUid + "（" + reason + "）";
            }
            catch (Exception ex)
            {
                _statusMessage = "移出玩家失败: " + ex.Message;
            }
        }

        internal void CreateHighCreditRoom(string roomName = "", string customPwd = "", int mode = 4, int mapId = -1, int difficulty = -1)
        {
            if (!HasAuthToken)
            {
                _statusMessage = "请先在星枢 Hub（或下方授权页）登录星枢账号后再发起高信誉密码车队";
                return;
            }
            if (!ValidateLobby(out GameLogicManager logic, out string err))
            {
                _statusMessage = err;
                return;
            }
            if (_inRoom || logic.room.IsInRoom)
            {
                PublishCurrentRoomToFleet(customPwd);
                return;
            }
            int effectiveMapId = mapId > 0 ? mapId : _fleetMapId;
            int effectiveDiff = difficulty >= 0 ? Mathf.Clamp(difficulty, 0, 3) : _fleetDifficulty;
            int upgradePlan = mode == 4 ? (effectiveDiff == 0 ? 5 : 4) : 1;

            string pwd = (customPwd ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(pwd))
            {
                pwd = _rng.Next(1000, 9999).ToString(CultureInfo.InvariantCulture);
            }
            string rName = string.IsNullOrEmpty(roomName)
                ? ((string.IsNullOrEmpty(_localNick) ? "星枢玩家" : _localNick) + " 的信誉车")
                : roomName.Trim();
            if (rName.Length > 32) rName = rName.Substring(0, 32);

            _pendingCreateAndPublish = true;
            _pendingHostPwd = pwd;
            _pendingHostName = rName;
            try
            {
                XingShuRuntime.UI.XingShuUICenter.Close();
            }
            catch { }
            try
            {
                logic.room.RequestCreateC2S(rName, pwd, effectiveMapId, 0, upgradePlan, 2, 0UL, 2, mode, effectiveDiff, false, 0);
                _statusMessage = "正在创建高信誉密码房（" + FleetMapName + " · " + FleetDifficultyName + " · 门槛 " + _minCredit + " 分）…";
            }
            catch (Exception ex)
            {
                _pendingCreateAndPublish = false;
                _statusMessage = "开房失败: " + ex.Message;
            }
        }

        internal void PublishCurrentRoomToFleet(string overridePwd = "")
        {
            if (!_inRoom || !_isRoomHost)
            {
                _statusMessage = "请先以房主身份进入房间，或点击「一键开高信誉密码房」";
                return;
            }
            _hostingFleetRoom = true;
            _hostedRoomId = _currentRoomId.ToString(CultureInfo.InvariantCulture);
            _hostedRoomPwd = !string.IsNullOrEmpty(overridePwd) ? overridePwd.Trim() : _currentRoomPwd;
            _lastHeartbeatAt = ThinkingClock.RealSeconds();
            SendFleetRoomHeartbeat();
        }

        internal void StopHostingFleetRoom()
        {
            _hostingFleetRoom = false;
            _pendingCreateAndPublish = false;
            if (!string.IsNullOrEmpty(_hostedRoomId))
            {
                CloseHostedFleetRoom();
            }
            _statusMessage = "已停止广播高信誉车队房间";
        }

        private void CloseHostedFleetRoom()
        {
            string rid = _hostedRoomId;
            _hostingFleetRoom = false;
            _hostedRoomId = string.Empty;
            _hostedRoomPwd = string.Empty;
            if (string.IsNullOrEmpty(rid) || !HasAuthToken) return;
            SendJsonRequest("DELETE", "/api/credit/fleet/rooms/" + rid, null, requireAuth: true, null);
        }

        private void SendFleetRoomHeartbeat()
        {
            if (!_inRoom || !_isRoomHost || _currentRoomId <= 0 || !HasAuthToken) return;
            var uids = new List<string>(4);
            foreach (RoomPeerModel p in _currentPeers) uids.Add(p.UidStr);
            if (uids.Count == 0 && _localUid > 0) uids.Add(_localUid.ToString(CultureInfo.InvariantCulture));

            var body = new Dictionary<string, object>
            {
                ["roomId"] = _currentRoomId.ToString(CultureInfo.InvariantCulture),
                ["roomServerId"] = _currentRoomServerId,
                ["roomPwd"] = _hostedRoomPwd ?? _currentRoomPwd ?? string.Empty,
                ["roomName"] = string.IsNullOrEmpty(_currentRoomName) ? "星枢高信誉车队" : _currentRoomName,
                ["mode"] = _currentMapType == 4 ? "PVE" : "PVP",
                ["modeId"] = _currentMapType,
                ["mapId"] = _currentMapId,
                ["difficulty"] = _currentDifficulty,
                ["minCredit"] = _minCredit,
                ["maxGiveUpRate"] = _maxGiveUpRate,
                ["blockBlacklisted"] = _blockBlacklisted,
                ["autoKickLowCredit"] = _autoKick,
                ["maxPlayers"] = 4,
                ["playerUids"] = uids,
                ["squadId"] = _currentSquad != null ? _currentSquad.SquadId : string.Empty
            };
            SendJsonRequest("POST", "/api/credit/fleet/rooms", body, requireAuth: true, (ok, code, text) =>
            {
                if (!ok)
                {
                    _statusMessage = ExtractError(text, "车队心跳上报失败 (" + code + ")");
                    return;
                }
                _statusMessage = "车队广播中 · 房间 #" + _currentRoomId + " (最低信誉 " + _minCredit + ")";
            });
        }

        internal void RefreshFleetRooms()
        {
            SendJsonRequest("GET", "/api/credit/fleet/rooms", null, requireAuth: false, (ok, code, text) =>
            {
                if (!ok)
                {
                    _statusMessage = ExtractError(text, "拉取高信誉车队失败");
                    return;
                }
                var root = BridgeJson.Parse(text) as Dictionary<string, object>;
                if (root == null || !(root.TryGetValue("rooms", out object roomsObj) && roomsObj is List<object> list)) return;
                _fleetRooms.Clear();
                foreach (object item in list)
                {
                    if (!(item is Dictionary<string, object> d)) continue;
                    _fleetRooms.Add(new FleetRoomModel
                    {
                        RoomId = Str(d, "roomId"),
                        RoomServerId = Int(d, "roomServerId"),
                        HasPassword = Bool(d, "hasPassword"),
                        RoomName = StripRichTags(Str(d, "roomName")),
                        HostUid = Str(d, "hostUid"),
                        HostNick = StripRichTags(Str(d, "hostNick")),
                        Mode = Str(d, "mode", "PVE"),
                        MapId = Int(d, "mapId"),
                        MapName = Str(d, "mapName"),
                        Difficulty = Int(d, "difficulty"),
                        MinCredit = Int(d, "minCredit", 80),
                        MaxGiveUpRate = Dbl(d, "maxGiveUpRate", 20.0),
                        PlayerCount = Int(d, "playerCount", 1),
                        MaxPlayers = Int(d, "maxPlayers", 4),
                        AvgCredit = Dbl(d, "avgCredit", 90.0),
                        Eligible = Bool(d, "eligible", true),
                        IneligibleReason = Str(d, "ineligibleReason"),
                        HasBlacklistedMember = Bool(d, "hasBlacklistedMember", false),
                    });
                }
                _statusMessage = _fleetRooms.Count > 0
                    ? "已刷新 " + _fleetRooms.Count + " 个星枢高信誉车队"
                    : "当前暂无在线高信誉车队（可点击一键开房当车头）";
            });
        }

        internal void JoinFleetRoom(string roomId)
        {
            if (string.IsNullOrEmpty(roomId)) return;
            SendJsonRequest("POST", "/api/credit/fleet/rooms/" + roomId + "/join-ticket", new Dictionary<string, object>(), requireAuth: true, (ok, code, text) =>
            {
                if (!ok)
                {
                    _statusMessage = ExtractError(text, "未通过车队门禁 (" + code + ")");
                    return;
                }
                var t = BridgeJson.Parse(text) as Dictionary<string, object>;
                if (t == null) return;
                long rid = Lng(t, "roomId");
                int srvId = Int(t, "roomServerId");
                string pwd = Str(t, "roomPwd");
                if (rid > 0)
                {
                    JoinGameRoom(rid, pwd, srvId, "车队门禁通过");
                }
            });
        }

        internal void StartAutoFollowHost(string hostUid)
        {
            string clean = (hostUid ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(clean) || !Regex.IsMatch(clean, @"\A\d{1,20}\z"))
            {
                _statusMessage = "请输入车头玩家的数字 UID";
                return;
            }
            if (_localUid > 0 && clean == _localUid.ToString(CultureInfo.InvariantCulture))
            {
                _statusMessage = "不能自动跟房自己";
                return;
            }
            _autoFollowHostUid = clean;
            _autoFollowActive = true;
            _lastFollowPollAt = 0f;
            _lastFollowJoinedRoomId = _currentRoomId > 0 ? _currentRoomId.ToString(CultureInfo.InvariantCulture) : string.Empty;
            _statusMessage = "已开启自动跟房 · 正在盯防车头 UID " + clean;
        }

        internal void StopAutoFollowHost()
        {
            _autoFollowActive = false;
            _statusMessage = "已停止自动跟房";
        }

        private void PollFollowHost()
        {
            if (!HasAuthToken || string.IsNullOrEmpty(_autoFollowHostUid)) return;
            string path = "/api/credit/fleet/follow/" + _autoFollowHostUid;
            if (!string.IsNullOrEmpty(_lastFollowJoinedRoomId))
            {
                path += "?lastRoomId=" + Uri.EscapeDataString(_lastFollowJoinedRoomId);
            }
            SendJsonRequest("GET", path, null, requireAuth: true, (ok, code, text) =>
            {
                if (!ok) return;
                var d = BridgeJson.Parse(text) as Dictionary<string, object>;
                if (d == null) return;
                string status = Str(d, "status");
                if (status == "ineligible")
                {
                    _statusMessage = "跟房被门槛拦截：" + Str(d, "reason");
                    return;
                }
                if (status == "join_ready" && d.TryGetValue("ticket", out object tObj) && tObj is Dictionary<string, object> t)
                {
                    long rid = Lng(t, "roomId");
                    int srvId = Int(t, "roomServerId");
                    string pwd = Str(t, "roomPwd");
                    if (rid > 0)
                    {
                        _lastFollowJoinedRoomId = rid.ToString(CultureInfo.InvariantCulture);
                        JoinGameRoom(rid, pwd, srvId, "自动跟房命中车头房间");
                    }
                }
            });
        }

        internal void CreateSquad(string title = "")
        {
            var body = new Dictionary<string, object>
            {
                ["title"] = string.IsNullOrEmpty(title) ? ((string.IsNullOrEmpty(_localNick) ? "星枢" : _localNick) + "的小队") : title.Trim(),
                ["minCredit"] = _minCredit,
                ["maxGiveUpRate"] = _maxGiveUpRate,
                ["maxMembers"] = 4,
            };
            SendJsonRequest("POST", "/api/credit/squad/create", body, requireAuth: true, (ok, code, text) =>
            {
                if (!ok)
                {
                    _statusMessage = ExtractError(text, "创建小队失败");
                    return;
                }
                UpdateSquadFromResponse(text);
                if (_currentSquad != null)
                {
                    _statusMessage = "已创建小队 · 邀请码 " + _currentSquad.JoinCode;
                }
            });
        }

        internal void JoinSquadByCode(string code)
        {
            string clean = (code ?? string.Empty).Trim().ToUpperInvariant();
            if (string.IsNullOrEmpty(clean))
            {
                _statusMessage = "请输入 6 位小队邀请码";
                return;
            }
            SendJsonRequest("POST", "/api/credit/squad/" + Uri.EscapeDataString(clean) + "/join", new Dictionary<string, object>(), requireAuth: true, (ok, httpCode, text) =>
            {
                if (!ok)
                {
                    _statusMessage = ExtractError(text, "加入小队失败");
                    return;
                }
                UpdateSquadFromResponse(text);
                _statusMessage = "已加入星枢高信誉小队";
            });
        }

        internal void LeaveSquad()
        {
            if (_currentSquad == null) return;
            string sid = _currentSquad.SquadId;
            _currentSquad = null;
            SendJsonRequest("POST", "/api/credit/squad/" + sid + "/leave", new Dictionary<string, object>(), requireAuth: true, null);
            _statusMessage = "已退出星枢小队";
        }

        internal void ToggleSquadReady()
        {
            if (_currentSquad == null) return;
            string selfUid = _localUid > 0 ? _localUid.ToString(CultureInfo.InvariantCulture) : string.Empty;
            bool curReady = false;
            foreach (SquadMemberModel m in _currentSquad.Members)
            {
                if (m.Uid == selfUid) { curReady = m.Ready; break; }
            }
            SendJsonRequest("POST", "/api/credit/squad/" + _currentSquad.SquadId + "/ready",
                new Dictionary<string, object> { ["ready"] = !curReady }, requireAuth: true, (ok, code, text) =>
                {
                    if (ok) UpdateSquadFromResponse(text);
                });
        }

        internal void PublishSquadRoomToTeam()
        {
            if (_currentSquad == null)
            {
                _statusMessage = "请先创建或加入小队";
                return;
            }
            if (!_inRoom || !_isRoomHost || _currentRoomId <= 0)
            {
                _statusMessage = "请队长先在游戏内开好房间，再一键拉全员进房";
                return;
            }
            string pwd = !string.IsNullOrEmpty(_hostedRoomPwd) ? _hostedRoomPwd : _currentRoomPwd;
            var body = new Dictionary<string, object>
            {
                ["roomId"] = _currentRoomId.ToString(CultureInfo.InvariantCulture),
                ["roomServerId"] = _currentRoomServerId,
                ["roomPwd"] = pwd ?? string.Empty,
                ["roomName"] = _currentRoomName,
                ["mapId"] = _currentMapId,
                ["difficulty"] = _currentDifficulty,
                ["publicToFleet"] = _hostingFleetRoom
            };
            SendJsonRequest("POST", "/api/credit/squad/" + _currentSquad.SquadId + "/publish-room", body, requireAuth: true, (ok, code, text) =>
            {
                if (!ok)
                {
                    _statusMessage = ExtractError(text, "推送房间指令给队员失败");
                    return;
                }
                UpdateSquadFromResponse(text);
                _statusMessage = "已通知小队全员自动跟进房间 #" + _currentRoomId;
            });
        }

        internal void PollSquadState()
        {
            if (!HasAuthToken) return;
            SendJsonRequest("GET", "/api/credit/squad/me", null, requireAuth: true, (ok, code, text) =>
            {
                if (!ok) return;
                UpdateSquadFromResponse(text);
                if (_currentSquad != null && !string.IsNullOrEmpty(_currentSquad.ActiveRoomId) && !_inRoom)
                {
                    string selfUid = _localUid.ToString(CultureInfo.InvariantCulture);
                    if (_currentSquad.LeaderUid != selfUid && _currentSquad.ActiveRoomId != _lastSquadJoinedRoomId)
                    {
                        if (long.TryParse(_currentSquad.ActiveRoomId, NumberStyles.Integer, CultureInfo.InvariantCulture, out long rid) && rid > 0)
                        {
                            _lastSquadJoinedRoomId = _currentSquad.ActiveRoomId;
                            JoinGameRoom(rid, _currentSquad.ActiveRoomPwd, _currentSquad.ActiveRoomServerId, "收到队长发车指令");
                        }
                    }
                }
            });
        }

        private void JoinGameRoom(long roomId, string pwd, int serverId, string tag)
        {
            if (!ValidateLobby(out GameLogicManager logic, out string err))
            {
                _statusMessage = tag + "，但当前无法直接进房：" + err;
                return;
            }
            try
            {
                try { XingShuRuntime.UI.XingShuUICenter.Close(); } catch { }
                logic.room.RequestJoinRoomC2S(roomId, pwd ?? string.Empty, serverId);
                _statusMessage = tag + " · 正在进入房间 #" + roomId;
            }
            catch (Exception ex)
            {
                _statusMessage = "进房调用失败: " + ex.Message;
            }
        }

        private static bool ValidateLobby(out GameLogicManager logic, out string reason)
        {
            logic = SimpleSingletonProvider<GameLogicManager>.hasInstance ? SimpleSingletonProvider<GameLogicManager>.inst : null;
            if (!SimpleSingletonProvider<SceneManager>.hasInstance ||
                SimpleSingletonProvider<SceneManager>.inst?.currentType == null ||
                SimpleSingletonProvider<SceneManager>.inst.currentType.Value != SceneType.Home)
            {
                reason = "请先进入游戏主大厅";
                return false;
            }
            if (logic == null || logic.account == null || !logic.account.online || logic.room == null)
            {
                reason = "账号尚未连线官服大厅";
                return false;
            }
            NetManager net = MonoSingletonProvider<NetManager>.inst;
            if (net == null || !net.IsConnected)
            {
                reason = "游戏服务器连接已断开";
                return false;
            }
            reason = string.Empty;
            return true;
        }

        // --- Official room wait stay extension (real wall-clock, immune to speedup) ---

        private void TickRoomWaitKeepAlive()
        {
            try
            {
                if (!SimpleSingletonProvider<UIManager>.hasInstance)
                {
                    _roomWaitTrackedRoomId = 0;
                    _roomWaitEnteredRealSec = 0d;
                    return;
                }
                UIManager uiMgr = SimpleSingletonProvider<UIManager>.inst;
                RoomWaitPanel waitPanel = uiMgr != null ? uiMgr.currentPanel as RoomWaitPanel : null;
                if (waitPanel == null || !waitPanel.IsOpen())
                {
                    _roomWaitTrackedRoomId = 0;
                    _roomWaitEnteredRealSec = 0d;
                    return;
                }

                double nowReal = ThinkingClock.RealSeconds();
                long roomKey = _currentRoomId > 0 ? _currentRoomId : 1L;
                if (_roomWaitTrackedRoomId != roomKey || _roomWaitEnteredRealSec <= 0d)
                {
                    _roomWaitTrackedRoomId = roomKey;
                    _roomWaitEnteredRealSec = nowReal;
                }

                if (!_extendRoomWait) return;

                double elapsed = Math.Max(0d, nowReal - _roomWaitEnteredRealSec);
                if (_roomWaitMinutes > 0 && elapsed >= _roomWaitMinutes * 60d)
                {
                    return;
                }

                CancelPrivateTimer(waitPanel, RoomWaitRoomTimerField);
                if (_isRoomHost)
                {
                    CancelPrivateTimer(waitPanel, RoomWaitMasterKickTimerField);
                }
            }
            catch { }
        }

        private static void CancelPrivateTimer(object target, FieldInfo field)
        {
            if (target == null || field == null) return;
            object timerObj = field.GetValue(target);
            if (timerObj == null) return;
            if (_timerCancelMethod == null)
            {
                _timerCancelMethod = timerObj.GetType().GetMethod("Cancel", BindingFlags.Instance | BindingFlags.Public);
            }
            if (_timerCancelMethod != null)
            {
                _timerCancelMethod.Invoke(timerObj, null);
                field.SetValue(target, null);
            }
        }

        // --- Native FairyGUI Player Card Credit Badges & Low-Credit Warning ---

        private void TickNativeCardOverlays()
        {
            _cardOverlayActive = false;
            try
            {
                if (!SimpleSingletonProvider<UIManager>.hasInstance)
                {
                    DisposeCardOverlays();
                    return;
                }
                UIManager uiMgr = SimpleSingletonProvider<UIManager>.inst;
                if (uiMgr == null)
                {
                    DisposeCardOverlays();
                    return;
                }

                RoomWaitPanel waitPanel = uiMgr.currentPanel as RoomWaitPanel;
                if (waitPanel != null && waitPanel.IsOpen())
                {
                    UIRoomWaitPanel waitUi = waitPanel.UIObject;
                    if (waitUi != null && !waitUi.isDisposed && waitUi.visible && waitUi.onStage)
                    {
                        RenderRoomWaitCardOverlays(waitUi);
                        _cardOverlayActive = true;
                        return;
                    }
                }

                RoomHeroPanel heroPanel = uiMgr.currentPanel as RoomHeroPanel;
                if (heroPanel != null && heroPanel.IsOpen())
                {
                    UIRoomHeroPanel heroUi = heroPanel.UIObject;
                    if (heroUi != null && !heroUi.isDisposed && heroUi.visible && heroUi.onStage)
                    {
                        RenderHeroSelectCardOverlays(heroUi);
                        _cardOverlayActive = true;
                        return;
                    }
                }

                DisposeCardOverlays();
            }
            catch { }
        }

        private void RenderRoomWaitCardOverlays(UIRoomWaitPanel waitUi)
        {
            var activeCards = new HashSet<GComponent>();
            var riskySummaries = new List<string>(4);
            var missingUids = new List<string>(4);

            UICom_RoomPlayer comPlayer = waitUi.com_Player as UICom_RoomPlayer;
            GList list = comPlayer != null ? comPlayer.list_playerWait : null;
            if (list != null && !list.isDisposed)
            {
                int count = list.numChildren;
                for (int i = 0; i < count; i++)
                {
                    UIRoomPlayer_Com_PlayerLabel card = list.GetChildAt(i) as UIRoomPlayer_Com_PlayerLabel;
                    if (card == null || card.isDisposed || !card.visible) continue;
                    RoomPlayer rp = card.playerInfo;
                    if (rp == null || rp.IsBot || rp.Id <= 0) continue;

                    activeCards.Add(card);
                    string uidStr = rp.Id.ToString(CultureInfo.InvariantCulture);
                    if (!_profiles.ContainsKey(uidStr)) missingUids.Add(uidStr);
                    bool isSelf = rp.Id == _localUid;
                    string riskReason = string.Empty;
                    bool risky = !isSelf && IsPeerRisky(uidStr, out riskReason);
                    string displayNick = string.Empty;
                    try { displayNick = StripRichTags(rp.GetNick(false) ?? string.Empty); } catch { }
                    if (string.IsNullOrEmpty(displayNick)) displayNick = uidStr;
                    if (risky)
                    {
                        riskySummaries.Add(displayNick + "(" + riskReason + ")");
                    }
                    UpdateSingleCardBadge(card, uidStr, isSelf, isHeroCard: false);
                }
            }

            double now = ThinkingClock.RealSeconds();
            if (missingUids.Count > 0 && !_profileFetchInFlight && now >= _nextProfileRetryAt && now - _lastProfileFetchAt >= 2.0d)
            {
                FetchProfiles(missingUids, manual: false);
            }

            CleanupUnusedCardBadges(activeCards);
            UpdateRoomRiskBanner(waitUi, riskySummaries);
        }

        private void RenderHeroSelectCardOverlays(UIRoomHeroPanel heroUi)
        {
            var activeCards = new HashSet<GComponent>();
            var riskySummaries = new List<string>(4);
            var missingUids = new List<string>(4);

            UIRoomHero_Com_Player[] slots = { heroUi.com_player_1, heroUi.com_player_2, heroUi.com_player_3, heroUi.com_player_4 };
            for (int i = 0; i < slots.Length; i++)
            {
                UIRoomHero_Com_Player card = slots[i];
                if (card == null || card.isDisposed || !card.visible) continue;
                RoomPlayer rp = HeroPlayerDataField != null ? HeroPlayerDataField.GetValue(card) as RoomPlayer : null;
                if (rp == null || rp.IsBot || rp.Id <= 0) continue;

                activeCards.Add(card);
                string uidStr = rp.Id.ToString(CultureInfo.InvariantCulture);
                if (!_profiles.ContainsKey(uidStr)) missingUids.Add(uidStr);
                bool isSelf = rp.Id == _localUid;
                string riskReason = string.Empty;
                bool risky = !isSelf && IsPeerRisky(uidStr, out riskReason);
                string displayNick = string.Empty;
                try { displayNick = StripRichTags(rp.GetNick(false) ?? string.Empty); } catch { }
                if (string.IsNullOrEmpty(displayNick)) displayNick = uidStr;
                if (risky)
                {
                    riskySummaries.Add(displayNick + "(" + riskReason + ")");
                }
                UpdateSingleCardBadge(card, uidStr, isSelf, isHeroCard: true);
            }

            double now = ThinkingClock.RealSeconds();
            if (missingUids.Count > 0 && !_profileFetchInFlight && now >= _nextProfileRetryAt && now - _lastProfileFetchAt >= 2.0d)
            {
                FetchProfiles(missingUids, manual: false);
            }

            CleanupUnusedCardBadges(activeCards);
            UpdateRoomRiskBanner(heroUi, riskySummaries);
        }

        private void UpdateSingleCardBadge(GComponent card, string uidStr, bool isSelf, bool isHeroCard)
        {
            CardBadgeVisual vis = null;
            for (int i = 0; i < _cardBadges.Count; i++)
            {
                if (_cardBadges[i].HostCard == card && _cardBadges[i].Root != null && !_cardBadges[i].Root.isDisposed && _cardBadges[i].Root.parent == card)
                {
                    vis = _cardBadges[i];
                    break;
                }
            }
            if (vis == null)
            {
                GObject existing = card.GetChild(CardBadgeName);
                if (existing != null && !existing.isDisposed) existing.Dispose();

                var root = new GComponent { name = CardBadgeName, touchable = false, opaque = false };
                var borderTop = new GGraph { touchable = false };
                var borderBottom = new GGraph { touchable = false };
                var borderLeft = new GGraph { touchable = false };
                var borderRight = new GGraph { touchable = false };
                var pillBg = new GGraph { touchable = false };
                var pillText = new GTextField
                {
                    name = "CreditLabel",
                    touchable = false,
                    autoSize = AutoSizeType.Both,
                    align = AlignType.Left,
                    stroke = 1f,
                    strokeColor = new Color(0f, 0f, 0f, 0.92f)
                };
                TextFormat fmt = pillText.textFormat;
                fmt.size = Application.isMobilePlatform ? 22 : (isHeroCard ? 16 : 18);
                fmt.bold = true;
                fmt.color = Color.white;
                pillText.textFormat = fmt;

                root.AddChild(borderTop);
                root.AddChild(borderBottom);
                root.AddChild(borderLeft);
                root.AddChild(borderRight);
                root.AddChild(pillBg);
                root.AddChild(pillText);
                card.AddChild(root);

                vis = new CardBadgeVisual
                {
                    HostCard = card,
                    Root = root,
                    PillBg = pillBg,
                    PillText = pillText,
                    BorderTop = borderTop,
                    BorderBottom = borderBottom,
                    BorderLeft = borderLeft,
                    BorderRight = borderRight
                };
                _cardBadges.Add(vis);
            }

            if (vis.Root.parent == card)
            {
                card.SetChildIndex(vis.Root, card.numChildren - 1);
            }

            float cw = Mathf.Max(180f, card.width);
            float ch = Mathf.Max(60f, card.height);
            vis.Root.SetSize(cw, ch);
            vis.Root.SetXY(0f, 0f);

            CreditProfileModel p = GetCachedProfile(uidStr);
            string cardRiskReason = string.Empty;
            bool risky = !isSelf && IsPeerRisky(uidStr, out cardRiskReason);
            vis.IsRisky = risky;

            string labelText;
            Color pillColor;
            Color textColor;
            if (p == null)
            {
                labelText = !string.IsNullOrEmpty(_lastProfileError) ? "★ 星枢信誉 重试中…" : "★ 星枢信誉 查询中…";
                pillColor = new Color(0.08f, 0.11f, 0.17f, 0.84f);
                textColor = new Color(0.82f, 0.90f, 0.98f, 1f);
            }
            else if (risky)
            {
                string prefix = p.BlacklistedByMe ? "⚠ 黑名单警告" : (p.FleetBanned ? "⚠ 车队受限" : "⚠ 低信誉警告");
                labelText = string.Format(CultureInfo.InvariantCulture, "{0} · {1}分 · 拔线{2:F0}%", prefix, p.Score, p.GiveUpRate);
                pillColor = new Color(0.68f, 0.06f, 0.12f, 0.95f);
                textColor = new Color(1.0f, 0.94f, 0.72f, 1f);
            }
            else if (p.Score >= 90)
            {
                string tier = p.Observing ? "观察期" : p.TierLabel;
                labelText = string.Format(CultureInfo.InvariantCulture, "★ 信誉 {0} · {1} | 拔线{2:F0}%", p.Score, tier, p.GiveUpRate);
                pillColor = new Color(0.05f, 0.24f, 0.18f, 0.88f);
                textColor = new Color(0.56f, 0.98f, 0.76f, 1f);
            }
            else if (p.Score >= 80)
            {
                labelText = string.Format(CultureInfo.InvariantCulture, "★ 信誉 {0} · {1} | 拔线{2:F0}%", p.Score, p.TierLabel, p.GiveUpRate);
                pillColor = new Color(0.06f, 0.18f, 0.28f, 0.88f);
                textColor = new Color(0.62f, 0.90f, 1.0f, 1f);
            }
            else
            {
                labelText = string.Format(CultureInfo.InvariantCulture, "★ 信誉 {0} · {1} | 拔线{2:F0}%", p.Score, p.TierLabel, p.GiveUpRate);
                pillColor = new Color(0.38f, 0.22f, 0.04f, 0.92f);
                textColor = new Color(1.0f, 0.84f, 0.45f, 1f);
            }

            TextFormat curFmt = vis.PillText.textFormat;
            if (curFmt.color != textColor)
            {
                curFmt.color = textColor;
                vis.PillText.textFormat = curFmt;
            }
            if (vis.PillText.text != labelText)
            {
                vis.PillText.text = labelText;
            }

            float padX = 12f;
            float padY = 4f;
            float pillW = Mathf.Clamp(vis.PillText.width + padX * 2f, 140f, Mathf.Max(140f, cw - 20f));
            float pillH = Mathf.Max(26f, vis.PillText.height + padY * 2f);
            float pillX = isHeroCard
                ? Mathf.Max(8f, (cw - pillW) * 0.5f)
                : Mathf.Clamp(cw * 0.28f, 130f, Mathf.Max(130f, cw - pillW - 142f));
            float pillY = isHeroCard ? 8f : 6f;

            vis.PillBg.SetSize(pillW, pillH);
            vis.PillBg.SetXY(pillX, pillY);
            vis.PillBg.DrawRoundRect(pillW, pillH, pillColor, new float[] { 8f, 8f, 8f, 8f });
            vis.PillText.SetXY(pillX + padX, pillY + padY);

            vis.BorderTop.visible = risky;
            vis.BorderBottom.visible = risky;
            vis.BorderLeft.visible = risky;
            vis.BorderRight.visible = risky;
            if (risky)
            {
                float t = 5f;
                Color warnCol = new Color(1.0f, 0.16f, 0.22f, 0.92f);
                float[] r0 = { 4f, 4f, 4f, 4f };
                vis.BorderTop.SetXY(2f, 2f);
                vis.BorderTop.SetSize(cw - 4f, t);
                vis.BorderTop.DrawRoundRect(cw - 4f, t, warnCol, r0);

                vis.BorderBottom.SetXY(2f, ch - t - 2f);
                vis.BorderBottom.SetSize(cw - 4f, t);
                vis.BorderBottom.DrawRoundRect(cw - 4f, t, warnCol, r0);

                vis.BorderLeft.SetXY(2f, 2f);
                vis.BorderLeft.SetSize(t, ch - 4f);
                vis.BorderLeft.DrawRoundRect(t, ch - 4f, warnCol, r0);

                vis.BorderRight.SetXY(cw - t - 2f, 2f);
                vis.BorderRight.SetSize(t, ch - 4f);
                vis.BorderRight.DrawRoundRect(t, ch - 4f, warnCol, r0);
            }
        }

        private void PulseRiskyBorders(double now)
        {
            float alpha = 0.58f + 0.40f * Mathf.Abs(Mathf.Sin((float)((now % 628.0d) * 4.5d)));
            for (int i = 0; i < _cardBadges.Count; i++)
            {
                CardBadgeVisual vis = _cardBadges[i];
                if (!vis.IsRisky || vis.Root == null || vis.Root.isDisposed) continue;
                vis.BorderTop.alpha = alpha;
                vis.BorderBottom.alpha = alpha;
                vis.BorderLeft.alpha = alpha;
                vis.BorderRight.alpha = alpha;
            }
        }

        private void UpdateRoomRiskBanner(GComponent panelUi, List<string> riskySummaries)
        {
            if (panelUi == null || panelUi.isDisposed || riskySummaries == null || riskySummaries.Count == 0)
            {
                if (_roomWarnBanner != null && !_roomWarnBanner.isDisposed) _roomWarnBanner.visible = false;
                return;
            }
            if (_roomWarnBanner == null || _roomWarnBanner.isDisposed || _roomWarnBanner.parent != panelUi)
            {
                if (_roomWarnBanner != null && !_roomWarnBanner.isDisposed) _roomWarnBanner.Dispose();
                GObject old = panelUi.GetChild(RoomWarnBannerName);
                if (old != null && !old.isDisposed) old.Dispose();

                _roomWarnBanner = new GComponent { name = RoomWarnBannerName, touchable = false, opaque = false };
                _roomWarnBg = new GGraph { touchable = false };
                _roomWarnText = new GTextField
                {
                    name = "WarnText",
                    touchable = false,
                    autoSize = AutoSizeType.Both,
                    align = AlignType.Center,
                    stroke = 1f,
                    strokeColor = new Color(0f, 0f, 0f, 0.92f)
                };
                TextFormat wf = _roomWarnText.textFormat;
                wf.size = Application.isMobilePlatform ? 24 : 20;
                wf.bold = true;
                wf.color = new Color(1.0f, 0.96f, 0.78f, 1f);
                _roomWarnText.textFormat = wf;
                _roomWarnBanner.AddChild(_roomWarnBg);
                _roomWarnBanner.AddChild(_roomWarnText);
                panelUi.AddChild(_roomWarnBanner);
            }

            panelUi.SetChildIndex(_roomWarnBanner, panelUi.numChildren - 1);
            string text = "⚠ 低信誉风险警告：" + string.Join("、", riskySummaries.ToArray()) + "  |  按 F1 →「信誉与车队」可拉黑或踢出";
            if (_roomWarnText.text != text) _roomWarnText.text = text;
            float bw = Mathf.Clamp(_roomWarnText.width + 36f, 360f, Mathf.Max(360f, panelUi.width - 80f));
            float bh = Mathf.Max(38f, _roomWarnText.height + 14f);
            _roomWarnBanner.SetSize(bw, bh);
            _roomWarnBanner.SetXY((panelUi.width - bw) * 0.5f, 18f);
            _roomWarnBg.SetSize(bw, bh);
            _roomWarnBg.DrawRoundRect(bw, bh, new Color(0.68f, 0.06f, 0.12f, 0.93f), new float[] { 10f, 10f, 10f, 10f });
            _roomWarnText.SetXY((bw - _roomWarnText.width) * 0.5f, (bh - _roomWarnText.height) * 0.5f);
            _roomWarnBanner.visible = true;
        }

        private void CleanupUnusedCardBadges(HashSet<GComponent> activeCards)
        {
            for (int i = _cardBadges.Count - 1; i >= 0; i--)
            {
                CardBadgeVisual vis = _cardBadges[i];
                if (vis.HostCard == null || vis.HostCard.isDisposed || !activeCards.Contains(vis.HostCard))
                {
                    if (vis.Root != null && !vis.Root.isDisposed) vis.Root.Dispose();
                    _cardBadges.RemoveAt(i);
                }
            }
        }

        private void DisposeCardOverlays()
        {
            for (int i = 0; i < _cardBadges.Count; i++)
            {
                try
                {
                    if (_cardBadges[i].Root != null && !_cardBadges[i].Root.isDisposed) _cardBadges[i].Root.Dispose();
                }
                catch { }
            }
            _cardBadges.Clear();
            try
            {
                if (_roomWarnBanner != null && !_roomWarnBanner.isDisposed) _roomWarnBanner.Dispose();
            }
            catch { }
            _roomWarnBanner = null;
            _roomWarnBg = null;
            _roomWarnText = null;
        }

        // --- Lightweight room-only fallback strip (hidden in battle and whenever native room/hero card badges are shown) ---

        private static bool IsInHomeScene()
        {
            return SimpleSingletonProvider<SceneManager>.hasInstance
                && SimpleSingletonProvider<SceneManager>.inst?.currentType != null
                && SimpleSingletonProvider<SceneManager>.inst.currentType.Value == SceneType.Home;
        }

        private void OnGUI()
        {
            if (!_enabled || !_hudStripEnabled || !_inRoom || _currentPeers.Count == 0 || _cardOverlayActive || _guiInitFailed || !IsInHomeScene()) return;
            try
            {
                EnsureGuiStyles();

                float rowH = 22f;
                float w = 296f;
                float h = 28f + _currentPeers.Count * rowH + 8f;
                float x = Screen.width - w - 16f;
                float y = 74f;
                Color prevColor = GUI.color;
                GUI.color = new Color(0.08f, 0.10f, 0.15f, 0.82f);
                GUI.DrawTexture(new Rect(x, y, w, h), Texture2D.whiteTexture);
                GUI.color = prevColor;
                GUI.Label(new Rect(x + 10f, y + 5f, w - 20f, 20f), "★ 星枢社区信誉监护", _hudTitleStyle);

                for (int i = 0; i < _currentPeers.Count; i++)
                {
                    RoomPeerModel peer = _currentPeers[i];
                    CreditProfileModel p = GetCachedProfile(peer.UidStr);
                    bool risky = IsPeerRisky(peer.UidStr, out string riskReason);
                    string name = string.IsNullOrEmpty(peer.PlainNick) ? peer.UidStr : peer.PlainNick;
                    if (name.Length > 10) name = name.Substring(0, 10);
                    string line = p != null
                        ? string.Format(CultureInfo.InvariantCulture, "{0} · {1}分 拔{2:F0}%{3}",
                            name, p.Score, p.GiveUpRate, risky && !string.IsNullOrEmpty(riskReason) ? " [" + riskReason + "]" : "")
                        : name + " · 查询中…";
                    GUI.Label(new Rect(x + 10f, y + 26f + i * rowH, w - 20f, rowH), line, risky ? _hudWarnStyle : _hudRowStyle);
                }
            }
            catch
            {
                _guiInitFailed = true;
            }
        }

        private void EnsureGuiStyles()
        {
            if (_hudTitleStyle == null)
            {
                _hudTitleStyle = new GUIStyle(GUI.skin.label)
                {
                    fontSize = 12,
                    fontStyle = FontStyle.Bold,
                    alignment = TextAnchor.MiddleLeft
                };
                _hudTitleStyle.normal.textColor = new Color(0.56f, 0.85f, 1.0f, 1f);
            }
            if (_hudRowStyle == null)
            {
                _hudRowStyle = new GUIStyle(GUI.skin.label)
                {
                    fontSize = 12,
                    alignment = TextAnchor.MiddleLeft
                };
                _hudRowStyle.normal.textColor = new Color(0.92f, 0.96f, 0.99f, 1f);
            }
            if (_hudWarnStyle == null)
            {
                _hudWarnStyle = new GUIStyle(_hudRowStyle);
                _hudWarnStyle.normal.textColor = new Color(1.0f, 0.45f, 0.48f, 1f);
            }
        }

        // --- UnityWebRequest queue & JSON helpers ---

        private void SendJsonRequest(string method, string path, object bodyObj, bool requireAuth, Action<bool, long, string> callback)
        {
            bool useProxy = IsUsingHubProxy && path.StartsWith("/api/credit/", StringComparison.Ordinal);
            string token = useProxy ? string.Empty : GetAuthToken();
            if (requireAuth && !useProxy && string.IsNullOrEmpty(token))
            {
                callback?.Invoke(false, 401, "{\"error\":\"请先在星枢 Hub 登录账号或完成一键授权\"}");
                return;
            }
            if (_httpInFlight.Count >= 10)
            {
                callback?.Invoke(false, 429, "{\"error\":\"请求过于频繁，请稍候\"}");
                return;
            }

            string targetUrl = useProxy
                ? string.Format(CultureInfo.InvariantCulture, "http://127.0.0.1:{0}{1}", _hubProxyPort, path)
                : (ApiOrigin + path);

            var req = new UnityWebRequest(targetUrl, method);
            if (bodyObj != null)
            {
                string json = BridgeJson.Serialize(bodyObj);
                req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
            }
            req.downloadHandler = new DownloadHandlerBuffer();
            req.timeout = 0;
            req.SetRequestHeader("Content-Type", "application/json; charset=utf-8");
            if (useProxy)
            {
                req.SetRequestHeader("X-XingShu-Proxy-Nonce", _hubProxyNonce);
            }
            else if (!string.IsNullOrEmpty(token))
            {
                req.SetRequestHeader("Authorization", "Bearer " + token);
            }
            req.SendWebRequest();
            _httpInFlight.Add(new PendingHttp
            {
                Request = req,
                StartedAt = ThinkingClock.RealSeconds(),
                TimeoutSeconds = HttpRequestTimeoutSeconds,
                Callback = (ok, code, body) =>
                {
                    if (useProxy && !ok && code <= 0)
                    {
                        _hubProxyReachable = false;
                        _hubProxySignedIn = false;
                    }
                    callback?.Invoke(ok, code, body);
                }
            });
        }

        private void TickHttpRequests()
        {
            double now = ThinkingClock.RealSeconds();
            for (int i = _httpInFlight.Count - 1; i >= 0; i--)
            {
                PendingHttp item = _httpInFlight[i];
                double timeout = item.TimeoutSeconds > 0d ? item.TimeoutSeconds : HttpRequestTimeoutSeconds;
                bool timedOut = !item.Request.isDone && (now - item.StartedAt) >= timeout;
                if (!item.Request.isDone && !timedOut) continue;

                _httpInFlight.RemoveAt(i);
                long code = 0;
                string body = string.Empty;
                string reqError = string.Empty;
                bool ok = false;
                if (timedOut)
                {
                    try { item.Request.Abort(); } catch { }
                }
                else
                {
                    code = item.Request.responseCode;
                    body = item.Request.downloadHandler != null ? item.Request.downloadHandler.text : string.Empty;
                    reqError = item.Request.error ?? string.Empty;
                    ok = item.Request.result == UnityWebRequest.Result.Success && code >= 200 && code < 300;
                }
                item.Request.Dispose();
                if (!ok && string.IsNullOrEmpty(body))
                {
                    body = SynthesizeHttpErrorJson(timedOut, reqError);
                }
                try { item.Callback?.Invoke(ok, code, body ?? string.Empty); } catch { }
            }
        }

        private static string SynthesizeHttpErrorJson(bool timedOut, string reqError)
        {
            if (timedOut) return "{\"error\":\"请求超时，请检查网络连接\"}";
            if (!string.IsNullOrEmpty(reqError))
            {
                if (reqError.IndexOf("timed out", StringComparison.OrdinalIgnoreCase) >= 0)
                    return "{\"error\":\"请求超时，请检查网络连接\"}";
                if (reqError.IndexOf("connect", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    reqError.IndexOf("resolve", StringComparison.OrdinalIgnoreCase) >= 0)
                    return "{\"error\":\"无法连接星枢服务\"}";
                if (reqError.IndexOf("SSL", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    reqError.IndexOf("TLS", StringComparison.OrdinalIgnoreCase) >= 0)
                    return "{\"error\":\"安全连接校验失败\"}";
            }
            return "{\"error\":\"网络请求异常\"}";
        }

        private void UpdateCachedProfileFromResponse(string json)
        {
            var root = BridgeJson.Parse(json) as Dictionary<string, object>;
            if (root != null && root.TryGetValue("profile", out object pObj) && pObj is Dictionary<string, object> d)
            {
                CreditProfileModel p = ParseProfile(d, ThinkingClock.RealSeconds());
                _profiles[p.Uid] = p;
            }
        }

        private void UpdateSquadFromResponse(string json)
        {
            var root = BridgeJson.Parse(json) as Dictionary<string, object>;
            if (root == null) return;
            if (!root.TryGetValue("squad", out object sqObj) || !(sqObj is Dictionary<string, object> d))
            {
                _currentSquad = null;
                return;
            }
            var sq = new SquadModel
            {
                SquadId = Str(d, "squadId"),
                JoinCode = Str(d, "joinCode"),
                Title = StripRichTags(Str(d, "title")),
                LeaderUid = Str(d, "leaderUid"),
                MinCredit = Int(d, "minCredit", 80),
                MaxMembers = Int(d, "maxMembers", 4),
                AvgCredit = Dbl(d, "avgCredit", 90.0),
            };
            if (d.TryGetValue("members", out object memObj) && memObj is List<object> mList)
            {
                foreach (object m in mList)
                {
                    if (!(m is Dictionary<string, object> md)) continue;
                    sq.Members.Add(new SquadMemberModel
                    {
                        Uid = Str(md, "uid"),
                        Nick = StripRichTags(Str(md, "nick")),
                        Ready = Bool(md, "ready"),
                        IsLeader = Bool(md, "isLeader"),
                        Score = Int(md, "score", 90),
                        GiveUpRate = Dbl(md, "giveUpRate", 0.0),
                    });
                }
            }
            if (d.TryGetValue("activeRoom", out object arObj) && arObj is Dictionary<string, object> ar)
            {
                sq.ActiveRoomId = Str(ar, "roomId");
                sq.ActiveRoomServerId = Int(ar, "roomServerId");
                sq.ActiveRoomPwd = Str(ar, "roomPwd");
            }
            _currentSquad = sq;
        }

        private static CreditProfileModel ParseProfile(Dictionary<string, object> d, double fetchedAt)
        {
            var tags = new List<string>(4);
            if (d.TryGetValue("tags", out object tObj) && tObj is List<object> tList)
            {
                foreach (object item in tList)
                {
                    string s = Convert.ToString(item, CultureInfo.InvariantCulture);
                    if (!string.IsNullOrEmpty(s)) tags.Add(s);
                }
            }
            return new CreditProfileModel
            {
                Uid = Str(d, "uid"),
                Nick = StripRichTags(Str(d, "nick")),
                Score = Int(d, "score", 90),
                Tier = Str(d, "tier", "excellent"),
                TierLabel = Str(d, "tierLabel", "极佳"),
                Observing = Bool(d, "observing"),
                RecordedMatches = Int(d, "recordedMatches"),
                GiveUpCount = Int(d, "giveUpCount"),
                GiveUpRate = Dbl(d, "giveUpRate"),
                LikesCount = Int(d, "likesCount"),
                BlacklistCount = Int(d, "blacklistCount"),
                FleetBanned = Bool(d, "fleetBanned"),
                BlacklistedByMe = Bool(d, "blacklistedByMe"),
                LikedByMe = Bool(d, "likedByMe"),
                TagsText = string.Join(" · ", tags.ToArray()),
                FetchedAt = fetchedAt
            };
        }

        internal static string StripRichTags(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return string.Empty;
            string s = Regex.Replace(raw, @"\[/?(?:color|gradient|size|font|align|url|img|b|i|u|s|strike|sup|sub)(?:=[^\]]*)?\]", string.Empty, RegexOptions.IgnoreCase);
            s = Regex.Replace(s, @"</?(?:color|gradient|size|font|b|i|u|s|strike|sup|sub)(?:=[^>]*)?>", string.Empty, RegexOptions.IgnoreCase);
            return s.Trim();
        }

        private static string ExtractError(string json, string fallback)
        {
            if (!string.IsNullOrEmpty(json))
            {
                var d = BridgeJson.Parse(json) as Dictionary<string, object>;
                if (d != null)
                {
                    string err = Str(d, "error");
                    if (!string.IsNullOrEmpty(err)) return err;
                    string msg = Str(d, "message");
                    if (!string.IsNullOrEmpty(msg)) return msg;
                }
            }
            return fallback;
        }

        private static string Str(Dictionary<string, object> d, string key, string def = "")
        {
            return d != null && d.TryGetValue(key, out object v) && v != null
                ? Convert.ToString(v, CultureInfo.InvariantCulture) ?? def
                : def;
        }

        private static int Int(Dictionary<string, object> d, string key, int def = 0)
        {
            if (d == null || !d.TryGetValue(key, out object v) || v == null) return def;
            try { return Convert.ToInt32(v, CultureInfo.InvariantCulture); } catch { return def; }
        }

        private static long Lng(Dictionary<string, object> d, string key, long def = 0L)
        {
            if (d == null || !d.TryGetValue(key, out object v) || v == null) return def;
            try { return Convert.ToInt64(v, CultureInfo.InvariantCulture); } catch { return def; }
        }

        private static double Dbl(Dictionary<string, object> d, string key, double def = 0.0)
        {
            if (d == null || !d.TryGetValue(key, out object v) || v == null) return def;
            try { return Convert.ToDouble(v, CultureInfo.InvariantCulture); } catch { return def; }
        }

        private static bool Bool(Dictionary<string, object> d, string key, bool def = false)
        {
            if (d == null || !d.TryGetValue(key, out object v) || v == null) return def;
            try { return Convert.ToBoolean(v, CultureInfo.InvariantCulture); } catch { return def; }
        }

        private void OnDestroy()
        {
            CancelDeviceLogin();
            DisposeCardOverlays();
            for (int i = 0; i < _httpInFlight.Count; i++)
            {
                try { _httpInFlight[i].Request.Dispose(); } catch { }
            }
            _httpInFlight.Clear();
            if (_instance == this) _instance = null;
        }
    }
}
