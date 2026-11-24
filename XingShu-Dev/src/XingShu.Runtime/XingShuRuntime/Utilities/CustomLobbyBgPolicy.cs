using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

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

        internal const int VideoAudioOutputModeDirectValue = 2;

        internal static bool ShouldMuteVanillaLobbyBgm(
            bool featureEnabled,
            bool muteVanillaBgm,
            bool homeVisible,
            bool subBgVisible)
        {
            return featureEnabled && muteVanillaBgm && (homeVisible || subBgVisible);
        }

        internal static void ProcessPcm16Chunk(
            byte[] src,
            int srcBytes,
            int channels,
            float speed,
            float startGain,
            float endGain,
            ref double fracFramePos,
            byte[] dst,
            out int dstBytes)
        {
            dstBytes = 0;
            if (src == null || dst == null || channels <= 0 || srcBytes <= 0 || dst.Length <= 0)
            {
                return;
            }
            int frameSize = channels * 2;
            int maxSrcFrames = Math.Min(srcBytes, src.Length) / frameSize;
            int maxDstFrames = dst.Length / frameSize;
            if (maxSrcFrames <= 0 || maxDstFrames <= 0)
            {
                return;
            }

            float clampedSpeed = ClampSpeed(speed);
            float g0 = ClampVolume(startGain);
            float g1 = ClampVolume(endGain);

            if (Math.Abs(clampedSpeed - 1f) < 0.015f)
            {
                int count = Math.Min(maxSrcFrames, maxDstFrames);
                fracFramePos = 0.0;
                for (int f = 0; f < count; f++)
                {
                    float g = g0 + (g1 - g0) * ((f + 0.5f) / count);
                    int baseIdx = f * frameSize;
                    for (int c = 0; c < channels; c++)
                    {
                        int idx = baseIdx + c * 2;
                        short s = (short)(src[idx] | (src[idx + 1] << 8));
                        int scaled = (int)Math.Round(s * g);
                        if (scaled > short.MaxValue) scaled = short.MaxValue;
                        else if (scaled < short.MinValue) scaled = short.MinValue;
                        short outS = (short)scaled;
                        dst[idx] = (byte)(outS & 0xFF);
                        dst[idx + 1] = (byte)((outS >> 8) & 0xFF);
                    }
                }
                dstBytes = count * frameSize;
                return;
            }

            double pos = fracFramePos >= 0.0 ? fracFramePos : 0.0;
            int outFrames = 0;
            while (outFrames < maxDstFrames)
            {
                int i0 = (int)pos;
                if (i0 >= maxSrcFrames)
                {
                    break;
                }
                int i1 = i0 + 1 < maxSrcFrames ? i0 + 1 : i0;
                double t = pos - i0;
                float g = g0 + (g1 - g0) * ((outFrames + 0.5f) / maxDstFrames);
                int b0 = i0 * frameSize;
                int b1 = i1 * frameSize;
                int bd = outFrames * frameSize;
                for (int c = 0; c < channels; c++)
                {
                    int o = c * 2;
                    short s0 = (short)(src[b0 + o] | (src[b0 + o + 1] << 8));
                    short s1 = (short)(src[b1 + o] | (src[b1 + o + 1] << 8));
                    double interp = s0 + (s1 - s0) * t;
                    int scaled = (int)Math.Round(interp * g);
                    if (scaled > short.MaxValue) scaled = short.MaxValue;
                    else if (scaled < short.MinValue) scaled = short.MinValue;
                    short outS = (short)scaled;
                    dst[bd + o] = (byte)(outS & 0xFF);
                    dst[bd + o + 1] = (byte)((outS >> 8) & 0xFF);
                }
                outFrames++;
                pos += clampedSpeed;
            }
            fracFramePos = pos >= maxSrcFrames ? (pos - maxSrcFrames) : 0.0;
            dstBytes = outFrames * frameSize;
        }

        internal static string BuildWindowsAudioCommandPayload(
            int generation,
            bool stop,
            bool quit,
            string fullPath,
            bool muted,
            float volume,
            float speed,
            bool paused,
            int seekSeq,
            double seekSeconds)
        {
            string b64 = string.IsNullOrEmpty(fullPath)
                ? ""
                : Convert.ToBase64String(Encoding.UTF8.GetBytes(fullPath));
            float clampedVol = ClampVolume(volume);
            float clampedSpeed = ClampSpeed(speed);
            double safeSeek = seekSeconds > 0.0 && !double.IsNaN(seekSeconds) && !double.IsInfinity(seekSeconds)
                ? seekSeconds
                : 0.0;

            var sb = new StringBuilder(256);
            sb.Append("GEN=").Append(generation).Append('\n');
            sb.Append("STOP=").Append(stop ? "1" : "0").Append('\n');
            sb.Append("QUIT=").Append(quit ? "1" : "0").Append('\n');
            sb.Append("PATH_B64=").Append(b64).Append('\n');
            sb.Append("MUTED=").Append(muted ? "1" : "0").Append('\n');
            sb.Append("VOL=").Append(clampedVol.ToString("0.0000", CultureInfo.InvariantCulture)).Append('\n');
            sb.Append("SPEED=").Append(clampedSpeed.ToString("0.0000", CultureInfo.InvariantCulture)).Append('\n');
            sb.Append("PAUSED=").Append(paused ? "1" : "0").Append('\n');
            sb.Append("SEEK_SEQ=").Append(seekSeq).Append('\n');
            sb.Append("SEEK_SEC=").Append(safeSeek.ToString("0.000", CultureInfo.InvariantCulture)).Append('\n');
            return sb.ToString();
        }

        internal static bool TryParseWindowsAudioState(
            string content,
            out int generation,
            out bool opened,
            out bool hasAudio,
            out double posSeconds,
            out double durationSeconds,
            out string error)
        {
            generation = 0;
            opened = false;
            hasAudio = false;
            posSeconds = 0.0;
            durationSeconds = 0.0;
            error = "";
            if (string.IsNullOrEmpty(content))
            {
                return false;
            }
            string trimmed = content.Trim();
            int p1 = trimmed.IndexOf('|');
            if (p1 < 0) return false;
            int p2 = trimmed.IndexOf('|', p1 + 1);
            if (p2 < 0) return false;
            int p3 = trimmed.IndexOf('|', p2 + 1);
            if (p3 < 0) return false;
            int p4 = trimmed.IndexOf('|', p3 + 1);
            if (p4 < 0) return false;
            int p5 = trimmed.IndexOf('|', p4 + 1);

            string genStr = trimmed.Substring(0, p1);
            string openStr = trimmed.Substring(p1 + 1, p2 - p1 - 1);
            string audioStr = trimmed.Substring(p2 + 1, p3 - p2 - 1);
            string posStr = trimmed.Substring(p3 + 1, p4 - p3 - 1);
            string durStr = p5 >= 0 ? trimmed.Substring(p4 + 1, p5 - p4 - 1) : trimmed.Substring(p4 + 1);

            if (!int.TryParse(genStr, NumberStyles.Integer, CultureInfo.InvariantCulture, out generation))
            {
                return false;
            }
            opened = openStr == "1";
            hasAudio = audioStr == "1";
            if (!double.TryParse(posStr, NumberStyles.Float, CultureInfo.InvariantCulture, out posSeconds)
                || double.IsNaN(posSeconds) || double.IsInfinity(posSeconds) || posSeconds < 0.0)
            {
                posSeconds = 0.0;
            }
            if (!double.TryParse(durStr, NumberStyles.Float, CultureInfo.InvariantCulture, out durationSeconds)
                || double.IsNaN(durationSeconds) || double.IsInfinity(durationSeconds) || durationSeconds < 0.0)
            {
                durationSeconds = 0.0;
            }
            error = p5 >= 0 ? trimmed.Substring(p5 + 1).Trim() : "";
            return true;
        }
    }
}
