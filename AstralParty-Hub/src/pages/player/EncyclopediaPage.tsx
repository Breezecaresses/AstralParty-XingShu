import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Coins, Map, ChevronRight, Sparkles } from 'lucide-react';
import { useEncyclopediaModOverrides, type EncyclopediaAssetOverride } from '../../shared/encyclopediaMods';
import { gameCatalog, plainGameText } from '../../shared/gameLibrary';
import { EncyclopediaTabs, GameImage, GameText, LibraryHeader, LibraryModal, useGameLibrary } from './LibraryUI';
import { EncyclopediaModSummary, LazyModArtwork, ModReplacedPill } from './ModOverrideUI';

type LibraryChip = { id: number; name: string; description: string; image: string; quality?: number; qualityName?: string; type?: number; typeName?: string; tags?: (number | string)[]; params?: number[] };
type LibraryMap = { id: number; name: string; description?: string; galleryDescription?: string; image?: string; sceneImage?: string; sceneIds?: number[]; modeIds?: number[]; galleryTypes?: number[]; specialChipIds?: number[]; difficulties?: { index?: number; name?: string; description?: string; turnLimit?: number; monsters?: { id: number; name: string; title: string }[] }[] };
type LibraryMode = { id: number; name: string; description?: string; rules?: string[] | string; mapIds?: number[]; group?: number; visible?: boolean };
type EncyclopediaCatalog = { chips?: LibraryChip[]; maps: LibraryMap[]; modes: LibraryMode[] };
const catalog = gameCatalog as unknown as EncyclopediaCatalog;
const galleryMaps = catalog.maps.filter(map => map.image && map.galleryTypes?.length);
const qualityColors = ['neutral', 'blue', 'purple', 'gold', 'rose', 'cyan'];

