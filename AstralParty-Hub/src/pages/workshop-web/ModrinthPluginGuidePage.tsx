import React, { useState } from 'react';
import { ArrowLeft, Check, Code2, Copy, Layers, PackagePlus, Puzzle, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../../i18n';
import {
  GUIDE_FEATURES,
  INTERFACE_SNIPPET,
  SIMPLE_PAGE_SNIPPET,
  XSPKG_MANIFEST_SNIPPET,
} from '../tools/pluginSdkGuideData';

export const ModrinthPluginGuidePage: React.FC = () => {
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
    <div className="mr-container mr-guide-page">
      <div className="mr-guide-hero">
        <div className="mr-guide-hero-copy">
          <div className="mr-guide-badges">
            <span className="mr-guide-pill">
              <Puzzle size={13} />
              <span>XingShuCenterPluginHost v2 · PC &amp; Android</span>
            </span>
          </div>
          <h1>{zh ? '外部优化 Mod / 插件接入指南' : 'External Mod & Plugin Integration Guide'}</h1>
          <p>
            {zh
              ? '面向星枢工坊创作者与独立优化 Mod 开发者：免修改星枢核心源码，直接将插件设置页挂载至游戏内 F1「星枢功能中心（毛玻璃框架 v2）」，并可打包发布到星枢工坊。'
              : 'For modders: register external pages directly into the in-game F1 XingShu Center Glass v2 host and distribute via XingShu Workshop.'}
          </p>
        </div>

        <div className="mr-guide-hero-actions">
          <Link to="/extensions/mods" className="mr-guide-btn">
            <ArrowLeft size={14} />
            <span>{zh ? '返回星枢工坊 · 模组列表' : 'Back to Mods'}</span>
          </Link>
          <Link to="/extensions/creator" className="mr-guide-btn is-primary">
            <Sparkles size={14} />
            <span>{zh ? '前往创作者投稿入口' : 'Submit to Workshop'}</span>
          </Link>
        </div>
      </div>

      {/* 1. Architecture Overview */}
      <section className="mr-guide-card">
        <header className="mr-guide-card-head">
          <div className="mr-guide-card-title">
            <span className="mr-guide-icon">
              <Layers size={16} />
            </span>
            <div>
              <h2>{zh ? '一、宿主契约与自动适配能力' : '1. Host Contract & Auto-Adaptation'}</h2>
              <p>
                {zh
                  ? '一次注册，自动共享侧边栏入口、滚动容器、原版与毛玻璃皮肤切换。'
                  : 'One registration shares sidebar navigation, scrolling, and Glassmorphism theming.'}
              </p>
            </div>
          </div>
          <span className="mr-guide-tag">XingShuRuntime.UI</span>
        </header>

        <div className="mr-guide-feature-grid">
          {GUIDE_FEATURES.map((item) => (
            <div key={item.title} className="mr-guide-feature-item">
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Quick Callback API */}
      <section className="mr-guide-card">
        <header className="mr-guide-card-head">
          <div className="mr-guide-card-title">
            <span className="mr-guide-icon">
              <Code2 size={16} />
            </span>
            <div>
              <h2>{zh ? '二、快速接入：RegisterSimplePage（推荐）' : '2. Quick Start: RegisterSimplePage'}</h2>
              <p>
                {zh
                  ? '适合大多数设置面板、开关矩阵与状态监控类外部 Mod。'
                  : 'Best for settings panels, toggle grids, and status monitors.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="mr-guide-btn"
            onClick={() => handleCopy('simple', SIMPLE_PAGE_SNIPPET)}
          >
            {copiedKey === 'simple' ? <Check size={13} /> : <Copy size={13} />}
            <span>{copiedKey === 'simple' ? '已复制' : '复制代码'}</span>
          </button>
        </header>

        <pre className="mr-guide-code">
          <code>{SIMPLE_PAGE_SNIPPET}</code>
        </pre>
      </section>

      {/* 3. Full Interface API */}
      <section className="mr-guide-card">
        <header className="mr-guide-card-head">
          <div className="mr-guide-card-title">
            <span className="mr-guide-icon">
              <Puzzle size={16} />
            </span>
            <div>
              <h2>{zh ? '三、完整生命周期接入：IXingShuExternalPage' : '3. Full Interface: IXingShuExternalPage'}</h2>
              <p>
                {zh
                  ? '需要维护独立实例、缓存控件或动态刷新的复杂模块可实现该接口。'
                  : 'Implement IXingShuExternalPage for stateful views and live refresh hooks.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="mr-guide-btn"
            onClick={() => handleCopy('interface', INTERFACE_SNIPPET)}
          >
            {copiedKey === 'interface' ? <Check size={13} /> : <Copy size={13} />}
            <span>{copiedKey === 'interface' ? '已复制' : '复制代码'}</span>
          </button>
        </header>

        <pre className="mr-guide-code">
          <code>{INTERFACE_SNIPPET}</code>
        </pre>
      </section>

      {/* 4. Distribution & .xspkg */}
      <section className="mr-guide-card">
        <header className="mr-guide-card-head">
          <div className="mr-guide-card-title">
            <span className="mr-guide-icon">
              <PackagePlus size={16} />
            </span>
            <div>
              <h2>{zh ? '四、打包与星枢工坊分发规范' : '4. Packaging & Workshop Distribution'}</h2>
              <p>
                {zh
                  ? '可将优化扩展打包为 .xspkg / .zip 上传星枢工坊或直接在启动器导入测试。'
                  : 'Package into .xspkg / .zip to submit on XingShu Workshop or test locally.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="mr-guide-btn"
            onClick={() => handleCopy('xspkg', XSPKG_MANIFEST_SNIPPET)}
          >
            {copiedKey === 'xspkg' ? <Check size={13} /> : <Copy size={13} />}
            <span>{copiedKey === 'xspkg' ? '已复制' : '复制示例清单'}</span>
          </button>
        </header>

        <pre className="mr-guide-code" style={{ marginBottom: 14 }}>
          <code>{XSPKG_MANIFEST_SNIPPET}</code>
        </pre>

        <div className="mr-guide-footer-row">
          <span>
            提示：在游戏中按 <strong>F1</strong> 切换至「毛玻璃 UI」后，也可在左侧「扩展框架 → 扩展总览」直接查看本机实时挂载状态。
          </span>
          <div className="mr-guide-hero-actions">
            <Link className="mr-guide-btn" to="/extensions/mods">
              浏览全部星枢工坊 Mod
            </Link>
            <Link className="mr-guide-btn is-primary" to="/extensions/creator">
              投稿外部优化 Mod
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default ModrinthPluginGuidePage;
