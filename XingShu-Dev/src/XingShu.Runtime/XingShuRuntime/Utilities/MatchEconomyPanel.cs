using UnityEngine;
using XingShuRuntime.MatchPort;

namespace XingShuRuntime.Utilities
{
    /// <summary>
    /// Controller shim preserving legacy MatchEconomyPanel entry points while delegating
    /// display directly to the unified StatsWidgetView detailed card mode.
    /// </summary>
    internal static class MatchEconomyPanel
    {
        internal static bool IsVisible => BattleStatsOverlay.IsDetailedMode;

        internal static void Install(GameObject host)
        {
            if (host == null) return;
            MatchProtocolObserver.EnsureInstalled(host);
            try
            {
                AssistBall.RegisterAction(
                    "XingShu.MatchEconomy",
                    "详细对局统计",
                    Toggle,
                    32,
                    "在「对局统计」卡片内一键切换普通/详细模式（商店购牌与筹码历史）",
                    "详细",
                    () => IsVisible);
            }
            catch { }
        }

        internal static void Toggle()
        {
            BattleStatsOverlay.ToggleDetailedMode();
        }

        internal static void SetVisible(bool value)
        {
            BattleStatsOverlay.SetDetailedMode(value);
        }
    }
}
