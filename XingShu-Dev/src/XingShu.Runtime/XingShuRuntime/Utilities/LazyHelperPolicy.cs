using System;
using System.Collections.Generic;

namespace XingShuRuntime.Utilities;

/// <summary>
/// Pure-C# policies for LazyHelperRuntime (懒人助手):
/// - Safe chest filtering (NEVER open optional/selectable chests)
/// - Lobby shop filtering (free items + star-coin-only items)
/// - Per-account config key construction & legacy DailyStarCoinShop migration
/// </summary>
internal static class LazyHelperPolicy
{
    internal const string KeyMaster = "ENABLED";
    internal const string KeyFreeShop = "FREE_SHOP";
    internal const string KeyStarCoinShop = "STARCOIN_SHOP";
    internal const string KeyTasks = "TASKS";
    internal const string KeyPasses = "PASSES";
    internal const string KeyMail = "MAIL";
    internal const string KeyChests = "CHESTS";
    internal const string KeyActivities = "ACTIVITIES";

    internal sealed class ChestCandidate
    {
        internal int DefId;
        internal string Name;
        internal bool IsChestType;
        internal bool IsValidItem;
        internal bool IsOptional;
        internal int OptionalRewardCount;
        internal int OwnedCount;
        internal int UseMax;
    }

    internal static bool CanAutoOpenChest(
        bool isChestType,
        bool isValidItem,
        bool isOptional,
        int optionalRewardCount,
        int ownedCount)
    {
        return isChestType &&
               isValidItem &&
               !isOptional &&
               optionalRewardCount == 0 &&
               ownedCount > 0;
    }

    internal static bool CanAutoOpenChest(ChestCandidate chest)
    {
        return chest != null &&
               chest.DefId > 0 &&
               CanAutoOpenChest(
                   chest.IsChestType,
                   chest.IsValidItem,
                   chest.IsOptional,
                   chest.OptionalRewardCount,
                   chest.OwnedCount);
    }

    internal static int ComputeChestOpenBatch(int ownedCount, int useMax)
    {
        if (ownedCount <= 0) return 0;
        int cap = useMax > 0 ? useMax : 10;
        return Math.Min(ownedCount, Math.Max(1, cap));
    }

    internal static ChestCandidate NextRandomChest(IList<ChestCandidate> chests)
    {
        if (chests == null) return null;
        for (int i = 0; i < chests.Count; i++)
        {
            var chest = chests[i];
            if (CanAutoOpenChest(chest)) return chest;
        }
        return null;
    }

    internal static DailyStarCoinShopPolicy.Offer NextShopOffer(
        IList<DailyStarCoinShopPolicy.Offer> offers,
        long starCoinBalance,
        bool allowFree,
        bool allowStarCoin,
        out bool budgetShort)
    {
        budgetShort = false;
        if (offers == null || (!allowFree && !allowStarCoin)) return null;

        // Pass 0: free items (Price == 0); Pass 1: star-coin items (Currency == 1 && Price > 0).
        for (int pass = 0; pass < 2; pass++)
        {
            if (pass == 0 && !allowFree) continue;
            if (pass == 1 && !allowStarCoin) continue;

            for (int i = 0; i < offers.Count; i++)
            {
                var offer = offers[i];
                if (offer == null || !offer.Eligible || offer.Remaining <= 0) continue;
                bool isFree = offer.Price == 0;
                if (isFree != (pass == 0)) continue;

                long cost = checked((long)offer.Price * offer.Remaining);
                if (cost <= Math.Max(0L, starCoinBalance)) return offer;
                budgetShort = true;
            }
        }
        return null;
    }

    internal static string AccountConfigKey(long playerId, string subKey)
    {
        return "XINGSHU_LAZY_HELPER_" + playerId.ToString(System.Globalization.CultureInfo.InvariantCulture) + "_" + subKey;
    }

    internal static string LegacyStarCoinEnabledKey(long playerId)
    {
        return "XINGSHU_DAILY_STARCOIN_" + playerId.ToString(System.Globalization.CultureInfo.InvariantCulture) + "_ENABLED";
    }

    internal static void ResolveMigratedDefaults(
        bool hasSavedMaster,
        bool savedMaster,
        bool hasSavedStarCoin,
        bool savedStarCoin,
        bool hasLegacyStarCoin,
        bool legacyStarCoinEnabled,
        out bool masterEnabled,
        out bool starCoinEnabled,
        out bool migratedFromLegacy)
    {
        migratedFromLegacy = !hasSavedMaster && !hasSavedStarCoin && hasLegacyStarCoin && legacyStarCoinEnabled;
        if (migratedFromLegacy)
        {
            masterEnabled = true;
            starCoinEnabled = true;
            return;
        }
        masterEnabled = hasSavedMaster && savedMaster;
        starCoinEnabled = hasSavedStarCoin && savedStarCoin;
    }
}
