using System;
using System.Collections.Generic;
using System.Reflection;
using Tools;
using UI;
using UnityEngine;
using XingShuRuntime.Core;
using XingShuRuntime.Features;

namespace XingShuRuntime.Utilities
{
    /// <summary>
    /// Controls extended visibility for right-side map pings, quick-chat popups,
    /// expression bubbles, board mark effects, and magnifying-glass tile step numbers
    /// while speed acceleration is active.
    /// </summary>
    public static class PingDisplayTiming
    {
        private static HashSet<string> _markEffectNames;
        private static bool _distanceReflectionReady;
        private static FieldInfo _cachedDistanceWinField;
        private static FieldInfo _distanceVisibleField;
        private static FieldInfo _distanceHideAtField;
        private static bool _distanceTracking;
        private static double _distanceRealDeadline;
        private static float _distanceLastAppliedHideAt;

        static PingDisplayTiming()
        {
            PingClockTimingBridge.IsAccelerated = IsAccelerated;
            PingClockTimingBridge.GetExtensionSeconds = () => ExtensionSeconds;
        }

        public static void EnsureInitialized()
        {
            // Touching static constructor wires PingClockTimingBridge delegates.
        }

        public static float ExtensionSeconds
        {
            get
            {
                try
                {
                    return XingShuConfigService.GetFloat(
                        XingShuConfigKeys.PingAccelExtendSeconds,
                        XingShuConfigKeys.PingAccelExtendSecondsDefault,
                        XingShuConfigKeys.PingAccelExtendSecondsMin,
                        XingShuConfigKeys.PingAccelExtendSecondsMax);
                }
                catch
                {
                    return XingShuConfigKeys.PingAccelExtendSecondsDefault;
                }
            }
            set
            {
                try
                {
                    XingShuConfigService.SetFloat(
                        XingShuConfigKeys.PingAccelExtendSeconds,
                        value,
                        XingShuConfigKeys.PingAccelExtendSecondsMin,
                        XingShuConfigKeys.PingAccelExtendSecondsMax);
                    XingShuConfigService.Save();
                }
                catch { }
            }
        }

        public static bool IsAccelerated()
        {
            try
            {
                if (Time.timeScale > 1.05f) return true;
                if (GameSpeedControllerGUI.EffectiveTimeScale > 1.05f) return true;
                if (XingShuSpeedEngineCoordinator.ManagedEffectiveSpeed > 1.05f) return true;
                if (XingShuSpeedEngineCoordinator.NativeEffectiveSpeed > 1.05f) return true;
            }
            catch { }
            return false;
        }

        public static bool IsAccelerationFeatureActive()
        {
            if (IsAccelerated()) return true;
            try
            {
                if (XingShuSpeedEngineCoordinator.CurrentEngine == XingShuSpeedEngineMode.NativeHook
                    && XingShuSpeedEngineCoordinator.IsNativeAvailable
                    && XingShuConfigService.GetBool(XingShuConfigKeys.NativeSpeedEnabled, XingShuConfigKeys.NativeSpeedEnabledDefault))
                {
                    return true;
                }
                if (XingShuSpeedEngineCoordinator.CurrentEngine == XingShuSpeedEngineMode.ManagedXingShu
                    && GameSpeedControllerGUI.IsSpeedEnabled
                    && GameSpeedControllerGUI.CurrentTimeScale > 1.05f)
                {
                    return true;
                }
            }
            catch { }
            return false;
        }

