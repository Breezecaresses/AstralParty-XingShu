import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link } from 'react-router-dom';
import { FileText, FolderOpen, Package, Puzzle, RefreshCw, Trash2, Upload } from 'lucide-react';
import { api } from '../../shared/api/tauri';
import { isTauriRuntime } from '../../shared/runtime';
import { DesktopOnlyBanner } from '../../components/DesktopOnlyBanner';
import type { GameInstallation } from '../../shared/types';
import { AndroidInstallPanel } from './AndroidInstallPanel';
import { ExternalModsPanel } from './ExternalModsPanel';
import { ImportPackagePage } from './ImportPackagePage';
import { ModDropInspector } from './ModDropInspector';
import { WorkshopPanel } from './WorkshopPanel';
import './extensions.css';

export const extensionChannels = [['STEAM_CN', 'Steam 国服'], ['STEAM_GLOBAL', 'Steam 国际服'], ['TAPTAP', 'TapTap Windows'], ['BILIBILI', '哔哩哔哩'], ['WEGAME', 'WeGame']] as const;
export interface ExtensionEntry { id: string; packageId: string; name: string; category: string; version: string | null; path: string; source: string; status: string; description: string; managed: boolean }
export interface Inventory { entries: ExtensionEntry[]; pluginDirectory: string; modDirectory: string; resourceDirectory: string; warnings: string[]; installerAvailable: boolean }
const message = (e: unknown) => e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
export const categoryName = (category: string) => ({ 'xingshu-plugin': 'DLL / 功能插件', mod: '游戏模组', 'resource-pack': '资源包' }[category] || category);

