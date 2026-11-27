using System;

namespace XingShuRuntime.Utilities
{
    // One shared progress bar, one current local operation. Old operation callbacks
    // still run their game logic, but cannot repaint or clear a newer operation.
    internal sealed class DecisionProgressOwner
    {
        private object _owner;
        private float _initialDuration;
        private float _initialScale = 1f;
        private float _currentScale = 1f;
        private float _highWaterVirtual;

        internal bool Active => _owner != null;
        internal float BaseDuration => _owner != null ? _initialDuration / _initialScale : 0f;
        internal float ScaledDuration => _owner != null ? BaseDuration * _currentScale : 0f;
        internal float RemainingSeconds => _owner != null ? Math.Max(0f, ScaledDuration - _highWaterVirtual * (_currentScale / _initialScale)) : 0f;

        private static float ClampScale(float scale)
        {
            if (float.IsNaN(scale) || float.IsInfinity(scale)) return 1f;
            if (scale < ThinkingTime.MinScale) return ThinkingTime.MinScale;
            if (scale > ThinkingTime.MaxScale) return ThinkingTime.MaxScale;
            return scale;
        }

        internal void Begin(object owner, float duration, float initialScale = 1f)
        {
            Clear();
            if (owner == null || duration <= 0 || float.IsNaN(duration) || float.IsInfinity(duration)) return;
            _owner = owner;
            _initialDuration = duration;
            _initialScale = ClampScale(initialScale);
            _currentScale = _initialScale;
        }

        internal void OnScaleChanged(float currentScale)
        {
            if (_owner != null)
            {
                _currentScale = ClampScale(currentScale);
            }
        }

        internal bool Update(object owner, int maximum, float elapsed, out int total, out float value)
        {
            return Update(owner, maximum, elapsed, _currentScale, out total, out value);
        }

        internal bool Update(object owner, int maximum, float elapsed, float currentScale, out int total, out float value)
        {
            total = 0; value = 0;
            if (!ReferenceEquals(owner, _owner) || _owner == null || float.IsNaN(elapsed) || float.IsInfinity(elapsed)) return false;
            if (maximum <= 0) { Clear(); return true; }
            _currentScale = ClampScale(currentScale);
            _highWaterVirtual = Math.Max(_highWaterVirtual, Math.Min(_initialDuration, Math.Max(0f, elapsed)));
            float ratio = _currentScale / _initialScale;
            float scaledTotal = _initialDuration * ratio;
            total = Math.Max(1, (int)Math.Round(scaledTotal));
            value = Math.Min(scaledTotal, _highWaterVirtual * ratio);
            return true;
        }

        internal void Clear()
        {
            _owner = null;
            _initialDuration = 0f;
            _initialScale = 1f;
            _currentScale = 1f;
            _highWaterVirtual = 0f;
        }
    }
}
