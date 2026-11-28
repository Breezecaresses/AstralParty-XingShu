using System;
using System.Collections.Generic;
using Core.Net;
using Core.Scene;
using Cysharp.Threading.Tasks;
using GameLogic;
using party.model;
using party.protocol;
using Tools;
using UnityEngine;
using XingShuRuntime.Utilities;

namespace XingShuRuntime.MatchPort
{
    /// <summary>
    /// Live in-match RPC observer shared by Game Insight (Fanny 10202 teammate reveal)
    /// and MatchEconomyPanel (real-time shop & chip history). Coexists cleanly with TransferBridge.
    /// </summary>
    internal sealed class MatchProtocolObserver : MonoBehaviour
    {
        private static MatchProtocolObserver _instance;

        internal static readonly FannyEventChoiceState FannyEvents = new FannyEventChoiceState();
        internal static readonly MatchEconomyLedger EconomyLedger = new MatchEconomyLedger();

        private RPCMsgManager _rpc;
        private double _nextCheckRealTime;
        private long _roomId;
        private long _startTime;

        private static PredictActionS2C _lastObservedPredict;
        private static PVEShopBuyS2C _lastObservedPveShop;

        private PredictActionS2CRPC.OnPredictActionS2CServerDelegate _prevPredict;
        private PredictActionS2CRPC.OnPredictActionS2CServerDelegate _wrapPredict;

        private SelectEventS2CRPC.OnSelectEventS2CServerDelegate _prevSelectEvent;
        private SelectEventS2CRPC.OnSelectEventS2CServerDelegate _wrapSelectEvent;

        private SelectRelicS2CRPC.OnSelectRelicS2CServerDelegate _prevSelectRelic;
        private SelectRelicS2CRPC.OnSelectRelicS2CServerDelegate _wrapSelectRelic;

        private PVEShopBuyS2CRPC.OnPVEShopBuyS2CServerDelegate _prevPveShopBuy;
        private PVEShopBuyS2CRPC.OnPVEShopBuyS2CServerDelegate _wrapPveShopBuy;

        private ShopBuyS2CRPC.OnShopBuyS2CServerDelegate _prevShopBuy;
        private ShopBuyS2CRPC.OnShopBuyS2CServerDelegate _wrapShopBuy;

        private VendorBuyCardS2CRPC.OnVendorBuyCardS2CServerDelegate _prevVendorBuy;
        private VendorBuyCardS2CRPC.OnVendorBuyCardS2CServerDelegate _wrapVendorBuy;

        private BuyRelicS2CRPC.OnBuyRelicS2CServerDelegate _prevBuyRelic;
        private BuyRelicS2CRPC.OnBuyRelicS2CServerDelegate _wrapBuyRelic;

        private SyncRelicsS2CRPC.OnSyncRelicsS2CServerDelegate _prevSyncRelics;
        private SyncRelicsS2CRPC.OnSyncRelicsS2CServerDelegate _wrapSyncRelics;

        private RoundStartS2CRPC.OnRoundStartS2CServerDelegate _prevRoundStart;
        private RoundStartS2CRPC.OnRoundStartS2CServerDelegate _wrapRoundStart;

        internal static void Install(GameObject host)
        {
            if (_instance != null || host == null) return;
            _instance = host.AddComponent<MatchProtocolObserver>();
        }

        internal static void EnsureInstalled(GameObject host)
        {
            if (_instance == null && host != null)
            {
                Install(host);
            }
        }

        private void Awake()
        {
            if (_instance != null && _instance != this)
            {
                Destroy(this);
                return;
            }
            _instance = this;
        }

        private void Update()
        {
            double now = ThinkingClock.RealSeconds();
            if (now < _nextCheckRealTime) return;
            _nextCheckRealTime = now + 0.5d;
            SyncMatchContext();
            EnsureHooks();
            SyncLivePlayerRelics();
        }

        private void OnDestroy()
        {
            RestoreHooks();
            if (_instance == this) _instance = null;
        }

