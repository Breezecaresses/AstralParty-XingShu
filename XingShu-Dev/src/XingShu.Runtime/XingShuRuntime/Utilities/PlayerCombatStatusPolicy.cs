using System;
using System.Text;

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

    internal static void ResolveMoveSpeedBreakdown(
        int extraAddMove,
        int extraMinusMove,
        bool hasServerAddMoveUpdate,
        int additionAttrsMoveSum,
        int appendMovePoint1,
        int appendMovePoint2,
        int buffTempAddMove,
        int baselinePermanentAdd,
        out int permanentNetMove,
        out int tempAddMove)
    {
        int fallbackAdd = Math.Max(0, additionAttrsMoveSum + appendMovePoint1 + appendMovePoint2);
        bool useServer = hasServerAddMoveUpdate || extraAddMove != 0 || extraMinusMove != 0;
        int rawAdd = Math.Max(0, useServer ? extraAddMove : fallbackAdd);
        int rawMinus = Math.Max(0, extraMinusMove);
        int basePerm = Math.Max(0, baselinePermanentAdd);
        int tempBuff = Math.Max(0, buffTempAddMove);

        if (tempBuff > 0)
        {
            if (rawAdd >= basePerm + tempBuff)
            {
                // Server ExtraAddMovePoint already absorbed the buff bonus (+ any unparsed server temp add).
                permanentNetMove = basePerm - rawMinus;
                tempAddMove = rawAdd - basePerm;
            }
            else if (basePerm == 0 && rawAdd >= tempBuff)
            {
                // No separate baseline recorded, yet server ExtraAddMovePoint already carries >= tempBuff.
                tempAddMove = tempBuff;
                permanentNetMove = (rawAdd - tempBuff) - rawMinus;
            }
            else
            {
                // Active skill / card buff is present locally while server ExtraAddMovePoint has not synced yet.
                tempAddMove = tempBuff;
                permanentNetMove = rawAdd - rawMinus;
            }
            return;
        }

        tempAddMove = 0;
        permanentNetMove = rawAdd - rawMinus;
    }

    internal static bool TryExtractBuffTempMoveDelta(
        int buffId,
        int progress,
        int keepRound,
        string name,
        string desc,
        long param0,
        long param1,
        int heroLoveStacks,
        out int moveDelta)
    {
        moveDelta = 0;
        if (buffId <= 0) return false;

        string cleanDesc = StripMarkup(desc);
        string cleanName = StripMarkup(name);

        // Guard against star-upgrade passive text or dice-count buffs (e.g. 移动时投掷2枚骰子).
        if (!string.IsNullOrEmpty(cleanDesc))
        {
            if (cleanDesc.Contains("达到") && cleanDesc.Contains("星时"))
            {
                return false;
            }
            if ((cleanDesc.Contains("投掷") || cleanDesc.Contains("枚骰子"))
                && !cleanDesc.Contains("移动速度+")
                && !cleanDesc.Contains("移动点数+")
                && !cleanDesc.Contains("移速+"))
            {
                return false;
            }
            if (cleanDesc.Contains("每累计") || cleanDesc.Contains("大于等于") || cleanDesc.Contains("小于"))
            {
                return false;
            }
        }

        // Explicit positive "+N" value right after 移动速度 / 移动点数 / 移速 / 移动力.
        if (!string.IsNullOrEmpty(cleanDesc))
        {
            if (TryParseKeywordPlusInt(cleanDesc, "移动速度+", out int keywordVal, out bool perStack)
                || TryParseKeywordPlusInt(cleanDesc, "下次移动速度+", out keywordVal, out perStack)
                || TryParseKeywordPlusInt(cleanDesc, "移动点数+", out keywordVal, out perStack)
                || TryParseKeywordPlusInt(cleanDesc, "移速+", out keywordVal, out perStack)
                || TryParseKeywordPlusInt(cleanDesc, "移动力+", out keywordVal, out perStack))
            {
                if (perStack)
                {
                    int stacks = progress > 0 ? progress : (param0 > 0 && param0 <= 30 ? (int)param0 : 1);
                    moveDelta = ClampSpeedDelta(keywordVal * stacks);
                }
                else
                {
                    moveDelta = ClampSpeedDelta(keywordVal);
                }
                return moveDelta > 0;
            }
        }

        // Dynamic/stack-based speed buff (e.g., 糖糖 active skill 感情过量摄入 30201 / {0} layer buffs).
        bool mentionsSpeedGain = !string.IsNullOrEmpty(cleanDesc) && (
            cleanDesc.Contains("层数的移动速度")
            || cleanDesc.Contains("等量的移动速度")
            || cleanDesc.Contains("移动速度提升")
            || cleanDesc.Contains("移动速度提高")
            || cleanDesc.Contains("移动速度增加")
            || (cleanDesc.Contains("移动速度") && cleanDesc.Contains("+") && !cleanDesc.Contains("移动速度-")));

        if (buffId == 3020101 || (!string.IsNullOrEmpty(cleanName) && cleanName.Contains("感情过量")))
        {
            int val = progress > 0 ? progress : (param0 > 0 && param0 <= 30 ? (int)param0 : heroLoveStacks);
            moveDelta = ClampSpeedDelta(val);
            return moveDelta > 0;
        }

        if (mentionsSpeedGain)
        {
            int val = progress > 0 ? progress : (param0 > 0 && param0 <= 30 ? (int)param0 : (param1 > 0 && param1 <= 30 ? (int)param1 : 0));
            moveDelta = ClampSpeedDelta(val);
            return moveDelta > 0;
        }

        // Fallback if description was stripped to empty/token but name itself denotes speed boost with KeepRound > 0.
        if (keepRound > 0 && progress > 0 && !string.IsNullOrEmpty(cleanName)
            && (cleanName.Contains("疾行") || cleanName.Contains("加速") || cleanName.Contains("移速"))
            && !cleanName.Contains("减") && !cleanName.Contains("迟缓"))
        {
            moveDelta = ClampSpeedDelta(progress);
            return moveDelta > 0;
        }

        return false;
    }

    internal static string FormatMoveSpeedToken(int extraMove)
    {
        return FormatMoveSpeedToken(extraMove, 0);
    }

    internal static string FormatMoveSpeedToken(int permanentNetMove, int tempAddMove)
    {
        int temp = Math.Max(0, tempAddMove);
        if (permanentNetMove == 0 && temp == 0)
        {
            return "";
        }
        if (temp == 0)
        {
            if (permanentNetMove > 0)
            {
                return "[color=#7CFF9B]移速+" + permanentNetMove + "[/color]";
            }
            return "[color=#FF8DA1]移速" + permanentNetMove + "[/color]";
        }

        var sb = new StringBuilder(48);
        sb.Append("移速");
        if (permanentNetMove > 0)
        {
            sb.Append("[color=#7CFF9B]+").Append(permanentNetMove).Append("[/color]");
        }
        else if (permanentNetMove < 0)
        {
            sb.Append("[color=#FF8DA1]").Append(permanentNetMove).Append("[/color]");
        }
        // Match the light-blue buffed ATK/DEF accent (#82D8FF) for temporary move speed bonuses.
        sb.Append("[color=#82D8FF]+").Append(temp).Append("[/color]");
        return sb.ToString();
    }

    private static int ClampSpeedDelta(int value)
    {
        if (value <= 0) return 0;
        return value > 30 ? 30 : value;
    }

    private static bool TryParseKeywordPlusInt(string text, string keyword, out int value, out bool isPerStack)
    {
        value = 0;
        isPerStack = false;
        int start = 0;
        while (start < text.Length)
        {
            int idx = text.IndexOf(keyword, start, StringComparison.Ordinal);
            if (idx < 0) return false;
            int numStart = idx + keyword.Length;
            while (numStart < text.Length && text[numStart] == ' ') numStart++;
            int numEnd = numStart;
            while (numEnd < text.Length && text[numEnd] >= '0' && text[numEnd] <= '9') numEnd++;
            if (numEnd > numStart && int.TryParse(text.Substring(numStart, numEnd - numStart), out int parsed) && parsed > 0)
            {
                int lookbackStart = Math.Max(0, idx - 24);
                string prefix = text.Substring(lookbackStart, idx - lookbackStart);
                isPerStack = prefix.Contains("每层");
                value = parsed;
                return true;
            }
            start = idx + keyword.Length;
        }
        return false;
    }

    internal static string StripMarkup(string raw)
    {
        if (string.IsNullOrEmpty(raw)) return "";
        if (raw.IndexOf('[') < 0) return raw;
        var sb = new StringBuilder(raw.Length);
        bool inTag = false;
        for (int i = 0; i < raw.Length; i++)
        {
            char c = raw[i];
            if (c == '[')
            {
                inTag = true;
                continue;
            }
            if (c == ']' && inTag)
            {
                inTag = false;
                continue;
            }
            if (!inTag)
            {
                sb.Append(c);
            }
        }
        return sb.ToString();
    }
}
}
