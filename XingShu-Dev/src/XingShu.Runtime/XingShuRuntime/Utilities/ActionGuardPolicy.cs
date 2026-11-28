using System;

namespace XingShuRuntime.Utilities
{
    internal enum KickEvaluationOutcome
    {
        ForwardOriginal = 0,
        IgnoreMismatchRoom = 1,
        IgnoreExitSignal = 2,
        CooldownBlocked = 3,
        TriggerReconnect = 4,
    }

    internal static class ActionGuardPolicy
    {
        internal const double DefaultReconnectCooldownRealSeconds = 2.0d;
        internal const double MaintenanceIntervalRealSeconds = 1.0d;

        internal static KickEvaluationOutcome EvaluateKick(
            bool enabled,
            bool isInBattle,
            long currentRoomId,
            long kickRoomId,
            bool isExit,
            double realNowSeconds,
            double lastReconnectRealSeconds,
            double cooldownSeconds = DefaultReconnectCooldownRealSeconds)
        {
            if (!enabled)
            {
                return KickEvaluationOutcome.ForwardOriginal;
            }
            if (isExit)
            {
                return KickEvaluationOutcome.IgnoreExitSignal;
            }
            if (!isInBattle)
            {
                return KickEvaluationOutcome.ForwardOriginal;
            }
            if (kickRoomId > 0L && currentRoomId > 0L && kickRoomId != currentRoomId)
            {
                return KickEvaluationOutcome.IgnoreMismatchRoom;
            }
            if (lastReconnectRealSeconds > 0d && realNowSeconds - lastReconnectRealSeconds < cooldownSeconds)
            {
                return KickEvaluationOutcome.CooldownBlocked;
            }
            return KickEvaluationOutcome.TriggerReconnect;
        }
    }
}