        internal static void TickMapDistanceTips()
        {
            try
            {
                if (!SimpleSingletonProvider<UIManager>.hasInstance)
                {
                    _distanceTracking = false;
                    return;
                }
                if (!_distanceReflectionReady)
                {
                    _distanceReflectionReady = true;
                    const BindingFlags flags = BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public;
                    _cachedDistanceWinField = typeof(UIManager).GetField("_cachedMapDistanceTipsWindow", flags);
                    _distanceVisibleField = typeof(MapDistanceTipsWindow).GetField("_isMapStepVisible", flags);
                    _distanceHideAtField = typeof(MapDistanceTipsWindow).GetField("_mapStepHideAt", flags);
                }
                if (_cachedDistanceWinField == null || _distanceVisibleField == null || _distanceHideAtField == null)
                {
                    return;
                }

                UIManager uiMgr = SimpleSingletonProvider<UIManager>.inst;
                if (uiMgr == null)
                {
                    _distanceTracking = false;
                    return;
                }

                object win = _cachedDistanceWinField.GetValue(uiMgr);
                if (win == null)
                {
                    _distanceTracking = false;
                    return;
                }

                bool visible = _distanceVisibleField.GetValue(win) is bool b && b;
                float currentHideAt = _distanceHideAtField.GetValue(win) is float f ? f : 0f;
                float baseSeconds = 3.0f;
                try
                {
                    int rawMs = StaticGlobalData.GAME_DISTANCE_NUM_DURATION;
                    if (rawMs > 100) baseSeconds = rawMs * 0.001f;
                }
                catch { }

                if (MapDistanceTimingState.ComputeHold(
                    visible,
                    currentHideAt,
                    _distanceLastAppliedHideAt,
                    Time.unscaledTime,
                    ThinkingClock.RealSeconds(),
                    baseSeconds,
                    IsAccelerationFeatureActive(),
                    ExtensionSeconds,
                    ref _distanceTracking,
                    ref _distanceRealDeadline,
                    out float nextHideAt))
                {
                    _distanceHideAtField.SetValue(win, nextHideAt);
                    _distanceLastAppliedHideAt = nextHideAt;
                }
            }
            catch
            {
                _distanceTracking = false;
            }
        }

        public static float CurrentSpeedMultiplier()
        {
            float speed = 1f;
            try
            {
                speed = Math.Max(speed, Time.timeScale);
                speed = Math.Max(speed, GameSpeedControllerGUI.EffectiveTimeScale);
                speed = Math.Max(speed, XingShuSpeedEngineCoordinator.ManagedEffectiveSpeed);
                speed = Math.Max(speed, XingShuSpeedEngineCoordinator.NativeEffectiveSpeed);
            }
            catch { }
            if (float.IsNaN(speed) || float.IsInfinity(speed)) return 1f;
            return Math.Max(1f, Math.Min(10f, speed));
        }

        public static float ResolveEffectDuration(float baseDuration, string effectPoolKey)
        {
            if (baseDuration <= 0f || string.IsNullOrEmpty(effectPoolKey)) return baseDuration;
            if (!IsMarkEffectName(effectPoolKey) || !IsAccelerated()) return baseDuration;
            float speed = CurrentSpeedMultiplier();
            return (baseDuration + Math.Max(0f, ExtensionSeconds)) * speed;
        }

        internal static bool IsMarkEffectName(string effectName)
        {
            if (string.IsNullOrEmpty(effectName)) return false;
            var names = EnsureMarkEffectNames();
            return names != null && names.Contains(effectName);
        }

        private static HashSet<string> EnsureMarkEffectNames()
        {
            if (_markEffectNames != null) return _markEffectNames;
            var set = new HashSet<string>(StringComparer.Ordinal);
            try
            {
                var marks = StaticConfigure.Chat?.Marks;
                if (marks == null) return null;
                foreach (var mark in marks)
                {
                    if (mark == null || mark.EffctID <= 0) continue;
                    var cfg = UIHelper.GetEffectDataConfigure(mark.EffctID);
                    if (cfg != null && !string.IsNullOrEmpty(cfg.EffectName))
                    {
                        set.Add(cfg.EffectName);
                    }
                }
                if (set.Count > 0) _markEffectNames = set;
            }
            catch
            {
                return null;
            }
            return _markEffectNames;
        }
    }
}
