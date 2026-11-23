import { webApiBaseUrl } from './runtime.ts';

export type WorkshopCategory = 'all' | 'optimization' | 'card' | 'skin' | 'voice_vfx';

export interface WorkshopModFile {
  target: string;
  sha256: string;
  originalSha256?: string;
  size: number;
  assets: string[];
  payloadUrl?: string | null;
}

export interface WorkshopVersionEntry {
  id?: string;
  version: string;
  title?: string;
  channel?: 'release' | 'beta' | 'optional' | string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  gameVersion: string;
  platforms: string[];
  platformLabel?: string;
  installKind: string;
  downloadUrl?: string | null;
  publishedAt: string;
  downloads?: number;
  notes?: string;
  reviewStatus?: string;
  reviewNote?: string;
}

export interface WorkshopChangelogEntry {
  version: string;
  date: string;
  title: string;
  notes: string;
}

export interface WorkshopReactionCount {
  emoteId: string;
  count: number;
}

export interface WorkshopGalleryImage {
  id: string;
  url: string;
  caption: string;
  featured: boolean;
  mime: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface WorkshopModViewerState {
  following: boolean;
  bookmarked: boolean;
  viewerEmoteId?: string | null;
  isOwner: boolean;
}

export interface WorkshopModItem {
  id: string;
  slug?: string;
  name: string;
  author: string;
  authorUid?: number | null;
  authorAvatarUrl?: string | null;
  authorAvatarColor?: string | null;
  authorIsOfficial?: boolean;
  authorKey?: string | null;
  ownerUserId?: string | null;
  ownerUsername?: string | null;
  visibility?: 'public' | 'unlisted' | 'private' | string;
  license?: string;
  category: Exclude<WorkshopCategory, 'all'> | string;
  secondaryCategories?: string[];
  categoryLabel: string;
  installKind: 'bundle_mod' | 'xspkg' | 'external_archive' | string;
  status: string;
  isSeed: boolean;
  isOfficialSeed?: boolean;
  version?: string | null;
  versionCount?: number;
  platformLabels?: string[];
  gameVersion: string;
  platforms: string[];
  packageFile?: string | null;
  sizeBytes: number;
  sha256: string;
  tags: string[];
  description: string;
  longDescription?: string;
  targetInfo: string;
  assets: string[];
  targets: string[];
  files: WorkshopModFile[];
  versions?: WorkshopVersionEntry[];
  changelog?: WorkshopChangelogEntry[];
  downloadable: boolean;
  downloadUrl?: string | null;
  externalUrl?: string | null;
  previewUrl?: string | null;
  featuredImageUrl?: string | null;
  galleryCount?: number;
  promoHeadline?: string;
  promoVideoUrl?: string;
  gallery?: WorkshopGalleryImage[];
  submittedAt?: string | null;
  downloads?: number;
  follows?: number;
  bookmarks?: number;
  reactions?: WorkshopReactionCount[];
  reactionTotal?: number;
  viewerState?: WorkshopModViewerState;
  reviewNote?: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  pendingVersionCount?: number;
}

export interface WorkshopCategoryCount {
  id: Exclude<WorkshopCategory, 'all'>;
  label: string;
  count: number;
}

export interface WorkshopListResponse {
  items: WorkshopModItem[];
  total: number;
  counts: Record<string, number>;
  categories: WorkshopCategoryCount[];
}

export interface WorkshopSubmitInput {
  name: string;
  author: string;
  category: Exclude<WorkshopCategory, 'all'>;
  description: string;
  tags: string;
  targetInfo: string;
  externalUrl: string;
  gameVersion?: string;
  platforms?: string;
  token?: string | null;
  archiveFile?: File | null;
  previewFile?: File | null;
}

export interface WorkshopSubmitResponse {
  ok: boolean;
  id: string;
  status: string;
  sha256: string;
  installKind: string;
  message: string;
  item: WorkshopModItem;
}

export const WORKSHOP_CATEGORIES: Array<{ id: WorkshopCategory; labelZh: string; labelEn: string }> = [
  { id: 'all', labelZh: '全部', labelEn: 'All' },
  { id: 'optimization', labelZh: '优化 Mod', labelEn: 'Optimization' },
  { id: 'card', labelZh: '卡牌替换', labelEn: 'Cards' },
  { id: 'skin', labelZh: '角色皮肤', labelEn: 'Skins' },
  { id: 'voice_vfx', labelZh: '语音·特效', labelEn: 'Voice & VFX' },
];

export const MAX_WORKSHOP_UPLOAD_BYTES = 32 * 1024 * 1024;
export const MAX_WORKSHOP_PREVIEW_BYTES = 2 * 1024 * 1024;

export function formatModBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function installKindLabel(kind: string): string {
  switch (kind) {
    case 'xspkg':
      return '.xspkg 扩展包';
    case 'bundle_mod':
      return 'Bundle 替换';
    case 'external_archive':
      return '外部整包';
    default:
      return kind || '模组包';
  }
}

const PC_PLATFORM_SET = new Set(['STEAM_CN', 'TAPTAP', 'BILIBILI', 'WEGAME', 'STEAM_GLOBAL', 'PC']);
const MOBILE_PLATFORM_SET = new Set(['ANDROID_CN', 'PE', 'MOBILE']);

export const WORKSHOP_CHANNEL_FILTER_OPTIONS = [
  { id: 'STEAM_CN', labelZh: 'Steam 国服', labelEn: 'Steam CN' },
  { id: 'TAPTAP', labelZh: 'TapTap', labelEn: 'TapTap' },
  { id: 'BILIBILI', labelZh: '哔哩哔哩', labelEn: 'Bilibili' },
  { id: 'WEGAME', labelZh: 'WeGame', labelEn: 'WeGame' },
  { id: 'ANDROID_CN', labelZh: '手机端 (安卓 / PE)', labelEn: 'Mobile (Android / PE)' },
] as const;

export const WORKSHOP_UPLOAD_CHANNEL_PRESETS = [
  {
    value: 'STEAM_CN,TAPTAP,BILIBILI,WEGAME',
    labelZh: 'PC 全渠道 (Steam / TapTap / B站 / WeGame)',
    labelEn: 'PC All Channels',
  },
  {
    value: 'STEAM_CN,TAPTAP,BILIBILI,WEGAME,ANDROID_CN',
    labelZh: 'PC / 手机端通用 (桌面与安卓 PE)',
    labelEn: 'PC & Mobile Universal',
  },
  {
    value: 'PE,ANDROID_CN',
    labelZh: '手机端 / PE (安卓 / modimg 贴图包)',
    labelEn: 'Mobile / PE (Android / modimg)',
  },
  {
    value: 'STEAM_CN',
    labelZh: '仅 Steam 国服',
    labelEn: 'Steam CN Only',
  },
] as const;

export function sanitizeWorkshopPlatforms(platforms?: readonly string[] | null): string[] {
  const out: string[] = [];
  for (const raw of platforms || []) {
    const up = String(raw || '').trim().toUpperCase();
    if (!up || up === 'IOS' || up === 'IOS_CN' || up.includes('IOS')) continue;
    if (!out.includes(up)) out.push(up);
  }
  return out;
}

export function formatWorkshopChannelName(code: string, zh = true): string {
  switch (String(code || '').trim().toUpperCase()) {
    case 'STEAM_CN':
      return zh ? 'Steam 国服' : 'Steam CN';
    case 'STEAM_GLOBAL':
      return zh ? 'Steam 国际服' : 'Steam Global';
    case 'TAPTAP':
      return 'TapTap';
    case 'BILIBILI':
      return zh ? '哔哩哔哩' : 'Bilibili';
    case 'WEGAME':
      return 'WeGame';
    case 'ANDROID_CN':
    case 'PE':
    case 'MOBILE':
      return zh ? '手机端 (安卓 / PE)' : 'Mobile (Android / PE)';
    default:
      return code;
  }
}

export function modSupportsChannelFilter(
  item: Pick<WorkshopModItem, 'platforms' | 'versions'>,
  filterCode: string,
): boolean {
  const target = String(filterCode || '').trim().toUpperCase();
  if (!target || target === 'ALL') return true;
  const collected = new Set<string>(sanitizeWorkshopPlatforms(item.platforms));
  for (const ver of item.versions || []) {
    for (const p of sanitizeWorkshopPlatforms(ver.platforms)) {
      collected.add(p);
    }
  }
  if (target === 'ANDROID_CN') {
    for (const m of MOBILE_PLATFORM_SET) {
      if (collected.has(m)) return true;
    }
    return false;
  }
  return collected.has(target);
}

export function modPlatformSummaryBadge(
  item: Pick<WorkshopModItem, 'platforms' | 'platformLabels' | 'versionCount' | 'versions'>,
  zh = true,
): string | null {
  const collected = new Set<string>(sanitizeWorkshopPlatforms(item.platforms));
  for (const ver of item.versions || []) {
    for (const p of sanitizeWorkshopPlatforms(ver.platforms)) {
      collected.add(p);
    }
  }
  const hasPc = Array.from(collected).some((p) => PC_PLATFORM_SET.has(p));
  const hasMobile = Array.from(collected).some((p) => MOBILE_PLATFORM_SET.has(p));
  const versionCount = Number(item.versionCount ?? 0);

  if (versionCount > 1) {
    const cleanLabels = (item.platformLabels || [])
      .map((l) => String(l || '').replace(/\s*\/\s*iOS/gi, '').replace(/iOS\s*\/\s*/gi, '').trim())
      .filter((l) => l && !/ios/i.test(l));
    const suffix = cleanLabels.length ? ` · ${cleanLabels.slice(0, 2).join(' / ')}` : '';
    return `${versionCount} ${zh ? '个版本' : 'versions'}${suffix}`;
  }

  if (hasPc && hasMobile) {
    return zh ? 'PC / 手机端通用' : 'PC & Mobile';
  }
  if (hasMobile) {
    return zh ? '手机端 (安卓 / PE)' : 'Mobile (Android / PE)';
  }
  return null;
}

export function workshopAssetUrl(pathOrUrl?: string | null): string {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = webApiBaseUrl();
  const clean = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${clean}`;
}

export async function fetchWorkshopMods(
  category: WorkshopCategory = 'all',
  query = '',
  signal?: AbortSignal,
): Promise<WorkshopListResponse> {
  const base = webApiBaseUrl();
  const params = new URLSearchParams();
  if (category && category !== 'all') params.set('category', category);
  if (query.trim()) params.set('q', query.trim());
  const qs = params.toString();
  const url = `${base}/api/workshop/mods${qs ? `?${qs}` : ''}`;

  let res: Response;
  let text: string;
  try {
    const deadline = AbortSignal.timeout(12_000);
    res = await fetch(url, {
      cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
    text = await res.text();
  } catch {
    throw new Error('暂时无法连接模组工坊，请检查网络后点击刷新列表。');
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`工坊数据解析失败（HTTP ${res.status}）`);
  }
  if (!res.ok) {
    throw new Error(
      (typeof parsed?.error === 'string' && parsed.error) || `加载工坊失败（HTTP ${res.status}）`,
    );
  }
  if (!Array.isArray(parsed?.items)) {
    throw new Error('工坊列表格式异常，请刷新重试。');
  }
  return parsed as unknown as WorkshopListResponse;
}

export async function fetchWorkshopModDetail(
  modIdOrSlug: string,
  token?: string | null,
): Promise<WorkshopModItem> {
  const base = webApiBaseUrl();
  const clean = encodeURIComponent(modIdOrSlug.trim());
  const url = `${base}/api/workshop/mods/${clean}`;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  let text: string;
  try {
    res = await fetch(url, { headers });
    text = await res.text();
  } catch {
    throw new Error('暂时无法连接模组工坊详情接口，请检查网络后重试。');
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`模组详情解析失败（HTTP ${res.status}）`);
  }
  if (!res.ok || !parsed.item) {
    throw new Error(
      (typeof parsed.error === 'string' && parsed.error) || `未找到该模组详情（HTTP ${res.status}）`,
    );
  }
  return parsed.item as WorkshopModItem;
}

export function validateWorkshopSubmission(input: WorkshopSubmitInput): string | null {
  if (input.name.trim().length < 2) return '模组名称至少需要 2 个字符';
  if (input.author.trim().length < 1) return '请填写作者署名';
  if (input.description.trim().length < 4) return '模组说明至少需要 4 个字符';
  const ext = input.externalUrl.trim();
  if (!input.archiveFile && !ext) {
    return '请上传 .zip / .xspkg 模组压缩包，或填写安全的 https:// 发布页/网盘链接';
  }
  if (ext && !/^https:\/\/[^/\s]+\.[^/\s]+/i.test(ext)) {
    return '外部下载链接必须使用安全的 https:// 地址';
  }
  if (input.archiveFile) {
    const lowerName = input.archiveFile.name.toLowerCase();
    if (!lowerName.endsWith('.zip') && !lowerName.endsWith('.xspkg')) {
      return '在线投稿压缩包仅支持 .zip 或 .xspkg 格式';
    }
    if (input.archiveFile.size <= 0 || input.archiveFile.size > MAX_WORKSHOP_UPLOAD_BYTES) {
      return '上传压缩包大小需在 1B ~ 32MB 之间';
    }
  }
  if (input.previewFile) {
    const mime = (input.previewFile.type || '').toLowerCase();
    const pname = input.previewFile.name.toLowerCase();
    const okType =
      mime === 'image/png' ||
      mime === 'image/jpeg' ||
      mime === 'image/webp' ||
      /\.(png|jpe?g|webp)$/i.test(pname);
    if (!okType) return '预览图仅支持 PNG、JPG 或 WebP 格式';
    if (input.previewFile.size <= 0 || input.previewFile.size > MAX_WORKSHOP_PREVIEW_BYTES) {
      return '预览图大小不能超过 2MB';
    }
  }
  return null;
}

export async function submitWorkshopMod(input: WorkshopSubmitInput): Promise<WorkshopSubmitResponse> {
  const errMsg = validateWorkshopSubmission(input);
  if (errMsg) throw new Error(errMsg);

  const form = new FormData();
  form.set('name', input.name.trim());
  form.set('author', input.author.trim());
  form.set('category', input.category);
  form.set('description', input.description.trim());
  if (input.tags.trim()) form.set('tags', input.tags.trim());
  if (input.targetInfo.trim()) form.set('targetInfo', input.targetInfo.trim());
  if (input.externalUrl.trim()) form.set('externalUrl', input.externalUrl.trim());
  if (input.gameVersion?.trim()) form.set('gameVersion', input.gameVersion.trim());
  if (input.platforms?.trim()) form.set('platforms', input.platforms.trim());
  if (input.archiveFile) form.set('archive', input.archiveFile);
  if (input.previewFile) form.set('preview', input.previewFile);

  const headers: Record<string, string> = {};
  if (input.token?.trim()) {
    headers['Authorization'] = `Bearer ${input.token.trim()}`;
  }

  const res = await fetch(`${webApiBaseUrl()}/api/workshop/submit`, {
    method: 'POST',
    headers,
    body: form,
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`投稿提交失败（HTTP ${res.status}）`);
  }
  if (!res.ok) {
    throw new Error(
      (typeof parsed.error === 'string' && parsed.error) || `投稿提交失败（HTTP ${res.status}）`,
    );
  }
  return parsed as unknown as WorkshopSubmitResponse;
}

export function modHeatScore(item: WorkshopModItem): number {
  return (
    (item.downloads || 0) * 3 +
    (item.reactionTotal || 0) * 5 +
    (item.follows || 0) * 4 +
    (item.bookmarks || 0) * 2
  );
}

export function compareModsByHeat(a: WorkshopModItem, b: WorkshopModItem, locale = 'zh-CN'): number {
  const heatDiff = modHeatScore(b) - modHeatScore(a);
  if (heatDiff !== 0) return heatDiff;
  const dlDiff = (b.downloads || 0) - (a.downloads || 0);
  if (dlDiff !== 0) return dlDiff;
  const reactDiff = (b.reactionTotal || 0) - (a.reactionTotal || 0);
  if (reactDiff !== 0) return reactDiff;
  return a.name.localeCompare(b.name, locale);
}

export interface WorkshopDownloadProgress {
  loaded: number;
  total: number;
  percent: number | null;
}

export interface WorkshopDownloadResult {
  completed: boolean;
  cancelled: boolean;
  bytesReceived: number;
  counted?: boolean;
  downloads?: number;
  versionDownloads?: number;
}

interface WritableSaveFileStream {
  write: (data: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
}

interface SaveFileHandleLike {
  createWritable: () => Promise<WritableSaveFileStream>;
}

type ShowSaveFilePickerFn = (opts?: { suggestedName?: string }) => Promise<SaveFileHandleLike>;

function triggerBlobDownload(blob: Blob, filename: string): void {
  const objUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
  }
}

export async function reportWorkshopDownloadComplete(
  modId: string,
  payload: { versionId?: string | null; bytesReceived: number },
  token?: string | null,
): Promise<{ counted: boolean; downloads?: number; versionDownloads?: number }> {
  const cleanId = encodeURIComponent(String(modId || '').trim());
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  const res = await fetch(`${webApiBaseUrl()}/api/workshop/mods/${cleanId}/download-complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      versionId: payload.versionId || undefined,
      bytesReceived: payload.bytesReceived,
    }),
  });
  if (!res.ok) {
    return { counted: false };
  }
  try {
    const data = (await res.json()) as {
      counted?: boolean;
      downloads?: number;
      versionDownloads?: number;
    };
    return {
      counted: Boolean(data?.counted),
      downloads: typeof data?.downloads === 'number' ? data.downloads : undefined,
      versionDownloads: typeof data?.versionDownloads === 'number' ? data.versionDownloads : undefined,
    };
  } catch {
    return { counted: false };
  }
}

