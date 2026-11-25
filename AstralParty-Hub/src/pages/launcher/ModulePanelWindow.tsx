import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  FolderOpen,
  Minus,
  Power,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useTranslation } from '../../i18n';
import definitions from '../../shared/launcherModules.json';
import { isTauriRuntime } from '../../shared/runtime';
import { getLauncherModuleMeta, OFFICIAL_SUB_GROUPS, type ModSubGroup } from './launcherModMeta';
import { errorMessage } from './launcherModel';
import './module-panel.css';

const fallbackModules = definitions.map(({ id, name, description }) => ({
  id,
  name,
  description,
  visual: getLauncherModuleMeta(id),
}));

type Module = (typeof fallbackModules)[number];
type ModuleState = 'enabled' | 'disabled' | 'not_installed' | 'not_selected';
type CategoryFilter = 'all' | ModSubGroup;

interface ModulePanelSnapshot {
  ready: boolean;
  gamePlatform?: string | null;
  gameRoot?: string | null;
  modules?: Array<{ id: string; name: string; description: string }>;
  states: Record<string, ModuleState>;
}

const PREVIEW_SNAPSHOT: ModulePanelSnapshot = {
  ready: true,
  gamePlatform: 'STEAM_CN',
  gameRoot: 'Astral Party/8vJXn6CN',
  states: Object.fromEntries(
    fallbackModules.map((m, idx) => [
      m.id,
      idx < 14 ? 'enabled' : idx < 16 ? 'disabled' : 'not_installed',
    ]),
  ),
};

function shortPathLabel(root?: string | null): string {
  if (!root) return '';
  const parts = root.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 2) return parts.join('/');
  return parts.slice(-2).join('/');
}

function stateBadgeText(state: ModuleState, zh: boolean): string {
  switch (state) {
    case 'enabled':
      return zh ? '已开启' : 'On';
    case 'disabled':
      return zh ? '已关闭' : 'Off';
    case 'not_installed':
      return zh ? '未安装' : 'Uninstalled';
    default:
      return zh ? '未选目录' : 'No folder';
  }
}

