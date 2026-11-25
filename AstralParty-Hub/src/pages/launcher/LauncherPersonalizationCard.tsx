import React from 'react';
import { Check, Palette, Sparkles } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { isTauriRuntime } from '../../shared/runtime';
import { PCL_THEMES, useLauncherTheme } from './launcherTheme';

export const LauncherPersonalizationCard: React.FC = () => {
  const { locale } = useTranslation();
  const zh = locale === 'zh-CN';
  const desktopRuntime = isTauriRuntime();
  const { theme, setTheme, startupAnimEnabled, setStartupAnimEnabled, replayStartup } = useLauncherTheme();

  if (!desktopRuntime) return null;

  return (
    <section
      className="panel pcl-appearance-panel"
      aria-label={zh ? '个性化与启动动画' : 'Appearance & Startup Animation'}
    >
      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            <Palette size={18} color="var(--primary)" />
            <span>{zh ? '个性化与启动动画' : 'Appearance & Startup Animation'}</span>
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            {zh
              ? '选择星枢启动器主题色板与窗口入场动效，切换后即时应用于标题栏、导航胶囊与全部桌面页面。'
              : 'Customize the launcher palette and startup sequence. Changes apply immediately across all desktop pages.'}
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={replayStartup}>
          <Sparkles size={14} />
          <span>{zh ? '预览启动动画' : 'Preview startup animation'}</span>
        </button>
      </div>

      <div className="pcl-settings-theme-grid" role="group" aria-label={zh ? '主题配色' : 'Color themes'}>
        {PCL_THEMES.map((preset) => {
          const selected = theme === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={selected}
              className={`pcl-settings-theme-card ${selected ? 'is-selected' : ''} ${preset.isDark ? 'is-dark-preset' : ''}`}
              onClick={() => setTheme(preset.id)}
            >
              <span
                className="pcl-settings-theme-swatch"
                style={{
                  background: `linear-gradient(135deg, ${preset.swatchPrimary}, ${preset.swatchSecondary})`,
                }}
                aria-hidden="true"
              >
                {selected && <Check size={14} strokeWidth={2.6} />}
              </span>
              <span className="pcl-settings-theme-meta">
                <strong>{zh ? preset.nameZh : preset.nameEn}</strong>
                <small>{zh ? preset.descZh : preset.descEn}</small>
              </span>
            </button>
          );
        })}
      </div>

      <div
        className="xingshu-update-switch-row"
        style={{ marginTop: 14 }}
        onClick={() => setStartupAnimEnabled(!startupAnimEnabled)}
      >
        <div className="xingshu-update-switch-copy" id="pcl-startup-anim-label">
          <span className="xingshu-update-switch-title">
            {zh ? '启用启动开屏与入场动画' : 'Enable startup splash & entrance animation'}
          </span>
          <span className="xingshu-update-switch-desc">
            {zh
              ? '开启后每次打开桌面客户端都会播放星枢轨道开屏与窗口弹性入场；系统开启减弱动态效果时自动跳过。'
              : 'Play the orbital emblem splash and spring entrance on launch (automatically skipped when reduced motion is enabled).'}
          </span>
        </div>
        <button
          id="pcl-startup-anim-toggle"
          type="button"
          role="switch"
          aria-checked={startupAnimEnabled}
          aria-labelledby="pcl-startup-anim-label"
          className={`xingshu-switch-track${startupAnimEnabled ? ' is-on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setStartupAnimEnabled(!startupAnimEnabled);
          }}
        >
          <span className="xingshu-switch-thumb" />
        </button>
      </div>
    </section>
  );
};