        private void SyncMatchContext()
        {
            try
            {
                bool inBattle = SimpleSingletonProvider<SceneManager>.hasInstance
                    && SimpleSingletonProvider<SceneManager>.inst.currentType != null
                    && SimpleSingletonProvider<SceneManager>.inst.currentType.Value == SceneType.Battle;
                if (!inBattle || !SimpleSingletonProvider<GameLogicManager>.hasInstance)
                {
                    if (_roomId != 0L || _startTime != 0L)
                    {
                        _roomId = 0L;
                        _startTime = 0L;
                        FannyEvents.Clear();
                        EconomyLedger.Reset(0L, 0L);
                    }
                    return;
                }
                var roomInfo = SimpleSingletonProvider<GameLogicManager>.inst.room?.curRoomInfo;
                if (roomInfo == null) return;
                long rid = roomInfo.Id;
                long st = roomInfo.info != null ? roomInfo.info.StartTime : 0L;
                if (rid != _roomId || st != _startTime)
                {
                    _roomId = rid;
                    _startTime = st;
                    _lastObservedPredict = null;
                    _lastObservedPveShop = null;
                    FannyEvents.Clear();
                    EconomyLedger.Reset(rid, st);
                }
                if (roomInfo.Round > 0)
                {
                    EconomyLedger.OnRoundStart(roomInfo.Round);
                }
            }
            catch { }
        }

        private static void SyncLivePlayerRelics()
        {
            try
            {
                if (!SimpleSingletonProvider<GameLogicManager>.hasInstance) return;
                var list = SimpleSingletonProvider<GameLogicManager>.inst.battle?.PlayerDatas;
                if (list == null) return;
                var relicsBuf = new List<int>(16);
                for (int i = 0; i < list.Count; i++)
                {
                    var p = list[i];
                    if (p == null || p.characterType != CharacterType.Hero || p.player == null) continue;
                    long pid = p.player.Id;
                    if (pid <= 0) continue;
                    string rawNick = p.player.GetNick();
                    string pName = !string.IsNullOrEmpty(rawNick) ? GameTextResolver.StripRichTags(rawNick) : ("P" + pid);
                    string hName = p.player.Hero != null && p.player.Hero.HeroId > 0 ? GameTextResolver.GetHeroName(p.player.Hero.HeroId) : "";
                    relicsBuf.Clear();
                    if (p.player.Hero?.SelectRelics != null)
                    {
                        foreach (var kv in p.player.Hero.SelectRelics)
                        {
                            if (kv.Key > 0 && kv.Value) relicsBuf.Add(kv.Key);
                        }
                    }
                    EconomyLedger.UpsertPlayerMeta(pid, pName, hName, relicsBuf);
                }
            }
            catch { }
        }

