using System;
using System.Collections.Generic;
using System.IO;

namespace XingShuRuntime.Utilities
{
    internal enum LobbyBgMediaKind
    {
        Unknown = 0,
        Video = 1,
        Image = 2,
        CriUsm = 3,
        UnityBundle = 4,
    }

    internal enum LobbyBgFillMode
    {
        Cover = 0,
        Contain = 1,
        Stretch = 2,
    }

    /// <summary>
    /// Pure, deterministic media classification, sorting, clamping, and cycling policy
    /// for <see cref="CustomLobbyBackground"/>. Kept free of UnityEngine/game dependencies
    /// so unit tests can compile and verify it directly.
    /// </summary>
    internal static class CustomLobbyBgPolicy
    {
        internal const float MinBrightness = 0.30f;
        internal const float MaxBrightness = 1.00f;
        internal const float DefaultBrightness = 1.00f;

        internal const float MinSpeed = 0.50f;
        internal const float MaxSpeed = 2.00f;
        internal const float DefaultSpeed = 1.00f;

        internal const float MinVolume = 0.00f;
        internal const float MaxVolume = 1.00f;
        internal const float DefaultVolume = 0.35f;

        internal static LobbyBgMediaKind ClassifyExtension(string path)
        {
            if (string.IsNullOrEmpty(path))
            {
                return LobbyBgMediaKind.Unknown;
            }
            string ext = Path.GetExtension(path.Trim());
            if (string.IsNullOrEmpty(ext))
            {
                return LobbyBgMediaKind.Unknown;
            }
            string lower = ext.ToLowerInvariant();
            switch (lower)
            {
                case ".mp4":
                case ".webm":
                case ".mov":
                case ".m4v":
                case ".wmv":
                    return LobbyBgMediaKind.Video;
                case ".png":
                case ".jpg":
                case ".jpeg":
                case ".webp":
                case ".bmp":
                    return LobbyBgMediaKind.Image;
                case ".usm":
                    return LobbyBgMediaKind.CriUsm;
                case ".bundle":
                    return LobbyBgMediaKind.UnityBundle;
                default:
                    return LobbyBgMediaKind.Unknown;
            }
        }

        internal static string KindLabel(LobbyBgMediaKind kind)
        {
            switch (kind)
            {
                case LobbyBgMediaKind.Video: return "视频";
                case LobbyBgMediaKind.Image: return "静态图";
                case LobbyBgMediaKind.CriUsm: return "USM 动效";
                case LobbyBgMediaKind.UnityBundle: return "VKVLoop 包";
                default: return "未知";
            }
        }

        internal static List<string> SortMediaFiles(IEnumerable<string> paths)
        {
            var result = new List<string>();
            if (paths == null)
            {
                return result;
            }
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string raw in paths)
            {
                if (string.IsNullOrEmpty(raw))
                {
                    continue;
                }
                string trimmed = raw.Trim();
                string fileName = Path.GetFileName(trimmed);
                if (string.IsNullOrEmpty(fileName) || fileName[0] == '.' || fileName[0] == '~')
                {
                    continue;
                }
                if (ClassifyExtension(fileName) == LobbyBgMediaKind.Unknown)
                {
                    continue;
                }
                if (seen.Add(trimmed))
                {
                    result.Add(trimmed);
                }
            }
            result.Sort(CompareMediaPath);
            return result;
        }

        private static int CompareMediaPath(string a, string b)
        {
            string na = Path.GetFileName(a) ?? "";
            string nb = Path.GetFileName(b) ?? "";
            int c = StringComparer.OrdinalIgnoreCase.Compare(na, nb);
            return c != 0 ? c : StringComparer.OrdinalIgnoreCase.Compare(a, b);
        }

        internal static void ComputeRenderTextureSize(int srcW, int srcH, bool isMobile, out int outW, out int outH)
        {
            if (srcW <= 0 || srcH <= 0)
            {
                outW = isMobile ? 1280 : 1920;
                outH = isMobile ? 720 : 1080;
                return;
            }
            int maxW = isMobile ? 1920 : 3840;
            int maxH = isMobile ? 1080 : 2160;
            double w = srcW;
            double h = srcH;
            if (w > maxW || h > maxH)
            {
                double scale = Math.Min((double)maxW / w, (double)maxH / h);
                w *= scale;
                h *= scale;
            }
            outW = ((int)Math.Round(w)) & ~1;
            outH = ((int)Math.Round(h)) & ~1;
            if (outW < 2) outW = 2;
            if (outH < 2) outH = 2;
        }

