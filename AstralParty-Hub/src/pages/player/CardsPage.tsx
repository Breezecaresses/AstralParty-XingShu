import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEncyclopediaModOverrides, type EncyclopediaAssetOverride } from '../../shared/encyclopediaMods';
import { cardTypes, gameCatalog } from '../../shared/gameLibrary';
import type { LibraryCard } from '../../shared/gameLibrary';
import { EncyclopediaTabs, GameImage, GameText, LibraryHeader, LibraryModal, LibraryStats, useGameLibrary } from './LibraryUI';
import { AltArtImage, FullGameCard } from './FullGameCard';
import type { AnimatedAltArt } from './FullGameCard';
import { EncyclopediaModSummary, LazyModArtwork } from './ModOverrideUI';

export function CardsPage() {
  const state = useGameLibrary();
  const modOvr = useEncyclopediaModOverrides('card');
  const [tab, setTab] = useState('cards');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [selectedModId, setSelectedModId] = useState('');
  const [onlyReplaced, setOnlyReplaced] = useState(false);
  const [showModdedArt, setShowModdedArt] = useState(true);
  const [detailVanilla, setDetailVanilla] = useState(false);
  const [card, setCard] = useState<LibraryCard | null>(null);
  const [art, setArt] = useState<AnimatedAltArt | null>(null);
  const [motion, setMotion] = useState(true);
  const altArts = gameCatalog.altArts as AnimatedAltArt[];

  const resolveCardOverride = (c: LibraryCard, a?: AnimatedAltArt | null): EncyclopediaAssetOverride | null => {
    const candidateKeys = [
      a?.image?.toLowerCase(),
      c.image?.toLowerCase(),
    ].filter(Boolean) as string[];
    const pool: EncyclopediaAssetOverride[] = [];
    for (const k of candidateKeys) {
      for (const hit of modOvr.overridesByAsset.get(k) ?? []) pool.push(hit);
    }
    if (!a) {
      for (const hit of modOvr.overridesByEntity.get(String(c.id)) ?? []) pool.push(hit);
    }
    if (selectedModId) {
      return pool.find((o) => o.modId === selectedModId) ?? null;
    }
    return pool.find((o) => o.enabled) ?? pool[0] ?? null;
  };

  const matches = (r: { id: number; name: string; description: string }) => `${r.id} ${r.name} ${r.description}`.toLowerCase().includes(query.toLowerCase());
  const cards = gameCatalog.cards.filter((c) => {
    if (!matches(c)) return false;
    if (type !== 'all' && c.type !== Number(type)) return false;
    if (tab === 'dedicated' && !c.dedicated) return false;
    if (onlyReplaced || selectedModId) {
      const ov = resolveCardOverride(c);
      if (!ov) return false;
    }
    return true;
  });
  const arts = altArts.filter((a) => {
    if (!matches(a)) return false;
    if (onlyReplaced || selectedModId) {
      const base = gameCatalog.cards.find((c) => c.id === a.cardId);
      if (!base || !resolveCardOverride(base, a)) return false;
    }
    return true;
  });
  const relatedArts = altArts.filter(a => a.cardId === card?.id);
  const openCard = (next: LibraryCard, nextArt: AnimatedAltArt | null = null) => { setCard(next); setArt(nextArt); setDetailVanilla(false); };
  const stepCard = (direction: number) => {
    const list = tab === 'art' ? arts.map(a => ({ card: gameCatalog.cards.find(c => c.id === a.cardId), art: a })).filter(r => r.card) : cards.map(c => ({ card: c, art: null }));
    const index = list.findIndex(r => r.card?.id === card?.id && r.art?.id === art?.id);
    if (list.length) { const next = list[(index + direction + list.length) % list.length]; openCard(next.card!, next.art); }
  };
  const detailOverride = card ? resolveCardOverride(card, art) : null;
  return <div>
    <EncyclopediaTabs />
    <LibraryHeader title="卡牌图鉴" description="完整竖版卡面、详细效果与动态异画收藏" state={state} />
    <LibraryStats items={[{ label: '卡牌图鉴', value: gameCatalog.cards.length }, { label: '角色专属卡', value: gameCatalog.cards.filter(c => c.dedicated).length }, { label: '异画卡牌', value: altArts.length }, { label: '已替换卡面', value: modOvr.replacedCount > 0 ? modOvr.replacedCount : state.account ? altArts.filter(a => state.account!.snapshot.altArts.includes(a.id)).length : '待同步' }]} />
    <EncyclopediaModSummary
      sectionLabel="卡牌图鉴"
      installedMods={modOvr.installedMods}
      allInstalledMods={modOvr.allInstalledMods}
      replacedCount={modOvr.replacedCount}
      selectedModId={selectedModId}
      onSelectModId={setSelectedModId}
      onlyReplaced={onlyReplaced}
      onToggleOnlyReplaced={() => setOnlyReplaced((v) => !v)}
      showModdedArt={showModdedArt}
      onToggleShowModdedArt={() => setShowModdedArt((v) => !v)}
    />
    <div className="card-library-toolbar"><div className="library-tabs">{[['cards', '全部卡牌'], ['dedicated', '角色专属'], ['art', '异画卡牌']].map(([key, label]) => <button key={key} className={`btn ${tab === key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(key)}>{label}</button>)}</div><Link to="/player/chips">筹码图鉴 <ChevronRight size={15} /></Link></div>
    <div className="library-filters"><input aria-label="搜索卡牌" placeholder="搜索名称、卡牌效果或编号…" value={query} onChange={e => setQuery(e.target.value)} />{tab !== 'art' && <select aria-label="卡牌分类" value={type} onChange={e => setType(e.target.value)}><option value="all">全部类型</option>{cardTypes.map((label, i) => <option key={i} value={i}>{label}</option>)}</select>}{tab === 'art' && <label className="library-check"><input type="checkbox" checked={motion} onChange={e => setMotion(e.target.checked)} />播放动态卡面</label>}<span>{tab === 'art' ? arts.length : cards.length} 张卡牌</span></div>
    <div className="full-card-grid">{tab === 'art' ? arts.map(a => {
      const base = gameCatalog.cards.find(c => c.id === a.cardId);
      const ov = base ? resolveCardOverride(base, a) : null;
      const useModArt = Boolean(ov && showModdedArt && ov.enabled);
      return base && <div key={a.id} className="full-card-entry"><button className="full-card-button" onClick={() => openCard(base, a)} aria-label={`查看${a.name}详情`}><FullGameCard card={base} art={a} motion={motion} modOverrideName={ov?.modName} modOverrideEnabled={ov?.enabled} modOverrideSlot={useModArt ? <LazyModArtwork installationId={modOvr.installationId} override={ov} active={useModArt} alt={a.name} className="library-image" fallback={<AltArtImage card={base} art={a} />} /> : undefined} /></button><div className="full-card-entry-caption"><strong>{a.name}</strong><span>{!state.account ? '持有未知' : state.account.snapshot.altArts.includes(a.id) ? '已持有' : '未持有'}{a.animationKind === 'video' ? ' · 动态卡面' : a.animated ? ' · 游戏原生特效' : ''}</span></div></div>;
    }) : cards.map(c => {
      const ov = resolveCardOverride(c);
      const useModArt = Boolean(ov && showModdedArt && ov.enabled);
      return <div key={c.id} className="full-card-entry"><button className="full-card-button" onClick={() => openCard(c)} aria-label={`查看${c.name}详情`}><FullGameCard card={c} modOverrideName={ov?.modName} modOverrideEnabled={ov?.enabled} modOverrideSlot={useModArt ? <LazyModArtwork installationId={modOvr.installationId} override={ov} active={useModArt} alt={c.name} className="library-image" fallback={<AltArtImage card={c} />} /> : undefined} /></button>{c.dedicated && <span className="library-tag card-dedicated-label">角色专属</span>}</div>;
    })}</div>
    {!(tab === 'art' ? arts : cards).length && <div className="library-empty">没有符合条件的卡牌。</div>}
    {card && <LibraryModal title={art?.name || card.name || '卡牌详情'} close={() => { setCard(null); setArt(null); }}>
      <div className="full-card-detail">
        <div className="full-card-focus">
          <FullGameCard
            card={card}
            art={art}
            motion={motion}
            allowSpine
            modOverrideName={detailOverride?.modName}
            modOverrideEnabled={detailOverride?.enabled}
            modOverrideSlot={
              detailOverride && !detailVanilla ? (
                <LazyModArtwork
                  installationId={modOvr.installationId}
                  override={detailOverride}
                  active={true}
                  alt={art?.name || card.name}
                  className="library-image"
                  fallback={<AltArtImage card={card} art={art} />}
                />
              ) : undefined
            }
          />
          {detailOverride && (
            <div className="mod-ovr-detail-bar">
              <span>来自 Mod：<strong>{detailOverride.modName}</strong>（<code>{detailOverride.assetName}</code> · {detailOverride.enabled ? '已开启' : '已关闭'}）</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetailVanilla((v) => !v)}>
                {detailVanilla ? '查看 Mod 替换图' : '对比游戏原版图'}
              </button>
            </div>
          )}
          <div className="full-card-pagination"><button className="btn btn-secondary" aria-label="上一张卡牌" onClick={() => stepCard(-1)}><ChevronLeft size={17} /> 上一张</button><button className="btn btn-secondary" aria-label="下一张卡牌" onClick={() => stepCard(1)}>下一张 <ChevronRight size={17} /></button></div>
        </div>
        <div><div className="library-section"><span className="library-tag">{cardTypes[card.type] || '其他'}</span><span className="library-tag">行动点消耗 {card.cost}</span>{card.dedicated && <span className="library-tag">角色专属</span>}{detailOverride && <span className="library-tag">{detailOverride.modName} 替换中</span>}<h3 className="card-detail-name">{card.name}</h3><GameText text={card.description} /></div>
          {(art || relatedArts.length > 0) && <div className="library-section"><h3><Sparkles size={17} /> 卡面版本</h3><div className="card-version-options"><button className={!art ? 'selected' : ''} onClick={() => setArt(null)}><GameImage asset={card.image} name={card.name} /><span>原始卡面</span></button>{relatedArts.map(a => <button key={a.id} className={art?.id === a.id ? 'selected' : ''} onClick={() => setArt(a)}><AltArtImage card={card} art={a} /><span>{a.name}</span></button>)}</div></div>}
          {art && <div className="card-animation-info"><span className="library-tag">{!state.account ? '持有未知' : state.account.snapshot.altArts.includes(art.id) ? '已持有' : '未持有'}</span><GameText text={art.description} />{(art.video && gameCatalog.assets[art.video]) || art.spine ? <label className="library-check"><input type="checkbox" checked={motion} onChange={e => setMotion(e.target.checked)} />播放游戏原始动态卡面</label> : art.animated ? <p className="library-text">此异画暂未加载动态资源，当前展示静态卡面。</p> : null}</div>}
          {card.comment && <div className="library-section"><h3>卡牌说明</h3><GameText text={card.comment} /></div>}
          {!!card.relatedCards.length && <div className="library-section"><h3>关联卡牌</h3><div className="library-tabs">{card.relatedCards.map(id => <button className="btn btn-secondary" key={id} onClick={() => openCard(gameCatalog.cards.find(c => c.id === id) || card)}>{gameCatalog.cards.find(c => c.id === id)?.name || `卡牌 #${id}`}</button>)}</div></div>}
          <p className="library-text card-data-caption">{card.number || `#${card.id}`} · 官方配置 {gameCatalog.version}</p>
        </div>
      </div>
    </LibraryModal>}
  </div>;
}
