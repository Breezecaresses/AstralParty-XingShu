using System;
using XingShuRuntime.Utilities;

class ActionGuardPolicyTests
{
    static void Check(bool ok, string name)
    {
        if (!ok) throw new Exception("FAIL: " + name);
        Console.WriteLine("PASS " + name);
    }

    static void Main()
    {
        Check(
            ActionGuardPolicy.EvaluateKick(false, true, 1001, 1001, false, 10.0, 0.0) == KickEvaluationOutcome.ForwardOriginal,
            "disabled guard forwards original kick");

        Check(
            ActionGuardPolicy.EvaluateKick(true, false, 0, 1001, false, 10.0, 0.0) == KickEvaluationOutcome.ForwardOriginal,
            "lobby or non-battle forwards original kick");

        Check(
            ActionGuardPolicy.EvaluateKick(true, true, 1001, 1002, false, 10.0, 0.0) == KickEvaluationOutcome.IgnoreMismatchRoom,
            "mismatched room id is ignored cleanly");

        Check(
            ActionGuardPolicy.EvaluateKick(true, true, 1001, 1001, true, 10.0, 0.0) == KickEvaluationOutcome.IgnoreExitSignal,
            "explicit exit signal does not trigger blind reconnect");

        Check(
            ActionGuardPolicy.EvaluateKick(true, true, 1001, 1001, false, 10.5, 9.5) == KickEvaluationOutcome.CooldownBlocked,
            "duplicate kick within 2s real-time cooldown is suppressed");

        Check(
            ActionGuardPolicy.EvaluateKick(true, true, 1001, 1001, false, 12.1, 10.0) == KickEvaluationOutcome.TriggerReconnect,
            "valid battle kick after cooldown triggers reconnect");

        Check(
            ActionGuardPolicy.EvaluateKick(true, true, 1001, 0, false, 5.0, 0.0) == KickEvaluationOutcome.TriggerReconnect,
            "battle kick with omitted room id falls back to active room reconnect");
    }
}