export function ModulePanelWindow() {
  const zh = useTranslation().locale === 'zh-CN';
  const tauri = isTauriRuntime();
  const logoSrc = `${import.meta.env.BASE_URL}brand/xingshu.svg`;
  const initialExpanded = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('preview') === 'expanded';
  }, []);

  const [expanded, setExpanded] = useState(initialExpanded);
  const [group, setGroup] = useState<CategoryFilter>('all');
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<Module>();
  const [snapshot, setSnapshot] = useState<ModulePanelSnapshot | null>(() =>
    tauri ? null : PREVIEW_SNAPSHOT,
  );
  const [loading, setLoading] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [busyModId, setBusyModId] = useState('');
  const [problem, setProblem] = useState('');

  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);

  const loadSnapshot = useCallback(async () => {
    if (!tauri) return;
    setLoading(true);
    try {
      const next = await invoke<ModulePanelSnapshot>('module_panel_snapshot');
      setSnapshot(next);
      setProblem('');
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [tauri]);

  useEffect(() => {
    if (!tauri) return;
    void loadSnapshot();
    const onFocus = () => void loadSnapshot();
    window.addEventListener('focus', onFocus);
    let mounted = true;
    let unlisten: (() => void) | undefined;
    void listen('xingshu:panel-target-changed', () => {
      if (mounted) void loadSnapshot();
    }).then((fn) => {
      if (!mounted) fn();
      else unlisten = fn;
    });
    return () => {
      mounted = false;
      window.removeEventListener('focus', onFocus);
      if (unlisten) unlisten();
    };
  }, [loadSnapshot, tauri]);

  const resize = async (value: boolean) => {
    if (resizing) return;
    setResizing(true);
    setProblem('');
    try {
      if (tauri) {
        await invoke('module_panel_set_expanded', { expanded: value });
      }
      setExpanded(value);
      if (value) void loadSnapshot();
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setResizing(false);
    }
  };

  const toggleModule = async (mod: Module, enable: boolean) => {
    if (busyModId) return;
    setBusyModId(mod.id);
    setProblem('');
    try {
      if (!tauri) {
        setSnapshot((prev) =>
          prev
            ? {
                ...prev,
                states: { ...prev.states, [mod.id]: enable ? 'enabled' : 'disabled' },
              }
            : prev,
        );
        return;
      }
      const nextState = await invoke<ModuleState>('module_panel_toggle', {
        modId: mod.id,
        enabled: enable,
      });
      setSnapshot((prev) =>
        prev ? { ...prev, states: { ...prev.states, [mod.id]: nextState } } : prev,
      );
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusyModId('');
    }
  };

  const manage = async (mod: Module) => {
    if (!tauri) return;
    setProblem('');
    try {
      await invoke('module_panel_manage', { modId: mod.id });
      await resize(false);
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  const openMainWindow = async () => {
    if (!tauri) return;
    try {
      await invoke('module_panel_open_main');
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  const closeBall = async () => {
    if (!tauri) {
      setExpanded(false);
      return;
    }
    try {
      await getCurrentWindow().close();
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  const resolveState = useCallback(
    (modId: string): ModuleState => {
      if (!snapshot?.gameRoot) return 'not_selected';
      return snapshot.states[modId] || 'not_installed';
    },
    [snapshot],
  );

  const modules = useMemo<Module[]>(() => {
    const raw = snapshot?.modules && snapshot.modules.length > 0 ? snapshot.modules : definitions;
    return raw.map(({ id, name, description }) => ({
      id,
      name,
      description,
      visual: getLauncherModuleMeta(id),
    }));
  }, [snapshot?.modules]);

  const enabledCount = useMemo(
    () => modules.filter((m) => resolveState(m.id) === 'enabled').length,
    [modules, resolveState],
  );

  const filteredModules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return modules.filter((m) => {
      if (group !== 'all' && m.visual.group !== group) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q)
      );
    });
  }, [group, modules, search]);

  const groupCounts = useMemo(() => {
    const map: Record<string, number> = { all: modules.length };
    for (const g of OFFICIAL_SUB_GROUPS) {
      map[g.id] = modules.filter((m) => m.visual.group === g.id).length;
    }
    return map;
  }, [modules]);

  if (!expanded) {
    return (
      <div className="xs-ball-stage">
        <button
          type="button"
          className="xs-ball-trigger"
          aria-label={zh ? '打开星枢悬浮球' : 'Open XingShu Module Panel'}
          title={problem || (zh ? '点击展开星枢悬浮球，按住拖动位置' : 'Click to expand · Drag to move')}
          disabled={resizing}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            draggedRef.current = false;
            dragOriginRef.current = { x: e.screenX, y: e.screenY };
          }}
          onPointerMove={(e) => {
            const origin = dragOriginRef.current;
            if (!origin || draggedRef.current) return;
            if (Math.hypot(e.screenX - origin.x, e.screenY - origin.y) > 5) {
              draggedRef.current = true;
              dragOriginRef.current = null;
              if (tauri) {
                void getCurrentWindow().startDragging().catch(() => {});
              }
            }
          }}
          onPointerUp={() => {
            dragOriginRef.current = null;
          }}
          onPointerCancel={() => {
            dragOriginRef.current = null;
            draggedRef.current = false;
          }}
          onClick={() => {
            if (draggedRef.current) {
              draggedRef.current = false;
              return;
            }
            void resize(true);
          }}
        >
          <span className="xs-ball-ring" aria-hidden="true" />
          <img src={logoSrc} alt="" className="xs-ball-orb-logo" draggable={false} />
          {enabledCount > 0 && (
            <span className="xs-ball-orb-badge xs-tabular" aria-label={zh ? `已开启 ${enabledCount} 项` : `${enabledCount} enabled`}>
              {enabledCount}
            </span>
          )}
        </button>
      </div>
    );
  }

  const activeState: ModuleState = active ? resolveState(active.id) : 'not_selected';
  const folderText = snapshot?.gameRoot
    ? `${snapshot.gamePlatform ? `${snapshot.gamePlatform} · ` : ''}${shortPathLabel(snapshot.gameRoot)}`
    : zh
      ? '尚未选择游戏目录'
      : 'No game folder';

  return (
    <main
      className="xs-ball-panel"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        if (active) setActive(undefined);
        else void resize(false);
      }}
    >
      <header className="xs-ball-header">
        <div className="xs-ball-drag" data-tauri-drag-region>
          <img src={logoSrc} alt="" className="xs-ball-head-logo" draggable={false} />
          <div className="xs-ball-head-copy">
            <strong>{zh ? '星枢悬浮球' : 'XingShu Panel'}</strong>
          </div>
          <span className="xs-ball-count-pill xs-tabular">
            {enabledCount}/{modules.length} {zh ? '已开启' : 'On'}
          </span>
        </div>
        <div className="xs-ball-head-actions">
          <button
            type="button"
            aria-label={zh ? '刷新状态' : 'Refresh'}
            title={zh ? '刷新状态' : 'Refresh'}
            disabled={loading}
            onClick={() => void loadSnapshot()}
          >
            <RefreshCw size={14} className={loading ? 'xs-spin' : ''} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={zh ? '收起为悬浮球' : 'Collapse'}
            title={zh ? '收起为悬浮球' : 'Collapse'}
            disabled={resizing}
            onClick={() => void resize(false)}
          >
            <Minus size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={zh ? '关闭悬浮球' : 'Close panel'}
            title={zh ? '关闭悬浮球' : 'Close'}
            onClick={() => void closeBall()}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      {problem && (
        <div className="xs-ball-error" role="alert">
          <span>{problem}</span>
          <button type="button" onClick={() => setProblem('')} aria-label={zh ? '关闭提示' : 'Dismiss'}>
            <X size={12} />
          </button>
        </div>
      )}

      {!active ? (
        <>
          <div className="xs-ball-controls">
            <label className="xs-ball-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={zh ? '搜索模块名称或功能说明…' : 'Search modules…'}
                aria-label={zh ? '搜索模块' : 'Search modules'}
              />
              {search && (
                <button
                  type="button"
                  className="xs-ball-search-clear"
                  onClick={() => setSearch('')}
                  aria-label={zh ? '清空搜索' : 'Clear search'}
                >
                  <X size={12} />
                </button>
              )}
            </label>

            <nav className="xs-ball-pills" aria-label={zh ? '模块分类' : 'Module categories'}>
              <button
                type="button"
                className={group === 'all' ? 'is-active' : ''}
                aria-pressed={group === 'all'}
                onClick={() => setGroup('all')}
              >
                <span>{zh ? '全部' : 'All'}</span>
                <small className="xs-tabular">{groupCounts.all}</small>
              </button>
              {OFFICIAL_SUB_GROUPS.map(({ id, labelZh, labelEn }) => (
                <button
                  key={id}
                  type="button"
                  className={group === id ? 'is-active' : ''}
                  aria-pressed={group === id}
                  onClick={() => setGroup(id)}
                >
                  <span>{zh ? labelZh : labelEn}</span>
                  <small className="xs-tabular">{groupCounts[id] ?? 0}</small>
                </button>
              ))}
            </nav>
          </div>

          <div className="xs-ball-scroll">
            {filteredModules.length === 0 ? (
              <div className="xs-ball-empty">
                <p>{zh ? '没有找到匹配的模块' : 'No matching modules'}</p>
                {search && (
                  <button type="button" onClick={() => setSearch('')}>
                    {zh ? '清空筛选' : 'Reset filter'}
                  </button>
                )}
              </div>
            ) : (
              <ul className="xs-ball-list">
                {filteredModules.map((module) => {
                  const { Icon, accentBg, accentFg, accentBorder } = module.visual;
                  const state = resolveState(module.id);
                  const canSwitch = state === 'enabled' || state === 'disabled';
                  const isOn = state === 'enabled';
                  return (
                    <li key={module.id} className={`xs-ball-card is-${state}`}>
                      <button
                        type="button"
                        className="xs-ball-card-main"
                        onClick={() => setActive(module)}
                      >
                        <span
                          className="xs-ball-icon"
                          style={{
                            background: accentBg,
                            color: accentFg,
                            borderColor: accentBorder,
                          }}
                        >
                          <Icon size={17} aria-hidden="true" />
                        </span>
                        <span className="xs-ball-card-text">
                          <span className="xs-ball-card-top">
                            <strong>{module.name}</strong>
                            <span className={`xs-ball-badge is-${state}`}>
                              {stateBadgeText(state, zh)}
                            </span>
                          </span>
                          <span className="xs-ball-card-desc">{module.description}</span>
                        </span>
                      </button>

                      <div className="xs-ball-card-act">
                        {canSwitch ? (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={isOn}
                            aria-label={
                              isOn
                                ? `${zh ? '关闭' : 'Disable'} ${module.name}`
                                : `${zh ? '开启' : 'Enable'} ${module.name}`
                            }
                            className={`xs-ball-switch ${isOn ? 'is-on' : ''}`}
                            disabled={Boolean(busyModId)}
                            onClick={() => void toggleModule(module, !isOn)}
                          >
                            <span className="xs-ball-switch-thumb" />
                          </button>
                        ) : state === 'not_installed' ? (
                          <button
                            type="button"
                            className="xs-ball-mini-install"
                            onClick={() => void manage(module)}
                          >
                            {zh ? '去安装' : 'Install'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="xs-ball-mini-arrow"
                            aria-label={zh ? '查看详情' : 'Details'}
                            onClick={() => setActive(module)}
                          >
                            <ChevronRight size={15} />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      ) : (
        <div className="xs-ball-scroll">
          <div className="xs-ball-detail-top">
            <button type="button" className="xs-ball-back" onClick={() => setActive(undefined)}>
              <ArrowLeft size={14} aria-hidden="true" />
              <span>{zh ? '所有模块' : 'All modules'}</span>
            </button>
            <span className="xs-ball-group-tag">
              {zh ? active.visual.groupZh : active.visual.groupEn}
            </span>
          </div>

          <section className="xs-ball-hero">
            <div className="xs-ball-hero-head">
              <span
                className="xs-ball-hero-icon"
                style={{
                  background: active.visual.accentBg,
                  color: active.visual.accentFg,
                  borderColor: active.visual.accentBorder,
                }}
              >
                <active.visual.Icon size={24} aria-hidden="true" />
              </span>
              <div>
                <h2>{active.name}</h2>
                <code>{active.id}</code>
              </div>
            </div>
            <p className="xs-ball-hero-desc">{active.description}</p>
          </section>

          <section className="xs-ball-detail-status">
            <div>
              <span>{zh ? '当前状态' : 'Module State'}</span>
              <strong className={`xs-ball-badge is-${activeState}`}>
                {stateBadgeText(activeState, zh)}
              </strong>
            </div>
            <div>
              <span>{zh ? '运行组件' : 'Core Runtime'}</span>
              <strong>
                {snapshot?.ready
                  ? zh
                    ? '已安装就绪'
                    : 'Ready'
                  : snapshot?.gameRoot
                    ? zh
                      ? '需更新或安装组件'
                      : 'Needs component'
                    : zh
                      ? '未选择目录'
                      : 'No folder'}
              </strong>
            </div>
          </section>

          <div className="xs-ball-detail-actions">
            {(activeState === 'enabled' || activeState === 'disabled') && (
              <button
                type="button"
                className={`xs-ball-toggle-cta ${activeState === 'enabled' ? 'is-off' : 'is-on'}`}
                disabled={Boolean(busyModId)}
                onClick={() => void toggleModule(active, activeState !== 'enabled')}
              >
                <Power size={15} aria-hidden="true" />
                <span>
                  {busyModId === active.id
                    ? zh
                      ? '正在切换…'
                      : 'Updating…'
                    : activeState === 'enabled'
                      ? zh
                        ? '立即关闭此模块'
                        : 'Disable Module'
                      : zh
                        ? '立即开启此模块'
                        : 'Enable Module'}
                </span>
              </button>
            )}
            <button type="button" className="xs-ball-manage" onClick={() => void manage(active)}>
              <span>{zh ? '在启动器主界面中管理' : 'Manage in Launcher'}</span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      <footer className="xs-ball-footer">
        <span className="xs-ball-foot-dir" title={snapshot?.gameRoot || undefined}>
          <FolderOpen size={13} aria-hidden="true" />
          <span>{folderText}</span>
        </span>
        <button type="button" className="xs-ball-main-btn" onClick={() => void openMainWindow()}>
          <span>{zh ? '打开主界面' : 'Main Window'}</span>
        </button>
      </footer>
    </main>
  );
}
