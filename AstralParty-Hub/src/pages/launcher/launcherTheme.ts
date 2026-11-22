import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../../shared/runtime';

export type PclThemeId = 'azure' | 'rose' | 'amber' | 'mint' | 'violet' | 'obsidian';

export interface PclThemePreset {
  id: PclThemeId;
  nameZh: string;
  nameEn: string;
  descZh: string;
  descEn: string;
  swatchPrimary: string;
  swatchSecondary: string;
  isDark?: boolean;
}

export const PCL_THEMES: readonly PclThemePreset[] = [
  {
    id: 'azure',
    nameZh: '星海蓝',
    nameEn: 'Azure Sky',
    descZh: '经典 PCL2 澄澈天蓝与亮白卡片',
    descEn: 'Classic PCL2 clear azure with crisp white cards',
    swatchPrimary: '#1370f3',
    swatchSecondary: '#4890f5',
  },
  {
    id: 'rose',
    nameZh: '星樱粉',
    nameEn: 'Astral Rose',
    descZh: '轻盈樱绯色调与明朗星光层',
    descEn: 'Soft sakura rose with bright daylight surfaces',
    swatchPrimary: '#d9467a',
    swatchSecondary: '#f472a8',
  },
  {
    id: 'amber',
    nameZh: '星辉金',
    nameEn: 'Astral Amber',
    descZh: '温暖琥珀金与清透象牙底色',
    descEn: 'Warm amber gold over clean ivory-white cards',
    swatchPrimary: '#c96a12',
    swatchSecondary: '#ef9b38',
  },
  {
    id: 'mint',
    nameZh: '晴空青',
    nameEn: 'Mint Breeze',
    descZh: '清冽薄荷碧与高通透质感',
    descEn: 'Fresh mint teal with crisp airy contrast',
    swatchPrimary: '#0f8c7a',
    swatchSecondary: '#2fb8a3',
  },
  {
    id: 'violet',
    nameZh: '星夜紫',
    nameEn: 'Nebula Iris',
    descZh: '沉静鸢尾紫与高对比白卡',
    descEn: 'Calm iris violet with high-contrast cards',
    swatchPrimary: '#5c4ad8',
    swatchSecondary: '#8474f0',
  },
  {
    id: 'obsidian',
    nameZh: '玄素黑',
    nameEn: 'Obsidian Slate',
    descZh: '低眩光玄铁深灰与素白字阶',
    descEn: 'Low-glare obsidian slate dark surface',
    swatchPrimary: '#3b4758',
    swatchSecondary: '#64748b',
    isDark: true,
  },
] as const;

export const REPLAY_STARTUP_EVENT = 'xingshu:replay-startup';

const THEME_STORAGE_KEY = 'xingshu.launcher.theme';
const STARTUP_ANIM_STORAGE_KEY = 'xingshu.launcher.startupAnim';
const THEME_CHANGE_EVENT = 'xingshu:theme-change';
const DEFAULT_THEME: PclThemeId = 'azure';

function isValidThemeId(value: string | null | undefined): value is PclThemeId {
  return PCL_THEMES.some((preset) => preset.id === value);
}

export function getStoredTheme(): PclThemeId {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_THEME;
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return isValidThemeId(saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function setStoredTheme(id: PclThemeId): void {
  const next: PclThemeId = isValidThemeId(id) ? id : DEFAULT_THEME;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    }
  } catch {
    // Ignore storage errors in restricted contexts.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme: next } }));
  }
}

export function getStartupAnimEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    const saved = localStorage.getItem(STARTUP_ANIM_STORAGE_KEY);
    if (saved === '0' || saved === 'false') return false;
    return true;
  } catch {
    return true;
  }
}

export function setStartupAnimEnabled(enabled: boolean): void {
  const normalized = Boolean(enabled);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STARTUP_ANIM_STORAGE_KEY, normalized ? '1' : '0');
    }
  } catch {
    // Ignore storage errors in restricted contexts.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(THEME_CHANGE_EVENT, { detail: { startupAnimEnabled: normalized } }),
    );
  }
}

export function triggerStartupReplay(): void {
  if (typeof window === 'undefined') return;
  if (isTauriRuntime()) {
    invoke('replay_startup_splash').catch(() => {
      window.dispatchEvent(new CustomEvent(REPLAY_STARTUP_EVENT));
    });
    return;
  }
  window.dispatchEvent(new CustomEvent(REPLAY_STARTUP_EVENT));
}

export function useLauncherTheme(): {
  theme: PclThemeId;
  setTheme: (id: PclThemeId) => void;
  startupAnimEnabled: boolean;
  setStartupAnimEnabled: (enabled: boolean) => void;
  replayStartup: () => void;
} {
  const [theme, setThemeState] = useState<PclThemeId>(getStoredTheme);
  const [startupAnimEnabled, setStartupAnimState] = useState<boolean>(getStartupAnimEnabled);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleThemeEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ theme?: PclThemeId; startupAnimEnabled?: boolean }>).detail;
      if (detail?.theme && isValidThemeId(detail.theme)) {
        setThemeState(detail.theme);
      } else {
        setThemeState(getStoredTheme());
      }
      if (typeof detail?.startupAnimEnabled === 'boolean') {
        setStartupAnimState(detail.startupAnimEnabled);
      } else {
        setStartupAnimState(getStartupAnimEnabled());
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) {
        setThemeState(getStoredTheme());
      } else if (event.key === STARTUP_ANIM_STORAGE_KEY) {
        setStartupAnimState(getStartupAnimEnabled());
      }
    };

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeEvent);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeEvent);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const setTheme = useCallback((id: PclThemeId) => {
    const valid = isValidThemeId(id) ? id : DEFAULT_THEME;
    setThemeState(valid);
    setStoredTheme(valid);
  }, []);

  const updateStartupAnimEnabled = useCallback((enabled: boolean) => {
    const normalized = Boolean(enabled);
    setStartupAnimState(normalized);
    setStartupAnimEnabled(normalized);
  }, []);

  const replayStartup = useCallback(() => {
    triggerStartupReplay();
  }, []);

  return {
    theme,
    setTheme,
    startupAnimEnabled,
    setStartupAnimEnabled: updateStartupAnimEnabled,
    replayStartup,
  };
}
