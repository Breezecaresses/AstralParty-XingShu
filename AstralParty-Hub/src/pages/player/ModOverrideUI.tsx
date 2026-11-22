import React, { useEffect, useRef, useState } from 'react';
import { Eye, Layers, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  useModTexturePreview,
  type EncyclopediaAssetOverride,
  type EncyclopediaInstalledMod,
} from '../../shared/encyclopediaMods';

interface SummaryProps {
  sectionLabel: string;
  installedMods: EncyclopediaInstalledMod[];
  allInstalledMods: EncyclopediaInstalledMod[];
  replacedCount: number;
  selectedModId: string;
  onSelectModId: (modId: string) => void;
  onlyReplaced: boolean;
  onToggleOnlyReplaced: () => void;
  showModdedArt: boolean;
  onToggleShowModdedArt: () => void;
}

export const EncyclopediaModSummary: React.FC<SummaryProps> = ({
  sectionLabel,
  installedMods,
  allInstalledMods,
  replacedCount,
  selectedModId,
  onSelectModId,
  onlyReplaced,
  onToggleOnlyReplaced,
  showModdedArt,
  onToggleShowModdedArt,
}) => {
  if (!installedMods.length && !allInstalledMods.length) {
    return null;
  }

  return (
    <section className="mod-ovr-banner" aria-label={`${sectionLabel} Mod 替换概览`}>
      <div className="mod-ovr-banner-head">
        <div className="mod-ovr-title">
          <Sparkles size={15} />
          <strong>
            {installedMods.length
              ? `已检测 ${installedMods.length} 个影响${sectionLabel}的已安装 Mod（共替换 ${replacedCount} 项）`
              : `当前已安装 ${allInstalledMods.length} 个资源 Mod（暂未替换${sectionLabel}条目）`}
          </strong>
        </div>

        <div className="mod-ovr-controls">
          {replacedCount > 0 && (
            <>
              <button
                type="button"
                className={`btn btn-sm ${showModdedArt ? 'btn-primary' : 'btn-secondary'}`}
                onClick={onToggleShowModdedArt}
              >
                <Eye size={13} />
                <span>{showModdedArt ? '当前显示：Mod 替换图' : '当前显示：游戏原版图'}</span>
              </button>
              <button
                type="button"
                className={`btn btn-sm ${onlyReplaced ? 'btn-primary' : 'btn-secondary'}`}
                onClick={onToggleOnlyReplaced}
              >
                <Layers size={13} />
                <span>{onlyReplaced ? `仅看已替换 (${replacedCount})` : `筛选已替换 (${replacedCount})`}</span>
              </button>
            </>
          )}
          <Link to="/extensions/launcher" className="mod-ovr-manage-link">
            前往 Mod 管理 →
          </Link>
        </div>
      </div>

      {installedMods.length > 0 && (
        <div className="mod-ovr-mod-list">
          <button
            type="button"
            className={`mod-ovr-mod-pill ${selectedModId === '' ? 'is-active' : ''}`}
            onClick={() => onSelectModId('')}
          >
            <span>全部生效 Mod ({installedMods.length})</span>
          </button>
          {installedMods.map((mod) => (
            <button
              key={mod.modId}
              type="button"
              className={`mod-ovr-mod-pill ${selectedModId === mod.modId ? 'is-active' : ''} ${
                mod.enabled ? 'is-on' : 'is-off'
              }`}
              onClick={() => onSelectModId(selectedModId === mod.modId ? '' : mod.modId)}
              title={`点击筛选来自「${mod.modName}」的替换项`}
            >
              <i className="mod-ovr-dot" aria-hidden="true" />
              <span>{mod.modName}</span>
              <small>
                {mod.enabled ? '已开启' : '已关闭'} · {mod.assetCount} 项
              </small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};

export const ModReplacedPill: React.FC<{
  override?: EncyclopediaAssetOverride | null;
  compact?: boolean;
}> = ({ override, compact = false }) => {
  if (!override) return null;
  return (
    <span
      className={`mod-ovr-badge ${override.enabled ? 'is-on' : 'is-off'} ${compact ? 'is-compact' : ''}`}
      title={`Mod: ${override.modName} · 资产: ${override.assetName}`}
    >
      {override.enabled ? (compact ? 'Mod 已替换' : `Mod 替换 · ${override.modName}`) : compact ? 'Mod 已关闭' : `已关闭 · ${override.modName}`}
    </span>
  );
};

export const LazyModArtwork: React.FC<{
  installationId: string;
  override?: EncyclopediaAssetOverride | null;
  active: boolean;
  alt: string;
  className?: string;
  fallback: React.ReactNode;
}> = ({ installationId, override, active, alt, className = 'library-image', fallback }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '220px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [override?.bundlePath, override?.assetName]);

  const { src } = useModTexturePreview(
    installationId,
    override,
    Boolean(active && visible && override),
  );

  return (
    <div ref={hostRef} className="mod-ovr-art-wrap">
      {active && src ? <img className={className} src={src} alt={alt} loading="lazy" /> : fallback}
    </div>
  );
};
