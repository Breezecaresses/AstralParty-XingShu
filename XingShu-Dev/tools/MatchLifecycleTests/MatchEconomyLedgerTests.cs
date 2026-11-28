using System;
using XingShuRuntime.MatchPort;

class MatchEconomyLedgerTests
{
    static void Check(bool ok, string name)
    {
        if (!ok) throw new Exception("FAIL: " + name);
        Console.WriteLine("PASS " + name);
    }

    static void Main()
    {
        var ledger = new MatchEconomyLedger();
        ledger.Reset(9001, 123456);
        ledger.OnRoundStart(2);

        // 1. PVE shop offer + incremental buys + assist payer + close
        ledger.OnShopOffer(2, 101, "猫耳", "米米", "PVE商店", new[] { 2001, 2002, 2003, 2004 }, new[] { false, false, false, false }, 10.0);
        ledger.OnShopBuy(2, 101, "猫耳", "米米", "PVE商店", new[] { 2001, 2002, 2003, 2004 }, new[] { 2002 }, 102, new[] { false, true, false, false }, false, 11.0);
        ledger.OnShopBuy(2, 101, "猫耳", "米米", "PVE商店", new[] { 2001, 2002, 2003, 2004 }, new[] { 2002, 2004 }, 0, new[] { false, true, false, true }, true, 12.0);

        var snaps = ledger.GetPlayerSnapshots();
        Check(snaps.Count == 1 && snaps[0].TotalBoughtCards == 2, "incremental shop purchases deduplicated cleanly to 2 cards");
        Check(snaps[0].ActiveShopVisit == null, "closing shop clears active offer");

        // 2. Relic 3-choice: offer -> reroll -> offer -> choose
        ledger.OnRelicOffer(3, 102, "队友B", "芬妮", new[] { 50001, 50002, 50003 }, false, 20.0);
        var pendingSnaps = ledger.GetPlayerSnapshots();
        var pB = pendingSnaps.Find(x => x.PlayerId == 102);
        Check(pB != null && pB.ActiveRelicChoice != null && pB.ActiveRelicChoice.IsPending, "pending relic offer visible live");

        ledger.OnRelicSelect(3, 102, "队友B", "芬妮", 0, true, 21.0);
        ledger.OnRelicOffer(3, 102, "队友B", "芬妮", new[] { 50010, 50011, 50027 }, true, 22.0);
        ledger.OnRelicSelect(3, 102, "队友B", "芬妮", 50027, false, 23.0);

        var history = ledger.GetFilteredHistory(0, 0, true);
        Check(history.Count == 3, "history contains 1 shop visit + 1 rerolled chip choice + 1 picked chip choice");
        Check(history[0].RelicChoice.ChosenRelicId == 50027 && history[0].RelicChoice.UnchosenRelicIds.Length == 2,
            "chosen chip 50027 and 2 unchosen chips recorded");
        Check(history[1].RelicChoice.IsReroll && history[1].RelicChoice.UnchosenRelicIds.Length == 3,
            "rerolled offer records all 3 skipped chips");

        // 3. Vendor offer & skip
        ledger.OnVendorOffer(4, 101, "猫耳", "米米", 2099, 30.0);
        ledger.OnVendorResult(4, 101, "猫耳", "米米", false, 31.0);
        var shopOnly = ledger.GetFilteredHistory(101, 1, true);
        Check(shopOnly.Count == 2 && shopOnly[0].ShopVisit.ShopKind == "流浪商人" && shopOnly[0].ShopVisit.BoughtCardIds.Count == 0,
            "vendor skip recorded with offered card and 0 bought");
    }
}
