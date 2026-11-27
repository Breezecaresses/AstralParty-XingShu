using System;
using XingShuRuntime.Core;
using XingShuRuntime.Utilities;
using GameLogic;
using Tools;
class ThinkingTimeTests {
    static void Check(bool ok, string text) { if (!ok) throw new Exception(text); Console.WriteLine("PASS " + text); }
    static void Main() {
        var logic = SimpleSingletonProvider<GameLogicManager>.inst;
        Check(ThinkingTime.ScaleSeconds(30) == 300 && ThinkingTime.ScaleSeconds(12.5f) == 125f, "hero and operation timer values scale tenfold");
        Check(ThinkingTime.ScaleSeconds(0) == 0 && ThinkingTime.ScaleSeconds(-1) == -1, "disabled timer sentinels remain unchanged");
        XingShuConfigService.Enabled = false;
        Check(ThinkingTime.ScaleSeconds(30) == 30, "user can disable multiplier");
        XingShuConfigService.Enabled = true; logic.watch.Watching = true;
        Check(ThinkingTime.ScaleSeconds(30) == 30, "spectators keep official timers");
        logic.watch.Watching = false; logic.replay.Session.IsReplay = true;
        Check(ThinkingTime.ScaleSeconds(30) == 30, "replays keep official timers");
        logic.replay.Session.IsReplay = false;
        var window = new UI.OperateTimeWindow();
        object first = new object(), second = new object();
        ThinkingTime.BeginProgress(first, 300);
        ThinkingTime.UpdateProgress(window, 300, 15, "first", false, first);
        Check(window.Calls == 1 && window.Total == 300 && window.Elapsed == 15 && !ThinkingTime.AllowRemoteProgress(),
            "local real-clock progress excludes remote repainting");
        ThinkingTime.BeginProgress(second, 450);
        ThinkingTime.UpdateProgress(window, 450, 7, "second", false, second);
        ThinkingTime.UpdateProgress(window, 300, 290, "old first", false, first);
        Check(window.Calls == 2 && window.Total == 450 && window.Elapsed == 7,
            "old operation callback cannot repaint the current window");
        ThinkingTime.UpdateProgress(window, 450, 3, "second", false, second);
        Check(window.Elapsed == 7, "same operation cannot move displayed progress backwards");
        ThinkingTime.UpdateProgress(window, 0, 0, "old first ended", false, first);
        Check(window.Calls == 3 && !ThinkingTime.AllowRemoteProgress(), "old operation completion cannot clear a newer progress bar");
        ThinkingTime.UpdateProgress(window, 0, 0, "second ended", false, second);
        Check(window.Calls == 4 && window.Total == 0 && ThinkingTime.AllowRemoteProgress(), "current operation completion releases progress ownership");
        ThinkingTime.BeginProgress(first, 300);
        ThinkingTime.ClearProgress();
        ThinkingTime.UpdateProgress(window, 300, 20, "disposed", false, first);
        Check(window.Calls == 4 && ThinkingTime.AllowRemoteProgress(), "room disposal blocks late local callbacks");
        logic.watch.Watching = true;
        ThinkingTime.BeginProgress(first, 30);
        ThinkingTime.UpdateProgress(window, 30, 2, "official spectator", false, second);
        Check(window.Calls == 5 && window.Total == 30 && ThinkingTime.AllowRemoteProgress(), "spectator progress remains owned by official timers");
        logic.watch.Watching = false; XingShuConfigService.Enabled = false;
        ThinkingTime.BeginProgress(first, 30);
        ThinkingTime.UpdateProgress(window, 30, 3, "official disabled", false, second);
        Check(window.Calls == 6 && window.Elapsed == 3 && ThinkingTime.AllowRemoteProgress(), "disabling tenfold thinking restores official progress updates");
        XingShuConfigService.Enabled = true; XingShuConfigService.Scale = 10f;
        Check(ThinkingTime.ScaleMultiplier == 10f, "default thinking time scale is 10x");
        ThinkingTime.ScaleMultiplier = 1f;
        Check(ThinkingTime.ScaleMultiplier == 1f && ThinkingTime.ScaleSeconds(30) == 30, "minimum 1x matches original speed");
        ThinkingTime.ScaleMultiplier = 20f;
        Check(ThinkingTime.ScaleMultiplier == 20f && ThinkingTime.ScaleSeconds(30) == 600, "maximum 20x scales twentyfold");
        ThinkingTime.ScaleMultiplier = 0.2f;
        Check(ThinkingTime.ScaleMultiplier == 1f, "below-minimum clamps to 1x");
        ThinkingTime.ScaleMultiplier = 99f;
        Check(ThinkingTime.ScaleMultiplier == 20f, "above-maximum clamps to 20x");
        ThinkingTime.ScaleMultiplier = 10f;
        Check(ThinkingTime.ScaleSeconds(30) == 300, "restores 10x scale cleanly");

        // Live mid-turn multiplier adjustments (10x -> 20x and 10x -> 1x)
        var liveWin = new UI.OperateTimeWindow();
        object liveOwner = new object();
        double fakeClock = 100d;
        float liveScale = 10f;
        float lastClockVal = 0f;
        bool clockDone = false;
        var liveClock = new ThinkingClock(0f, 300f, () => clockDone = true, () => {}, v => lastClockVal = v, () => fakeClock, () => liveScale);

        ThinkingTime.ScaleMultiplier = 10f;
        ThinkingTime.BeginProgress(liveOwner, 300f);
        fakeClock += 10d;
        liveClock.Tick(0f);
        ThinkingTime.UpdateProgress(liveWin, 300, lastClockVal, "self", false, liveOwner);
        Check(Math.Abs(lastClockVal - 10f) < 0.01f && liveWin.Total == 300 && Math.Abs(liveWin.Elapsed - 10f) < 0.01f,
            "10s elapsed at 10x renders 10/300");
        Check(ThinkingTime.HasActiveTurnTimer && Math.Abs(ThinkingTime.ActiveRemainingSeconds - 290f) < 0.2f,
            "telemetry reports 290s remaining at 10x");

        // Mid-turn 10x -> 20x: base 30s * 20 = 600s total; 29/30 * 600 = 580s left; advance rate becomes 0.5x
        liveScale = 20f;
        ThinkingTime.ScaleMultiplier = 20f;
        Check(Math.Abs(ThinkingTime.ActiveScaledDuration - 600f) < 0.2f && Math.Abs(ThinkingTime.ActiveRemainingSeconds - 580f) < 0.2f,
            "mid-turn 10x->20x immediately doubles live duration to 600s and remaining to 580s");
        fakeClock += 20d;
        liveClock.Tick(0f);
        ThinkingTime.UpdateProgress(liveWin, 300, lastClockVal, "self", false, liveOwner);
        Check(Math.Abs(lastClockVal - 20f) < 0.01f && liveWin.Total == 600 && Math.Abs(liveWin.Elapsed - 40f) < 0.05f,
            "20 real seconds at 20x advances 10 virtual units (20/300) and displays 40/600 (560s left)");

        // Mid-turn 20x -> 1x: base 30s * 1 = 30s total; 28/30 left = 28s real remaining; advance rate becomes 10x
        liveScale = 1f;
        ThinkingTime.ScaleMultiplier = 1f;
        ThinkingTime.UpdateProgress(liveWin, 300, lastClockVal, "self", false, liveOwner);
        Check(liveWin.Total == 30 && Math.Abs(liveWin.Elapsed - 2f) < 0.05f,
            "mid-turn 20x->1x immediately updates bar to 2/30 (28s real left)");
        fakeClock += 28d;
        liveClock.Tick(0f);
        Check(clockDone && Math.Abs(lastClockVal - 300f) < 0.01f,
            "finishing remaining 28 real seconds at 1x completes ThinkingClock cleanly");
        ThinkingTime.ClearProgress();

        XingShuConfigService.Scale = 10f;
        ThinkingTime.Install(new UnityEngine.GameObject()); AssistBall.Action();
        Check(!XingShuConfigService.Enabled && XingShuConfigService.Saved, "registered toggle persists preference");
    }
}
namespace UnityEngine { public class GameObject {} }
namespace UI {
    public class OperateTimeWindow {
        public int Calls, Total; public float Elapsed;
        public void UpdateOperationProgress(int total, float elapsed, string head, bool warning) { Calls++; Total = total; Elapsed = elapsed; }
    }
}
namespace Tools { public static class SimpleSingletonProvider<T> where T:new() { public static T inst = new T(); } }
namespace GameLogic {
    public class Watch { public bool Watching; public bool PlayerIsWatcher() => Watching; }
    public class ReplaySession { public bool IsReplay; }
    public class Replay { public ReplaySession Session = new ReplaySession(); }
    public class GameLogicManager { public Watch watch = new Watch(); public Replay replay = new Replay(); }
}
namespace XingShuRuntime.Core {
    internal static class XingShuConfigKeys {
        internal const string ThinkingTimeScale = "XINGSHU_THINKING_TIME_SCALE";
        internal const float ThinkingTimeScaleMin = 1.0f;
        internal const float ThinkingTimeScaleMax = 20.0f;
        internal const float ThinkingTimeScaleDefault = 10.0f;
    }
    public static class XingShuConfigService {
        public static bool Enabled = true, Saved;
        public static float Scale = 10f;
        public static bool GetBool(string key, bool fallback) => Enabled;
        public static void SetBool(string key, bool value) { Enabled = value; }
        public static float GetFloat(string key, float fallback, float min, float max) => Math.Max(min, Math.Min(max, Scale));
        public static void SetFloat(string key, float value, float min, float max) { Scale = Math.Max(min, Math.Min(max, value)); }
        public static void Save() { Saved = true; }
    }
    public static class AssistBall {
        public static Action Action;
        public static void RegisterAction(string id, string name, Action action, int order, string hint, string icon, Func<bool> state) { Action = action; }
    }
}
