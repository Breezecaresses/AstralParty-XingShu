import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { api } from './api/tauri';
import type { GameInstallation } from './types';
import { isTauriRuntime } from './runtime';

export interface EncyclopediaInstalledMod {
  modId: string;
  modName: string;
  source: string;
  enabled: boolean;
  assetCount: number;
}

export interface EncyclopediaAssetOverride {
  kind: 'character' | 'card' | 'chip' | 'map' | string;
  entityId: string;
  slot?: string | null;
  assetName: string;
  modId: string;
  modName: string;
  source: string;
  enabled: boolean;
  bundlePath: string;
  sha256: string;
}

export interface EncyclopediaModOverridesReport {
  installationId: string;
  installedMods: EncyclopediaInstalledMod[];
  overrides: EncyclopediaAssetOverride[];
}

const previewCache = new Map<string, string>();
const previewInflight = new Map<string, Promise<string>>();

async function resolveActiveInstallationId(): Promise<string> {
  if (!isTauriRuntime() || !isTauri()) return '';
  try {
    const games = await invoke<GameInstallation[]>('list_extension_targets').catch(
      () => [] as GameInstallation[],
    );
    const primary = games.length ? null : await api.getPrimaryGame().catch(() => null);
    const list = games.length ? games : primary ? [primary] : [];
    if (!list.length) return '';
    const savedChannel =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem('extensions.channel') || localStorage.getItem('xingshu.target.channel') || ''
        : '';
    const savedInst =
      typeof localStorage !== 'undefined' && savedChannel
        ? localStorage.getItem(`extensions.target.${savedChannel}`) ||
          localStorage.getItem(`xingshu.target.installation.${savedChannel}`) ||
          ''
        : '';
    const picked =
      list.find((g: GameInstallation) => g.id === savedInst) ||
      list.find((g: GameInstallation) => savedChannel && g.platform === savedChannel) ||
      list[0];
    return picked?.id || '';
  } catch {
    return '';
  }
}

export function useEncyclopediaModOverrides(kind: 'character' | 'card' | 'chip' | 'map') {
  const [installationId, setInstallationId] = useState('');
  const [report, setReport] = useState<EncyclopediaModOverridesReport | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isTauriRuntime() || !isTauri()) return;
    setLoading(true);
    try {
      const instId = await resolveActiveInstallationId();
      setInstallationId(instId);
      if (!instId) {
        setReport(null);
        return;
      }
      const next = await invoke<EncyclopediaModOverridesReport>('get_encyclopedia_mod_overrides', {
        installationId: instId,
      });
      setReport(next);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredOverrides = useMemo(() => {
    if (!report) return [];
    return report.overrides.filter((item) => item.kind === kind);
  }, [kind, report]);

  const overridesByEntity = useMemo(() => {
    const map = new Map<string, EncyclopediaAssetOverride[]>();
    for (const item of filteredOverrides) {
      const bucket = map.get(item.entityId) ?? [];
      bucket.push(item);
      map.set(item.entityId, bucket);
    }
    return map;
  }, [filteredOverrides]);

  const overridesByAsset = useMemo(() => {
    const map = new Map<string, EncyclopediaAssetOverride[]>();
    for (const item of filteredOverrides) {
      const bucket = map.get(item.assetName.toLowerCase()) ?? [];
      bucket.push(item);
      map.set(item.assetName.toLowerCase(), bucket);
    }
    return map;
  }, [filteredOverrides]);

  const activeMods = useMemo(() => {
    const ids = new Set(filteredOverrides.map((o) => o.modId));
    return (report?.installedMods ?? []).filter((m) => ids.has(m.modId));
  }, [filteredOverrides, report?.installedMods]);

  return {
    installationId,
    loading,
    refresh,
    installedMods: activeMods,
    allInstalledMods: report?.installedMods ?? [],
    overrides: filteredOverrides,
    overridesByEntity,
    overridesByAsset,
    replacedCount: new Set(filteredOverrides.map((o) => o.entityId)).size,
  };
}

export function useModTexturePreview(
  installationId: string,
  override?: EncyclopediaAssetOverride | null,
  enabled = true,
): { src: string | null; loading: boolean } {
  const cacheKey = override
    ? `${installationId}|${override.sha256 || override.bundlePath}|${override.assetName}`
    : '';
  const [src, setSrc] = useState<string | null>(() =>
    cacheKey && previewCache.has(cacheKey) ? previewCache.get(cacheKey) ?? null : null,
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !override || !installationId || !isTauriRuntime() || !isTauri()) {
      setSrc(null);
      setLoading(false);
      return;
    }
    const existing = previewCache.get(cacheKey);
    if (existing) {
      setSrc(existing);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    let inflight = previewInflight.get(cacheKey);
    if (!inflight) {
      inflight = invoke<string>('get_mod_texture_preview', {
        installationId,
        bundlePath: override.bundlePath,
        assetName: override.assetName,
        sha256: override.sha256 || null,
      })
        .then((dataUrl) => {
          previewCache.set(cacheKey, dataUrl);
          return dataUrl;
        })
        .finally(() => {
          previewInflight.delete(cacheKey);
        });
      previewInflight.set(cacheKey, inflight);
    }

    inflight
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, enabled, installationId, override]);

  return { src, loading };
}