        private void EnsureHooks()
        {
            try
            {
                var net = MonoSingletonProvider<NetManager>.inst;
                var rpc = net != null ? net.RPC : null;
                if (rpc == null) return;
                if (_rpc != rpc)
                {
                    RestoreHooks();
                    _rpc = rpc;
                }

                // 1. PredictActionS2C (do NOT overwrite if TransferBridge owns it; TransferBridge forwards to ObservePredictExternal)
                if (rpc.PredictActionS2C != null)
                {
                    var cur = rpc.PredictActionS2C.OnPredictActionS2CServerCallBackAsync;
                    if (!TransferBridge.IsOwnPredictDelegate(cur))
                    {
                        if (_wrapPredict == null)
                        {
                            _wrapPredict = (PredictActionS2C model, int err, bool dispatch) =>
                            {
                                try { ObservePredictExternal(model); } catch { }
                                return _prevPredict != null ? _prevPredict(model, err, dispatch) : UniTask.CompletedTask;
                            };
                        }
                        if (cur != _wrapPredict && cur != null)
                        {
                            _prevPredict = cur;
                            rpc.PredictActionS2C.OnPredictActionS2CServerCallBackAsync = _wrapPredict;
                        }
                    }
                }

                // 2. PVEShopBuyS2C (coexist cleanly with TransferBridge)
                if (rpc.PVEShopBuyS2C != null)
                {
                    var cur = rpc.PVEShopBuyS2C.OnPVEShopBuyS2CServerCallBackAsync;
                    if (!TransferBridge.IsOwnBuyDelegate(cur))
                    {
                        if (_wrapPveShopBuy == null)
                        {
                            _wrapPveShopBuy = (PVEShopBuyS2C model, int err, bool dispatch) =>
                            {
                                try { if (err == 0) ObservePveShopBuyExternal(model); } catch { }
                                return _prevPveShopBuy != null ? _prevPveShopBuy(model, err, dispatch) : UniTask.CompletedTask;
                            };
                        }
                        if (cur != _wrapPveShopBuy && cur != null)
                        {
                            _prevPveShopBuy = cur;
                            rpc.PVEShopBuyS2C.OnPVEShopBuyS2CServerCallBackAsync = _wrapPveShopBuy;
                        }
                    }
                }

                // 3. SelectEventS2C
                if (rpc.SelectEventS2C != null)
                {
                    var cur = rpc.SelectEventS2C.OnSelectEventS2CServerCallBackAsync;
                    if (_wrapSelectEvent == null)
                    {
                        _wrapSelectEvent = (SelectEventS2C model, int err, bool dispatch) =>
                        {
                            try { if (err == 0 && model != null) FannyEvents.RecordSelection(model.PlayerId, model.EventId, ThinkingClock.RealSeconds()); } catch { }
                            return _prevSelectEvent != null ? _prevSelectEvent(model, err, dispatch) : UniTask.CompletedTask;
                        };
                    }
                    if (cur != _wrapSelectEvent && cur != null)
                    {
                        _prevSelectEvent = cur;
                        rpc.SelectEventS2C.OnSelectEventS2CServerCallBackAsync = _wrapSelectEvent;
                    }
                }

                // 4. SelectRelicS2C
                if (rpc.SelectRelicS2C != null)
                {
                    var cur = rpc.SelectRelicS2C.OnSelectRelicS2CServerCallBackAsync;
                    if (_wrapSelectRelic == null)
                    {
                        _wrapSelectRelic = (SelectRelicS2C model, int err, bool dispatch) =>
                        {
                            try { if (err == 0 && model != null) HandleSelectRelic(model); } catch { }
                            return _prevSelectRelic != null ? _prevSelectRelic(model, err, dispatch) : UniTask.CompletedTask;
                        };
                    }
                    if (cur != _wrapSelectRelic && cur != null)
                    {
                        _prevSelectRelic = cur;
                        rpc.SelectRelicS2C.OnSelectRelicS2CServerCallBackAsync = _wrapSelectRelic;
                    }
                }

                // 5. ShopBuyS2C (PVP)
                if (rpc.ShopBuyS2C != null)
                {
                    var cur = rpc.ShopBuyS2C.OnShopBuyS2CServerCallBackAsync;
                    if (_wrapShopBuy == null)
                    {
                        _wrapShopBuy = (ShopBuyS2C model, int err, bool dispatch) =>
                        {
                            try { if (err == 0 && model != null) HandleShopBuy(model); } catch { }
                            return _prevShopBuy != null ? _prevShopBuy(model, err, dispatch) : UniTask.CompletedTask;
                        };
                    }
                    if (cur != _wrapShopBuy && cur != null)
                    {
                        _prevShopBuy = cur;
                        rpc.ShopBuyS2C.OnShopBuyS2CServerCallBackAsync = _wrapShopBuy;
                    }
                }

                // 6. VendorBuyCardS2C
                if (rpc.VendorBuyCardS2C != null)
                {
                    var cur = rpc.VendorBuyCardS2C.OnVendorBuyCardS2CServerCallBackAsync;
                    if (_wrapVendorBuy == null)
                    {
                        _wrapVendorBuy = (VendorBuyCardS2C model, int err, bool dispatch) =>
                        {
                            try { if (err == 0 && model != null) HandleVendorBuy(model); } catch { }
                            return _prevVendorBuy != null ? _prevVendorBuy(model, err, dispatch) : UniTask.CompletedTask;
                        };
                    }
                    if (cur != _wrapVendorBuy && cur != null)
                    {
                        _prevVendorBuy = cur;
                        rpc.VendorBuyCardS2C.OnVendorBuyCardS2CServerCallBackAsync = _wrapVendorBuy;
                    }
                }

                // 7. BuyRelicS2C
                if (rpc.BuyRelicS2C != null)
                {
                    var cur = rpc.BuyRelicS2C.OnBuyRelicS2CServerCallBackAsync;
                    if (_wrapBuyRelic == null)
                    {
                        _wrapBuyRelic = (BuyRelicS2C model, int err, bool dispatch) =>
                        {
                            try { if (err == 0 && model != null) HandleBuyRelic(model); } catch { }
                            return _prevBuyRelic != null ? _prevBuyRelic(model, err, dispatch) : UniTask.CompletedTask;
                        };
                    }
                    if (cur != _wrapBuyRelic && cur != null)
                    {
                        _prevBuyRelic = cur;
                        rpc.BuyRelicS2C.OnBuyRelicS2CServerCallBackAsync = _wrapBuyRelic;
                    }
                }

                // 8. SyncRelicsS2C
                if (rpc.SyncRelicsS2C != null)
                {
                    var cur = rpc.SyncRelicsS2C.OnSyncRelicsS2CServerCallBackAsync;
                    if (_wrapSyncRelics == null)
                    {
                        _wrapSyncRelics = (SyncRelicsS2C model, int err, bool dispatch) =>
                        {
                            try { if (err == 0 && model != null) HandleSyncRelics(model); } catch { }
                            return _prevSyncRelics != null ? _prevSyncRelics(model, err, dispatch) : UniTask.CompletedTask;
                        };
                    }
                    if (cur != _wrapSyncRelics && cur != null)
                    {
                        _prevSyncRelics = cur;
                        rpc.SyncRelicsS2C.OnSyncRelicsS2CServerCallBackAsync = _wrapSyncRelics;
                    }
                }

                // 9. RoundStartS2C
                if (rpc.RoundStartS2C != null)
                {
                    var cur = rpc.RoundStartS2C.OnRoundStartS2CServerCallBackAsync;
                    if (_wrapRoundStart == null)
                    {
                        _wrapRoundStart = (RoundStartS2C model, int err, bool dispatch) =>
                        {
                            try { if (err == 0 && model != null && model.Round > 0) EconomyLedger.OnRoundStart(model.Round); } catch { }
                            return _prevRoundStart != null ? _prevRoundStart(model, err, dispatch) : UniTask.CompletedTask;
                        };
                    }
                    if (cur != _wrapRoundStart && cur != null)
                    {
                        _prevRoundStart = cur;
                        rpc.RoundStartS2C.OnRoundStartS2CServerCallBackAsync = _wrapRoundStart;
                    }
                }
            }
            catch { }
        }

