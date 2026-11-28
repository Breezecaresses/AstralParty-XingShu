using System;
using System.Collections.Generic;
using XingShuRuntime.Utilities;

internal static class LazyHelperPolicyTests
{
    private static int _checks;
    private static int _failed;

    private static void Check(bool condition, string message)
    {
        _checks++;
        if (!condition)
        {
            _failed++;
            Console.WriteLine("FAIL: " + message);
        }
        else
        {
            Console.WriteLine("PASS: " + message);
        }
    }

    private static int Main()
    {
        // 1. Chest filter strictly blocks optional chests
        Check(!LazyHelperPolicy.CanAutoOpenChest(true, true, true, 0, 5),
            "IsOptional=true chest is strictly rejected");
        Check(!LazyHelperPolicy.CanAutoOpenChest(true, true, false, 3, 5),
            "OptionalReward.Count > 0 chest is strictly rejected");
        Check(!LazyHelperPolicy.CanAutoOpenChest(false, true, false, 0, 5),
            "non-Chest item type is rejected");
        Check(!LazyHelperPolicy.CanAutoOpenChest(true, false, false, 0, 5),
            "invalid/expired item is rejected");
        Check(!LazyHelperPolicy.CanAutoOpenChest(true, true, false, 0, 0),
            "0 owned count is rejected");
        Check(LazyHelperPolicy.CanAutoOpenChest(true, true, false, 0, 3),
            "valid pure random chest is accepted");

        var chestList = new List<LazyHelperPolicy.ChestCandidate>
        {
            new LazyHelperPolicy.ChestCandidate { DefId = 1001, Name = "自选箱", IsChestType = true, IsValidItem = true, IsOptional = true, OptionalRewardCount = 4, OwnedCount = 2, UseMax = 10 },
            new LazyHelperPolicy.ChestCandidate { DefId = 1002, Name = "随机箱", IsChestType = true, IsValidItem = true, IsOptional = false, OptionalRewardCount = 0, OwnedCount = 25, UseMax = 10 },
        };
        var picked = LazyHelperPolicy.NextRandomChest(chestList);
        Check(picked != null && picked.DefId == 1002, "NextRandomChest skips optional chest and picks random chest");
        Check(LazyHelperPolicy.ComputeChestOpenBatch(25, 10) == 10, "batch clamps to UseMax=10");
        Check(LazyHelperPolicy.ComputeChestOpenBatch(4, 0) == 4, "batch uses owned count when UseMax=0 and <=10");

        // 2. Shop filter respects independent free / star-coin switches and never picks paid currencies
        var offers = new List<DailyStarCoinShopPolicy.Offer>
        {
            new DailyStarCoinShopPolicy.Offer { Id = 1, Currency = 1, Price = 500, Limit = 1, Purchased = 0, Owned = false },
            new DailyStarCoinShopPolicy.Offer { Id = 2, Currency = 1, Price = 0, Limit = 1, Purchased = 0, Owned = false },
            new DailyStarCoinShopPolicy.Offer { Id = 3, Currency = 2, Price = 100, Limit = 1, Purchased = 0, Owned = false },
        };
        var pickFreeOnly = LazyHelperPolicy.NextShopOffer(offers, 1000, allowFree: true, allowStarCoin: false, out _);
        Check(pickFreeOnly != null && pickFreeOnly.Id == 2, "free-only picks free offer first");
        offers[1].Purchased = 1;
        Check(LazyHelperPolicy.NextShopOffer(offers, 1000, allowFree: true, allowStarCoin: false, out _) == null,
            "free-only never buys star-coin or paid currency offers");
        var pickCoin = LazyHelperPolicy.NextShopOffer(offers, 1000, allowFree: false, allowStarCoin: true, out _);
        Check(pickCoin != null && pickCoin.Id == 1, "star-coin picks currency=1 item");

        // 3. Legacy DailyStarCoinShop toggle migration per account
        LazyHelperPolicy.ResolveMigratedDefaults(
            hasSavedMaster: false, savedMaster: false,
            hasSavedStarCoin: false, savedStarCoin: false,
            hasLegacyStarCoin: true, legacyStarCoinEnabled: true,
            out bool mEnabled, out bool sEnabled, out bool migrated);
        Check(migrated && mEnabled && sEnabled, "legacy enabled star-coin user migrates to enabled LazyHelper");

        LazyHelperPolicy.ResolveMigratedDefaults(
            hasSavedMaster: true, savedMaster: false,
            hasSavedStarCoin: false, savedStarCoin: false,
            hasLegacyStarCoin: true, legacyStarCoinEnabled: true,
            out mEnabled, out sEnabled, out migrated);
        Check(!migrated && !mEnabled, "explicit master=false is respected and does not re-migrate");

        Console.WriteLine($"LazyHelperPolicyTests: {_checks} checks, {_failed} failed.");
        return _failed == 0 ? 0 : 1;
    }
}
