import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Blocks,
  Compass,
  Download,
  Layers,
  LayoutDashboard,
  SmilePlus,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../../i18n';
import { openPlatformAuthModal, usePlatformAccount } from '../../shared/platformAccountClient';
import { assetUrl } from '../../shared/runtime';
import {
  compareModsByHeat,
  fetchWorkshopMods,
  modPlatformSummaryBadge,
  workshopAssetUrl,
  type WorkshopModItem,
} from '../../shared/workshopClient';
import { getCategoryVisualMeta, getLauncherModuleMeta } from '../launcher/launcherModMeta';

const HERO_WORDS_ZH = ['功能优化', '角色皮肤', '卡牌替换', '语音特效'];
const HERO_WORDS_EN = ['optimizations', 'character skins', 'card packs', 'voice & VFX'];

export const ModrinthHomePage: React.FC = () => {
  const { locale } = useTranslation();
  const zh = locale === 'zh-CN';
  const { user } = usePlatformAccount();

  const [wordIdx, setWordIdx] = useState(0);
  const [allItems, setAllItems] = useState<WorkshopModItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [failedPreviews, setFailedPreviews] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const timer = window.setInterval(() => {
      setWordIdx((prev) => (prev + 1) % HERO_WORDS_ZH.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    fetchWorkshopMods('all', '')
      .then((res) => {
        if (!active) return;
        setCounts(res.counts || {});
        setAllItems(res.items || []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const heroWord = zh ? HERO_WORDS_ZH[wordIdx] : HERO_WORDS_EN[wordIdx];
  const trendingMods = useMemo(
    () =>
      [...allItems]
        .sort((a, b) => compareModsByHeat(a, b, zh ? 'zh-CN' : 'en'))
        .slice(0, 12),
    [allItems, zh],
  );

  // Split all items into 3 marquee bands sorted by popularity & downloads.
  const marqueeRows = useMemo(() => {
    const ranked = [...allItems].sort((a, b) => compareModsByHeat(a, b, zh ? 'zh-CN' : 'en'));
    if (ranked.length === 0) return [[], [], []] as WorkshopModItem[][];
    const r0: WorkshopModItem[] = [];
    const r1: WorkshopModItem[] = [];
    const r2: WorkshopModItem[] = [];
    ranked.forEach((item, idx) => {
      if (idx % 3 === 0) r0.push(item);
      else if (idx % 3 === 1) r1.push(item);
      else r2.push(item);
    });
    const pad = (list: WorkshopModItem[]) => (list.length >= 4 ? list : ranked.slice(0, 8));
    return [pad(r0), pad(r1), pad(r2)];
  }, [allItems, zh]);

  const renderTileIcon = (item: WorkshopModItem, size: 'sm' | 'md' = 'sm') => {
    const previewSrc =
      item.previewUrl && !failedPreviews[item.id] ? workshopAssetUrl(item.previewUrl) : '';
    if (previewSrc) {
      return (
        <div className={`mr-icon-tile ${size === 'sm' ? 'is-sm' : ''}`}>
          <img
            src={previewSrc}
            alt=""
            onError={() => setFailedPreviews((prev) => ({ ...prev, [item.id]: true }))}
          />
        </div>
      );
    }
    const isOfficial = item.id.startsWith('xingshu.launcher.');
    const visual = isOfficial ? getLauncherModuleMeta(item.id) : getCategoryVisualMeta(item.category);
    const Icon = visual.Icon;
    return (
      <div
        className={`mr-icon-tile ${size === 'sm' ? 'is-sm' : ''}`}
        style={{ background: visual.accentBg, color: visual.accentFg, borderColor: visual.accentBorder }}
        aria-hidden="true"
      >
        <Icon size={size === 'sm' ? 20 : 26} />
      </div>
    );
  };

  return (
    <div>
      <section className="mr-hero">
        <div className="mr-hero-inner" style={{ paddingBottom: 30 }}>
          <div className="mr-hero-logo-wrap">
            <img
              src={assetUrl(
                zh
                  ? 'brand/astral-party-logo-zh.png'
                  : 'brand/astral-party-logo-en.png',
              )}
              alt={zh ? '星引擎 PARTY 官方标志' : 'Astral Party Official Logo'}
              className="mr-hero-logo-img"
            />
          </div>

          <h1>
            {zh ? '汇聚《吉星派对》各类' : 'The place for Astral Party '}
            <br />
            <span className="mr-hero-accent">{heroWord}</span>
          </h1>

          <p className="mr-hero-sub">
            {zh
              ? '在我们为社区打造的开源平台探索、下载并发布《吉星派对》官方 .xspkg 功能模块、皮肤、卡面与语音特效资源包。'
              : 'Discover, download, and publish official .xspkg feature modules, skins, card packs, and voice mods for Astral Party.'}
          </p>

          <div className="mr-hero-cta">
            <Link to="/extensions/mods" className="mr-btn-emerald mr-btn-lg">
              <Compass size={17} />
              <span>{zh ? '发现模组' : 'Discover Mods'}</span>
            </Link>
            {user ? (
              <Link to="/account" className="mr-btn-outline mr-btn-lg">
                <LayoutDashboard size={16} />
                <span>{zh ? '前往仪表板' : 'Dashboard'}</span>
              </Link>
            ) : (
              <button
                type="button"
                className="mr-btn-outline mr-btn-lg"
                onClick={() => openPlatformAuthModal('login')}
              >
                <LayoutDashboard size={16} />
                <span>{zh ? '登录平台账号' : 'Sign In'}</span>
              </button>
            )}
          </div>
        </div>

        {allItems.length > 0 && (
          <div className="mr-marquee-wrap" aria-label={zh ? '热门模组滚动展墙' : 'Scrolling Mod Showcase'}>
            {marqueeRows.map((rowItems, rowIdx) => (
              <div
                key={rowIdx}
                className={`mr-marquee-row ${rowIdx === 1 ? 'is-reverse' : ''}`}
              >
                <div className="mr-marquee-track">
                  {[...rowItems, ...rowItems].map((item, copyIdx) => (
                    <Link
                      key={`${rowIdx}-${copyIdx}-${item.id}`}
                      to={`/mod/${encodeURIComponent(item.slug || item.id)}`}
                      className="mr-marquee-card"
                    >
                      {renderTileIcon(item, 'sm')}
                      <div className="mr-marquee-copy">
                        <strong>{item.name}</strong>
                        <span>{item.description}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mr-home-section">
        <div className="mr-marquee-intro">
          <span className="mr-audience-pill">{zh ? '面向玩家' : 'For Players'}</span>
          <h2 style={{ margin: 0, fontSize: 30, fontWeight: 850, letterSpacing: '-0.02em' }}>
            {zh ? `探索 ${allItems.length || 34} 件官方与社区 Mod` : `Explore ${allItems.length || 34} Curated Mods`}
          </h2>
          <p style={{ margin: 0, color: 'var(--mr-text-secondary)', maxWidth: 580, fontSize: 14.5 }}>
            {zh
              ? '点击任意模组卡片即可查看详细介绍、更新日志、版本号、SHA-256 摘要并一键收藏或下载。'
              : 'Click any mod to inspect its description, changelog, SHA-256 hashes, and direct .xspkg downloads.'}
          </p>
        </div>

        <div className="mr-quick-cats">
          <Link to="/extensions/mods?category=optimization" className="mr-cat-card">
            <div className="mr-icon-tile is-sm" style={{ background: 'rgba(240, 40, 120, 0.16)', color: '#ff5ca0' }}>
              <Sparkles size={20} />
            </div>
            <div>
              <strong>{zh ? '功能优化 (.xspkg)' : 'Optimization (.xspkg)'}</strong>
              <span className="mr-tabular">{counts.optimization ?? 18} {zh ? '个模组' : 'mods'}</span>
            </div>
          </Link>

          <Link to="/extensions/mods?category=skin" className="mr-cat-card">
            <div className="mr-icon-tile is-sm" style={{ background: 'rgba(236,72,153,0.14)', color: '#f472b6' }}>
              <Blocks size={20} />
            </div>
            <div>
              <strong>{zh ? '角色皮肤' : 'Character Skins'}</strong>
              <span className="mr-tabular">{counts.skin ?? 9} {zh ? '个模组' : 'mods'}</span>
            </div>
          </Link>

          <Link to="/extensions/mods?category=card" className="mr-cat-card">
            <div className="mr-icon-tile is-sm" style={{ background: 'rgba(245,158,11,0.14)', color: '#fbbf24' }}>
              <Layers size={20} />
            </div>
            <div>
              <strong>{zh ? '卡牌替换' : 'Card Replacers'}</strong>
              <span className="mr-tabular">{counts.card ?? 4} {zh ? '个模组' : 'mods'}</span>
            </div>
          </Link>

          <Link to="/extensions/mods?category=voice_vfx" className="mr-cat-card">
            <div className="mr-icon-tile is-sm" style={{ background: 'rgba(59,130,246,0.14)', color: '#60a5fa' }}>
              <Volume2 size={20} />
            </div>
            <div>
              <strong>{zh ? '语音 · 特效' : 'Voice & VFX'}</strong>
              <span className="mr-tabular">{counts.voice_vfx ?? 3} {zh ? '个模组' : 'mods'}</span>
            </div>
          </Link>
        </div>
      </section>

      <section className="mr-home-section" style={{ paddingTop: 0 }}>
        <div className="mr-section-head">
          <div>
            <h2>{zh ? '热门模组排行' : 'Trending & Most Downloaded'}</h2>
            <p>{zh ? '按热度与下载量实时排序，涵盖全部官方与社区模组' : 'Ranked by popularity and downloads across official and community mods'}</p>
          </div>
          <Link to="/extensions/mods" className="mr-btn-outline">
            <span>{zh ? '查看全部模组' : 'Browse All Mods'}</span>
            <ArrowRight size={14} />
          </Link>
        </div>

        <div className="mr-official-grid">
          {trendingMods.map((item) => (
            <Link
              key={item.id}
              to={`/mod/${encodeURIComponent(item.slug || item.id)}`}
              className="mr-mini-mod-card"
            >
              {renderTileIcon(item, 'sm')}
              <div className="mr-mini-mod-body">
                <strong>{item.name}</strong>
                <p title={item.description}>{item.description}</p>
                <div className="mr-mini-mod-stats">
                  <span>
                    <Download size={11} />
                    {item.downloads ?? 0}
                  </span>
                  <span>
                    <SmilePlus size={11} />
                    {item.reactionTotal ?? 0}
                  </span>
                  {modPlatformSummaryBadge(item, zh) && (
                    <span className="mr-pill is-versions" style={{ padding: '1px 6px', fontSize: 10.5 }}>
                      {modPlatformSummaryBadge(item, zh)}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
};
