import { useSyncExternalStore } from 'react';
import { isTauriRuntime, webApiBaseUrl } from './runtime.ts';
import type {
  WorkshopCategory,
  WorkshopChangelogEntry,
  WorkshopModItem,
  WorkshopReactionCount,
} from './workshopClient.ts';

const TOKEN_STORAGE_KEY = 'xingshu.platform.token';
const SAVED_ACCOUNTS_KEY = 'xingshu.platform.savedAccounts';

export interface PlatformUser {
  id: string;
  uid: number;
  username: string;
  displayName: string;
  email: string;
  bio: string;
  avatarColor: string;
  avatarUrl?: string | null;
  role: string;
  createdAt: number;
  updatedAt: number;
}

export interface PublicAuthorProfile {
  id?: string | null;
  uid?: number | null;
  username?: string | null;
  displayName: string;
  bio: string;
  avatarColor: string;
  avatarUrl?: string | null;
  role: string;
  isOfficial: boolean;
  createdAt?: number | null;
  modCount: number;
  totalDownloads: number;
  totalReactions: number;
}

export interface PlatformGameBinding {
  id: string;
  gameUid: string;
  gameNick: string;
  platform: string;
  platformLabel: string;
  isPrimary: boolean;
  verified: boolean;
  verifiedSource: string;
  boundAt: number;
}