        private void RestoreHooks()
        {
            if (_rpc == null) return;
            try
            {
                if (_rpc.PredictActionS2C != null && _wrapPredict != null && _rpc.PredictActionS2C.OnPredictActionS2CServerCallBackAsync == _wrapPredict)
                    _rpc.PredictActionS2C.OnPredictActionS2CServerCallBackAsync = _prevPredict;
                if (_rpc.PVEShopBuyS2C != null && _wrapPveShopBuy != null && _rpc.PVEShopBuyS2C.OnPVEShopBuyS2CServerCallBackAsync == _wrapPveShopBuy)
                    _rpc.PVEShopBuyS2C.OnPVEShopBuyS2CServerCallBackAsync = _prevPveShopBuy;
                if (_rpc.SelectEventS2C != null && _wrapSelectEvent != null && _rpc.SelectEventS2C.OnSelectEventS2CServerCallBackAsync == _wrapSelectEvent)
                    _rpc.SelectEventS2C.OnSelectEventS2CServerCallBackAsync = _prevSelectEvent;
                if (_rpc.SelectRelicS2C != null && _wrapSelectRelic != null && _rpc.SelectRelicS2C.OnSelectRelicS2CServerCallBackAsync == _wrapSelectRelic)
                    _rpc.SelectRelicS2C.OnSelectRelicS2CServerCallBackAsync = _prevSelectRelic;
                if (_rpc.ShopBuyS2C != null && _wrapShopBuy != null && _rpc.ShopBuyS2C.OnShopBuyS2CServerCallBackAsync == _wrapShopBuy)
                    _rpc.ShopBuyS2C.OnShopBuyS2CServerCallBackAsync = _prevShopBuy;
                if (_rpc.VendorBuyCardS2C != null && _wrapVendorBuy != null && _rpc.VendorBuyCardS2C.OnVendorBuyCardS2CServerCallBackAsync == _wrapVendorBuy)
                    _rpc.VendorBuyCardS2C.OnVendorBuyCardS2CServerCallBackAsync = _prevVendorBuy;
                if (_rpc.BuyRelicS2C != null && _wrapBuyRelic != null && _rpc.BuyRelicS2C.OnBuyRelicS2CServerCallBackAsync == _wrapBuyRelic)
                    _rpc.BuyRelicS2C.OnBuyRelicS2CServerCallBackAsync = _prevBuyRelic;
                if (_rpc.SyncRelicsS2C != null && _wrapSyncRelics != null && _rpc.SyncRelicsS2C.OnSyncRelicsS2CServerCallBackAsync == _wrapSyncRelics)
                    _rpc.SyncRelicsS2C.OnSyncRelicsS2CServerCallBackAsync = _prevSyncRelics;
                if (_rpc.RoundStartS2C != null && _wrapRoundStart != null && _rpc.RoundStartS2C.OnRoundStartS2CServerCallBackAsync == _wrapRoundStart)
                    _rpc.RoundStartS2C.OnRoundStartS2CServerCallBackAsync = _prevRoundStart;
            }
            catch { }
            _rpc = null;
        }