export function ChipsPage() {
  const state = useGameLibrary();
  const modOvr = useEncyclopediaModOverrides('chip');
  const [query, setQuery] = useState('');
  const [quality, setQuality] = useState('all');
  const [selectedModId, setSelectedModId] = useState('');
  const [onlyReplaced, setOnlyReplaced] = useState(false);
  const [showModdedArt, setShowModdedArt] = useState(true);
  const [detailVanilla, setDetailVanilla] = useState(false);
  const [selected, setSelected] = useState<LibraryChip | null>(null);
  const chips = catalog.chips || [];
  const qualities = [...new Set(chips.map(c => c.quality).filter(q => q !== undefined))].sort((a, b) => a! - b!);

  const pickChipOverride = (chip: LibraryChip): EncyclopediaAssetOverride | null => {
    const pool = [
      ...(modOvr.overridesByAsset.get(chip.image.toLowerCase()) ?? []),
      ...(modOvr.overridesByEntity.get(String(chip.id)) ?? []),
    ];
    if (selectedModId) return pool.find((o) => o.modId === selectedModId) ?? null;
    return pool.find((o) => o.enabled) ?? pool[0] ?? null;
  };

  const filtered = useMemo(() => chips.filter(c => {
    if (!`${c.name} ${plainGameText(c.description)} ${c.id}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (quality !== 'all' && c.quality !== Number(quality)) return false;
    if ((onlyReplaced || selectedModId) && !pickChipOverride(c)) return false;
    return true;
  }), [chips, query, quality, onlyReplaced, selectedModId, modOvr.overridesByAsset, modOvr.overridesByEntity]);
  const qualityLabel = (chip: LibraryChip) => chip.qualityName || (chip.quality !== undefined ? `品质 ${chip.quality}` : '合作挑战筹码');
  const detailOv = selected ? pickChipOverride(selected) : null;
  return <div>
    <EncyclopediaTabs />
    <LibraryHeader title="筹码图鉴" description="合作挑战中的强化选择，查看筹码品质与完整效果" state={state} />
    <div className="encyclopedia-banner"><div className="encyclopedia-banner-icon"><Coins size={30} /></div><div><h2>为每一次冒险做好准备</h2><p>{chips.length ? `${chips.length} 个筹码配置 · 所有效果来自当前游戏版本` : '筹码配置正在准备中'}</p></div><Link to="/player/maps">查看地图 <ChevronRight size={17} /></Link></div>
    <EncyclopediaModSummary
      sectionLabel="筹码图鉴"
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
    <div className="library-filters"><input aria-label="搜索筹码" placeholder="搜索筹码名称或效果…" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="筹码品质" value={quality} onChange={e => setQuality(e.target.value)}><option value="all">全部品质</option>{qualities.map(q => <option value={q} key={q}>{chips.find(c => c.quality === q)?.qualityName || `品质 ${q}`}</option>)}</select><span>{filtered.length} 个筹码</span></div>
    <div className="chip-grid">{filtered.map(chip => {
      const ov = pickChipOverride(chip);
      return <button className={`chip-card quality-${qualityColors[chip.quality ?? 0] || 'neutral'}`} key={chip.id} onClick={() => { setSelected(chip); setDetailVanilla(false); }}>
        <header><span>{qualityLabel(chip)}</span><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}><h3>{chip.name}</h3><ModReplacedPill override={ov} compact /></div></header>
        <div className="chip-art"><LazyModArtwork installationId={modOvr.installationId} override={ov} active={Boolean(ov && showModdedArt && ov.enabled)} alt={chip.name} className="library-image" fallback={<GameImage asset={chip.image} name={chip.name} />} /></div>
        <div className="chip-description"><GameText text={chip.description} /><small>#{chip.id}{ov ? ` · ${ov.modName}` : ''}</small></div>
      </button>;
    })}</div>
    {!filtered.length && <div className="library-empty">{chips.length ? '没有符合条件的筹码。' : '尚未导入游戏的筹码配置。'}</div>}
    {selected && <LibraryModal title={selected.name} close={() => setSelected(null)}><div className="chip-detail"><div className={`chip-detail-art quality-${qualityColors[selected.quality ?? 0] || 'neutral'}`}><LazyModArtwork installationId={modOvr.installationId} override={detailOv} active={Boolean(detailOv && !detailVanilla)} alt={selected.name} className="library-image" fallback={<GameImage asset={selected.image} name={selected.name} />} /></div><div><span className="library-tag">{qualityLabel(selected)}</span>{selected.typeName && <span className="library-tag">{selected.typeName}</span>}{detailOv && <span className="library-tag">Mod: {detailOv.modName}</span>}<h3>{selected.name}</h3><GameText text={selected.description} />{detailOv && <div className="mod-ovr-detail-bar" style={{ marginTop: 12 }}><span>已替换为「{detailOv.modName}」（<code>{detailOv.assetName}</code>）</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetailVanilla((v) => !v)}>{detailVanilla ? '显示 Mod 替换图' : '对比原版图'}</button></div>}<p className="card-data-caption library-text">筹码 #{selected.id} · 官方配置 {gameCatalog.version}</p></div></div></LibraryModal>}
  </div>;
}

export function MapsPage() {
  const state = useGameLibrary();
  const modOvr = useEncyclopediaModOverrides('map');
  const [query, setQuery] = useState('');
  const [modeId, setModeId] = useState('all');
  const [selectedModId, setSelectedModId] = useState('');
  const [onlyReplaced, setOnlyReplaced] = useState(false);
  const [showModdedArt, setShowModdedArt] = useState(true);
  const [detailVanilla, setDetailVanilla] = useState(false);
  const [selected, setSelected] = useState<LibraryMap | null>(null);
  const [showScene, setShowScene] = useState(false);
  const [tab, setTab] = useState('maps');
  const modes = catalog.modes.filter(m => m.visible !== false && m.name);

  const pickMapOverride = (m: LibraryMap, sceneMode = false): EncyclopediaAssetOverride | null => {
    const primaryAsset = (sceneMode ? m.sceneImage : m.image) || m.sceneImage || m.image;
    const secondaryAsset = sceneMode ? m.image : m.sceneImage;
    const pool = [
      ...(primaryAsset ? modOvr.overridesByAsset.get(primaryAsset.toLowerCase()) ?? [] : []),
      ...(secondaryAsset ? modOvr.overridesByAsset.get(secondaryAsset.toLowerCase()) ?? [] : []),
      ...(modOvr.overridesByEntity.get(String(m.id)) ?? []),
    ];
    if (selectedModId) return pool.find((o) => o.modId === selectedModId) ?? null;
    return pool.find((o) => o.enabled) ?? pool[0] ?? null;
  };

  const maps = galleryMaps.filter(m => {
    if (!m.name || !`${m.name} ${plainGameText(m.description || '')} ${m.id}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (modeId !== 'all' && !(m.modeIds?.includes(Number(modeId)) || modes.find(mode => mode.id === Number(modeId))?.mapIds?.includes(m.id))) return false;
    if ((onlyReplaced || selectedModId) && !pickMapOverride(m)) return false;
    return true;
  });
  const relatedModes = (map: LibraryMap) => modes.filter(m => map.modeIds?.includes(m.id) || m.mapIds?.includes(map.id));
  const rules = (mode: LibraryMode) => Array.isArray(mode.rules) ? mode.rules.join('\n') : mode.rules;
  const effects = gameCatalog.mutators.filter(m => `${m.name} ${plainGameText(m.description)} ${m.id}`.toLowerCase().includes(query.toLowerCase()));
  const detailOv = selected ? pickMapOverride(selected, showScene) : null;
  return <div>
    <EncyclopediaTabs />
    <LibraryHeader title="地图与场地" description="地图详情、玩法规则与特殊场地效果" state={state} />
    <div className="encyclopedia-banner map-banner"><div className="encyclopedia-banner-icon"><Map size={30} /></div><div><h2>下一站，去哪里？</h2><p>{galleryMaps.length} 张地图 · {modes.length} 种玩法</p></div><Link to="/player/chips">查看筹码 <ChevronRight size={17} /></Link></div>
    <EncyclopediaModSummary
      sectionLabel="地图与场地"
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
    <div className="library-tabs"><button className={`btn ${tab === 'maps' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('maps')}>地图详情</button><button className={`btn ${tab === 'modes' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('modes')}>玩法规则</button><button className={`btn ${tab === 'effects' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('effects')}>特殊场地效果</button></div>
    <div className="library-filters"><input aria-label="搜索地图与效果" placeholder={tab === 'effects' ? '搜索场地效果…' : '搜索地图名称或说明…'} value={query} onChange={e => setQuery(e.target.value)} />{tab === 'maps' && <select aria-label="地图玩法" value={modeId} onChange={e => setModeId(e.target.value)}><option value="all">全部玩法</option>{modes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}</div>
    {tab === 'maps' && <div className="map-grid">{maps.map(map => {
      const ov = pickMapOverride(map);
      return <button className="map-card" key={map.id} onClick={() => { setSelected(map); setShowScene(false); setDetailVanilla(false); }}><div className="map-card-art"><LazyModArtwork installationId={modOvr.installationId} override={ov} active={Boolean(ov && showModdedArt && ov.enabled)} alt={map.name} className="library-image" fallback={<GameImage asset={map.image || map.sceneImage || ''} name={map.name} />} /><span>MAP / {map.id}</span><ModReplacedPill override={ov} compact /></div><div><h3>{map.name} <ChevronRight size={18} /></h3><div className="map-mode-tags">{relatedModes(map).slice(0, 3).map(mode => <span className="library-tag" key={mode.id}>{mode.name}</span>)}</div><p>{plainGameText(map.galleryDescription || map.description || '查看地图详情与适用玩法')}</p></div></button>;
    })}</div>}
    {tab === 'maps' && !maps.length && <div className="library-empty">没有符合条件的地图。</div>}
    {tab === 'modes' && <div className="mode-grid">{modes.filter(m => `${m.name} ${m.description || ''}`.toLowerCase().includes(query.toLowerCase())).map(mode => <article className="mode-card" key={mode.id}><h3>{mode.name}</h3><GameText text={mode.description} />{rules(mode) && <div className="mode-rules"><GameText text={rules(mode)} /></div>}<div className="mode-map-links">{galleryMaps.filter(map => map.modeIds?.includes(mode.id) || mode.mapIds?.includes(map.id)).map(map => <button className="btn btn-secondary" key={map.id} onClick={() => { setSelected(map); setShowScene(false); }}>{map.name}</button>)}</div></article>)}</div>}
    {tab === 'effects' && <><p className="library-text library-section">以下为游戏中的特殊规则与场地效果，在对应玩法生效。</p><div className="field-effect-grid">{effects.map(effect => <article className="field-effect" key={effect.id}><GameImage asset={effect.image} name={effect.name} /><div><h3><Sparkles size={15} />{effect.name}</h3><GameText text={effect.description} /></div></article>)}</div>{!effects.length && <div className="library-empty">没有符合条件的场地效果。</div>}</>}
    {selected && <LibraryModal title={selected.name} close={() => setSelected(null)}><div className="map-detail"><div className="map-detail-visual"><LazyModArtwork installationId={modOvr.installationId} override={detailOv} active={Boolean(detailOv && !detailVanilla)} alt={selected.name} className="library-image" fallback={<GameImage asset={(showScene ? selected.sceneImage : selected.image) || selected.sceneImage || selected.image || ''} name={selected.name} />} />{selected.image && selected.sceneImage && selected.image !== selected.sceneImage && <div className="library-tabs"><button className={`btn ${!showScene ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShowScene(false)}>地图预览</button><button className={`btn ${showScene ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShowScene(true)}>场景一览</button></div>}{detailOv && <div className="mod-ovr-detail-bar" style={{ marginTop: 12 }}><span>Mod: <strong>{detailOv.modName}</strong> (<code>{detailOv.assetName}</code>)</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetailVanilla((v) => !v)}>{detailVanilla ? '显示 Mod 替换图' : '对比原版图'}</button></div>}</div><div><span className="library-tag">地图 #{selected.id}</span>{detailOv && <span className="library-tag">{detailOv.modName} 替换中</span>}<h3>{selected.name}</h3><GameText text={selected.galleryDescription || selected.description} />{!!selected.galleryDescription && selected.description && selected.description !== selected.galleryDescription && <div className="library-section"><GameText text={selected.description} /></div>}<div className="map-detail-modes"><h4>适用玩法</h4>{relatedModes(selected).length ? relatedModes(selected).map(mode => <details key={mode.id}><summary>{mode.name}</summary><GameText text={mode.description} />{rules(mode) && <GameText text={rules(mode)} />}</details>) : <p className="library-text">配置暂未提供关联玩法。</p>}</div>{!!selected.difficulties?.length && <div className="map-difficulty-list"><h4>挑战难度</h4>{selected.difficulties.map((difficulty, i) => <details key={difficulty.index ?? i}><summary>{difficulty.name}{!!difficulty.turnLimit && <span>{difficulty.turnLimit} 回合上限</span>}</summary><GameText text={difficulty.description} />{!!difficulty.monsters?.length && <p className="library-text">场地怪物：{difficulty.monsters.map(monster => monster.name || monster.title).join('、')}</p>}</details>)}</div>}{!!selected.specialChipIds?.length && <div className="library-section"><h4>地图专属筹码</h4><div className="map-special-chips">{(catalog.chips || []).filter(chip => selected.specialChipIds?.includes(chip.id)).map(chip => <div key={chip.id}><GameImage asset={chip.image} name={chip.name} /><div><strong>{chip.name}</strong><GameText text={chip.description} /></div></div>)}</div></div>}</div></div></LibraryModal>}
  </div>;
}
