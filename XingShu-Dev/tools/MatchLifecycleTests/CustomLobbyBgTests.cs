using System;
using System.Collections.Generic;
using XingShuRuntime.Utilities;

namespace XingShu.Tests
{
    public static class CustomLobbyBgTests
    {
        private static void Assert(bool condition, string message)
        {
            if (!condition)
            {
                throw new InvalidOperationException("Assertion failed: " + message);
            }
        }

        private static void AssertClose(float actual, float expected, string message)
        {
            if (Math.Abs(actual - expected) > 0.0005f)
            {
                throw new InvalidOperationException(
                    string.Format("Assertion failed: {0} (expected={1}, actual={2})", message, expected, actual));
            }
        }

        private static void TestClassifyAndKindLabel()
        {
            Assert(CustomLobbyBgPolicy.ClassifyExtension("clip.mp4") == LobbyBgMediaKind.Video, ".mp4 -> Video");
            Assert(CustomLobbyBgPolicy.ClassifyExtension("CLIP.WEBM") == LobbyBgMediaKind.Video, ".WEBM -> Video");
            Assert(CustomLobbyBgPolicy.ClassifyExtension("demo.mov") == LobbyBgMediaKind.Video, ".mov -> Video");
            Assert(CustomLobbyBgPolicy.ClassifyExtension("demo.m4v") == LobbyBgMediaKind.Video, ".m4v -> Video");
            Assert(CustomLobbyBgPolicy.ClassifyExtension("demo.wmv") == LobbyBgMediaKind.Video, ".wmv -> Video");
            Assert(CustomLobbyBgPolicy.ClassifyExtension("bg.png") == LobbyBgMediaKind.Image, ".png -> Image");
            Assert(CustomLobbyBgPolicy.ClassifyExtension("bg.jpg") == LobbyBgMediaKind.Image, ".jpg -> Image");
            Assert(CustomLobbyBgPolicy.ClassifyExtension("bg.jpeg") == LobbyBgMediaKind.Image, ".jpeg -> Image");
            Assert(CustomLobbyBgPolicy.ClassifyExtension("movie.usm") == LobbyBgMediaKind.CriUsm, ".usm -> CriUsm");
            Assert(CustomLobbyBgPolicy.ClassifyExtension("vkv.bundle") == LobbyBgMediaKind.UnityBundle, ".bundle -> UnityBundle");
            Assert(CustomLobbyBgPolicy.ClassifyExtension("readme.txt") == LobbyBgMediaKind.Unknown, ".txt -> Unknown");
            Assert(CustomLobbyBgPolicy.ClassifyExtension("") == LobbyBgMediaKind.Unknown, "empty -> Unknown");
            Assert(CustomLobbyBgPolicy.ClassifyExtension(null) == LobbyBgMediaKind.Unknown, "null -> Unknown");

            Assert(CustomLobbyBgPolicy.KindLabel(LobbyBgMediaKind.Video) == "视频", "Video label");
            Assert(CustomLobbyBgPolicy.KindLabel(LobbyBgMediaKind.Image) == "静态图", "Image label");
            Assert(CustomLobbyBgPolicy.KindLabel(LobbyBgMediaKind.CriUsm) == "USM 动效", "CriUsm label");
            Assert(CustomLobbyBgPolicy.KindLabel(LobbyBgMediaKind.UnityBundle) == "VKVLoop 包", "Bundle label");
            Assert(CustomLobbyBgPolicy.KindLabel(LobbyBgMediaKind.Unknown) == "未知", "Unknown label");
        }

        private static void TestSortMediaFiles()
        {
            List<string> empty = CustomLobbyBgPolicy.SortMediaFiles(null);
            Assert(empty.Count == 0, "null list -> empty");

            List<string> sorted = CustomLobbyBgPolicy.SortMediaFiles(new[]
            {
                "",
                null,
                @"C:\dir\.hidden.mp4",
                @"C:\dir\~temp.png",
                @"C:\dir\notes.txt",
                @"C:\dir\zeta.mp4",
                @"C:\dir\alpha.PNG",
                @"C:\dir\alpha.PNG",
                @"C:\dir\beta.usm",
                @"C:\dir\gamma.bundle",
            });

            Assert(sorted.Count == 4, "filtered supported unique files count == 4");
            Assert(sorted[0].EndsWith("alpha.PNG"), "index 0 alpha.PNG");
            Assert(sorted[1].EndsWith("beta.usm"), "index 1 beta.usm");
            Assert(sorted[2].EndsWith("gamma.bundle"), "index 2 gamma.bundle");
            Assert(sorted[3].EndsWith("zeta.mp4"), "index 3 zeta.mp4");
        }

        private static void TestComputeRenderTextureSize()
        {
            int dw, dh;
            CustomLobbyBgPolicy.ComputeRenderTextureSize(0, 0, false, out dw, out dh);
            Assert(dw == 1920 && dh == 1080, "desktop fallback 1920x1080");

            int mw, mh;
            CustomLobbyBgPolicy.ComputeRenderTextureSize(-1, 500, true, out mw, out mh);
            Assert(mw == 1280 && mh == 720, "mobile fallback 1280x720");

            int pcW, pcH;
            CustomLobbyBgPolicy.ComputeRenderTextureSize(2560, 1440, false, out pcW, out pcH);
            Assert(pcW == 2560 && pcH == 1440, "desktop preserves <=4K dimensions");

            int capW, capH;
            CustomLobbyBgPolicy.ComputeRenderTextureSize(7680, 4320, false, out capW, out capH);
            Assert(capW == 3840 && capH == 2160, "desktop caps 8K to 3840x2160");

            int mobCapW, mobCapH;
            CustomLobbyBgPolicy.ComputeRenderTextureSize(2560, 1440, true, out mobCapW, out mobCapH);
            Assert(mobCapW == 1920 && mobCapH == 1080, "mobile caps 1440p to 1920x1080");

            int evenW, evenH;
            CustomLobbyBgPolicy.ComputeRenderTextureSize(3, 3, false, out evenW, out evenH);
            Assert(evenW % 2 == 0 && evenH % 2 == 0 && evenW >= 2 && evenH >= 2, "even positive sizes");
        }