        internal static void ObservePredictExternal(PredictActionS2C model)
        {
            if (model == null || ReferenceEquals(_lastObservedPredict, model)) return;
            _lastObservedPredict = model;

            int round = ResolveCurrentRound(model.RoomRound);
            double now = ThinkingClock.RealSeconds();
            var actions = model.Actions;
            if (actions == null) return;

            for (int i = 0; i < actions.Count; i++)
            {
                var action = actions[i];
                if (action == null || action.NotBro || action.PlayerId <= 0 || action.Data == null || action.Data.Length == 0)
                {
                    continue;
                }
                GameTextResolver.ResolvePlayerLabels(action.PlayerId, out string pName, out string hName);
                try
                {
                    switch (action.Id)
                    {
                        case 5317:
                        {
                            var ev = ByteBuf.ReadObject<SelectEventC2S>(action.Data.ToByteArray());
                            if (ev != null && ev.Events != null && ev.Events.Count > 0)
                            {
                                FannyEvents.RecordOffer(action.PlayerId, pName, round, ev.Events, now);
                            }
                            break;
                        }
                        case 5211:
                        {
                            var rel = ByteBuf.ReadObject<SelectRelicC2S>(action.Data.ToByteArray());
                            if (rel != null && rel.Relics != null && rel.Relics.Count > 0)
                            {
                                EconomyLedger.OnRelicOffer(round, action.PlayerId, pName, hName, rel.Relics, rel.IsReroll, now);
                            }
                            break;
                        }
                        case 5215:
                        {
                            var shop = ByteBuf.ReadObject<PVEShopBuyC2S>(action.Data.ToByteArray());
                            if (shop != null && shop.Cards != null && shop.Cards.Count > 0)
                            {
                                EconomyLedger.OnShopOffer(round, action.PlayerId, pName, hName, "PVE商店", shop.Cards, shop.Alreadys, now);
                            }
                            break;
                        }
                        case 5029:
                        {
                            var shop = ByteBuf.ReadObject<ShopBuyC2S>(action.Data.ToByteArray());
                            if (shop != null && shop.Cards != null && shop.Cards.Count > 0)
                            {
                                EconomyLedger.OnShopOffer(round, action.PlayerId, pName, hName, "PVP商店", shop.Cards, shop.Alreadys, now);
                            }
                            break;
                        }
                        case 5323:
                        {
                            var vendor = ByteBuf.ReadObject<VendorBuyCardC2S>(action.Data.ToByteArray());
                            if (vendor != null && vendor.CardId > 0)
                            {
                                EconomyLedger.OnVendorOffer(round, action.PlayerId, pName, hName, vendor.CardId, now);
                            }
                            break;
                        }
                    }
                }
                catch { }
            }
        }

