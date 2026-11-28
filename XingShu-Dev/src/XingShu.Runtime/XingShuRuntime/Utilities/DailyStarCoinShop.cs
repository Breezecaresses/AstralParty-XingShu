using UnityEngine;

namespace XingShuRuntime.Utilities;

/// <summary>
/// Legacy compatibility facade: all daily free &amp; star-coin shop purchases are now
/// executed inside standalone LazyHelperRuntime (`lazy-helper`).
/// </summary>
internal static class DailyStarCoinShop
{
    internal static bool IsEnabled => LazyHelperRuntime.IsMasterEnabled && LazyHelperRuntime.IsStarCoinShopEnabled;
    internal static bool CanConfigure => LazyHelperRuntime.CanConfigure;
    internal static string Status => LazyHelperRuntime.Status;
    public static void Install(GameObject host) => LazyHelperRuntime.Install(host);
    internal static void SetEnabled(bool enabled) => LazyHelperRuntime.SetSubToggle(LazyHelperPolicy.KeyStarCoinShop, enabled);
}
