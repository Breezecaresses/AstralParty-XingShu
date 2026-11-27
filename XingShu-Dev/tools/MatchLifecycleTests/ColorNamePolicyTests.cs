using System;
using XingShuRuntime.Social;

internal static class ColorNamePolicyTests
{
    private static int _checks;

    private static void Check(bool condition, string name)
    {
        if (!condition) throw new Exception("Test failed: " + name);
        _checks++;
    }

    public static int Main()
    {
        try
        {
            return RunAll();
        }
        catch (Exception ex)
        {
            Console.WriteLine("EXCEPTION: " + ex.GetType().FullName + " :: " + ex.Message);
            return 1;
        }
    }

    private static int RunAll()
    {
        // 1. Plain brackets vs rich tags
        Check(!ColorNamePolicy.ContainsRichTags("[萌新]张三"), "plain bracket tag is NOT mistaken for rich tag");
        Check(!ColorNamePolicy.ContainsRichTags("【Bot2】"), "bot bracket is NOT rich tag");
        Check(ColorNamePolicy.ContainsRichTags("[color=#FF69B4]猫耳[/color]"), "color UBB tag detected");
        Check(ColorNamePolicy.ContainsRichTags("[color=#FF69B4,#66CCFF]双色[/color]"), "gradient color UBB tag detected");
        Check(ColorNamePolicy.ContainsRichTags("[color=#FF69B"), "dangling partial tag detected");

        // 2. StripRichTags preserves plain brackets and drops dangling fragments
        Check(ColorNamePolicy.StripRichTags("[color=#FF69B4]古明地猫耳[/color]") == "古明地猫耳", "strips UBB color tags");
        Check(ColorNamePolicy.StripRichTags("[萌新]张三[/col") == "[萌新]张三", "keeps plain brackets and drops dangling fragment");

        // 3. Battle strip truncation preserves UBB tags and closes open tags cleanly
        string longRich = "[color=#FF69B4]一二三四五六七八[/color]";
        string truncated = ColorNamePolicy.TruncatePreservingUbb(longRich, 14);
        Check(truncated == "[color=#FF69B4]一二三四五六七[/color]", "14 visual units keeps 7 CJK chars and closes [/color]: got " + truncated);

        string multiRich = "[b][color=#FF0000]Abcd[/color][color=#00FF00]一二三四五六[/color][/b]";
        string multiTrunc = ColorNamePolicy.TruncatePreservingUbb(multiRich, 14);
        Check(multiTrunc.StartsWith("[b][color=#FF0000]Abcd[/color][color=#00FF00]一二三四五", StringComparison.Ordinal)
            && multiTrunc.EndsWith("[/color][/b]", StringComparison.Ordinal),
            "multi-tag truncation keeps 4 ASCII + 5 CJK = 14 units and closes both color & b tags: got " + multiTrunc);

        // 4. Unity UI Text conversion (Battle Stats widget)
        Check(ColorNamePolicy.FormatForUnityRichText("一二三四五六七八", 7) == "一二三四五六…", "plain name preserves 6+ellipsis rule");
        Check(ColorNamePolicy.FormatForUnityRichText("[color=#FF69B4]猫耳[/color]", 7) == "<color=#FF69B4>猫耳</color>", "single color converts to Unity <color>");
        string unityGrad = ColorNamePolicy.FormatForUnityRichText("[color=#FF0000,#0000FF]红蓝渐变名字太长[/color]", 7);
        Check(unityGrad.Contains("<color=#FF0000>红</color>") && unityGrad.Contains("…"), "multi-stop gradient converts per char and truncates cleanly: " + unityGrad);

        // 5. All 5 animated gradient presets return valid cyclic corner colors
        for (int p = 0; p < ColorNamePolicy.PresetNames.Length; p++)
        {
            byte r0, g0, b0, r1, g1, b1, r2, g2, b2, r3, g3, b3;
            ColorNamePolicy.EvaluatePresetCorners(p, 0.25, out r0, out g0, out b0, out r1, out g1, out b1, out r2, out g2, out b2, out r3, out g3, out b3);
            Check((r0 | g0 | b0) != 0 && (r2 | g2 | b2) != 0, "preset " + p + " produces bright colors");
        }

        Console.WriteLine("PASS: " + _checks + " color name policy checks");
        return 0;
    }
}
