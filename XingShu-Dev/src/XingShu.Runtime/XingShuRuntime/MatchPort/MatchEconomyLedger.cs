using System;
using System.Collections.Generic;

namespace XingShuRuntime.MatchPort
{
    internal enum EconomyEventKind
    {
        ShopVisit = 0,
        RelicChoice = 1,
        RelicShopBuy = 2,
    }

    internal sealed class ShopVisitRecord
    {
        internal int Sequence;
        internal int Round;
        internal long PlayerId;
        internal string PlayerName;
        internal string HeroName;
        internal string ShopKind;
        internal int[] OfferedCardIds;
        internal readonly List<int> BoughtCardIds = new List<int>();
        internal readonly List<long> AssistPlayerIds = new List<long>();
        internal bool IsActive;
        internal double UpdatedRealTime;
    }

    internal sealed class RelicChoiceRecord
    {
        internal int Sequence;
        internal int Round;
        internal long PlayerId;
        internal string PlayerName;
        internal string HeroName;
        internal int[] OfferedRelicIds;
        internal int ChosenRelicId;
        internal int[] UnchosenRelicIds;
        internal bool IsReroll;
        internal bool IsPending;
        internal bool IsShopBuy;
        internal double UpdatedRealTime;
    }

    internal sealed class EconomyHistoryEntry
    {
        internal int Sequence;
        internal int Round;
        internal long PlayerId;
        internal EconomyEventKind Kind;
        internal ShopVisitRecord ShopVisit;
        internal RelicChoiceRecord RelicChoice;
    }

    internal sealed class PlayerEconomySnapshot
    {
        internal long PlayerId;
        internal string PlayerName;
        internal string HeroName;
        internal readonly List<int> OwnedRelicIds = new List<int>();
        internal int TotalBoughtCards;
        internal int TotalChosenRelics;
        internal int TotalSkippedRelics;
        internal ShopVisitRecord ActiveShopVisit;
        internal RelicChoiceRecord ActiveRelicChoice;
    }

    /// <summary>
    /// Thread-safe, UI-agnostic ledger storing live & round-by-round match history
    /// for shop offers/purchases and relic/chip choices (chosen, unchosen, rerolled).
    /// </summary>
    internal sealed class MatchEconomyLedger
    {
        private readonly object _lock = new object();
        private readonly List<ShopVisitRecord> _shopVisits = new List<ShopVisitRecord>();
        private readonly List<RelicChoiceRecord> _relicChoices = new List<RelicChoiceRecord>();
        private readonly List<EconomyHistoryEntry> _history = new List<EconomyHistoryEntry>();
        private readonly Dictionary<long, PlayerEconomySnapshot> _players = new Dictionary<long, PlayerEconomySnapshot>();
        private readonly Dictionary<long, ShopVisitRecord> _activeShops = new Dictionary<long, ShopVisitRecord>();
        private readonly Dictionary<long, RelicChoiceRecord> _pendingRelics = new Dictionary<long, RelicChoiceRecord>();
        private readonly Dictionary<long, HashSet<int>> _activeBoughtIndices = new Dictionary<long, HashSet<int>>();

        private int _sequence;
        private int _version;

        internal int CurrentRound { get; private set; }
        internal long RoomId { get; private set; }
        internal long StartTime { get; private set; }
        internal int Version
        {
            get { lock (_lock) return _version; }
        }

        internal void Reset(long roomId = 0L, long startTime = 0L)
        {
            lock (_lock)
            {
                RoomId = roomId;
                StartTime = startTime;
                CurrentRound = 1;
                _sequence = 0;
                _shopVisits.Clear();
                _relicChoices.Clear();
                _history.Clear();
                _players.Clear();
                _activeShops.Clear();
                _pendingRelics.Clear();
                _activeBoughtIndices.Clear();
                _version++;
            }
        }

        internal void OnRoundStart(int round)
        {
            if (round <= 0) return;
            lock (_lock)
            {
                if (round > CurrentRound || CurrentRound <= 0)
                {
                    CurrentRound = round;
                    _version++;
                }
            }
        }

        internal void UpsertPlayerMeta(long playerId, string playerName, string heroName, IList<int> ownedRelicIds)
        {
            if (playerId <= 0) return;
            lock (_lock)
            {
                var snap = EnsurePlayerLocked(playerId, playerName, heroName);
                bool changed = false;
                if (ownedRelicIds != null)
                {
                    if (!AreSameIntList(snap.OwnedRelicIds, ownedRelicIds))
                    {
                        snap.OwnedRelicIds.Clear();
                        for (int i = 0; i < ownedRelicIds.Count; i++)
                        {
                            int rid = ownedRelicIds[i];
                            if (rid > 0 && !snap.OwnedRelicIds.Contains(rid))
                            {
                                snap.OwnedRelicIds.Add(rid);
                            }
                        }
                        changed = true;
                    }
                }
                if (changed) _version++;
            }
        }

