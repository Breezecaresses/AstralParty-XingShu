using System;
using XingShuRuntime.Utilities;

internal static class PingDisplayTimingTests
{
    private static int _checks;
    private static void Check(bool condition, string name)
    {
        if (!condition) throw new Exception("Test failed: " + name);
        _checks++;
    }

    public static void Main()
    {
        double now = 100.0;
        bool accelerated = false;
        float extra = 5.0f;
        int completes = 0, cancels = 0, stops = 0;

        // 1. Normal speed: ignores inflated accelerated carrier ticks and finishes at real 3.0s
        var state = new PingClockState(0f, 3f, () => completes++, () => cancels++, null, () => now, () => accelerated, () => extra);
        state.AttachStop(() => stops++);
        now = 102.9;
        state.Tick(29.0f);
        Check(completes == 0 && stops == 0, "Normal speed must not finish before 3 real seconds even when carrier reports 29s");
        now = 103.05;
        state.Tick(30.5f);
        Check(completes == 1 && stops == 1 && cancels == 0, "Normal speed finishes once at 3 real seconds");

        // 2. Accelerated mode (e.g. 10x): extends real lifetime by extra seconds (3 + 5 = 8s real)
        now = 200.0; accelerated = true; completes = 0; stops = 0; cancels = 0;
        state = new PingClockState(0f, 3f, () => completes++, () => cancels++, null, () => now, () => accelerated, () => extra);
        state.AttachStop(() => stops++);
        now = 203.0;
        state.Tick(30.0f);
        Check(completes == 0 && stops == 0, "Accelerated ping stays visible past base 3s real time");
        now = 207.9;
        state.Tick(79.0f);
        Check(completes == 0 && stops == 0, "Accelerated ping stays visible up to 3+5=8s real time");
        now = 208.05;
        state.Tick(80.5f);
        Check(completes == 1 && stops == 1, "Accelerated ping completes cleanly after extended real duration");

        // 3. Switching speed ON mid-ping latches extension seamlessly
        now = 300.0; accelerated = false; completes = 0; stops = 0; cancels = 0;
        state = new PingClockState(0f, 3f, () => completes++, () => cancels++, null, () => now, () => accelerated, () => extra);
        state.AttachStop(() => stops++);
        now = 301.0;
        state.Tick(1.0f);
        accelerated = true;
        now = 305.0;
        state.Tick(41.0f);
        Check(completes == 0, "Turning on acceleration mid-ping extends real lifetime");
        now = 308.1;
        state.Tick(72.0f);
        Check(completes == 1 && stops == 1, "Mid-ping acceleration completes at 3+5=8s real time");

        // 4. Cancellation stops any later ticks from firing completion
        now = 400.0; accelerated = true; completes = 0; stops = 0; cancels = 0;
        state = new PingClockState(0f, 3f, () => completes++, () => cancels++, null, () => now, () => accelerated, () => extra);
        state.AttachStop(() => stops++);
        state.Cancelled();
        now = 420.0;
        state.Tick(200.0f);
        Check(cancels == 1 && completes == 0 && stops == 0, "Cancelled ping never completes later");

        // 5. Magnifying-glass map tile step numbers: real-clock hold & extension
        bool distTracking = false;
        double distDeadline = 0d;
        float lastApplied = 0f;
        float nextHideAt;

        // 5a. Accelerated: unscaledTime jumps 10x (from 500 to 535 in 3.5 real seconds), hold stays alive past 8s
        bool updated = MapDistanceTimingState.ComputeHold(true, 503f, lastApplied, 500f, 1000.0, 3f, true, 5f, ref distTracking, ref distDeadline, out nextHideAt);
        Check(updated && distTracking && nextHideAt > 550f, "First tick holds map distance numbers via real deadline");
        lastApplied = nextHideAt;

        updated = MapDistanceTimingState.ComputeHold(true, lastApplied, lastApplied, 535f, 1003.5, 3f, true, 5f, ref distTracking, ref distDeadline, out nextHideAt);
        Check(updated && distTracking && nextHideAt > 590f, "10x unscaledTime jump at 3.5 real sec still holds extended tile steps");
        lastApplied = nextHideAt;

        updated = MapDistanceTimingState.ComputeHold(true, lastApplied, lastApplied, 581f, 1008.1, 3f, true, 5f, ref distTracking, ref distDeadline, out nextHideAt);
        Check(updated && !distTracking && nextHideAt < 581f, "Expires after base 3s + 5s extra = 8s real time");

        // 5b. Normal speed uses base 3s real clock (plus clicking a new tile resets deadline)
        updated = MapDistanceTimingState.ComputeHold(true, 603f, lastApplied, 600f, 1020.0, 3f, false, 5f, ref distTracking, ref distDeadline, out nextHideAt);
        Check(updated && distTracking, "New tile click at normal speed restarts tracking");
        lastApplied = nextHideAt;
        updated = MapDistanceTimingState.ComputeHold(true, lastApplied, lastApplied, 602.5f, 1022.5, 3f, false, 5f, ref distTracking, ref distDeadline, out nextHideAt);
        Check(updated && distTracking, "Normal speed keeps showing before 3s real time");
        lastApplied = nextHideAt;
        updated = MapDistanceTimingState.ComputeHold(true, lastApplied, lastApplied, 603.1f, 1023.1, 3f, false, 5f, ref distTracking, ref distDeadline, out nextHideAt);
        Check(updated && !distTracking && nextHideAt < 603.1f, "Normal speed hides at 3s real time without extension");

        // 5c. Manual hide clears tracking cleanly
        updated = MapDistanceTimingState.ComputeHold(true, 703f, lastApplied, 700f, 1050.0, 3f, true, 5f, ref distTracking, ref distDeadline, out nextHideAt);
        Check(updated && distTracking, "Re-open tracks cleanly");
        updated = MapDistanceTimingState.ComputeHold(false, 0f, nextHideAt, 701f, 1050.1, 3f, true, 5f, ref distTracking, ref distDeadline, out nextHideAt);
        Check(!updated && !distTracking, "Hiding clears distance tracking");

        Console.WriteLine("PASS: " + _checks + " ping display timing checks");
    }
}