export async function downloadWorkshopModWithVerification(options: {
  modId: string;
  urlOrPath: string;
  fileName: string;
  versionId?: string | null;
  expectedBytes?: number | null;
  token?: string | null;
  countCompletion?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: WorkshopDownloadProgress) => void;
}): Promise<WorkshopDownloadResult> {
  const fullUrl = workshopAssetUrl(options.urlOrPath);
  if (!fullUrl) throw new Error('下载地址为空');
  const fileName = (options.fileName || 'mod-package.zip').trim() || 'mod-package.zip';
  const expectedHint = Number(options.expectedBytes || 0);

  let writable: WritableSaveFileStream | null = null;
  const picker =
    typeof window !== 'undefined'
      ? (window as unknown as { showSaveFilePicker?: ShowSaveFilePickerFn }).showSaveFilePicker
      : undefined;
  if (picker && expectedHint >= 64 * 1024 * 1024) {
    try {
      const handle = await picker({ suggestedName: fileName });
      writable = await handle.createWritable();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { completed: false, cancelled: true, bytesReceived: 0 };
      }
      writable = null;
    }
  }

  const headers: Record<string, string> = {};
  if (options.token?.trim()) {
    headers.Authorization = `Bearer ${options.token.trim()}`;
  }

  let res: Response;
  try {
    res = await fetch(fullUrl, { headers, signal: options.signal });
  } catch (err) {
    if (writable) {
      await writable.abort().catch(() => {});
    }
    if ((err instanceof DOMException && err.name === 'AbortError') || options.signal?.aborted) {
      return { completed: false, cancelled: true, bytesReceived: 0 };
    }
    throw err;
  }

  if (!res.ok) {
    if (writable) {
      await writable.abort().catch(() => {});
    }
    let msg = `下载失败 (${res.status})`;
    try {
      const errJson = (await res.json()) as { error?: string };
      if (errJson?.error) msg = errJson.error;
    } catch {
      // ignore non-json error body
    }
    throw new Error(msg);
  }

  const headerLen = Number(res.headers.get('Content-Length') || 0);
  const totalBytes = headerLen > 0 ? headerLen : expectedHint > 0 ? expectedHint : 0;

  let loaded = 0;
  let lastReportAt = 0;
  const emitProgress = (force = false) => {
    if (!options.onProgress) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && now - lastReportAt < 80) return;
    lastReportAt = now;
    const pct = totalBytes > 0 ? Math.min(100, Math.round((loaded / totalBytes) * 100)) : null;
    options.onProgress({ loaded, total: totalBytes, percent: pct });
  };

  emitProgress(true);

  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    loaded = buf.byteLength;
    if ((headerLen > 0 && loaded !== headerLen) || loaded <= 0) {
      if (writable) await writable.abort().catch(() => {});
      throw new Error('文件下载不完整，请重试。');
    }
    if (writable) {
      await writable.write(buf);
      await writable.close();
    } else {
      triggerBlobDownload(new Blob([buf], { type: 'application/octet-stream' }), fileName);
    }
    emitProgress(true);
  } else {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        if (options.signal?.aborted) {
          throw new DOMException('Download cancelled', 'AbortError');
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          loaded += value.byteLength;
          if (writable) {
            await writable.write(value);
          } else {
            chunks.push(value);
          }
          emitProgress(false);
        }
      }
      if ((headerLen > 0 && loaded !== headerLen) || loaded <= 0) {
        throw new Error('文件传输未完整结束，请重试。');
      }
      if (writable) {
        await writable.close();
      } else {
        triggerBlobDownload(new Blob(chunks as BlobPart[], { type: 'application/octet-stream' }), fileName);
      }
      emitProgress(true);
    } catch (err) {
      await reader.cancel().catch(() => {});
      if (writable) {
        await writable.abort().catch(() => {});
      }
      if ((err instanceof DOMException && err.name === 'AbortError') || options.signal?.aborted) {
        return { completed: false, cancelled: true, bytesReceived: loaded };
      }
      throw err;
    }
  }

  if (options.countCompletion !== false) {
    try {
      const receipt = await reportWorkshopDownloadComplete(
        options.modId,
        { versionId: options.versionId, bytesReceived: loaded },
        options.token,
      );
      return {
        completed: true,
        cancelled: false,
        bytesReceived: loaded,
        counted: receipt.counted,
        downloads: receipt.downloads,
        versionDownloads: receipt.versionDownloads,
      };
    } catch {
      return { completed: true, cancelled: false, bytesReceived: loaded };
    }
  }
  return { completed: true, cancelled: false, bytesReceived: loaded };
}