        internal void OnShopOffer(
            int round,
            long playerId,
            string playerName,
            string heroName,
            string shopKind,
            IList<int> cards,
            IList<bool> alreadys,
            double realNow)
        {
            if (playerId <= 0 || cards == null || cards.Count == 0) return;
            lock (_lock)
            {
                int useRound = ResolveRoundLocked(round);
                var snap = EnsurePlayerLocked(playerId, playerName, heroName);
                int[] offeredCopy = CopyPositiveOrAll(cards);

                if (_activeShops.TryGetValue(playerId, out var existing)
                    && existing.IsActive
                    && existing.ShopKind == shopKind
                    && existing.Round == useRound
                    && AreSameArray(existing.OfferedCardIds, offeredCopy))
                {
                    existing.UpdatedRealTime = realNow;
                    _version++;
                    return;
                }

                // Close previous open shop visit for this player before opening a new one.
                if (existing != null && existing.IsActive)
                {
                    existing.IsActive = false;
                }

                var visit = new ShopVisitRecord
                {
                    Sequence = ++_sequence,
                    Round = useRound,
                    PlayerId = playerId,
                    PlayerName = snap.PlayerName,
                    HeroName = snap.HeroName,
                    ShopKind = string.IsNullOrEmpty(shopKind) ? "商店" : shopKind,
                    OfferedCardIds = offeredCopy,
                    IsActive = true,
                    UpdatedRealTime = realNow,
                };
                var boughtIdxSet = new HashSet<int>();
                if (alreadys != null)
                {
                    for (int i = 0; i < alreadys.Count && i < offeredCopy.Length; i++)
                    {
                        if (alreadys[i]) boughtIdxSet.Add(i);
                    }
                }
                _activeShops[playerId] = visit;
                _activeBoughtIndices[playerId] = boughtIdxSet;
                snap.ActiveShopVisit = visit;
                _shopVisits.Add(visit);
                _history.Add(new EconomyHistoryEntry
                {
                    Sequence = visit.Sequence,
                    Round = useRound,
                    PlayerId = playerId,
                    Kind = EconomyEventKind.ShopVisit,
                    ShopVisit = visit,
                });
                _version++;
            }
        }

        internal void OnShopBuy(
            int round,
            long playerId,
            string playerName,
            string heroName,
            string shopKind,
            IList<int> shelfCards,
            IList<int> buyCards,
            long assistPlayerId,
            IList<bool> alreadys,
            bool isClose,
            double realNow)
        {
            if (playerId <= 0) return;
            lock (_lock)
            {
                int useRound = ResolveRoundLocked(round);
                var snap = EnsurePlayerLocked(playerId, playerName, heroName);
                int[] shelfCopy = shelfCards != null && shelfCards.Count > 0 ? CopyPositiveOrAll(shelfCards) : null;

                ShopVisitRecord visit;
                if (!_activeShops.TryGetValue(playerId, out visit) || visit == null || !visit.IsActive || visit.ShopKind != shopKind)
                {
                    visit = new ShopVisitRecord
                    {
                        Sequence = ++_sequence,
                        Round = useRound,
                        PlayerId = playerId,
                        PlayerName = snap.PlayerName,
                        HeroName = snap.HeroName,
                        ShopKind = string.IsNullOrEmpty(shopKind) ? "商店" : shopKind,
                        OfferedCardIds = shelfCopy ?? new int[0],
                        IsActive = true,
                        UpdatedRealTime = realNow,
                    };
                    _activeShops[playerId] = visit;
                    _activeBoughtIndices[playerId] = new HashSet<int>();
                    snap.ActiveShopVisit = visit;
                    _shopVisits.Add(visit);
                    _history.Add(new EconomyHistoryEntry
                    {
                        Sequence = visit.Sequence,
                        Round = useRound,
                        PlayerId = playerId,
                        Kind = EconomyEventKind.ShopVisit,
                        ShopVisit = visit,
                    });
                }
                else if (shelfCopy != null && shelfCopy.Length > 0 && visit.OfferedCardIds.Length == 0)
                {
                    visit.OfferedCardIds = shelfCopy;
                }

                if (!_activeBoughtIndices.TryGetValue(playerId, out var seenIdx))
                {
                    seenIdx = new HashSet<int>();
                    _activeBoughtIndices[playerId] = seenIdx;
                }

                bool addedBuy = false;
                if (alreadys != null && visit.OfferedCardIds != null && visit.OfferedCardIds.Length > 0)
                {
                    for (int i = 0; i < alreadys.Count && i < visit.OfferedCardIds.Length; i++)
                    {
                        if (alreadys[i] && seenIdx.Add(i))
                        {
                            int cid = visit.OfferedCardIds[i];
                            if (cid > 0)
                            {
                                visit.BoughtCardIds.Add(cid);
                                snap.TotalBoughtCards++;
                                addedBuy = true;
                            }
                        }
                    }
                }
                if (!addedBuy && buyCards != null && buyCards.Count > 0)
                {
                    for (int i = 0; i < buyCards.Count; i++)
                    {
                        int cid = buyCards[i];
                        if (cid > 0)
                        {
                            visit.BoughtCardIds.Add(cid);
                            snap.TotalBoughtCards++;
                        }
                    }
                }

                if (assistPlayerId > 0 && assistPlayerId != playerId && !visit.AssistPlayerIds.Contains(assistPlayerId))
                {
                    visit.AssistPlayerIds.Add(assistPlayerId);
                }
                visit.UpdatedRealTime = realNow;
                if (isClose)
                {
                    visit.IsActive = false;
                    if (snap.ActiveShopVisit == visit) snap.ActiveShopVisit = null;
                }
                _version++;
            }
        }

