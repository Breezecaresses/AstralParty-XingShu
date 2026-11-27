using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

namespace XingShuRuntime.Social
{
    /// <summary>
    /// Pure helper for parsing, tag-safe truncation, Unity rich-text conversion,
    /// and animated 4-corner gradient evaluation of player nicknames.
    /// </summary>
    internal static class ColorNamePolicy
    {
        internal static readonly string[] PresetNames =
        {
            "星虹流光",
            "星樱绯紫",
            "极光青蓝",
            "鎏金琥珀",
            "冰莓双色",
        };

        private static readonly string[] KnownUbbTags =
        {
            "color", "gradient", "size", "font", "align", "url", "img", "b", "i", "u", "s", "strike", "sup", "sub"
        };

        private static readonly Regex UbbOrHtmlTagRegex = new Regex(
            @"\[/?(?:color|gradient|size|font|align|url|img|b|i|u|s|strike|sup|sub)(?:=[^\]]*)?\]|</?(?:color|b|i|size|material|quad|u|s|strike|font)(?:=[^>]*)?>",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static readonly Regex TokenRegex = new Regex(
            @"\[(?<close>/)?(?<tag>color|gradient|size|font|align|url|img|b|i|u|s|strike|sup|sub)(?:=(?<val>[^\]]*))?\]",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static readonly Regex HexColorTokenRegex = new Regex(
            @"^#?(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$",
            RegexOptions.Compiled);

        internal static bool ContainsRichTags(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return false;
            return UbbOrHtmlTagRegex.IsMatch(raw) || FindPartialTailStart(raw) >= 0;
        }

        internal static string StripRichTags(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return string.Empty;
            string s = UbbOrHtmlTagRegex.Replace(raw, string.Empty);
            int tail = FindPartialTailStart(s);
            if (tail >= 0) s = s.Substring(0, tail);
            return s.Trim();
        }

        private static int FindPartialTailStart(string s)
        {
            if (string.IsNullOrEmpty(s)) return -1;
            int lastClose = Math.Max(s.LastIndexOf(']'), s.LastIndexOf('>'));
            int open = s.IndexOf('[', lastClose + 1);
            if (open < 0) open = s.IndexOf('<', lastClose + 1);
            if (open < 0) return -1;

            char openChar = s[open];
            int i = open + 1;
            if (i >= s.Length) return open; // trailing "[" or "<"

            bool hasSlash = s[i] == '/';
            if (hasSlash) i++;
            if (i >= s.Length) return open; // trailing "[/" or "</"

            int wordStart = i;
            while (i < s.Length && ((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z')))
            {
                i++;
            }
            string word = s.Substring(wordStart, i - wordStart).ToLowerInvariant();
            if (word.Length == 0) return -1;

            bool atEnd = i == s.Length;
            bool hasEquals = !atEnd && s[i] == '=';

            for (int t = 0; t < KnownUbbTags.Length; t++)
            {
                string tag = KnownUbbTags[t];
                if (openChar == '<' && tag != "color" && tag != "b" && tag != "i" && tag != "size" && tag != "font" && tag != "u" && tag != "s" && tag != "strike")
                {
                    continue;
                }
                if (hasEquals && string.Equals(tag, word, StringComparison.Ordinal))
                {
                    return open;
                }
                if (atEnd && tag.StartsWith(word, StringComparison.Ordinal))
                {
                    if (hasSlash || word.Length >= 3 || string.Equals(tag, word, StringComparison.Ordinal))
                    {
                        return open;
                    }
                }
            }
            return -1;
        }

        internal static string TruncatePreservingUbb(string raw, int maxVisualUnits)
        {
            if (string.IsNullOrEmpty(raw) || maxVisualUnits <= 0) return string.Empty;
            if (!ContainsRichTags(raw))
            {
                return TruncatePlainByUnits(raw, maxVisualUnits);
            }

            // Strip any dangling broken tail tag before parsing complete UBB spans.
            int tail = FindPartialTailStart(raw);
            string cleaned = tail >= 0 ? raw.Substring(0, tail) : raw;
            var sb = new StringBuilder(cleaned.Length + 16);
            var openTags = new List<string>(4);
            int units = 0;
            int idx = 0;

            MatchCollection matches = TokenRegex.Matches(cleaned);
            for (int m = 0; m < matches.Count; m++)
            {
                Match match = matches[m];
                if (match.Index > idx)
                {
                    if (!AppendPlainSliceByUnits(cleaned, idx, match.Index, maxVisualUnits, ref units, sb))
                    {
                        AppendClosingTags(sb, openTags);
                        return sb.ToString();
                    }
                }

                string tag = match.Groups["tag"].Value.ToLowerInvariant();
                bool isClose = match.Groups["close"].Success;
                sb.Append(match.Value);
                if (isClose)
                {
                    RemoveLastMatchingTag(openTags, tag);
                }
                else if (IsSelfContainedTag(tag) == false)
                {
                    openTags.Add(tag);
                }

                idx = match.Index + match.Length;
            }

            if (idx < cleaned.Length)
            {
                AppendPlainSliceByUnits(cleaned, idx, cleaned.Length, maxVisualUnits, ref units, sb);
            }

            AppendClosingTags(sb, openTags);
            return sb.ToString();
        }

        internal static string FormatForUnityRichText(string raw, int maxVisibleChars)
        {
            if (string.IsNullOrEmpty(raw)) return "—";
            string normalized = raw.Replace('\n', ' ').Replace('\r', ' ');
            if (!ContainsRichTags(normalized))
            {
                return TruncatePlainCharsWithEllipsis(normalized, maxVisibleChars);
            }

            int tail = FindPartialTailStart(normalized);
            string cleaned = tail >= 0 ? normalized.Substring(0, tail) : normalized;
            string plain = StripRichTags(cleaned);
            if (string.IsNullOrEmpty(plain)) return "—";

            int totalVisible = CountVisibleChars(plain);
            int cap = maxVisibleChars <= 0 ? int.MaxValue : (totalVisible > maxVisibleChars ? Math.Max(1, maxVisibleChars - 1) : totalVisible);
            bool needEllipsis = maxVisibleChars > 0 && totalVisible > maxVisibleChars;

            var sb = new StringBuilder(cleaned.Length + 32);
            var openHtmlTags = new List<string>(4);
            string[] activeGradientStops = null;
            int gradCharIdx = 0;
            int gradSpanVisibleTotal = Math.Max(1, cap);

            int visibleWritten = 0;
            int idx = 0;
            MatchCollection matches = TokenRegex.Matches(cleaned);
            for (int m = 0; m < matches.Count && visibleWritten < cap; m++)
            {
                Match match = matches[m];
                if (match.Index > idx)
                {
                    AppendUnityStyledSlice(cleaned, idx, match.Index, cap, ref visibleWritten, ref gradCharIdx, gradSpanVisibleTotal, activeGradientStops, sb);
                }
                if (visibleWritten >= cap)
                {
                    break;
                }

                string tag = match.Groups["tag"].Value.ToLowerInvariant();
                bool isClose = match.Groups["close"].Success;
                if (tag == "b" || tag == "i")
                {
                    if (!isClose)
                    {
                        sb.Append('<').Append(tag).Append('>');
                        openHtmlTags.Add(tag);
                    }
                    else if (RemoveLastMatchingTag(openHtmlTags, tag))
                    {
                        sb.Append("</").Append(tag).Append('>');
                    }
                }
                else if (tag == "color")
                {
                    if (!isClose)
                    {
                        string[] stops = ParseColorStops(match.Groups["val"].Value);
                        if (stops.Length == 1)
                        {
                            activeGradientStops = null;
                            sb.Append("<color=").Append(stops[0]).Append('>');
                            openHtmlTags.Add("color");
                        }
                        else if (stops.Length >= 2)
                        {
                            // Render multi-stop UBB gradient via per-character <color=#RRGGBB> interpolation.
                            activeGradientStops = stops;
                            gradCharIdx = 0;
                            gradSpanVisibleTotal = Math.Max(1, EstimateSpanVisibleChars(cleaned, match.Index + match.Length, cap - visibleWritten));
                        }
                    }
                    else
                    {
                        activeGradientStops = null;
                        if (RemoveLastMatchingTag(openHtmlTags, "color"))
                        {
                            sb.Append("</color>");
                        }
                    }
                }
                else if (tag == "gradient")
                {
                    if (!isClose)
                    {
                        string[] stops = ParseColorStops(match.Groups["val"].Value);
                        if (stops.Length >= 2)
                        {
                            activeGradientStops = stops;
                            gradCharIdx = 0;
                            gradSpanVisibleTotal = Math.Max(1, EstimateSpanVisibleChars(cleaned, match.Index + match.Length, cap - visibleWritten));
                        }
                    }
                    else
                    {
                        activeGradientStops = null;
                    }
                }

                idx = match.Index + match.Length;
            }

            if (visibleWritten < cap && idx < cleaned.Length)
            {
                AppendUnityStyledSlice(cleaned, idx, cleaned.Length, cap, ref visibleWritten, ref gradCharIdx, gradSpanVisibleTotal, activeGradientStops, sb);
            }

            if (needEllipsis)
            {
                if (activeGradientStops != null && activeGradientStops.Length >= 2)
                {
                    string hex = SampleGradientHex(activeGradientStops, 1f);
                    sb.Append("<color=").Append(hex).Append(">…</color>");
                }
                else
                {
                    sb.Append('…');
                }
            }

            for (int k = openHtmlTags.Count - 1; k >= 0; k--)
            {
                sb.Append("</").Append(openHtmlTags[k]).Append('>');
            }
            return sb.ToString();
        }

        internal static void EvaluatePresetCorners(
            int preset,
            double phase01,
            out byte r0, out byte g0, out byte b0,
            out byte r1, out byte g1, out byte b1,
            out byte r2, out byte g2, out byte b2,
            out byte r3, out byte g3, out byte b3)
        {
            double p = phase01 - Math.Floor(phase01);
            // FairyGUI fill order: [0]=TL, [1]=BL, [2]=TR, [3]=BR
            EvalColorAt(preset, p, out r0, out g0, out b0);
            EvalColorAt(preset, p + 0.08d, out r1, out g1, out b1);
            EvalColorAt(preset, p + 0.34d, out r2, out g2, out b2);
            EvalColorAt(preset, p + 0.42d, out r3, out g3, out b3);
        }

        private static void EvalColorAt(int preset, double t, out byte r, out byte g, out byte b)
        {
            double u = t - Math.Floor(t);
            switch (preset)
            {
                case 1: // 星樱绯紫
                    SampleStops(u,
                        0xff, 0x77, 0xb7,
                        0xf4, 0x92, 0xf0,
                        0xb5, 0x89, 0xff,
                        0xff, 0xa8, 0xd8,
                        out r, out g, out b);
                    return;
                case 2: // 极光青蓝
                    SampleStops(u,
                        0x56, 0xf3, 0xc8,
                        0x4f, 0xd1, 0xff,
                        0x7a, 0xa2, 0xff,
                        0x9f, 0xf7, 0xe8,
                        out r, out g, out b);
                    return;
                case 3: // 鎏金琥珀
                    SampleStops(u,
                        0xff, 0xe0, 0x66,
                        0xff, 0xa9, 0x4d,
                        0xff, 0x7b, 0x89,
                        0xff, 0xf3, 0xb0,
                        out r, out g, out b);
                    return;
                case 4: // 冰莓双色
                    SampleStops(u,
                        0x67, 0xe8, 0xf9,
                        0xc0, 0x84, 0xfc,
                        0xf4, 0x72, 0xb6,
                        0x93, 0xc5, 0xfd,
                        out r, out g, out b);
                    return;
                default: // 0 星虹流光
                    HsvToRgb(u, 0.72d, 1.0d, out r, out g, out b);
                    return;
            }
        }

        private static void SampleStops(
            double u,
            byte r0, byte g0, byte b0,
            byte r1, byte g1, byte b1,
            byte r2, byte g2, byte b2,
            byte r3, byte g3, byte b3,
            out byte r, out byte g, out byte b)
        {
            double scaled = u * 4.0d;
            int idx = ((int)Math.Floor(scaled)) & 3;
            double frac = scaled - Math.Floor(scaled);
            byte ar, ag, ab, br, bg, bb;
            switch (idx)
            {
                case 0: ar = r0; ag = g0; ab = b0; br = r1; bg = g1; bb = b1; break;
                case 1: ar = r1; ag = g1; ab = b1; br = r2; bg = g2; bb = b2; break;
                case 2: ar = r2; ag = g2; ab = b2; br = r3; bg = g3; bb = b3; break;
                default: ar = r3; ag = g3; ab = b3; br = r0; bg = g0; bb = b0; break;
            }
            r = (byte)Math.Round(ar + (br - ar) * frac);
            g = (byte)Math.Round(ag + (bg - ag) * frac);
            b = (byte)Math.Round(ab + (bb - ab) * frac);
        }

        private static void HsvToRgb(double h, double s, double v, out byte r, out byte g, out byte b)
        {
            double sector = h * 6.0d;
            int i = (int)Math.Floor(sector);
            double f = sector - i;
            double p = v * (1.0d - s);
            double q = v * (1.0d - f * s);
            double t = v * (1.0d - (1.0d - f) * s);
            double rr, gg, bb;
            switch (i % 6)
            {
                case 0: rr = v; gg = t; bb = p; break;
                case 1: rr = q; gg = v; bb = p; break;
                case 2: rr = p; gg = v; bb = t; break;
                case 3: rr = p; gg = q; bb = v; break;
                case 4: rr = t; gg = p; bb = v; break;
                default: rr = v; gg = p; bb = q; break;
            }
            r = (byte)Math.Round(rr * 255d);
            g = (byte)Math.Round(gg * 255d);
            b = (byte)Math.Round(bb * 255d);
        }

        private static bool IsSelfContainedTag(string tag)
        {
            return tag == "img";
        }

        private static bool RemoveLastMatchingTag(List<string> openTags, string tag)
        {
            for (int i = openTags.Count - 1; i >= 0; i--)
            {
                if (openTags[i] == tag)
                {
                    openTags.RemoveAt(i);
                    return true;
                }
            }
            return false;
        }

        private static void AppendClosingTags(StringBuilder sb, List<string> openTags)
        {
            for (int i = openTags.Count - 1; i >= 0; i--)
            {
                sb.Append("[/").Append(openTags[i]).Append(']');
            }
        }

        private static int VisualWidth(char c)
        {
            if (char.IsUpper(c) || char.IsLower(c) || char.IsDigit(c) || char.IsPunctuation(c))
            {
                return 1;
            }
            return 2;
        }

        private static string TruncatePlainByUnits(string s, int maxVisualUnits)
        {
            var sb = new StringBuilder(s.Length);
            int units = 0;
            AppendPlainSliceByUnits(s, 0, s.Length, maxVisualUnits, ref units, sb);
            return sb.ToString();
        }

        private static bool AppendPlainSliceByUnits(string s, int start, int end, int maxVisualUnits, ref int units, StringBuilder sb)
        {
            for (int i = start; i < end; i++)
            {
                char c = s[i];
                if (char.IsHighSurrogate(c) && i + 1 < end && char.IsLowSurrogate(s[i + 1]))
                {
                    if (units + 2 > maxVisualUnits) return false;
                    units += 2;
                    sb.Append(c).Append(s[i + 1]);
                    i++;
                    continue;
                }
                if (char.IsSurrogate(c)) continue;
                int w = VisualWidth(c);
                if (units + w > maxVisualUnits) return false;
                units += w;
                sb.Append(c);
            }
            return true;
        }

        private static string TruncatePlainCharsWithEllipsis(string name, int maxVisibleChars)
        {
            if (maxVisibleChars <= 0) return name;
            int count = 0;
            int pos = 0;
            int cutPos = 0;
            while (pos < name.Length)
            {
                char c = name[pos++];
                if (char.IsHighSurrogate(c) && pos < name.Length && char.IsLowSurrogate(name[pos]))
                {
                    pos++;
                }
                count++;
                if (count == maxVisibleChars - 1) cutPos = pos;
                if (count > maxVisibleChars)
                {
                    return name.Substring(0, cutPos) + "…";
                }
            }
            return name;
        }

        private static int CountVisibleChars(string s)
        {
            int count = 0;
            for (int i = 0; i < s.Length; i++)
            {
                if (char.IsHighSurrogate(s[i]) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1]))
                {
                    i++;
                }
                count++;
            }
            return count;
        }

        private static int EstimateSpanVisibleChars(string cleaned, int startIndex, int maxRemaining)
        {
            int count = 0;
            for (int i = startIndex; i < cleaned.Length && count < maxRemaining; i++)
            {
                if (cleaned[i] == '[')
                {
                    Match m = TokenRegex.Match(cleaned, i);
                    if (m.Success && m.Index == i)
                    {
                        string tag = m.Groups["tag"].Value.ToLowerInvariant();
                        if ((tag == "color" || tag == "gradient") && m.Groups["close"].Success) break;
                        i = m.Index + m.Length - 1;
                        continue;
                    }
                }
                if (char.IsHighSurrogate(cleaned[i]) && i + 1 < cleaned.Length && char.IsLowSurrogate(cleaned[i + 1]))
                {
                    i++;
                }
                count++;
            }
            return count;
        }

        private static void AppendUnityStyledSlice(
            string s,
            int start,
            int end,
            int cap,
            ref int visibleWritten,
            ref int gradCharIdx,
            int gradSpanVisibleTotal,
            string[] gradStops,
            StringBuilder sb)
        {
            for (int i = start; i < end && visibleWritten < cap; i++)
            {
                char c = s[i];
                string glyph;
                if (char.IsHighSurrogate(c) && i + 1 < end && char.IsLowSurrogate(s[i + 1]))
                {
                    glyph = s.Substring(i, 2);
                    i++;
                }
                else
                {
                    glyph = c.ToString();
                }

                if (gradStops != null && gradStops.Length >= 2)
                {
                    float t = gradSpanVisibleTotal <= 1 ? 0f : (float)gradCharIdx / (gradSpanVisibleTotal - 1);
                    string hex = SampleGradientHex(gradStops, t);
                    sb.Append("<color=").Append(hex).Append('>').Append(glyph).Append("</color>");
                    gradCharIdx++;
                }
                else
                {
                    sb.Append(glyph);
                }
                visibleWritten++;
            }
        }

        private static string[] ParseColorStops(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return Array.Empty<string>();
            string[] parts = raw.Split(',');
            var list = new List<string>(parts.Length);
            for (int i = 0; i < parts.Length; i++)
            {
                string part = parts[i].Trim();
                if (HexColorTokenRegex.IsMatch(part))
                {
                    if (!part.StartsWith("#", StringComparison.Ordinal)) part = "#" + part;
                    if (part.Length == 7) list.Add(part.ToUpperInvariant());
                    else if (part.Length == 9) list.Add(part.ToUpperInvariant());
                }
            }
            return list.ToArray();
        }

        private static string SampleGradientHex(string[] stops, float t01)
        {
            if (stops.Length == 1) return stops[0];
            float clamped = Math.Max(0f, Math.Min(1f, t01));
            float scaled = clamped * (stops.Length - 1);
            int idx = Math.Min(stops.Length - 2, (int)Math.Floor(scaled));
            float f = scaled - idx;
            ParseRgb(stops[idx], out byte r0, out byte g0, out byte b0);
            ParseRgb(stops[idx + 1], out byte r1, out byte g1, out byte b1);
            byte r = (byte)Math.Round(r0 + (r1 - r0) * f);
            byte g = (byte)Math.Round(g0 + (g1 - g0) * f);
            byte b = (byte)Math.Round(b0 + (b1 - b0) * f);
            return string.Format("#{0:X2}{1:X2}{2:X2}", r, g, b);
        }

        private static void ParseRgb(string hex, out byte r, out byte g, out byte b)
        {
            r = Convert.ToByte(hex.Substring(1, 2), 16);
            g = Convert.ToByte(hex.Substring(3, 2), 16);
            b = Convert.ToByte(hex.Substring(5, 2), 16);
        }
    }
}