export interface PlatformCollection {
  id: string;
  userId: string;
  name: string;
  description: string;
  visibility: string;
  modIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PlatformSavedAccount {
  user: PlatformUser;
  token: string;
}

export interface PlatformAccountSnapshot {
  loaded: boolean;
  token: string;
  user: PlatformUser | null;
  gameBindings: PlatformGameBinding[];
  follows: string[];
  bookmarks: string[];
  reactions: Record<string, string>;
  collections: PlatformCollection[];
  savedAccounts: PlatformSavedAccount[];
  authModalMode: 'login' | 'register' | null;
  createProjectModalOpen: boolean;
}

export const GAME_BIND_PLATFORMS = [
  { id: 'STEAM_CN', labelZh: 'Steam 国服', labelEn: 'Steam CN' },
  { id: 'STEAM_GLOBAL', labelZh: 'Steam 国际服', labelEn: 'Steam Global' },
  { id: 'TAPTAP', labelZh: 'TapTap', labelEn: 'TapTap' },
  { id: 'BILIBILI', labelZh: '哔哩哔哩', labelEn: 'Bilibili' },
  { id: 'WEGAME', labelZh: 'WeGame', labelEn: 'WeGame' },
  { id: 'ANDROID_CN', labelZh: '手机端 (安卓 / PE)', labelEn: 'Mobile (Android / PE)' },
] as const;

export const PLATFORM_AVATAR_SWATCHES = [
  '#f02878',
  '#2f7cf6',
  '#8b5cf6',
  '#ffc832',
  '#ec4899',
  '#06b6d4',
  '#ef4444',
  '#10b981',
] as const;

function readStorage(key: string): string {
  try {
    const storage = isTauriRuntime() ? sessionStorage : localStorage;
    if (isTauriRuntime()) localStorage.removeItem(key);
    return storage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeStorage(key: string, value: string): void {
  try {
    const storage = isTauriRuntime() ? sessionStorage : localStorage;
    if (value) storage.setItem(key, value);
    else storage.removeItem(key);
  } catch {
    // Ignore storage restriction errors.
  }
}

function loadSavedAccounts(): PlatformSavedAccount[] {
  const raw = readStorage(SAVED_ACCOUNTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PlatformSavedAccount =>
        Boolean(entry && typeof entry.token === 'string' && entry.user && typeof entry.user.id === 'string'),
    );
  } catch {
    return [];
  }
}

function saveSavedAccounts(list: PlatformSavedAccount[]): void {
  writeStorage(SAVED_ACCOUNTS_KEY, list.length ? JSON.stringify(list.slice(0, 6)) : '');
}

let snapshot: PlatformAccountSnapshot = {
  loaded: false,
  token: readStorage(TOKEN_STORAGE_KEY),
  user: null,
  gameBindings: [],
  follows: [],
  bookmarks: [],
  reactions: {},
  collections: [],
  savedAccounts: loadSavedAccounts(),
  authModalMode: null,
  createProjectModalOpen: false,
};

const listeners = new Set<() => void>();

function emitSnapshot(next: Partial<PlatformAccountSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) {
    listener();
  }
}

export function subscribePlatformAccount(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPlatformAccountSnapshot(): PlatformAccountSnapshot {
  return snapshot;
}

export function usePlatformAccount(): PlatformAccountSnapshot {
  return useSyncExternalStore(
    subscribePlatformAccount,
    getPlatformAccountSnapshot,
    getPlatformAccountSnapshot,
  );
}

export function openPlatformAuthModal(mode: 'login' | 'register' = 'login'): void {
  emitSnapshot({ authModalMode: mode });
}

export function closePlatformAuthModal(): void {
  emitSnapshot({ authModalMode: null });
}

export function openCreateProjectModal(): void {
  if (!snapshot.user) {
    emitSnapshot({ authModalMode: 'login' });
    return;
  }
  emitSnapshot({ createProjectModalOpen: true });
}

export function closeCreateProjectModal(): void {
  emitSnapshot({ createProjectModalOpen: false });
}

async function apiJson<T = Record<string, unknown>>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
  } = {},
): Promise<T> {
  const base = webApiBaseUrl();
  const headers: Record<string, string> = {};
  const tok = options.token ?? snapshot.token;
  if (tok) headers.Authorization = `Bearer ${tok}`;

  let reqBody: BodyInit | undefined;
  if (options.body instanceof FormData) {
    reqBody = options.body;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    reqBody = JSON.stringify(options.body);
  }

  let res: Response;
  let text: string;
  try {
    res = await fetch(`${base}${path}`, {
      method: options.method || (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: reqBody,
      redirect: 'error',
    });
    text = await res.text();
  } catch {
    throw new Error('暂时无法连接星枢平台服务，请检查网络后重试。');
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    if (res.status === 413) {
      throw new Error('上传文件体积过大，请选择较小的图片重试（HTTP 413）');
    }
    throw new Error(`平台服务返回无效数据（HTTP ${res.status}）`);
  }

  if (!res.ok) {
    const errMsg = typeof parsed.error === 'string' && parsed.error.trim()
      ? parsed.error
      : `请求未完成（HTTP ${res.status}）`;
    const err = new Error(errMsg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  return parsed as T;
}

function upsertSavedAccount(user: PlatformUser, token: string): PlatformSavedAccount[] {
  const filtered = snapshot.savedAccounts.filter((item) => item.user.id !== user.id);
  const next = [{ user, token }, ...filtered].slice(0, 6);
  saveSavedAccounts(next);
  return next;
}

interface AuthSessionPayload {
  token?: string;
  user: PlatformUser;
  gameBindings?: PlatformGameBinding[];
  follows?: string[];
  bookmarks?: string[];
  reactions?: Record<string, string>;
  collections?: PlatformCollection[];
}

function applySessionPayload(payload: AuthSessionPayload, overrideToken?: string): void {
  const token = overrideToken || payload.token || snapshot.token;
  if (token) writeStorage(TOKEN_STORAGE_KEY, token);
  const saved = upsertSavedAccount(payload.user, token);
  emitSnapshot({
    loaded: true,
    token,
    user: payload.user,
    gameBindings: payload.gameBindings || [],
    follows: payload.follows || [],
    bookmarks: payload.bookmarks || [],
    reactions: payload.reactions || {},
    collections: payload.collections || [],
    savedAccounts: saved,
  });
}

let inflightRefresh: Promise<PlatformAccountSnapshot> | null = null;

export async function refreshPlatformAccount(): Promise<PlatformAccountSnapshot> {
  if (inflightRefresh) return inflightRefresh;
  const currentToken = readStorage(TOKEN_STORAGE_KEY);
  if (!currentToken) {
    emitSnapshot({ loaded: true, token: '', user: null, gameBindings: [], follows: [], bookmarks: [], reactions: {}, collections: [] });
    return snapshot;
  }

  inflightRefresh = (async () => {
    try {
      const data = await apiJson<AuthSessionPayload>('/api/platform/me', { token: currentToken });
      applySessionPayload(data, currentToken);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        writeStorage(TOKEN_STORAGE_KEY, '');
        emitSnapshot({
          loaded: true,
          token: '',
          user: null,
          gameBindings: [],
          follows: [],
          bookmarks: [],
          reactions: {},
          collections: [],
        });
      } else {
        emitSnapshot({ loaded: true });
      }
    } finally {
      inflightRefresh = null;
    }
    return snapshot;
  })();

  return inflightRefresh;
}

export async function registerPlatformAccount(input: {
  username: string;
  password: string;
  displayName?: string;
  email?: string;
  bio?: string;
}): Promise<PlatformUser> {
  const data = await apiJson<AuthSessionPayload>('/api/platform/register', {
    method: 'POST',
    token: '',
    body: {
      ...input,
      clientType: isTauriRuntime() ? 'desktop' : 'web',
    },
  });
  applySessionPayload(data);
  return data.user;
}

export async function loginPlatformAccount(input: {
  username: string;
  password: string;
}): Promise<PlatformUser> {
  const data = await apiJson<AuthSessionPayload>('/api/platform/login', {
    method: 'POST',
    token: '',
    body: {
      ...input,
      clientType: isTauriRuntime() ? 'desktop' : 'web',
    },
  });
  applySessionPayload(data);
  return data.user;
}

export async function logoutPlatformAccount(): Promise<void> {
  const curToken = snapshot.token;
  const curUserId = snapshot.user?.id;
  if (curToken) {
    try {
      await apiJson('/api/platform/logout', { method: 'POST', body: {}, token: curToken });
    } catch {
      // Clear client state even if session was already expired.
    }
  }
  writeStorage(TOKEN_STORAGE_KEY, '');
  const nextSaved = curUserId
    ? snapshot.savedAccounts.filter((item) => item.user.id !== curUserId)
    : snapshot.savedAccounts;
  saveSavedAccounts(nextSaved);
  emitSnapshot({
    loaded: true,
    token: '',
    user: null,
    gameBindings: [],
    follows: [],
    bookmarks: [],
    reactions: {},
    collections: [],
    savedAccounts: nextSaved,
  });
}

export async function switchSavedPlatformAccount(userId: string): Promise<boolean> {
  const entry = snapshot.savedAccounts.find((item) => item.user.id === userId);
  if (!entry) return false;
  writeStorage(TOKEN_STORAGE_KEY, entry.token);
  emitSnapshot({ token: entry.token });
  await refreshPlatformAccount();
  return Boolean(snapshot.user && snapshot.user.id === userId);
}

export function removeSavedPlatformAccount(userId: string): void {
  const nextSaved = snapshot.savedAccounts.filter((item) => item.user.id !== userId);
  saveSavedAccounts(nextSaved);
  emitSnapshot({ savedAccounts: nextSaved });
}

export function platformAvatarUrl(pathOrUrl?: string | null): string {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = webApiBaseUrl();
  const clean = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${clean}`;
}

async function prepareAvatarUploadFile(file: File): Promise<File> {
  if (
    file.size <= 400_000 ||
    typeof document === 'undefined' ||
    typeof createImageBitmap !== 'function'
  ) {
    return file;
  }
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const maxDim = 512;
    const w = bitmap.width;
    const h = bitmap.height;
    if (w <= maxDim && h <= maxDim && file.size <= 1_800_000) {
      return file;
    }
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, tw, th);
    const tryEncode = (mime: string, quality?: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
    const encoded = (await tryEncode('image/webp', 0.9)) || (await tryEncode('image/png'));
    if (!encoded || encoded.size === 0 || encoded.size >= file.size) {
      return file;
    }
    const ext = encoded.type === 'image/webp' ? 'webp' : 'png';
    return new File([encoded], `avatar.${ext}`, { type: encoded.type });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

export async function uploadPlatformAvatar(file: File): Promise<PlatformUser> {
  const ready = await prepareAvatarUploadFile(file);
  const form = new FormData();
  form.set('file', ready);
  const data = await apiJson<{ user: PlatformUser }>('/api/platform/avatar', {
    method: 'POST',
    body: form,
  });
  const nextSaved = snapshot.token ? upsertSavedAccount(data.user, snapshot.token) : snapshot.savedAccounts;
  emitSnapshot({ user: data.user, savedAccounts: nextSaved });
  return data.user;
}

export async function deletePlatformAvatar(): Promise<PlatformUser> {
  const data = await apiJson<{ user: PlatformUser }>('/api/platform/avatar', {
    method: 'DELETE',
  });
  const nextSaved = snapshot.token ? upsertSavedAccount(data.user, snapshot.token) : snapshot.savedAccounts;
  emitSnapshot({ user: data.user, savedAccounts: nextSaved });
  return data.user;
}

export async function fetchPublicAuthorProfile(
  authorKey: string,
): Promise<{ author: PublicAuthorProfile; items: WorkshopModItem[] }> {
  return apiJson<{ author: PublicAuthorProfile; items: WorkshopModItem[] }>(
    `/api/platform/authors/${encodeURIComponent(authorKey.trim())}`,
    { token: '' },
  );
}

export async function updatePlatformProfile(patch: {
  displayName?: string;
  bio?: string;
  email?: string;
  avatarColor?: string;
}): Promise<PlatformUser> {
  const data = await apiJson<{ user: PlatformUser }>('/api/platform/profile', {
    method: 'PATCH',
    body: patch,
  });
  const nextSaved = snapshot.token ? upsertSavedAccount(data.user, snapshot.token) : snapshot.savedAccounts;
  emitSnapshot({ user: data.user, savedAccounts: nextSaved });
  return data.user;
}

export async function changePlatformPassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiJson('/api/platform/password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });
}

export async function bindPlatformGameAccount(input: {
  gameUid?: string;
  gameNick?: string;
  platform: string;
  gameAuthToken?: string;
  setPrimary?: boolean;
}): Promise<PlatformGameBinding[]> {
  const data = await apiJson<{ bindings: PlatformGameBinding[] }>('/api/platform/game-accounts', {
    method: 'POST',
    body: input,
  });
  emitSnapshot({ gameBindings: data.bindings || [] });
  return data.bindings || [];
}

export async function setPrimaryPlatformGameBinding(bindingId: string): Promise<PlatformGameBinding[]> {
  const data = await apiJson<{ bindings: PlatformGameBinding[] }>(
    `/api/platform/game-accounts/${encodeURIComponent(bindingId)}/primary`,
    { method: 'PATCH', body: {} },
  );
  emitSnapshot({ gameBindings: data.bindings || [] });
  return data.bindings || [];
}

export async function unbindPlatformGameAccount(bindingId: string): Promise<PlatformGameBinding[]> {
  const data = await apiJson<{ bindings: PlatformGameBinding[] }>(
    `/api/platform/game-accounts/${encodeURIComponent(bindingId)}`,
    { method: 'DELETE' },
  );
  emitSnapshot({ gameBindings: data.bindings || [] });
  return data.bindings || [];
}

export async function togglePlatformModFavorite(
  modId: string,
  kind: 'follow' | 'bookmark',
): Promise<{
  active: boolean;
  follows: string[];
  bookmarks: string[];
  counts: { follows: number; bookmarks: number };
}> {
  if (!snapshot.user) {
    openPlatformAuthModal('login');
    throw new Error('请先登录星枢平台账号');
  }
  const data = await apiJson<{
    active: boolean;
    follows: string[];
    bookmarks: string[];
    counts: { follows: number; bookmarks: number };
  }>('/api/platform/favorites/toggle', {
    method: 'POST',
    body: { modId, kind },
  });
  emitSnapshot({
    follows: data.follows || [],
    bookmarks: data.bookmarks || [],
  });
  return data;
}

export async function createPlatformCollection(input: {
  name: string;
  description?: string;
  visibility?: 'public' | 'unlisted' | 'private';
}): Promise<PlatformCollection> {
  const data = await apiJson<{ collection: PlatformCollection; collections: PlatformCollection[] }>(
    '/api/platform/collections',
    { method: 'POST', body: input },
  );
  emitSnapshot({ collections: data.collections || [] });
  return data.collection;
}

export async function updatePlatformCollectionMod(
  collectionId: string,
  modId: string,
  action: 'add' | 'remove' = 'add',
): Promise<PlatformCollection> {
  const data = await apiJson<{ collection: PlatformCollection; collections: PlatformCollection[] }>(
    `/api/platform/collections/${encodeURIComponent(collectionId)}/mods`,
    { method: 'POST', body: { modId, action } },
  );
  emitSnapshot({ collections: data.collections || [] });
  return data.collection;
}

export async function deletePlatformCollection(collectionId: string): Promise<void> {
  const data = await apiJson<{ collections: PlatformCollection[] }>(
    `/api/platform/collections/${encodeURIComponent(collectionId)}`,
    { method: 'DELETE' },
  );
  emitSnapshot({ collections: data.collections || [] });
}

export async function fetchMyWorkshopProjects(): Promise<WorkshopModItem[]> {
  const data = await apiJson<{ items: WorkshopModItem[] }>('/api/workshop/my-projects');
  return data.items || [];
}

export interface CreateWorkshopProjectInput {
  category: Exclude<WorkshopCategory, 'all'>;
  name: string;
  slug: string;
  visibility: 'public' | 'unlisted' | 'private';
  description: string;
  longDescription?: string;
  tags?: string;
  targetInfo?: string;
  gameVersion?: string;
  version?: string;
  platforms?: string;
  externalUrl?: string;
  archiveFile?: File | null;
  previewFile?: File | null;
}

export async function createWorkshopProject(input: CreateWorkshopProjectInput): Promise<WorkshopModItem> {
  const hasFile = Boolean(input.archiveFile || input.previewFile);
  if (hasFile) {
    const form = new FormData();
    form.set('category', input.category);
    form.set('name', input.name.trim());
    form.set('slug', input.slug.trim().toLowerCase());
    form.set('visibility', input.visibility);
    form.set('description', input.description.trim());
    if (input.longDescription?.trim()) form.set('longDescription', input.longDescription.trim());
    if (input.tags?.trim()) form.set('tags', input.tags.trim());
    if (input.targetInfo?.trim()) form.set('targetInfo', input.targetInfo.trim());
    if (input.gameVersion?.trim()) form.set('gameVersion', input.gameVersion.trim());
    if (input.version?.trim()) form.set('version', input.version.trim());
    if (input.platforms?.trim()) form.set('platforms', input.platforms.trim());
    if (input.externalUrl?.trim()) form.set('externalUrl', input.externalUrl.trim());
    if (input.archiveFile) form.set('archive', input.archiveFile);
    if (input.previewFile) form.set('preview', input.previewFile);
    const data = await apiJson<{ item: WorkshopModItem }>('/api/workshop/projects', {
      method: 'POST',
      body: form,
    });
    return data.item;
  }

  const data = await apiJson<{ item: WorkshopModItem }>('/api/workshop/projects', {
    method: 'POST',
    body: {
      category: input.category,
      name: input.name.trim(),
      slug: input.slug.trim().toLowerCase(),
      visibility: input.visibility,
      description: input.description.trim(),
      longDescription: input.longDescription?.trim() || '',
      tags: input.tags?.trim() || '',
      targetInfo: input.targetInfo?.trim() || '',
      gameVersion: input.gameVersion?.trim() || '3.3.0',
      version: input.version?.trim() || '1.0.0',
      ...(input.platforms?.trim() ? { platforms: input.platforms.trim() } : {}),
      externalUrl: input.externalUrl?.trim() || '',
    },
  });
  return data.item;
}

export async function uploadWorkshopProjectVersion(
  modIdOrSlug: string,
  input: {
    version: string;
    notes: string;
    gameVersion?: string;
    title?: string;
    channel?: 'release' | 'beta' | 'optional' | string;
    platforms?: string;
    archiveFile: File;
    previewFile?: File | null;
  },
): Promise<WorkshopModItem> {
  const form = new FormData();
  form.set('version', input.version.trim());
  form.set('notes', input.notes.trim());
  if (input.gameVersion?.trim()) form.set('gameVersion', input.gameVersion.trim());
  if (input.title?.trim()) form.set('title', input.title.trim());
  if (input.channel?.trim()) form.set('channel', input.channel.trim());
  if (input.platforms?.trim()) form.set('platforms', input.platforms.trim());
  form.set('archive', input.archiveFile);
  if (input.previewFile) form.set('preview', input.previewFile);
  const data = await apiJson<{ item: WorkshopModItem }>(
    `/api/workshop/projects/${encodeURIComponent(modIdOrSlug)}/versions`,
    { method: 'POST', body: form },
  );
  return data.item;
}

export async function deleteWorkshopProject(modIdOrSlug: string): Promise<void> {
  await apiJson(`/api/workshop/projects/${encodeURIComponent(modIdOrSlug)}`, {
    method: 'DELETE',
  });
}

export async function setPlatformModReaction(
  modId: string,
  emoteId: string,
  action: 'toggle' | 'set' | 'remove' = 'toggle',
): Promise<{
  modId: string;
  viewerEmoteId: string | null;
  reactions: WorkshopReactionCount[];
  reactionTotal: number;
}> {
  const data = await apiJson<{
    modId: string;
    viewerEmoteId: string | null;
    reactions: WorkshopReactionCount[];
    reactionTotal: number;
    userReactions?: Record<string, string>;
  }>('/api/platform/reactions/set', {
    method: 'POST',
    body: { modId, emoteId, action },
  });
  if (data.userReactions) {
    emitSnapshot({ reactions: data.userReactions });
  } else {
    const nextMap = { ...snapshot.reactions };
    if (data.viewerEmoteId) nextMap[data.modId] = data.viewerEmoteId;
    else delete nextMap[data.modId];
    emitSnapshot({ reactions: nextMap });
  }
  return {
    modId: data.modId,
    viewerEmoteId: data.viewerEmoteId ?? null,
    reactions: data.reactions || [],
    reactionTotal: Number(data.reactionTotal || 0),
  };
}

export async function uploadWorkshopProjectIcon(modIdOrSlug: string, file: File): Promise<WorkshopModItem> {
  const form = new FormData();
  form.set('file', file);
  const data = await apiJson<{ item: WorkshopModItem }>(
    `/api/workshop/projects/${encodeURIComponent(modIdOrSlug)}/icon`,
    { method: 'POST', body: form },
  );
  return data.item;
}

export async function deleteWorkshopProjectIcon(modIdOrSlug: string): Promise<WorkshopModItem> {
  const data = await apiJson<{ item: WorkshopModItem }>(
    `/api/workshop/projects/${encodeURIComponent(modIdOrSlug)}/icon`,
    { method: 'DELETE' },
  );
  return data.item;
}

export interface UpdateWorkshopProjectPayload {
  name?: string;
  slug?: string;
  category?: Exclude<WorkshopCategory, 'all'> | string;
  visibility?: 'public' | 'unlisted' | 'private' | string;
  gameVersion?: string;
  platforms?: string[];
  license?: string;
  targetInfo?: string;
  externalUrl?: string;
  tags?: string[] | string;
  description?: string;
  longDescription?: string;
  promoHeadline?: string;
  promoVideoUrl?: string;
  changelog?: WorkshopChangelogEntry[];
}

export async function updateWorkshopProject(
  modIdOrSlug: string,
  payload: UpdateWorkshopProjectPayload,
): Promise<WorkshopModItem> {
  const data = await apiJson<{ item: WorkshopModItem }>(
    `/api/workshop/projects/${encodeURIComponent(modIdOrSlug)}`,
    { method: 'PATCH', body: payload },
  );
  return data.item;
}

export async function uploadWorkshopGalleryImage(
  modIdOrSlug: string,
  input: { file: File; caption?: string; featured?: boolean },
): Promise<WorkshopModItem> {
  const form = new FormData();
  form.set('file', input.file);
  if (input.caption !== undefined) form.set('caption', input.caption.trim());
  if (input.featured !== undefined) form.set('featured', input.featured ? 'true' : 'false');
  const data = await apiJson<{ item: WorkshopModItem }>(
    `/api/workshop/projects/${encodeURIComponent(modIdOrSlug)}/gallery`,
    { method: 'POST', body: form },
  );
  return data.item;
}

export async function updateWorkshopGalleryImage(
  modIdOrSlug: string,
  imageId: string,
  input: { caption?: string; featured?: boolean },
): Promise<WorkshopModItem> {
  const data = await apiJson<{ item: WorkshopModItem }>(
    `/api/workshop/projects/${encodeURIComponent(modIdOrSlug)}/gallery/${encodeURIComponent(imageId)}`,
    { method: 'PATCH', body: input },
  );
  return data.item;
}

export async function deleteWorkshopGalleryImage(modIdOrSlug: string, imageId: string): Promise<WorkshopModItem> {
  const data = await apiJson<{ item: WorkshopModItem }>(
    `/api/workshop/projects/${encodeURIComponent(modIdOrSlug)}/gallery/${encodeURIComponent(imageId)}`,
    { method: 'DELETE' },
  );
  return data.item;
}

export function isPlatformAdmin(user?: PlatformUser | null): boolean {
  const role = String(user?.role || '').trim().toLowerCase();
  return role === 'official' || role === 'admin';
}

export interface AdminAuditEntry {
  id: string;
  actorId?: string | null;
  actorUid?: number | null;
  actorName: string;
  actorRole: string;
  action: string;
  targetId: string;
  targetName: string;
  detail: string;
  at: string;
}

export interface AdminOverviewResponse {
  platform: {
    totalUsers: number;
    todayUsers: number;
    activeSessions: number;
    totalGameBindings: number;
    totalFavorites: number;
    totalReactions: number;
    roleCounts: Record<string, number>;
  };
  workshop: {
    totalSeed: number;
    totalSubmissions: number;
    pendingCount: number;
    pendingVersionUpdates: number;
    pendingQueueTotal: number;
    approvedCount: number;
    rejectedCount: number;
    unpublishedCount: number;
    totalDownloads: number;
  };
  gameAuth: {
    authorizedAccounts: number;
    channelBindings: number;
    activeAuthGrants: number;
    publicPlayers: number;
    archivedMatches: number;
  };
  credit?: {
    pendingReports: number;
    totalReports: number;
    approvedReports: number;
    rejectedReports: number;
    activeSanctions: number;
    fleetBannedCount: number;
    totalLikes: number;
    totalBlacklists: number;
    activeFleetRooms: number;
    activeSquads: number;
  };
  auditLog: AdminAuditEntry[];
}

export interface AdminUserEntry {
  id: string;
  uid: number;
  username: string;
  displayName: string;
  email: string;
  role: string;
  bio: string;
  avatarColor: string;
  avatarUrl?: string | null;
  gameBindingsCount: number;
  submissionCount: number;
  activeSessionCount: number;
  lastActiveAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export async function fetchAdminOverview(): Promise<AdminOverviewResponse> {
  return await apiJson<AdminOverviewResponse>('/api/admin/overview');
}

export async function fetchAdminUsers(query = '', role = ''): Promise<{ items: AdminUserEntry[]; total: number }> {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  if (role.trim() && role !== 'all') params.set('role', role.trim());
  const qs = params.toString();
  return await apiJson<{ items: AdminUserEntry[]; total: number }>(`/api/admin/users${qs ? `?${qs}` : ''}`);
}

export async function updateAdminUserRole(
  userId: string,
  role: 'member' | 'creator' | 'official' | 'admin' | 'banned',
  note = '',
): Promise<{ ok: boolean; user: PlatformUser }> {
  return await apiJson<{ ok: boolean; user: PlatformUser }>(
    `/api/admin/users/${encodeURIComponent(userId)}/role`,
    { method: 'PATCH', body: { role, note } },
  );
}

export async function fetchAdminSubmissions(
  status = 'all',
  query = '',
): Promise<{ items: WorkshopModItem[]; stats?: AdminOverviewResponse['workshop'] }> {
  const params = new URLSearchParams();
  if (status && status !== 'all') params.set('status', status);
  if (query.trim()) params.set('q', query.trim());
  const qs = params.toString();
  return await apiJson<{ items: WorkshopModItem[]; stats?: AdminOverviewResponse['workshop'] }>(
    `/api/admin/submissions${qs ? `?${qs}` : ''}`,
  );
}

export async function submitAdminReview(input: {
  id: string;
  action: 'approve' | 'reject' | 'unpublish' | 'restore' | 'delete';
  note?: string;
  versionId?: string;
}): Promise<{ ok: boolean; status?: string; deleted?: boolean; item?: WorkshopModItem }> {
  return await apiJson<{ ok: boolean; status?: string; deleted?: boolean; item?: WorkshopModItem }>(
    '/api/admin/review',
    { method: 'POST', body: input },
  );
}

export async function fetchAdminMods(query = ''): Promise<{ items: WorkshopModItem[] }> {
  const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  return await apiJson<{ items: WorkshopModItem[] }>(`/api/admin/mods${qs}`);
}

export async function fetchAdminAuditLog(limit = 80): Promise<{ items: AdminAuditEntry[] }> {
  return await apiJson<{ items: AdminAuditEntry[] }>(`/api/admin/audit-log?limit=${limit}`);
}

export interface CreditProfileSummary {
  uid: string;
  nick: string;
  score: number;
  tier: 'excellent' | 'good' | 'fair' | 'warning' | 'danger' | string;
  tierLabel: string;
  observing: boolean;
  recordedMatches: number;
  giveUpCount: number;
  giveUpRate: number;
  recent10Matches: number;
  recent10GiveUps: number;
  likesCount: number;
  blacklistCount: number;
  fleetBanned: boolean;
  tags: string[];
  breakdown?: {
    base: number;
    disconnectPenalty: number;
    completionBonus: number;
    likesBonus: number;
    communityRiskPenalty: number;
    adminDelta: number;
  };
}

export interface AdminCreditReportItem {
  id: string;
  reporterUid: string;
  reporterNick: string;
  targetUid: string;
  targetNick: string;
  reason: string;
  reasonLabel: string;
  detail: string;
  replayId: string;
  roomId: string;
  matchTime: number;
  status: 'pending' | 'approved' | 'rejected' | string;
  reviewNote: string;
  reviewer: string;
  scoreDelta: number;
  badge: string;
  fleetBan: boolean;
  adjustmentId: string;
  created: number;
  reviewedAt: number;
  targetProfile?: CreditProfileSummary;
}

export interface AdminCreditAdjustment {
  id: string;
  targetUid: string;
  scoreDelta: number;
  badge: string;
  fleetBan: boolean;
  reason: string;
  actor: string;
  reportId: string;
  active: boolean;
  created: number;
  revokedAt: number;
  revokedBy: string;
}

export interface AdminCreditPlayerDetail {
  profile: CreditProfileSummary;
  adjustments: AdminCreditAdjustment[];
  recentReports: AdminCreditReportItem[];
}

export async function fetchAdminCreditReports(
  status = 'pending',
  query = '',
): Promise<{ items: AdminCreditReportItem[]; total: number; stats?: AdminOverviewResponse['credit'] }> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (query.trim()) params.set('q', query.trim());
  const qs = params.toString();
  return await apiJson<{ items: AdminCreditReportItem[]; total: number; stats?: AdminOverviewResponse['credit'] }>(
    `/api/admin/credit/reports${qs ? `?${qs}` : ''}`,
  );
}

export async function reviewAdminCreditReport(
  reportId: string,
  payload: {
    action: 'approve' | 'reject';
    reviewNote?: string;
    scoreDelta?: number;
    badge?: string;
    fleetBan?: boolean;
  },
): Promise<{ ok: boolean; report: AdminCreditReportItem }> {
  return await apiJson<{ ok: boolean; report: AdminCreditReportItem }>(
    `/api/admin/credit/reports/${encodeURIComponent(reportId)}/review`,
    { method: 'POST', body: payload },
  );
}

export async function fetchAdminCreditPlayer(uid: string): Promise<AdminCreditPlayerDetail> {
  return await apiJson<AdminCreditPlayerDetail>(
    `/api/admin/credit/player/${encodeURIComponent(uid.trim())}`,
  );
}

export async function createAdminCreditAdjustment(payload: {
  targetUid: string;
  scoreDelta?: number;
  badge?: string;
  fleetBan?: boolean;
  reason?: string;
}): Promise<{ ok: boolean } & AdminCreditPlayerDetail> {
  return await apiJson<{ ok: boolean } & AdminCreditPlayerDetail>(
    '/api/admin/credit/adjust',
    { method: 'POST', body: payload },
  );
}

export async function revokeAdminCreditAdjustment(
  adjId: string,
): Promise<{ ok: boolean } & AdminCreditPlayerDetail> {
  return await apiJson<{ ok: boolean } & AdminCreditPlayerDetail>(
    `/api/admin/credit/adjust/${encodeURIComponent(adjId)}/revoke`,
    { method: 'POST', body: {} },
  );
}

export async function downloadWorkshopArchiveAuthenticated(
  urlOrPath: string,
  fallbackFilename = 'mod-package.zip',
): Promise<void> {
  const trimmed = String(urlOrPath || '').trim();
  if (!trimmed) throw new Error('下载地址为空');
  const fullUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `${webApiBaseUrl()}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
  const headers: Record<string, string> = {};
  if (snapshot.token) {
    headers.Authorization = `Bearer ${snapshot.token}`;
  }
  const res = await fetch(fullUrl, { headers });
  if (!res.ok) {
    let msg = `下载失败 (${res.status})`;
    try {
      const errJson = (await res.json()) as { error?: string };
      if (errJson?.error) msg = errJson.error;
    } catch {
      // ignore non-json error body
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = fallbackFilename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
  }
}