        internal void OnVendorOffer(int round, long playerId, string playerName, string heroName, int cardId, double realNow)
        {
            if (playerId <= 0 || cardId <= 0) return;
            OnShopOffer(round, playerId, playerName, heroName, "流浪商人", new[] { cardId }, null, realNow);
        }

        internal void OnVendorResult(int round, long playerId, string playerName, string heroName, bool isBuy, double realNow)
        {
            if (playerId <= 0) return;
            lock (_lock)
            {
                var snap = EnsurePlayerLocked(playerId, playerName, heroName);
                if (_activeShops.TryGetValue(playerId, out var visit) && visit != null && visit.ShopKind == "流浪商人")
                {
                    if (isBuy && visit.OfferedCardIds.Length > 0 && visit.BoughtCardIds.Count == 0)
                    {
                        int cid = visit.OfferedCardIds[0];
                        if (cid > 0)
                        {
                            visit.BoughtCardIds.Add(cid);
                            snap.TotalBoughtCards++;
                        }
                    }
                    visit.IsActive = false;
                    visit.UpdatedRealTime = realNow;
                    if (snap.ActiveShopVisit == visit) snap.ActiveShopVisit = null;
                    _version++;
                }
            }
        }

        internal void OnRelicOffer(
            int round,
            long playerId,
            string playerName,
            string heroName,
            IList<int> offeredRelics,
            bool isReroll,
            double realNow)
        {
            if (playerId <= 0 || offeredRelics == null || offeredRelics.Count == 0) return;
            lock (_lock)
            {
                int useRound = ResolveRoundLocked(round);
                var snap = EnsurePlayerLocked(playerId, playerName, heroName);
                int[] offered = CopyUniquePositive(offeredRelics);
                if (offered.Length == 0) return;

                if (_pendingRelics.TryGetValue(playerId, out var prev) && prev != null && prev.IsPending)
                {
                    if (AreSameArray(prev.OfferedRelicIds, offered))
                    {
                        prev.UpdatedRealTime = realNow;
                        _version++;
                        return;
                    }
                    // Previous offer was skipped/rerolled without picking one
                    prev.IsPending = false;
                    prev.IsReroll = true;
                    prev.ChosenRelicId = 0;
                    prev.UnchosenRelicIds = (int[])prev.OfferedRelicIds.Clone();
                    snap.TotalSkippedRelics += prev.UnchosenRelicIds.Length;
                }

                var rec = new RelicChoiceRecord
                {
                    Sequence = ++_sequence,
                    Round = useRound,
                    PlayerId = playerId,
                    PlayerName = snap.PlayerName,
                    HeroName = snap.HeroName,
                    OfferedRelicIds = offered,
                    ChosenRelicId = 0,
                    UnchosenRelicIds = new int[0],
                    IsReroll = isReroll,
                    IsPending = true,
                    IsShopBuy = false,
                    UpdatedRealTime = realNow,
                };
                _pendingRelics[playerId] = rec;
                snap.ActiveRelicChoice = rec;
                _relicChoices.Add(rec);
                _history.Add(new EconomyHistoryEntry
                {
                    Sequence = rec.Sequence,
                    Round = useRound,
                    PlayerId = playerId,
                    Kind = EconomyEventKind.RelicChoice,
                    RelicChoice = rec,
                });
                _version++;
            }
        }

