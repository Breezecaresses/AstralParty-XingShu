using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Core.Net;
using Core.Scene;
using GameLogic;
using Tools;
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
        private const float RoomScanInterval = 1.0f;
        private const float ProfileCacheTtl = 45.0f;
        private const float FleetHeartbeatInterval = 15.0f;
        private const float FollowPollInterval = 4.0f;

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
            public float FetchedAt;
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
            public float StartedAt;
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
        private float _lastHeartbeatAt;

        private bool _autoFollowActive;
        private string _autoFollowHostUid = string.Empty;
        private string _lastFollowJoinedRoomId = string.Empty;
        private float _lastFollowPollAt;

        private SquadModel _currentSquad;
        private string _lastSquadJoinedRoomId = string.Empty;
        private float _lastSquadPollAt;
        private long _autoReadyDoneRoomId;

        private float _lastRoomScanAt;
        private float _lastProfileFetchAt;
        private float _lastKickAt;
        private string _statusMessage = "信誉分与车队模块已就绪";

        private Texture2D _hudBgTex;
        private GUIStyle _hudBoxStyle;
        private GUIStyle _hudTitleStyle;
        private GUIStyle _hudRowStyle;
        private GUIStyle _hudWarnStyle;

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
        }

        internal bool HasAuthToken => !string.IsNullOrEmpty(GetAuthToken());

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
            if (_localUid > 0)
            {
                PlayerPrefs.DeleteKey(PrefTokenPrefix + _localUid.ToString(CultureInfo.InvariantCulture));
            }
            PlayerPrefs.DeleteKey(PrefTokenFallback);
            PlayerPrefs.Save();
            _statusMessage = "已清除手动授权令牌";
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

            if (!_enabled) return;

            float now = Time.realtimeSinceStartup;
            if (now - _lastRoomScanAt >= RoomScanInterval)
            {
                _lastRoomScanAt = now;
                ScanGameRoomAndPeers(now);
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

        private void ScanGameRoomAndPeers(float now)
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

                if (neededUids.Count > 0 && now - _lastProfileFetchAt >= 2.0f)
                {
                    _lastProfileFetchAt = now;
                    FetchProfiles(neededUids);
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

        internal void RefreshRoomProfilesNow()
        {
            var list = new List<string>(4);
            foreach (RoomPeerModel p in ActivePeers)
            {
                if (!string.IsNullOrEmpty(p.UidStr)) list.Add(p.UidStr);
            }
            if (list.Count > 0) FetchProfiles(list);
        }

        private void FetchProfiles(List<string> uids)
        {
            if (uids == null || uids.Count == 0) return;
            var body = new Dictionary<string, object> { ["uids"] = uids };
            SendJsonRequest("POST", "/api/credit/profiles", body, requireAuth: false, (ok, code, text) =>
            {
                if (!ok) return;
                var root = BridgeJson.Parse(text) as Dictionary<string, object>;
                if (root == null) return;
                if (!(root.TryGetValue("profiles", out object profObj) && profObj is Dictionary<string, object> profMap)) return;
                float ts = Time.realtimeSinceStartup;
                foreach (var kv in profMap)
                {
                    if (kv.Value is Dictionary<string, object> d)
                    {
                        _profiles[kv.Key] = ParseProfile(d, ts);
                    }
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
                    CreditProfileModel p = ParseProfile(pDict, Time.realtimeSinceStartup);
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
                float ts = Time.realtimeSinceStartup;
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

        internal void CreateHighCreditRoom(string roomName = "", string customPwd = "", int mode = 4, int mapId = 4, int difficulty = 2)
        {
            if (!HasAuthToken)
            {
                _statusMessage = "请先绑定或授权星枢账号后再发起高信誉密码车队";
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
                logic.room.RequestCreateC2S(rName, pwd, mapId, 0, 1, 2, 0UL, 2, mode, difficulty, false, 0);
                _statusMessage = "正在创建高信誉密码房（门槛 " + _minCredit + " 分）…";
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
            _lastHeartbeatAt = Time.realtimeSinceStartup;
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

        // --- Lightweight top-right room/teammate credit strip ---

        private void OnGUI()
        {
            if (!_enabled || !_hudStripEnabled || !_inRoom || _currentPeers.Count == 0) return;
            EnsureGuiStyles();

            float rowH = 22f;
            float w = 296f;
            float h = 28f + _currentPeers.Count * rowH + 8f;
            float x = Screen.width - w - 16f;
            float y = 74f;
            GUI.Box(new Rect(x, y, w, h), GUIContent.none, _hudBoxStyle);
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

        private void EnsureGuiStyles()
        {
            if (_hudBgTex == null)
            {
                _hudBgTex = new Texture2D(1, 1, TextureFormat.RGBA32, false);
                _hudBgTex.SetPixel(0, 0, new Color(0.08f, 0.10f, 0.15f, 0.78f));
                _hudBgTex.Apply();
            }
            if (_hudBoxStyle == null)
            {
                _hudBoxStyle = new GUIStyle(GUI.skin.box);
                _hudBoxStyle.normal.background = _hudBgTex;
            }
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
            string token = GetAuthToken();
            if (requireAuth && string.IsNullOrEmpty(token))
            {
                callback?.Invoke(false, 401, "{\"error\":\"请先完成星枢授权或绑定游戏账号\"}");
                return;
            }
            if (_httpInFlight.Count >= 8)
            {
                callback?.Invoke(false, 429, "{\"error\":\"请求过于频繁，请稍候\"}");
                return;
            }

            var req = new UnityWebRequest(ApiOrigin + path, method);
            if (bodyObj != null)
            {
                string json = BridgeJson.Serialize(bodyObj);
                req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
            }
            req.downloadHandler = new DownloadHandlerBuffer();
            req.timeout = 12;
            req.SetRequestHeader("Content-Type", "application/json; charset=utf-8");
            req.SetRequestHeader("Origin", ApiOrigin);
            if (!string.IsNullOrEmpty(token))
            {
                req.SetRequestHeader("Authorization", "Bearer " + token);
            }
            req.SendWebRequest();
            _httpInFlight.Add(new PendingHttp
            {
                Request = req,
                Callback = callback,
                StartedAt = Time.realtimeSinceStartup
            });
        }

        private void TickHttpRequests()
        {
            for (int i = _httpInFlight.Count - 1; i >= 0; i--)
            {
                PendingHttp item = _httpInFlight[i];
                if (!item.Request.isDone && (Time.realtimeSinceStartup - item.StartedAt) < 14f) continue;

                _httpInFlight.RemoveAt(i);
                long code = item.Request.responseCode;
                string body = item.Request.downloadHandler != null ? item.Request.downloadHandler.text : string.Empty;
                bool ok = item.Request.isDone && item.Request.result == UnityWebRequest.Result.Success && code >= 200 && code < 300;
                item.Request.Dispose();
                try { item.Callback?.Invoke(ok, code, body ?? string.Empty); } catch { }
            }
        }

        private void UpdateCachedProfileFromResponse(string json)
        {
            var root = BridgeJson.Parse(json) as Dictionary<string, object>;
            if (root != null && root.TryGetValue("profile", out object pObj) && pObj is Dictionary<string, object> d)
            {
                CreditProfileModel p = ParseProfile(d, Time.realtimeSinceStartup);
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

        private static CreditProfileModel ParseProfile(Dictionary<string, object> d, float fetchedAt)
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
            for (int i = 0; i < _httpInFlight.Count; i++)
            {
                try { _httpInFlight[i].Request.Dispose(); } catch { }
            }
            _httpInFlight.Clear();
            if (_hudBgTex != null)
            {
                Destroy(_hudBgTex);
                _hudBgTex = null;
            }
            if (_instance == this) _instance = null;
        }
    }
}
