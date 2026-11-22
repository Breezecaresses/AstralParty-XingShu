import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link } from 'react-router-dom';
import { Activity, Cpu, FileCheck2, Radio, RefreshCw } from 'lucide-react';
import { isTauriRuntime } from '../../shared/runtime';
import { DesktopOnlyBanner } from '../../components/DesktopOnlyBanner';
import { ExtensionTargetPicker, useExtensionTarget, type Inventory } from '../extensions/ExtensionWorkspace';
import { selectedRuntimeSessions } from './selectedRuntimeSessions';

interface Session {
  connectionId: string; platformId: string; pid: number; executablePath?: string;
  runtimeVersion?: string; boundRole?: string; connectionState: string; lastSeenAt?: string;
}
interface ProcessState { processIds: number[]; bepInExFilesDetected: boolean }
const errorText = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);

export function RuntimeDiagnosticsPanel() {
  const target = useExtensionTarget();
  const game = target.selected;
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [process, setProcess] = useState<ProcessState | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [liveId, setLiveId] = useState('');
  const [loadedId, setLoadedId] = useState('');
  const [error, setError] = useState('');
  const [liveError, setLiveError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const ticket = ++request.current;
    setInventory(null); setLoadedId(''); setError('');
    if (!game) { setBusy(false); return; }
    setBusy(true);
    try {
      const result = await invoke<Inventory>('get_extension_inventory', { installationId: game.id });
      if (ticket === request.current) { setInventory(result); setLoadedId(game.id); }
    } catch (error) { if (ticket === request.current) setError(errorText(error)); }
    finally { if (ticket === request.current) setBusy(false); }
  }, [game?.id]);
  useEffect(() => { void refresh(); return () => { request.current++; }; }, [refresh]);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setLiveId(''); setProcess(null); setSessions([]); setLiveError('');
    const poll = async () => {
      if (!game || !isTauriRuntime()) return;
      const results = await Promise.allSettled([
        invoke<Session[]>('get_runtime_sessions'),
        invoke<ProcessState>('get_extension_runtime_state', { installationId: game.id }),
      ]);
      if (cancelled) return;
      setLiveId(game.id);
      setSessions(results[0].status === 'fulfilled' ? selectedRuntimeSessions(results[0].value, game.platform, game.executable_path) : []);
      setProcess(results[1].status === 'fulfilled' ? results[1].value : null);
      setLiveError(results.filter(result => result.status === 'rejected').map(result => errorText((result as PromiseRejectedResult).reason)).join('；'));
      timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [game?.id, game?.platform, game?.executable_path]);
  const current = loadedId === game?.id ? inventory : null;
  const currentProcess = liveId === game?.id ? process : null;
  const currentSessions = liveId === game?.id ? sessions : [];
  const runtime = current?.entries.find(entry => entry.id === 'builtin.runtime');
  return <div>
    <DesktopOnlyBanner feature="runtime" compact />
    <header className="extension-header"><div><h2 style={{ fontSize: 18 }}>游戏组件状态</h2><p>核对所选游戏目录的星枢版本、运行进程与实时桥接状态</p></div><button className="btn btn-secondary" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} />重新校验文件</button></header>
    <ExtensionTargetPicker target={target} purpose="diagnose" compact />
    {game ? <>
      <div className="runtime-status-grid">
        <section className="panel"><FileCheck2 size={21} /><span>本地运行时文件</span><strong>{busy ? '正在校验…' : runtime?.version || (current ? '未识别为本版运行时' : '尚未读取')}</strong><small>{runtime?.status || '文件校验与实时连接分别显示'}</small></section>
        <section className="panel"><Activity size={21} /><span>所选目录的游戏进程</span><strong>{currentProcess ? currentProcess.processIds.length ? '游戏运行中' : '游戏未运行' : liveError ? '读取失败' : '正在检测…'}</strong><small>{currentProcess?.processIds.length ? `PID：${currentProcess.processIds.join('、')}` : game.executable_path}</small></section>
        <section className="panel"><Radio size={21} /><span>当前连接上报版本</span><strong>{currentSessions.length ? currentSessions.map(session => session.runtimeVersion || '未上报版本').join(' / ') : '尚无已确认连接'}</strong><small>游戏进程存在或磁盘文件匹配，不代表运行时已连接</small></section>
      </div>
      {currentSessions.length > 0 && (
        <section className="panel extension-runtime" style={{ marginBottom: 14 }}>
          <Radio size={22} />
          <div>
            <h2>实时连接会话（{currentSessions.length}）</h2>
            <p>已收到所选游戏程序的实时连接，以下版本由游戏内运行时直接上报。</p>
            <div className="runtime-sessions">
              {currentSessions.map(session => <div key={session.connectionId}><strong>PID {session.pid}</strong><span>{session.runtimeVersion || '未上报版本'}</span><span>{({ MAIN: '主游戏', USER_SPECTATOR: '观战端', UNBOUND: '尚未绑定账号' } as Record<string, string>)[session.boundRole || ''] || session.boundRole || '尚未绑定账号'}</span>{session.lastSeenAt && <small>最近通信：{session.lastSeenAt}</small>}</div>)}
            </div>
          </div>
        </section>
      )}
      {currentProcess?.bepInExFilesDetected ? (
        <section className="panel extension-runtime">
          <Cpu size={22} />
          <div>
            <h2>检测到第三方加载器 (BepInEx/core)</h2>
            <p>磁盘存在 BepInEx/core 文件；若需排查外部插件冲突，可前往游戏模组页面检查。</p>
          </div>
          <Link className="btn btn-secondary" to="/extensions/mods">检查游戏模组</Link>
        </section>
      ) : (
        <details className="mod-notes" style={{ marginTop: 10 }}>
          <summary>兼容性与附加项检查（当前未检测到 BepInEx/core 冲突）</summary>
          <p>未检测到 BepInEx/core；星枢内置功能已随游戏自动加载，无需另行安装同名外部插件。</p>
        </details>
      )}
      <div className="extension-tags" style={{ marginTop: 14 }}>
        <Link className="btn btn-secondary" to="/dashboard">前往启动页（自动安装/更新）</Link>
        <Link className="btn btn-secondary" to="/extensions/mods">检查游戏模组</Link>
      </div>
    </> : <div className="panel extension-empty"><Cpu size={32} /><h2>先配置此渠道的游戏位置</h2><p>选择或添加实际游戏目录后，即可查看文件校验和运行时连接。</p></div>}
    {(!!error || !!liveError || !!current?.warnings.length) && <p className="extension-hint" role="status">{[error, liveError, ...(current?.warnings || [])].filter(Boolean).join('；')}</p>}
  </div>;
}