        internal void OnRelicSelect(
            int round,
            long playerId,
            string playerName,
            string heroName,
            int chosenRelicId,
            bool isReroll,
            double realNow)
        {
            if (playerId <= 0) return;
            lock (_lock)
            {
                int useRound = ResolveRoundLocked(round);
                var snap = EnsurePlayerLocked(playerId, playerName, heroName);
                if (_pendingRelics.TryGetValue(playerId, out var pending) && pending != null && pending.IsPending)
                {
                    pending.IsPending = false;
                    pending.UpdatedRealTime = realNow;
                    if (isReroll || chosenRelicId <= 0)
                    {
                        pending.IsReroll = true;
                        pending.ChosenRelicId = 0;
                        pending.UnchosenRelicIds = (int[])pending.OfferedRelicIds.Clone();
                        snap.TotalSkippedRelics += pending.UnchosenRelicIds.Length;
                    }
                    else
                    {
                        pending.ChosenRelicId = chosenRelicId;
                        pending.UnchosenRelicIds = ExcludeOne(pending.OfferedRelicIds, chosenRelicId);
                        snap.TotalChosenRelics++;
                        snap.TotalSkippedRelics += pending.UnchosenRelicIds.Length;
                        if (!snap.OwnedRelicIds.Contains(chosenRelicId))
                        {
                            snap.OwnedRelicIds.Add(chosenRelicId);
                        }
                    }
                    if (snap.ActiveRelicChoice == pending) snap.ActiveRelicChoice = null;
                    _pendingRelics.Remove(playerId);
                    _version++;
                    return;
                }

                if (!isReroll && chosenRelicId > 0)
                {
                    var rec = new RelicChoiceRecord
                    {
                        Sequence = ++_sequence,
                        Round = useRound,
                        PlayerId = playerId,
                        PlayerName = snap.PlayerName,
                        HeroName = snap.HeroName,
                        OfferedRelicIds = new[] { chosenRelicId },
                        ChosenRelicId = chosenRelicId,
                        UnchosenRelicIds = new int[0],
                        IsReroll = false,
                        IsPending = false,
                        IsShopBuy = false,
                        UpdatedRealTime = realNow,
                    };
                    snap.TotalChosenRelics++;
                    if (!snap.OwnedRelicIds.Contains(chosenRelicId)) snap.OwnedRelicIds.Add(chosenRelicId);
                    _relicChoices.Add(rec);
                    _history.Add(new EconomyHistoryEntry
                    {
                        Sequence = rec.Sequence,
                        Round = useRound,
                        PlayerId = playerId,
                        Kind = EconomyEventKind.RelicChoice,
                        RelicChoice = rec,
                    });
                    _version++;
                }
            }
        }

        internal void OnRelicBuy(int round, long playerId, string playerName, string heroName, int relicId, double realNow)
        {
            if (playerId <= 0 || relicId <= 0) return;
            lock (_lock)
            {
                int useRound = ResolveRoundLocked(round);
                var snap = EnsurePlayerLocked(playerId, playerName, heroName);
                var rec = new RelicChoiceRecord
                {
                    Sequence = ++_sequence,
                    Round = useRound,
                    PlayerId = playerId,
                    PlayerName = snap.PlayerName,
                    HeroName = snap.HeroName,
                    OfferedRelicIds = new[] { relicId },
                    ChosenRelicId = relicId,
                    UnchosenRelicIds = new int[0],
                    IsReroll = false,
                    IsPending = false,
                    IsShopBuy = true,
                    UpdatedRealTime = realNow,
                };
                snap.TotalChosenRelics++;
                if (!snap.OwnedRelicIds.Contains(relicId)) snap.OwnedRelicIds.Add(relicId);
                _relicChoices.Add(rec);
                _history.Add(new EconomyHistoryEntry
                {
                    Sequence = rec.Sequence,
                    Round = useRound,
                    PlayerId = playerId,
                    Kind = EconomyEventKind.RelicShopBuy,
                    RelicChoice = rec,
                });
                _version++;
            }
        }

