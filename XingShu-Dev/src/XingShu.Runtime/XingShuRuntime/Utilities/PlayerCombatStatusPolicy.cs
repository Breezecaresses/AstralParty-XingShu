namespace XingShuRuntime.Utilities
{
internal static class PlayerCombatStatusPolicy
{
    /// <summary>
    /// Resolves effective extra movement speed bonus/penalty from BattleProperty sync fields
    /// with fallback to initial/reconnected Hero attributes before the first HeroAddMoveChangeS2C push.
    /// </summary>
    internal static int ResolveExtraMoveSpeed(
        int extraAddMove,
        int extraMinusMove,
        bool hasServerAddMoveUpdate,
        int additionAttrsMoveSum,
        int appendMovePoint1,
        int appendMovePoint2)
    {
        if (hasServerAddMoveUpdate || extraAddMove != 0 || extraMinusMove != 0)
        {
            return extraAddMove - extraMinusMove;
        }
        return additionAttrsMoveSum + appendMovePoint1 + appendMovePoint2;
    }

    internal static string FormatMoveSpeedToken(int extraMove)
    {
        if (extraMove > 0)
        {
            return "[color=#7CFF9B]移速+" + extraMove + "[/color]";
        }
        if (extraMove < 0)
        {
            return "[color=#FF8DA1]移速" + extraMove + "[/color]";
        }
        return "";
    }
}
}