export function useExtensionTarget() {
  const [channel, setChannelState] = useState(() => localStorage.getItem('extensions.channel') || 'STEAM_CN');
  const [targets, setTargets] = useState<GameInstallation[]>([]);
  const [id, setId] = useState(() => localStorage.getItem(`extensions.target.${channel}`) || '');
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pendingScan = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (!isTauriRuntime()) return Promise.resolve();
    if (pendingScan.current) return pendingScan.current;
    setBusy(true);
    const scan = invoke<GameInstallation[]>('list_extension_targets')
      .then((result) => { setTargets(result); setError(''); })
      .catch((e) => setError(message(e)))
      .finally(() => { pendingScan.current = null; setBusy(false); });
    pendingScan.current = scan;
    return scan;
  }, []);
  useEffect(() => { if (isTauriRuntime()) void refresh(); }, [refresh]);
  const options = targets.filter(g => g.platform === channel);
  const selected = options.find(g => g.id === id) || options[0];
  const select = (value: string) => { setId(value); localStorage.setItem(`extensions.target.${channel}`, value); };
  const setChannel = (value: string) => { setChannelState(value); localStorage.setItem('extensions.channel', value); setId(localStorage.getItem(`extensions.target.${value}`) || ''); setPath(''); setError(''); };
  const save = async () => {
    if (!path.trim()) return;
    setBusy(true); setError('');
    try {
      const game = await invoke<GameInstallation>('register_extension_target', { platformId: channel, path: path.trim() });
      setTargets(old => [...old.filter(g => g.id !== game.id), game]); select(game.id); setPath('');
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  return { channel, setChannel, targets, options, selected, select, path, setPath, error, busy, save, refresh };
}
export function ExtensionTargetPicker({ target, disabled = false, purpose = 'install', compact = false }: { target: ReturnType<typeof useExtensionTarget>; disabled?: boolean; purpose?: 'install' | 'diagnose'; compact?: boolean }) {
  return <section className="panel extension-target" aria-label="扩展安装位置">
    <div className="extension-target-title"><FolderOpen size={19} /><strong>{purpose === 'diagnose' ? '检查渠道与游戏目录' : '渠道与安装位置'}</strong><span>{purpose === 'diagnose' ? '仅检查下方选定目录的文件、进程与连接' : '扩展只安装到下方选定目录'}</span></div>
    <div className="extension-channels">{extensionChannels.map(([id, name]) => <button key={id} className={`btn ${target.channel === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => target.setChannel(id)} disabled={disabled}>{name}<small>{target.targets.filter(g => g.platform === id).length || '未配置'}</small></button>)}</div>
    <div className="extension-location"><select aria-label="选择游戏安装位置" value={target.selected?.id || ''} disabled={disabled || !target.options.length} onChange={e => target.select(e.target.value)}>{!target.options.length && <option value="">此渠道尚未配置安装位置</option>}{target.options.map(g => <option key={g.id} value={g.id}>{g.install_path}</option>)}</select><button className="btn btn-secondary" disabled={target.busy || disabled} onClick={() => void target.refresh()}><RefreshCw size={14} />重新检测</button></div>
    {compact ? (
      <details className="mod-notes" style={{ margin: '8px 0 4px' }}>
        <summary>手动添加或指定其他游戏目录</summary>
        <form className="extension-location" style={{ marginTop: 8 }} onSubmit={e => { e.preventDefault(); void target.save(); }}><input aria-label="添加游戏安装路径" value={target.path} disabled={disabled} onChange={e => target.setPath(e.target.value)} placeholder="粘贴实际游戏 exe 或所在文件夹的完整路径" /><button className="btn btn-secondary" disabled={target.busy || disabled || !target.path.trim()}>保存此位置</button></form>
      </details>
    ) : (
      <form className="extension-location" onSubmit={e => { e.preventDefault(); void target.save(); }}><input aria-label="添加游戏安装路径" value={target.path} disabled={disabled} onChange={e => target.setPath(e.target.value)} placeholder="添加另一安装位置：粘贴实际游戏 exe 或所在文件夹的完整路径" /><button className="btn btn-secondary" disabled={target.busy || disabled || !target.path.trim()}>保存此位置</button></form>
    )}
    {target.selected && <p className="extension-path">实际游戏程序：<code>{target.selected.executable_path}</code></p>}
    {target.error && <p className="extension-error" role="alert">{target.error}</p>}
  </section>;
}

export function ExtensionManager({ view }: { view: 'packages' | 'mods' }) {
  const target = useExtensionTarget();
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loadedId, setLoadedId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++request.current;
    setInventory(null); setLoadedId(''); setError('');
    if (!target.selected) { setBusy(false); return; }
    setBusy(true);
    try { const result = await invoke<Inventory>('get_extension_inventory', { installationId: target.selected.id }); if (ticket === request.current) { setInventory(result); setLoadedId(target.selected.id); } }
    catch (e) { if (ticket === request.current) setError(message(e)); } finally { if (ticket === request.current) setBusy(false); }
  }, [target.selected?.id]);
  useEffect(() => { void refresh(); return () => { request.current++; }; }, [refresh]);
  const current = loadedId === target.selected?.id ? inventory : null;
  const runtime = current?.entries.find(e => e.id === 'builtin.runtime');
  const entries = (current?.entries || []).filter(e => e.id !== 'builtin.runtime');
  const visible = entries.filter(e => `${e.name} ${e.packageId} ${e.description}`.toLowerCase().includes(query.toLowerCase()));
  const uninstall = async (entry: ExtensionEntry) => {
    if (!target.selected || !confirm(`从 ${target.selected.install_path} 移除“${entry.name}”？只删除此位置由 Hub 记录且校验一致的文件；安装前备份仍保留。`)) return;
    setActionBusy(true); setError('');
    try { await api.uninstallExtension(entry.id, entry.category === 'xingshu-plugin', target.selected.id); await refresh(); }
    catch (e) { setError(message(e)); } finally { setActionBusy(false); }
  };
  const exportDesktopLog = () => {
    const now = new Date().toISOString();
    const content = [
      '=== 星枢 Hub · 电脑端模组诊断日志 ===',
      `导出时间: ${now}`,
      `渠道: ${target.channel}`,
      `安装目录: ${target.selected?.install_path || '未选择'}`,
      `游戏程序: ${target.selected?.executable_path || '未选择'}`,
      `当前运行时状态: ${runtime ? `${runtime.version || ''} (${runtime.status})` : '未识别为本版星枢'}`,
      '',
      '--- 错误信息 ---',
      error || '无直接错误',
      '',
      '--- 警告与冲突检测 ---',
      ...(current?.warnings?.length ? current.warnings : ['无警告']),
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `XingShu-Desktop-Failure-${now.replace(/[:.]/g, '-')}.log`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  };
  const packages = view === 'packages';
  if (packages) {
    return <div>
      <DesktopOnlyBanner feature="extensions" />
      <header className="extension-header">
        <div>
          <h1>手机连接与安装</h1>
          <p>通过 USB 或无线调试连接安卓手机，安装、更新或还原星枢组件</p>
        </div>
        <div>
          <Link className="btn btn-secondary" to="/dashboard">前往启动页</Link>
          <Link className="btn btn-secondary" to="/extensions/mods">管理游戏模组</Link>
        </div>
      </header>
      <AndroidInstallPanel defaultExpanded />
      <section className="panel extension-runtime" style={{ marginTop: 16 }}>
        <Puzzle size={22} />
        <div>
          <h2>电脑端已自动托管安装</h2>
          <p>Steam 国服 / TapTap / 哔哩哔哩 / WeGame 等电脑渠道已在「启动」页自动检测目录并完成安装与更新，无需再使用旧版电脑安装包。</p>
        </div>
      </section>
    </div>;
  }
  return <div>
    <DesktopOnlyBanner feature="extensions" />
    <header className="extension-header"><div><h1>游戏模组</h1><p>统一管理外部 DLL、加速组件、立绘、模型、卡面与语音替换</p></div><div><button className="btn btn-secondary" onClick={() => void refresh()} disabled={busy || actionBusy}><RefreshCw size={14} />刷新</button><button className="btn btn-primary" disabled={actionBusy} onClick={() => setImportOpen(v => !v)}><Upload size={14} />{importOpen ? '收起模组包安装' : '安装模组包'}</button></div></header>
    <ExtensionTargetPicker target={target} disabled={actionBusy} />
    <ModDropInspector
      installationId={target.selected?.id ?? null}
      onBusy={setActionBusy}
      disabled={actionBusy}
      onInstalled={() => void refresh()}
    />
    <WorkshopPanel
      installationId={target.selected?.id ?? null}
      installation={target.selected ?? null}
      onBusy={setActionBusy}
      disabled={actionBusy}
      onInstalled={() => void refresh()}
    />
    {target.selected && <>
      {importOpen && <ImportPackagePage key={target.selected.id} target={target} onBusy={setActionBusy} disabled={actionBusy} onInstalled={() => void refresh()} />}
      <ExternalModsPanel key={target.selected.id} installationId={target.selected.id} onBusy={setActionBusy} disabled={actionBusy} />
      <details className="mod-notes"><summary>其他本地文件与模组包安装记录（{entries.length}）</summary>
        <section className="panel extension-toolbar"><input aria-label="搜索其他本地模组" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索名称或描述…" /></section>
        <div className="extension-grid">{visible.map(entry => <article className="panel extension-card" key={entry.id}><h2>{entry.name}</h2><div className="extension-tags"><span>{categoryName(entry.category)}</span><span>{entry.source}</span></div><p>{entry.description}</p><code className="extension-path">{entry.path}</code><footer><span>{entry.status}</span>{entry.managed && <button className="btn btn-danger btn-sm" disabled={actionBusy} onClick={() => void uninstall(entry)}><Trash2 size={13} />卸载</button>}</footer></article>)}</div>
        {!visible.length && <p className="extension-path">尚未检测到其他本地模组。</p>}
      </details>
    </>}
    {!target.selected && <div className="panel extension-empty"><Package size={32} /><h2>先配置此渠道的游戏位置</h2><p>选择或添加实际游戏目录后，即可检查和管理该位置的模组。</p></div>}
    {(!!error || !!current?.warnings.length) && <div className="extension-hint" role="status"><span>{error || current?.warnings.join(' ')}</span> <button className="btn btn-secondary btn-sm" type="button" onClick={exportDesktopLog}><FileText size={13} />导出失败日志</button></div>}
  </div>;
}