        internal void OnSyncRelics(long playerId, string playerName, string heroName, IList<int> ownedRelicIds)
        {
            UpsertPlayerMeta(playerId, playerName, heroName, ownedRelicIds);
        }

        internal List<PlayerEconomySnapshot> GetPlayerSnapshots()
        {
            lock (_lock)
            {
                var list = new List<PlayerEconomySnapshot>(_players.Count);
                foreach (var kv in _players)
                {
                    var src = kv.Value;
                    var copy = new PlayerEconomySnapshot
                    {
                        PlayerId = src.PlayerId,
                        PlayerName = src.PlayerName,
                        HeroName = src.HeroName,
                        TotalBoughtCards = src.TotalBoughtCards,
                        TotalChosenRelics = src.TotalChosenRelics,
                        TotalSkippedRelics = src.TotalSkippedRelics,
                        ActiveShopVisit = src.ActiveShopVisit,
                        ActiveRelicChoice = src.ActiveRelicChoice,
                    };
                    copy.OwnedRelicIds.AddRange(src.OwnedRelicIds);
                    list.Add(copy);
                }
                return list;
            }
        }

        internal List<EconomyHistoryEntry> GetFilteredHistory(long filterPlayerId, int filterCategory, bool newestFirst = true)
        {
            // filterCategory: 0 = all, 1 = shop visits only, 2 = relics only
            lock (_lock)
            {
                var outList = new List<EconomyHistoryEntry>(_history.Count);
                int start = newestFirst ? _history.Count - 1 : 0;
                int end = newestFirst ? -1 : _history.Count;
                int step = newestFirst ? -1 : 1;
                for (int i = start; i != end; i += step)
                {
                    var item = _history[i];
                    if (filterPlayerId > 0 && item.PlayerId != filterPlayerId) continue;
                    if (filterCategory == 1 && item.Kind != EconomyEventKind.ShopVisit) continue;
                    if (filterCategory == 2 && item.Kind == EconomyEventKind.ShopVisit) continue;
                    outList.Add(item);
                }
                return outList;
            }
        }

        private int ResolveRoundLocked(int round)
        {
            if (round > CurrentRound) CurrentRound = round;
            return round > 0 ? round : Math.Max(1, CurrentRound);
        }

        private PlayerEconomySnapshot EnsurePlayerLocked(long playerId, string playerName, string heroName)
        {
            if (!_players.TryGetValue(playerId, out var snap))
            {
                snap = new PlayerEconomySnapshot
                {
                    PlayerId = playerId,
                    PlayerName = string.IsNullOrEmpty(playerName) ? ("P" + playerId) : playerName,
                    HeroName = heroName ?? "",
                };
                _players[playerId] = snap;
            }
            else
            {
                if (!string.IsNullOrEmpty(playerName) && (string.IsNullOrEmpty(snap.PlayerName) || snap.PlayerName.StartsWith("P")))
                {
                    snap.PlayerName = playerName;
                }
                if (!string.IsNullOrEmpty(heroName))
                {
                    snap.HeroName = heroName;
                }
            }
            return snap;
        }

        private static int[] CopyPositiveOrAll(IList<int> src)
        {
            if (src == null || src.Count == 0) return new int[0];
            var res = new int[src.Count];
            for (int i = 0; i < src.Count; i++) res[i] = src[i];
            return res;
        }

        private static int[] CopyUniquePositive(IList<int> src)
        {
            if (src == null || src.Count == 0) return new int[0];
            var list = new List<int>(src.Count);
            for (int i = 0; i < src.Count; i++)
            {
                if (src[i] > 0 && !list.Contains(src[i])) list.Add(src[i]);
            }
            return list.ToArray();
        }

        private static int[] ExcludeOne(int[] src, int exclude)
        {
            if (src == null || src.Length == 0) return new int[0];
            var list = new List<int>(src.Length);
            bool skipped = false;
            for (int i = 0; i < src.Length; i++)
            {
                if (!skipped && src[i] == exclude)
                {
                    skipped = true;
                    continue;
                }
                if (src[i] > 0) list.Add(src[i]);
            }
            return list.ToArray();
        }

        private static bool AreSameArray(int[] a, int[] b)
        {
            if (a == null || b == null) return a == b;
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++)
            {
                if (a[i] != b[i]) return false;
            }
            return true;
        }

        private static bool AreSameIntList(List<int> a, IList<int> b)
        {
            if (a.Count != b.Count) return false;
            for (int i = 0; i < a.Count; i++)
            {
                if (a[i] != b[i]) return false;
            }
            return true;
        }
    }
}