        internal static void ObservePveShopBuyExternal(PVEShopBuyS2C model)
        {
            if (model == null || ReferenceEquals(_lastObservedPveShop, model)) return;
            _lastObservedPveShop = model;
            int round = ResolveCurrentRound(0);
            GameTextResolver.ResolvePlayerLabels(model.PlayerId, out string pName, out string hName);
            EconomyLedger.OnShopBuy(
                round,
                model.PlayerId,
                pName,
                hName,
                "PVE商店",
                model.Cards,
                model.BuyCards,
                model.AssistPlayer,
                model.Alreadys,
                model.IsClose,
                ThinkingClock.RealSeconds());
        }

        private static void HandleShopBuy(ShopBuyS2C model)
        {
            int round = ResolveCurrentRound(0);
            GameTextResolver.ResolvePlayerLabels(model.PlayerId, out string pName, out string hName);
            EconomyLedger.OnShopBuy(
                round,
                model.PlayerId,
                pName,
                hName,
                "PVP商店",
                model.Cards,
                model.BuyCards,
                0L,
                model.Alreadys,
                false,
                ThinkingClock.RealSeconds());
        }

        private static void HandleVendorBuy(VendorBuyCardS2C model)
        {
            int round = ResolveCurrentRound(0);
            GameTextResolver.ResolvePlayerLabels(model.PlayerId, out string pName, out string hName);
            EconomyLedger.OnVendorResult(round, model.PlayerId, pName, hName, model.IsBuy, ThinkingClock.RealSeconds());
        }

        private static void HandleSelectRelic(SelectRelicS2C model)
        {
            int round = ResolveCurrentRound(0);
            GameTextResolver.ResolvePlayerLabels(model.PlayerId, out string pName, out string hName);
            EconomyLedger.OnRelicSelect(round, model.PlayerId, pName, hName, model.RelicId, model.IsReroll, ThinkingClock.RealSeconds());
        }

        private static void HandleBuyRelic(BuyRelicS2C model)
        {
            if (model.Select <= 0) return;
            int round = ResolveCurrentRound(0);
            GameTextResolver.ResolvePlayerLabels(model.PlayerId, out string pName, out string hName);
            EconomyLedger.OnRelicBuy(round, model.PlayerId, pName, hName, model.Select, ThinkingClock.RealSeconds());
        }

        private static void HandleSyncRelics(SyncRelicsS2C model)
        {
            if (model.PlayerId <= 0 || model.SelectRelics == null) return;
            GameTextResolver.ResolvePlayerLabels(model.PlayerId, out string pName, out string hName);
            var list = new List<int>(model.SelectRelics.Count);
            foreach (var kv in model.SelectRelics)
            {
                if (kv.Key > 0 && kv.Value) list.Add(kv.Key);
            }
            EconomyLedger.OnSyncRelics(model.PlayerId, pName, hName, list);
        }

        private static int ResolveCurrentRound(int packetRound)
        {
            if (packetRound > 0) return packetRound;
            try
            {
                if (SimpleSingletonProvider<GameLogicManager>.hasInstance)
                {
                    int r = SimpleSingletonProvider<GameLogicManager>.inst.room?.curRoomInfo?.Round ?? 0;
                    if (r > 0) return r;
                }
            }
            catch { }
            return Math.Max(1, EconomyLedger.CurrentRound);
        }
    }
}