        internal static int PickNextIndex(int currentIndex, int count, int delta)
        {
            if (count <= 0)
            {
                return -1;
            }
            if (currentIndex < 0 || currentIndex >= count)
            {
                return delta >= 0 ? 0 : count - 1;
            }
            int shifted = (currentIndex + delta) % count;
            if (shifted < 0)
            {
                shifted += count;
            }
            return shifted;
        }

        internal static int PickRandomIndex(int currentIndex, int count, Func<int, int> nextInt)
        {
            if (count <= 0)
            {
                return -1;
            }
            if (count == 1)
            {
                return 0;
            }
            bool hasCurrent = currentIndex >= 0 && currentIndex < count;
            int pool = hasCurrent ? (count - 1) : count;
            int raw = nextInt != null ? nextInt(pool) : 0;
            if (raw < 0) raw = 0;
            if (raw >= pool) raw = pool - 1;
            if (hasCurrent && raw >= currentIndex)
            {
                raw += 1;
            }
            if (raw >= count) raw = count - 1;
            return raw;
        }

        internal static float ClampBrightness(float value)
        {
            if (float.IsNaN(value) || float.IsInfinity(value)) return DefaultBrightness;
            if (value < MinBrightness) return MinBrightness;
            if (value > MaxBrightness) return MaxBrightness;
            return value;
        }

        internal static float ClampSpeed(float value)
        {
            if (float.IsNaN(value) || float.IsInfinity(value)) return DefaultSpeed;
            if (value < MinSpeed) return MinSpeed;
            if (value > MaxSpeed) return MaxSpeed;
            return value;
        }

        internal static float ClampVolume(float value)
        {
            if (float.IsNaN(value) || float.IsInfinity(value)) return DefaultVolume;
            if (value < MinVolume) return MinVolume;
            if (value > MaxVolume) return MaxVolume;
            return value;
        }

        internal static LobbyBgFillMode NormalizeFillMode(int raw)
        {
            switch (raw)
            {
                case (int)LobbyBgFillMode.Contain: return LobbyBgFillMode.Contain;
                case (int)LobbyBgFillMode.Stretch: return LobbyBgFillMode.Stretch;
                default: return LobbyBgFillMode.Cover;
            }
        }

        internal static string FillModeLabel(LobbyBgFillMode mode)
        {
            switch (mode)
            {
                case LobbyBgFillMode.Contain: return "完整显示";
                case LobbyBgFillMode.Stretch: return "拉伸填充";
                default: return "等比铺满";
            }
        }

        internal static string BuildFileUri(string fullPath)
        {
            if (string.IsNullOrEmpty(fullPath))
            {
                return "";
            }
            try
            {
                string abs = Path.GetFullPath(fullPath);
                return new Uri(abs).AbsoluteUri;
            }
            catch
            {
                string norm = fullPath.Replace('\\', '/');
                return norm.StartsWith("file://", StringComparison.OrdinalIgnoreCase)
                    ? norm
                    : ("file://" + (norm.StartsWith("/") ? "" : "/") + Uri.EscapeUriString(norm));
            }
        }

        internal static string DescribeImageHeader(byte[] bytes)
        {
            if (bytes == null || bytes.Length < 4)
            {
                return "空文件";
            }
            if (bytes.Length >= 8
                && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47
                && bytes[4] == 0x0D && bytes[5] == 0x0A && bytes[6] == 0x1A && bytes[7] == 0x0A)
            {
                return "PNG";
            }
            if (bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF)
            {
                return "JPEG";
            }
            if (bytes.Length >= 12
                && bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x46
                && bytes[8] == 0x57 && bytes[9] == 0x45 && bytes[10] == 0x42 && bytes[11] == 0x50)
            {
                return "WebP";
            }
            if (bytes.Length >= 12
                && bytes[4] == 0x66 && bytes[5] == 0x74 && bytes[6] == 0x79 && bytes[7] == 0x70)
            {
                return "HEIF/AVIF";
            }
            if (bytes[0] == 0x42 && bytes[1] == 0x4D)
            {
                return "BMP";
            }
            if (bytes.Length >= 6
                && bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x38)
            {
                return "GIF";
            }
            return "未知格式";
        }

        internal static bool IsLikelyUnsupportedByUnityLoadImage(byte[] bytes)
        {
            string fmt = DescribeImageHeader(bytes);
            return fmt == "WebP" || fmt == "HEIF/AVIF" || fmt == "BMP" || fmt == "GIF";
        }
    }
}
