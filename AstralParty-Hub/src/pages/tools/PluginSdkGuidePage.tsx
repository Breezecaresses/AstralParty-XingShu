import React, { useState } from 'react';
import { BookOpen, Check, Code2, Copy, ExternalLink, Layers, PackagePlus, Puzzle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../../i18n';
import { openExternalUrl } from '../../shared/runtime';
import '../launcher/launcher.css';
import {
  GUIDE_FEATURES,
  INTERFACE_SNIPPET,
  SIMPLE_PAGE_SNIPPET,
  WORKSHOP_MODS_URL,
  WORKSHOP_PLUGIN_GUIDE_URL,
  XSPKG_MANIFEST_SNIPPET,
} from './pluginSdkGuideData';

export const PluginSdkGuidePage: React.FC = () => {
  const zh = useTranslation().locale === 'zh-CN';
  const [copiedKey, setCopiedKey] = useState<string>('');

  const handleCopy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? '' : prev));
      }, 1800);
    }).catch(() => {});
  };

  return (
    <div className="launcher-catalog pcl-catalog-page">
      <div className="pcl-page-header">
        <div>
          <h1>{zh ? '外部优化 Mod / 插件接入指南' : 'External Mod & Plugin Integration Guide'}</h1>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--pcl-muted)' }}>
            {zh
              ? '面向社区作者与独立优化 Mod 开发者：免修改星枢核心源码，直接挂载至游戏内 F1「星枢功能中心（毛玻璃框架 v2）」。'
              : 'For modders: register external pages directly into the in-game F1 XingShu Center Glass v2 host.'}
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="pcl-btn-mini"
            onClick={() => openExternalUrl(WORKSHOP_PLUGIN_GUIDE_URL)}
            title={WORKSHOP_PLUGIN_GUIDE_URL}
          >
            <BookOpen size={13} />
            <span>{zh ? '星枢工坊网页指南' : 'Web Workshop Guide'}</span>
            <ExternalLink size={12} />
          </button>
          <div className="pcl-tools-pin-status">
            <Puzzle size={13} />
            <span>XingShuCenterPluginHost v2 · PC &amp; Android</span>
          </div>
        </div>
      </div>

      <div className="pcl-catalog-groups">
        {/* 1. Architecture Overview */}
        <section className="pcl-card pcl-catalog-card" style={{ '--card-index': 0 } as React.CSSProperties}>
          <header className="pcl-card-head">
            <div className="pcl-card-title-group">
              <span className="pcl-card-icon">
                <Layers size={16} />
              </span>
              <div>
                <h2>{zh ? '一、宿主契约与自动适配能力' : '1. Host Contract & Auto-Adaptation'}</h2>
                <p>{zh ? '一次注册，自动共享侧边栏入口、滚动容器、原版与毛玻璃皮肤切换。' : 'One registration handles sidebar navigation, scrolling, and skin theming.'}</p>
              </div>
            </div>
            <span className="pcl-count-chip">XingShuRuntime.UI</span>
          </header>

          <div
            className="pcl-card-body"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              gap: 12,
            }}
          >
            {GUIDE_FEATURES.map((item) => (
              <div
                key={item.title}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 6,
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px solid var(--pcl-border)',
                  background: 'var(--pcl-card-hover)',
                }}
              >
                <strong style={{ fontSize: 13.5, fontWeight: 720, color: 'var(--pcl-ink)' }}>
                  {item.title}
                </strong>
                <span style={{ fontSize: 12.5, color: 'var(--pcl-muted)', lineHeight: 1.58 }}>
                  {item.body}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* 2. Quick Callback API */}
        <section className="pcl-card pcl-catalog-card" style={{ '--card-index': 1 } as React.CSSProperties}>
          <header className="pcl-card-head">
            <div className="pcl-card-title-group">
              <span className="pcl-card-icon">
                <Code2 size={16} />
              </span>
              <div>
                <h2>{zh ? '二、快速接入：RegisterSimplePage（推荐）' : '2. Quick Start: RegisterSimplePage'}</h2>
                <p>{zh ? '适合大多数设置面板、开关矩阵与状态监控类外部 Mod。' : 'Best for settings, toggle grids and status monitors.'}</p>
              </div>
            </div>
            <button
              type="button"
              className="pcl-btn-mini"
              onClick={() => handleCopy('simple', SIMPLE_PAGE_SNIPPET)}
            >
              {copiedKey === 'simple' ? <Check size={13} /> : <Copy size={13} />}
              <span>{copiedKey === 'simple' ? '已复制' : '复制代码'}</span>
            </button>
          </header>

          <pre className="code-box" style={{ overflowX: 'auto', fontSize: 12, lineHeight: 1.55, margin: 0 }}>
            <code>{SIMPLE_PAGE_SNIPPET}</code>
          </pre>
        </section>

        {/* 3. Full Interface API */}
        <section className="pcl-card pcl-catalog-card" style={{ '--card-index': 2 } as React.CSSProperties}>
          <header className="pcl-card-head">
            <div className="pcl-card-title-group">
              <span className="pcl-card-icon">
                <BookOpen size={16} />
              </span>
              <div>
                <h2>{zh ? '三、完整生命周期接入：IXingShuExternalPage' : '3. Full Interface: IXingShuExternalPage'}</h2>
                <p>{zh ? '需要维护独立实例、缓存控件或动态刷新的复杂模块可实现该接口。' : 'Implement IXingShuExternalPage for complex stateful custom tabs.'}</p>
              </div>
            </div>
            <button
              type="button"
              className="pcl-btn-mini"
              onClick={() => handleCopy('interface', INTERFACE_SNIPPET)}
            >
              {copiedKey === 'interface' ? <Check size={13} /> : <Copy size={13} />}
              <span>{copiedKey === 'interface' ? '已复制' : '复制代码'}</span>
            </button>
          </header>

          <pre className="code-box" style={{ overflowX: 'auto', fontSize: 12, lineHeight: 1.55, margin: 0 }}>
            <code>{INTERFACE_SNIPPET}</code>
          </pre>
        </section>

        {/* 4. Distribution & .xspkg */}
        <section className="pcl-card pcl-catalog-card" style={{ '--card-index': 3 } as React.CSSProperties}>
          <header className="pcl-card-head">
            <div className="pcl-card-title-group">
              <span className="pcl-card-icon">
                <PackagePlus size={16} />
              </span>
              <div>
                <h2>{zh ? '四、打包与模组工坊分发规范' : '4. Packaging & Workshop Publishing'}</h2>
                <p>{zh ? '可将优化扩展打包为 .xspkg / .zip 导入启动器或在星枢工坊创作者中心投稿。' : 'Bundle into .xspkg / .zip and submit via Creator Portal.'}</p>
              </div>
            </div>
            <button
              type="button"
              className="pcl-btn-mini"
              onClick={() => handleCopy('xspkg', XSPKG_MANIFEST_SNIPPET)}
            >
              {copiedKey === 'xspkg' ? <Check size={13} /> : <Copy size={13} />}
              <span>{copiedKey === 'xspkg' ? '已复制' : '复制示例清单'}</span>
            </button>
          </header>

          <pre className="code-box" style={{ overflowX: 'auto', fontSize: 12, lineHeight: 1.55, marginBottom: 12 }}>
            <code>{XSPKG_MANIFEST_SNIPPET}</code>
          </pre>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12.5, color: 'var(--pcl-muted)' }}>
              网页版指引已同步上线星枢工坊；游戏内按 F1 切换「毛玻璃 UI」可在「扩展框架 → 扩展总览」直接查看。
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                className="pcl-btn-mini"
                onClick={() => openExternalUrl(WORKSHOP_PLUGIN_GUIDE_URL)}
              >
                <ExternalLink size={12} />
                <span>打开星枢工坊 · 插件接入指南</span>
              </button>
              <button
                type="button"
                className="pcl-btn-mini"
                onClick={() => openExternalUrl(WORKSHOP_MODS_URL)}
              >
                <ExternalLink size={12} />
                <span>打开星枢工坊网页</span>
              </button>
              <Link className="pcl-btn-mini" to="/extensions/launcher?section=inspect">
                前往本地 Mod 导入
              </Link>
              <Link className="pcl-btn-mini" to="/extensions/creator">
                前往创作者投稿入口
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default PluginSdkGuidePage;