        private static void TestIndexSelection()
        {
            Assert(CustomLobbyBgPolicy.PickNextIndex(0, 0, 1) == -1, "empty next -> -1");
            Assert(CustomLobbyBgPolicy.PickNextIndex(-1, 3, 1) == 0, "unselected +1 -> 0");
            Assert(CustomLobbyBgPolicy.PickNextIndex(-1, 3, -1) == 2, "unselected -1 -> last");
            Assert(CustomLobbyBgPolicy.PickNextIndex(2, 3, 1) == 0, "wrap forward");
            Assert(CustomLobbyBgPolicy.PickNextIndex(0, 3, -1) == 2, "wrap backward");

            Assert(CustomLobbyBgPolicy.PickRandomIndex(0, 0, _ => 0) == -1, "empty random -> -1");
            Assert(CustomLobbyBgPolicy.PickRandomIndex(0, 1, _ => 0) == 0, "single random -> 0");

            for (int current = 0; current < 4; current++)
            {
                for (int r = 0; r < 3; r++)
                {
                    int picked = CustomLobbyBgPolicy.PickRandomIndex(current, 4, _ => r);
                    Assert(picked >= 0 && picked < 4 && picked != current, "random avoids repeating current");
                }
            }
        }

        private static void TestClampersAndFillModeAndUri()
        {
            AssertClose(CustomLobbyBgPolicy.ClampBrightness(float.NaN), CustomLobbyBgPolicy.DefaultBrightness, "brightness NaN");
            AssertClose(CustomLobbyBgPolicy.ClampBrightness(0.05f), CustomLobbyBgPolicy.MinBrightness, "brightness min");
            AssertClose(CustomLobbyBgPolicy.ClampBrightness(2.5f), CustomLobbyBgPolicy.MaxBrightness, "brightness max");
            AssertClose(CustomLobbyBgPolicy.ClampBrightness(0.75f), 0.75f, "brightness mid");

            AssertClose(CustomLobbyBgPolicy.ClampSpeed(float.PositiveInfinity), CustomLobbyBgPolicy.DefaultSpeed, "speed inf");
            AssertClose(CustomLobbyBgPolicy.ClampSpeed(0.1f), CustomLobbyBgPolicy.MinSpeed, "speed min");
            AssertClose(CustomLobbyBgPolicy.ClampSpeed(5.0f), CustomLobbyBgPolicy.MaxSpeed, "speed max");
            AssertClose(CustomLobbyBgPolicy.ClampSpeed(1.25f), 1.25f, "speed mid");

            AssertClose(CustomLobbyBgPolicy.ClampVolume(float.NegativeInfinity), CustomLobbyBgPolicy.DefaultVolume, "vol -inf");
            AssertClose(CustomLobbyBgPolicy.ClampVolume(-1f), CustomLobbyBgPolicy.MinVolume, "vol min");
            AssertClose(CustomLobbyBgPolicy.ClampVolume(3f), CustomLobbyBgPolicy.MaxVolume, "vol max");
            AssertClose(CustomLobbyBgPolicy.ClampVolume(0.6f), 0.6f, "vol mid");

            Assert(CustomLobbyBgPolicy.NormalizeFillMode(0) == LobbyBgFillMode.Cover, "fill 0 -> Cover");
            Assert(CustomLobbyBgPolicy.NormalizeFillMode(1) == LobbyBgFillMode.Contain, "fill 1 -> Contain");
            Assert(CustomLobbyBgPolicy.NormalizeFillMode(2) == LobbyBgFillMode.Stretch, "fill 2 -> Stretch");
            Assert(CustomLobbyBgPolicy.NormalizeFillMode(99) == LobbyBgFillMode.Cover, "fill invalid -> Cover");

            Assert(CustomLobbyBgPolicy.FillModeLabel(LobbyBgFillMode.Cover) == "等比铺满", "Cover label");
            Assert(CustomLobbyBgPolicy.FillModeLabel(LobbyBgFillMode.Contain) == "完整显示", "Contain label");
            Assert(CustomLobbyBgPolicy.FillModeLabel(LobbyBgFillMode.Stretch) == "拉伸填充", "Stretch label");

            Assert(CustomLobbyBgPolicy.BuildFileUri("") == "", "empty uri");
            string uri = CustomLobbyBgPolicy.BuildFileUri(@"E:\工作流\lobbybg\my video.mp4");
            Assert(uri.StartsWith("file:///") && uri.EndsWith("my%20video.mp4"), "file uri encoded: " + uri);
        }

        public static int Main()
        {
            TestClassifyAndKindLabel();
            TestSortMediaFiles();
            TestComputeRenderTextureSize();
            TestIndexSelection();
            TestClampersAndFillModeAndUri();
            Console.WriteLine("CustomLobbyBgTests PASS");
            return 0;
        }
    }
}
