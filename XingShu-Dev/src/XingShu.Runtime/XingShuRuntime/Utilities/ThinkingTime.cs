using System;
using System.Reflection;
using XingShuRuntime.Core;
using GameLogic;
using Tools;
using UnityEngine;

namespace XingShuRuntime.Utilities
{
    public static class ThinkingTime
    {
        private const string Key = "XINGSHU_THINKING_TIME_X10";
        private const string ScaleKey = XingShuConfigKeys.ThinkingTimeScale;
        public const float MinScale = XingShuConfigKeys.ThinkingTimeScaleMin;
        public const float MaxScale = XingShuConfigKeys.ThinkingTimeScaleMax;
        public const float DefaultScale = XingShuConfigKeys.ThinkingTimeScaleDefault;

        private static readonly DecisionProgressOwner Progress = new DecisionProgressOwner();
        private static FieldInfo _operationTimeField;
        private static bool _operationTimeLookupDone;
        static ThinkingTime()
        {
            ThinkingClock.DefaultScaleProvider = () => ActiveScale;
        }

        public static bool Enabled => LauncherModules.CanLoad(nameof(ThinkingTime)) && XingShuConfigService.GetBool(Key, true);
        internal static float ActiveScale => UseRealClock() ? ScaleMultiplier : MinScale;
        internal static bool HasActiveTurnTimer => Progress.Active;
        internal static float ActiveBaseDuration => Progress.BaseDuration;
        internal static float ActiveScaledDuration => Progress.ScaledDuration;
        internal static float ActiveRemainingSeconds => Progress.RemainingSeconds;

        public static float ScaleMultiplier
        {
            get
            {
                if (!Enabled) return MinScale;
                float raw = XingShuConfigService.GetFloat(ScaleKey, DefaultScale, MinScale, MaxScale);
                if (float.IsNaN(raw) || float.IsInfinity(raw)) return DefaultScale;
                if (raw < MinScale) return MinScale;
                if (raw > MaxScale) return MaxScale;
                return raw;
            }
            set
            {
                float clamped = (float.IsNaN(value) || float.IsInfinity(value))
                    ? DefaultScale
                    : Math.Max(MinScale, Math.Min(MaxScale, value));
                clamped = (float)Math.Round(clamped, 1);
                XingShuConfigService.SetBool(Key, true);
                XingShuConfigService.SetFloat(ScaleKey, clamped, MinScale, MaxScale);
                XingShuConfigService.Save();
                OnLiveScaleChanged();
            }
        }

        private static void OnLiveScaleChanged()
        {
            Progress.OnScaleChanged(ActiveScale);
            if (!Progress.Active) return;
            try
            {
                if (!_operationTimeLookupDone)
                {
                    _operationTimeLookupDone = true;
                    Type opType = Type.GetType("GameLogic.OperationTimer, AstralParty.Runtime");
                    if (opType != null)
                    {
                        _operationTimeField = opType.GetField("operationTime", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);
                    }
                }
                if (_operationTimeField != null)
                {
                    _operationTimeField.SetValue(null, Progress.ScaledDuration);
                }
            }
            catch { }
        }

        public static void Install(GameObject host)
        {
            AssistBall.RegisterAction("xingshu.thinking_time", "思考时间倍数", Toggle, 39,
                "选人、自己的操作回合及筹码选择使用真实时钟与自定义倍数计时（1x~20x，默认10x）；服务端强制截止仍有效", "clock", () => Enabled);
        }

        private static void Toggle()
        {
            XingShuConfigService.SetBool(Key, !Enabled);
            XingShuConfigService.Save();
            OnLiveScaleChanged();
        }

        public static int ScaleSeconds(int seconds)
        {
            return (int)ScaleSeconds((float)seconds);
        }

        public static float ScaleSeconds(float seconds)
        {
            if (seconds <= 0 || !UseRealClock()) return seconds;
            return seconds * ScaleMultiplier;
        }

        public static bool UseRealClock()
        {
            if (!Enabled) return false;
            var logic = SimpleSingletonProvider<GameLogicManager>.inst;
            return logic?.watch?.PlayerIsWatcher() != true && logic?.replay?.Session?.IsReplay != true;
        }

        public static void BeginProgress(object owner, float duration)
        {
            if (UseRealClock()) Progress.Begin(owner, duration, ActiveScale); else Progress.Clear();
        }

        public static void ClearProgress() { Progress.Clear(); }

        public static bool AllowRemoteProgress()
        {
            if (!UseRealClock()) { Progress.Clear(); return true; }
            return !Progress.Active;
        }

        public static void UpdateProgress(global::UI.OperateTimeWindow window, int total, float elapsed,
            string head, bool warning, object owner)
        {
            if (window == null) return;
            if (UseRealClock() && !Progress.Update(owner, total, elapsed, ActiveScale, out total, out elapsed)) return;
            window.UpdateOperationProgress(total, elapsed, head, warning);
        }
    }
}
