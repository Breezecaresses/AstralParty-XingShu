import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Film,
  Filter,
  Images,
  Info,
  Link2,
  Maximize2,
  Monitor,
  MoreVertical,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Scale,
  Settings,
  ShieldCheck,
  Smartphone,
  SmilePlus,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { EmoteReactionBar } from '../../components/platform/EmoteReactionBar';
import { PlatformUserAvatar } from '../../components/platform/PlatformUserAvatar';
import { useTranslation } from '../../i18n';
import {
  GAME_BIND_PLATFORMS,
  deleteWorkshopGalleryImage,
  deleteWorkshopProject,
  deleteWorkshopProjectIcon,
  downloadWorkshopArchiveAuthenticated,
  isPlatformAdmin,
  openPlatformAuthModal,
  submitAdminReview,
  togglePlatformModFavorite,
  updatePlatformCollectionMod,
  updateWorkshopGalleryImage,
  updateWorkshopProject,
  uploadWorkshopGalleryImage,
  uploadWorkshopProjectIcon,
  uploadWorkshopProjectVersion,
  usePlatformAccount,
} from '../../shared/platformAccountClient';
import { PROJECT_SOURCE } from '../../shared/projectSource';
import {
  WORKSHOP_CATEGORIES,
  WORKSHOP_UPLOAD_CHANNEL_PRESETS,
  fetchWorkshopModDetail,
  formatModBytes,
  formatWorkshopChannelName,
  installKindLabel,
  modPlatformSummaryBadge,
  sanitizeWorkshopPlatforms,
  workshopAssetUrl,
  type WorkshopChangelogEntry,
  type WorkshopModItem,
} from '../../shared/workshopClient';
import { getCategoryVisualMeta, getLauncherModuleMeta } from '../launcher/launcherModMeta';
import './modrinth.css';

type DetailTab = 'description' | 'gallery' | 'changelog' | 'versions' | 'settings';

const VALID_TABS: readonly DetailTab[] = ['description', 'gallery', 'changelog', 'versions', 'settings'];

function normalizeVersionChannel(channel?: string | null): 'release' | 'beta' | 'optional' {
  const c = (channel || '').trim().toLowerCase();
  if (c === 'beta' || c === 'b' || c === 'alpha') return 'beta';
  if (c === 'optional' || c === 'o' || c === 'variant' || c === 'alt') return 'optional';
  return 'release';
}

function versionChannelMeta(channel: 'release' | 'beta' | 'optional', zh: boolean) {
  switch (channel) {
    case 'beta':
      return { letter: 'B', label: zh ? '测试版 (Beta)' : 'Beta', cls: 'is-beta' };
    case 'optional':
      return { letter: 'O', label: zh ? '备选方案' : 'Optional', cls: 'is-optional' };
    default:
      return { letter: 'R', label: zh ? '正式推荐' : 'Release', cls: 'is-release' };
  }
}

function formatVersionPlatformText(
  ver: { platformLabel?: string; platforms?: string[]; installKind?: string; fileName?: string; id?: string; title?: string },
  zh: boolean,
): { label: string; isMobile: boolean } {
  const rawPlatforms = sanitizeWorkshopPlatforms(ver.platforms);
  const hint = `${ver.platformLabel || ''} ${ver.title || ''} ${ver.fileName || ''} ${ver.id || ''}`.toLowerCase();
  const isMobile =
    rawPlatforms.some((p) => p === 'PE' || p === 'ANDROID_CN' || p.includes('MOBILE')) ||
    /\bpe\b|modimg|手机端|安卓|android/.test(hint);
  if (ver.platformLabel?.trim()) {
    const cleanLabel = ver.platformLabel
      .replace(/\s*\/\s*iOS/gi, '')
      .replace(/iOS\s*\/\s*/gi, '')
      .trim();
    if (cleanLabel && !/ios/i.test(cleanLabel)) {
      return { label: cleanLabel, isMobile };
    }
  }
  if (isMobile) {
    return { label: zh ? '手机端 (PE)' : 'Mobile (PE)', isMobile: true };
  }
  if (rawPlatforms.some((p) => ['STEAM_CN', 'TAPTAP', 'BILIBILI', 'WEGAME', 'STEAM_GLOBAL', 'PC'].includes(p))) {
    return { label: zh ? 'PC 端' : 'PC', isMobile: false };
  }
  return { label: ver.installKind ? installKindLabel(ver.installKind) : zh ? '全平台' : 'All', isMobile: false };
}

function formatVersionDate(publishedAt?: string | null, zh = true): string {
  const raw = (publishedAt || '').trim();
  if (!raw) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ms = Date.parse(raw);
  if (Number.isFinite(ms)) {
    try {
      return new Date(ms).toLocaleDateString(zh ? 'zh-CN' : 'en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      return raw.slice(0, 10);
    }
  }
  return raw.slice(0, 16);
}

function renderInlineFormatted(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let k = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={k++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(<code key={k++}>{token.slice(1, -1)}</code>);
    }
    lastIdx = match.index + token.length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

function renderProseBlocks(markdownText: string): React.ReactNode {
  const lines = markdownText.split(/\r?\n/);
  const nodes: React.ReactNode[] = [];
  let listItems: string[] = [];
  let orderedItems: string[] = [];
  let keyCounter = 0;

  const flushLists = () => {
    if (listItems.length > 0) {
      nodes.push(
        <ul key={keyCounter++}>
          {listItems.map((li, i) => (
            <li key={i}>{renderInlineFormatted(li)}</li>
          ))}
        </ul>,
      );
      listItems = [];
    }
    if (orderedItems.length > 0) {
      nodes.push(
        <ol key={keyCounter++}>
          {orderedItems.map((li, i) => (
            <li key={i}>{renderInlineFormatted(li)}</li>
          ))}
        </ol>,
      );
      orderedItems = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushLists();
      continue;
    }
    if (line.startsWith('### ')) {
      flushLists();
      nodes.push(<h3 key={keyCounter++}>{line.slice(4)}</h3>);
    } else if (line.startsWith('## ')) {
      flushLists();
      nodes.push(<h2 key={keyCounter++}>{line.slice(3)}</h2>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      orderedItems = [];
      listItems.push(line.slice(2));
    } else if (/^\d+\.\s+/.test(line)) {
      listItems = [];
      orderedItems.push(line.replace(/^\d+\.\s+/, ''));
    } else {
      flushLists();
      nodes.push(<p key={keyCounter++}>{renderInlineFormatted(line)}</p>);
    }
  }
  flushLists();
  return <div className="mr-detail-prose">{nodes}</div>;
}

export const ModrinthProjectDetailPage: React.FC = () => {
  const { modId = '' } = useParams<{ modId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { locale } = useTranslation();
  const zh = locale === 'zh-CN';
  const platform = usePlatformAccount();

  const initialTabParam = searchParams.get('tab') as DetailTab | null;
  const [tab, setTabState] = useState<DetailTab>(
    initialTabParam && VALID_TABS.includes(initialTabParam) ? initialTabParam : 'description',
  );

  const [item, setItem] = useState<WorkshopModItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedKey, setCopiedKey] = useState('');
  const [imgFailed, setImgFailed] = useState(false);
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Avatar upload ref/state
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  // Showcase stage & lightbox
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  // Quick inline promo & description editor (on 描述 tab)
  const [inlineEditOpen, setInlineEditOpen] = useState(false);
  const [inlinePreviewMode, setInlinePreviewMode] = useState<'edit' | 'preview'>('edit');
  const [promoHeadDraft, setPromoHeadDraft] = useState('');
  const [promoVideoDraft, setPromoVideoDraft] = useState('');
  const [shortDescDraft, setShortDescDraft] = useState('');
  const [longDescDraft, setLongDescDraft] = useState('');
  const [inlineBusy, setInlineBusy] = useState(false);

  // Full project settings form (on 项目设置 tab)
  const [setName, setSetName] = useState('');
  const [setSlug, setSetSlug] = useState('');
  const [setCategory, setSetCategory] = useState('skin');
  const [setVisibility, setSetVisibility] = useState('public');
  const [setGameVersion, setSetGameVersion] = useState('3.3.0');
  const [setLicense, setSetLicense] = useState('MIT');
  const [setPlatforms, setSetPlatforms] = useState<string[]>(['STEAM_CN']);
  const [setTargetInfo, setSetTargetInfo] = useState('');
  const [setExternalUrl, setSetExternalUrl] = useState('');
  const [setTags, setSetTags] = useState('');
  const [setDesc, setSetDesc] = useState('');
  const [setPromoHeadline, setSetPromoHeadline] = useState('');
  const [setPromoVideo, setSetPromoVideo] = useState('');
  const [setLongDesc, setSetLongDesc] = useState('');
  const [setMdPreview, setSetMdPreview] = useState<'edit' | 'preview'>('edit');
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [confirmDeleteStep, setConfirmDeleteStep] = useState(false);

  // Gallery upload & caption edit
  const [galFile, setGalFile] = useState<File | null>(null);
  const [galCaption, setGalCaption] = useState('');
  const [galFeatured, setGalFeatured] = useState(true);
  const [galBusy, setGalBusy] = useState(false);
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});

  // Changelog editor
  const [logEditorOpen, setLogEditorOpen] = useState(false);
  const [logVerInput, setLogVerInput] = useState('');
  const [logTitleInput, setLogTitleInput] = useState('');
  const [logNotesInput, setLogNotesInput] = useState('');
  const [logBusy, setLogBusy] = useState(false);
  const [editingLogIdx, setEditingLogIdx] = useState<number | null>(null);
  const [editingLogDraft, setEditingLogDraft] = useState<WorkshopChangelogEntry | null>(null);

  // Owner version upload state
  const [verInput, setVerInput] = useState('1.0.1');
  const [verGameInput, setVerGameInput] = useState('3.3.0');
  const [verTitleInput, setVerTitleInput] = useState('');
  const [verChannelInput, setVerChannelInput] = useState<'release' | 'beta' | 'optional'>('release');
  const [verPlatformsInput, setVerPlatformsInput] = useState('STEAM_CN,TAPTAP,BILIBILI,WEGAME');
  const [verNotes, setVerNotes] = useState('');
  const [verFile, setVerFile] = useState<File | null>(null);
  const [verBusy, setVerBusy] = useState(false);
  const [verErr, setVerErr] = useState('');

  // Multi-version download picker & table filter state
  const [downloadPickerOpen, setDownloadPickerOpen] = useState(false);
  const [verChannelFilter, setVerChannelFilter] = useState<'all' | 'release' | 'beta' | 'optional'>('all');
  const [verPlatformFilter, setVerPlatformFilter] = useState('all');
  const [verGameVerFilter, setVerGameVerFilter] = useState('all');
  const [openVerMenuKey, setOpenVerMenuKey] = useState<string | null>(null);
  const [expandedVerKey, setExpandedVerKey] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewNoteInput, setReviewNoteInput] = useState('');

  const syncDraftsFromItem = useCallback((mod: WorkshopModItem) => {
    setImgFailed(false);
    setPromoHeadDraft(mod.promoHeadline || '');
    setPromoVideoDraft(mod.promoVideoUrl || '');
    setShortDescDraft(mod.description || '');
    setLongDescDraft(mod.longDescription || mod.description || '');

    setSetName(mod.name || '');
    setSetSlug(mod.slug || '');
    setSetCategory(mod.category || 'skin');
    setSetVisibility(mod.visibility || 'public');
    setSetGameVersion(mod.gameVersion || '3.3.0');
    setSetLicense(mod.license || 'MIT');
    const cleanPlatforms = sanitizeWorkshopPlatforms(mod.platforms);
    setSetPlatforms(cleanPlatforms.length ? cleanPlatforms : ['STEAM_CN']);
    setSetTargetInfo(mod.targetInfo || '');
    setSetExternalUrl(mod.externalUrl || '');
    setSetTags((mod.tags || []).join(', '));
    setSetDesc(mod.description || '');
    setSetPromoHeadline(mod.promoHeadline || '');
    setSetPromoVideo(mod.promoVideoUrl || '');
    setSetLongDesc(mod.longDescription || mod.description || '');

    setVerGameInput(mod.gameVersion || '3.3.0');
    setVerChannelFilter('all');
    setVerPlatformFilter('all');
    setVerGameVerFilter('all');
    setOpenVerMenuKey(null);
    setExpandedVerKey(null);
    setDownloadPickerOpen(false);
    setLogVerInput(mod.version || '1.0.0');
    const gal = mod.gallery || [];
    const featIdx = gal.findIndex((g) => g.featured);
    setActiveSlideIdx(featIdx >= 0 ? featIdx : 0);
    const caps: Record<string, string> = {};
    gal.forEach((g) => {
      caps[g.id] = g.caption || '';
    });
    setCaptionDrafts(caps);
  }, []);

  const loadDetail = useCallback(async () => {
    if (!modId) return;
    setLoading(true);
    setError('');
    try {
      const detail = await fetchWorkshopModDetail(modId, platform.token || null);
      setItem(detail);
      syncDraftsFromItem(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [modId, platform.token, syncDraftsFromItem]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    const t = searchParams.get('tab') as DetailTab | null;
    if (t && VALID_TABS.includes(t)) {
      setTabState(t);
    }
  }, [searchParams]);

  const setTab = (next: DetailTab) => {
    setTabState(next);
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'description') nextParams.delete('tab');
    else nextParams.set('tab', next);
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    if (!downloadPickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDownloadPickerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [downloadPickerOpen]);

  useEffect(() => {
    if (!openVerMenuKey) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.mr-ver-menu-wrap')) return;
      setOpenVerMenuKey(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenVerMenuKey(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openVerMenuKey]);

  const gallery = useMemo(() => item?.gallery || [], [item]);

  useEffect(() => {
    if (lightboxIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIdx(null);
      else if (e.key === 'ArrowLeft' && gallery.length > 1) {
        setLightboxIdx((prev) => (prev === null ? 0 : (prev - 1 + gallery.length) % gallery.length));
      } else if (e.key === 'ArrowRight' && gallery.length > 1) {
        setLightboxIdx((prev) => (prev === null ? 0 : (prev + 1) % gallery.length));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gallery.length, lightboxIdx]);

  const applyUpdatedItem = (updated: WorkshopModItem, noticeText: string) => {
    setItem(updated);
    syncDraftsFromItem(updated);
    setFeedback({ kind: 'ok', text: noticeText });
  };

  const copyValue = async (key: string, val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(''), 1800);
    } catch {
      // Ignore clipboard restriction errors.
    }
  };

  const handleToggleFavorite = async (kind: 'follow' | 'bookmark') => {
    if (!item) return;
    if (!platform.user) {
      openPlatformAuthModal('login');
      return;
    }
    try {
      const res = await togglePlatformModFavorite(item.id, kind);
      setItem((prev) =>
        prev
          ? {
              ...prev,
              follows: res.counts.follows,
              bookmarks: res.counts.bookmarks,
              viewerState: {
                following: kind === 'follow' ? res.active : Boolean(prev.viewerState?.following),
                bookmarked: kind === 'bookmark' ? res.active : Boolean(prev.viewerState?.bookmarked),
                viewerEmoteId: prev.viewerState?.viewerEmoteId ?? null,
                isOwner: Boolean(prev.viewerState?.isOwner),
              },
            }
          : prev,
      );
    } catch {
      // Ignore transient toggle error.
    }
  };

  const handleAvatarSelected = async (file: File | null) => {
    if (!item || !file) return;
    setAvatarBusy(true);
    setFeedback(null);
    try {
      const updated = await uploadWorkshopProjectIcon(item.id, file);
      applyUpdatedItem(updated, zh ? '模组头像已更新。' : 'Mod icon updated.');
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setAvatarBusy(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const handleResetAvatar = async () => {
    if (!item) return;
    setAvatarBusy(true);
    setFeedback(null);
    try {
      const updated = await deleteWorkshopProjectIcon(item.id);
      applyUpdatedItem(updated, zh ? '已恢复默认图标。' : 'Reverted to default icon.');
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleSaveInlineShowcase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    setInlineBusy(true);
    setFeedback(null);
    try {
      const updated = await updateWorkshopProject(item.id, {
        promoHeadline: promoHeadDraft.trim(),
        promoVideoUrl: promoVideoDraft.trim(),
        description: shortDescDraft.trim(),
        longDescription: longDescDraft.trim(),
      });
      applyUpdatedItem(updated, zh ? '宣传页与正文内容已保存。' : 'Showcase & description saved.');
      setInlineEditOpen(false);
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setInlineBusy(false);
    }
  };

  const handleSaveFullSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    setSettingsBusy(true);
    setFeedback(null);
    try {
      const updated = await updateWorkshopProject(item.id, {
        name: setName.trim(),
        ...(item.isSeed ? {} : { slug: setSlug.trim().toLowerCase(), visibility: setVisibility, externalUrl: setExternalUrl.trim() }),
        category: setCategory,
        gameVersion: setGameVersion.trim(),
        license: setLicense.trim(),
        platforms: setPlatforms,
        targetInfo: setTargetInfo.trim(),
        tags: setTags,
        description: setDesc.trim(),
        promoHeadline: setPromoHeadline.trim(),
        promoVideoUrl: setPromoVideo.trim(),
        longDescription: setLongDesc.trim(),
      });
      applyUpdatedItem(updated, zh ? '项目信息与内容已更新。' : 'Project settings & content saved.');
      if (!item.isSeed && updated.slug && updated.slug !== modId) {
        navigate(`/mod/${encodeURIComponent(updated.slug)}?tab=settings`, { replace: true });
      }
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSettingsBusy(false);
    }
  };

  const toggleSettingPlatform = (platId: string) => {
    setSetPlatforms((prev) => {
      if (prev.includes(platId)) {
        return prev.length > 1 ? prev.filter((p) => p !== platId) : prev;
      }
      return [...prev, platId];
    });
  };

  const handleUploadGallery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item || !galFile) return;
    setGalBusy(true);
    setFeedback(null);
    try {
      const updated = await uploadWorkshopGalleryImage(item.id, {
        file: galFile,
        caption: galCaption.trim(),
        featured: galFeatured,
      });
      applyUpdatedItem(updated, zh ? '宣传展示图已上传。' : 'Showcase image uploaded.');
      setGalFile(null);
      setGalCaption('');
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setGalBusy(false);
    }
  };

  const handleUpdateGalleryMeta = async (imageId: string, opts: { caption?: string; featured?: boolean }) => {
    if (!item) return;
    setGalBusy(true);
    setFeedback(null);
    try {
      const updated = await updateWorkshopGalleryImage(item.id, imageId, opts);
      applyUpdatedItem(updated, opts.featured ? (zh ? '已设为主宣传图。' : 'Set as featured cover.') : (zh ? '图片说明已保存。' : 'Caption saved.'));
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setGalBusy(false);
    }
  };

  const handleDeleteGallery = async (imageId: string) => {
    if (!item) return;
    setGalBusy(true);
    setFeedback(null);
    try {
      const updated = await deleteWorkshopGalleryImage(item.id, imageId);
      applyUpdatedItem(updated, zh ? '展示图已移除。' : 'Image deleted.');
      setLightboxIdx(null);
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setGalBusy(false);
    }
  };

  const handleAddChangelog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item || !logNotesInput.trim()) return;
    setLogBusy(true);
    setFeedback(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const nextLog: WorkshopChangelogEntry[] = [
        {
          version: logVerInput.trim() || item.version || '1.0.0',
          date: today,
          title: logTitleInput.trim() || `v${logVerInput.trim() || item.version || '1.0.0'} 更新说明`,
          notes: logNotesInput.trim(),
        },
        ...(item.changelog || []),
      ].slice(0, 30);
      const updated = await updateWorkshopProject(item.id, { changelog: nextLog });
      applyUpdatedItem(updated, zh ? '更新日志已添加。' : 'Changelog entry added.');
      setLogTitleInput('');
      setLogNotesInput('');
      setLogEditorOpen(false);
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLogBusy(false);
    }
  };

  const handleSaveEditedLog = async (idx: number) => {
    if (!item || !editingLogDraft) return;
    setLogBusy(true);
    setFeedback(null);
    try {
      const nextLog = (item.changelog || []).map((entry, i) => (i === idx ? editingLogDraft : entry));
      const updated = await updateWorkshopProject(item.id, { changelog: nextLog });
      applyUpdatedItem(updated, zh ? '更新日志条目已修改。' : 'Changelog updated.');
      setEditingLogIdx(null);
      setEditingLogDraft(null);
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLogBusy(false);
    }
  };

  const handleDeleteLog = async (idx: number) => {
    if (!item) return;
    const nextLog = (item.changelog || []).filter((_, i) => i !== idx);
    setLogBusy(true);
    setFeedback(null);
    try {
      const updated = await updateWorkshopProject(item.id, { changelog: nextLog });
      applyUpdatedItem(updated, zh ? '更新日志条目已移除。' : 'Changelog entry removed.');
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLogBusy(false);
    }
  };

  const handleOwnerUploadVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item || !verFile) return;
    setVerBusy(true);
    setVerErr('');
    try {
      const updated = await uploadWorkshopProjectVersion(item.id, {
        version: verInput.trim() || '1.0.1',
        title: verTitleInput.trim() || undefined,
        channel: verChannelInput,
        platforms: verPlatformsInput.trim() || undefined,
        notes: verNotes.trim() || `发布 v${verInput.trim() || '1.0.1'}`,
        gameVersion: verGameInput.trim() || item.gameVersion || '3.3.0',
        archiveFile: verFile,
      });
      applyUpdatedItem(
        updated,
        isAdmin
          ? (zh ? `已发布 v${updated.version} 新版本。` : `Published v${updated.version}.`)
          : (zh ? `新版本包体已上传并进入审核渠道，通过后将对外公开。` : `Version uploaded and queued for review.`),
      );
      setVerFile(null);
      setVerNotes('');
      setVerTitleInput('');
    } catch (err) {
      setVerErr(err instanceof Error ? err.message : String(err));
    } finally {
      setVerBusy(false);
    }
  };

  const handleDeleteProjectConfirm = async () => {
    if (!item || item.isSeed) return;
    setSettingsBusy(true);
    try {
      await deleteWorkshopProject(item.id);
      navigate('/account?tab=projects');
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
      setSettingsBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mr-detail-page">
        <div className="mr-empty">
          <Package size={28} />
          <h3>{zh ? '正在加载模组详情…' : 'Loading project…'}</h3>
        </div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="mr-detail-page">
        <div className="mr-empty">
          <Package size={28} />
          <h3>{error || (zh ? '未找到该模组项目' : 'Project not found')}</h3>
          <Link to="/extensions/mods" className="mr-btn-emerald">
            {zh ? '返回模组列表' : 'Back to Browse'}
          </Link>
        </div>
      </div>
    );
  }

  const isOfficial = item.id.startsWith('xingshu.launcher.');
  const visual = isOfficial ? getLauncherModuleMeta(item.id) : getCategoryVisualMeta(item.category);
  const Icon = visual.Icon;
  const previewSrc = item.previewUrl && !imgFailed ? workshopAssetUrl(item.previewUrl) : '';
  const isBookmarked = Boolean(item.viewerState?.bookmarked || platform.bookmarks.includes(item.id));
  const isOwner = Boolean(item.viewerState?.isOwner || (platform.user && item.ownerUserId === platform.user.id));
  const isAdmin = isPlatformAdmin(platform.user);
  const platformBadgeText = modPlatformSummaryBadge(item, zh);
  const cleanItemPlatforms = sanitizeWorkshopPlatforms(item.platforms);
  const cleanPlatformLabels = (item.platformLabels || [])
    .map((lbl) => lbl.replace(/\s*\/\s*iOS/gi, '').replace(/iOS\s*\/\s*/gi, '').trim())
    .filter((lbl) => lbl && !/ios/i.test(lbl));

  const handleAuthenticatedDownload = async (urlOrPath: string, fileName?: string) => {
    try {
      await downloadWorkshopArchiveAuthenticated(urlOrPath, fileName || item.packageFile || `${item.slug || item.id}.zip`);
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleQuickAdminReview = async (
    action: 'approve' | 'reject' | 'unpublish' | 'restore' | 'delete',
    versionId?: string,
  ) => {
    if (!item || !isAdmin) return;
    setReviewBusy(true);
    setFeedback(null);
    try {
      const res = await submitAdminReview({
        id: item.id,
        action,
        note: reviewNoteInput.trim(),
        versionId,
      });
      if (res.deleted) {
        navigate('/admin');
        return;
      }
      if (res.item) {
        applyUpdatedItem(res.item, zh ? '审核状态已更新。' : 'Review updated.');
      } else {
        await loadDetail();
      }
      setReviewNoteInput('');
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setReviewBusy(false);
    }
  };
  const versions = item.versions || [];
  const changelog = item.changelog || [];
  const versionPlatformOptions = Array.from(
    new Set(versions.map((ver) => formatVersionPlatformText(ver, zh).label)),
  );
  const versionGameOptions = Array.from(
    new Set(versions.map((ver) => (ver.gameVersion || item.gameVersion || '3.3.0').trim()).filter(Boolean)),
  );
  const filteredVersions = versions.filter((ver) => {
    const ch = normalizeVersionChannel(ver.channel);
    if (verChannelFilter !== 'all' && ch !== verChannelFilter) return false;
    const plat = formatVersionPlatformText(ver, zh).label;
    if (verPlatformFilter !== 'all' && plat !== verPlatformFilter) return false;
    const gv = (ver.gameVersion || item.gameVersion || '3.3.0').trim();
    if (verGameVerFilter !== 'all' && gv !== verGameVerFilter) return false;
    return true;
  });
  const activeSlide = gallery[Math.min(activeSlideIdx, Math.max(0, gallery.length - 1))] || null;
  const hasShowcase = Boolean(item.promoHeadline || item.promoVideoUrl || gallery.length > 0);
  const effectiveTab: DetailTab = !isOwner && tab === 'settings' ? 'description' : tab;
  const detailUrl =
    typeof window !== 'undefined' ? window.location.href : `https://astralparty-xingshu.lanxichaxu.cn/xingshu-hub/mod/${item.slug || item.id}`;

  return (
    <div className="mr-detail-page">
      <nav className="mr-detail-breadcrumb" aria-label={zh ? '面包屑导航' : 'Breadcrumb'}>
        <Link to="/dashboard">{zh ? '星枢工坊' : 'Workshop'}</Link>
        <ChevronRight size={14} />
        <Link to={`/extensions/mods?category=${encodeURIComponent(item.category)}`}>{item.categoryLabel}</Link>
        <ChevronRight size={14} />
        <span style={{ color: 'var(--mr-text)' }}>{item.name}</span>
      </nav>

      {feedback && (
        <div className={`mr-feedback-banner ${feedback.kind === 'err' ? 'is-err' : 'is-ok'}`}>
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Close">
            <X size={14} />
          </button>
        </div>
      )}

      <header className="mr-detail-header">
        <div className="mr-detail-identity">
          <div className="mr-detail-icon-wrap">
            <div
              className="mr-detail-icon"
              style={
                previewSrc
                  ? undefined
                  : { background: visual.accentBg, color: visual.accentFg, borderColor: visual.accentBorder }
              }
            >
              {previewSrc ? (
                <img src={previewSrc} alt={item.name} onError={() => setImgFailed(true)} />
              ) : (
                <Icon size={40} />
              )}
              {isOwner && (
                <>
                  <button
                    type="button"
                    className="mr-detail-icon-overlay"
                    disabled={avatarBusy}
                    onClick={() => avatarInputRef.current?.click()}
                    title={zh ? '上传自定义模组头像 (PNG/JPG/WebP <= 2MB)' : 'Upload custom mod icon'}
                  >
                    <Camera size={16} />
                    <span>{avatarBusy ? (zh ? '上传中' : 'Saving') : zh ? '更换头像' : 'Edit Icon'}</span>
                  </button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    onChange={(e) => void handleAvatarSelected(e.target.files?.[0] || null)}
                  />
                </>
              )}
            </div>
            {isOwner && previewSrc && (
              <button
                type="button"
                className="mr-icon-reset-btn"
                disabled={avatarBusy}
                onClick={() => void handleResetAvatar()}
                title={zh ? '恢复默认 SVG 图标' : 'Reset to default icon'}
              >
                <RotateCcw size={11} />
                <span>{zh ? '默认' : 'Reset'}</span>
              </button>
            )}
          </div>

          <div className="mr-detail-title">
            <h1>
              <span>{item.name}</span>
              <span className={`mr-kind-badge ${item.installKind === 'xspkg' ? 'is-xspkg' : ''}`}>
                {installKindLabel(item.installKind)}
              </span>
              {platformBadgeText && (
                <span className="mr-pill is-versions mr-tabular">{platformBadgeText}</span>
              )}
            </h1>
            <p className="mr-detail-summary">{item.description}</p>
            <div className="mr-detail-stats">
              <span>
                <Download size={14} />
                <strong>{item.downloads ?? 0}</strong> {zh ? '次下载' : 'downloads'}
              </span>
              <span>
                <SmilePlus size={14} />
                <strong>{item.reactionTotal ?? 0}</strong> {zh ? '个表情回应' : 'reactions'}
              </span>
              {gallery.length > 0 && (
                <span>
                  <Images size={14} />
                  <strong>{gallery.length}</strong> {zh ? '张展示图' : 'images'}
                </span>
              )}
              <span>
                <Package size={14} />
                {item.categoryLabel}
              </span>
            </div>

            <EmoteReactionBar
              modId={item.id}
              reactions={item.reactions}
              reactionTotal={item.reactionTotal}
              viewerEmoteId={item.viewerState?.viewerEmoteId}
              mode="detail"
              onUpdated={(next) =>
                setItem((prev) =>
                  prev
                    ? {
                        ...prev,
                        reactions: next.reactions,
                        reactionTotal: next.reactionTotal,
                        viewerState: {
                          following: Boolean(prev.viewerState?.following),
                          bookmarked: Boolean(prev.viewerState?.bookmarked),
                          viewerEmoteId: next.viewerEmoteId,
                          isOwner: Boolean(prev.viewerState?.isOwner),
                        },
                      }
                    : prev,
                )
              }
            />
          </div>
        </div>

        <div className="mr-detail-actions">
          {versions.length > 1 ? (
            <button
              type="button"
              className="mr-btn-emerald mr-btn-lg mr-dl-picker-btn"
              onClick={() => setDownloadPickerOpen(true)}
            >
              <Download size={16} />
              <span>{zh ? '下载' : 'Download'}</span>
              <span className="mr-dl-count-pill mr-tabular">{versions.length}</span>
              <ChevronDown size={15} />
            </button>
          ) : item.downloadable && item.downloadUrl ? (
            item.downloadUrl.startsWith('/api/') ? (
              item.status && item.status !== 'approved' ? (
                <button
                  type="button"
                  className="mr-btn-emerald mr-btn-lg"
                  onClick={() => void handleAuthenticatedDownload(item.downloadUrl!, item.packageFile || undefined)}
                >
                  <Download size={16} />
                  <span>{zh ? '审阅下载包体' : 'Download for Review'}</span>
                </button>
              ) : (
                <a
                  href={workshopAssetUrl(item.downloadUrl)}
                  download={item.packageFile || undefined}
                  className="mr-btn-emerald mr-btn-lg"
                >
                  <Download size={16} />
                  <span>{zh ? '下载' : 'Download'}</span>
                </a>
              )
            ) : (
              <a href={item.downloadUrl} target="_blank" rel="noreferrer" className="mr-btn-emerald mr-btn-lg">
                <ExternalLink size={16} />
                <span>{zh ? '前往下载' : 'Download'}</span>
              </a>
            )
          ) : (
            <button type="button" className="mr-btn-outline mr-btn-lg" onClick={() => setTab('versions')}>
              <Download size={16} />
              <span>{zh ? '查看版本' : 'View Versions'}</span>
            </button>
          )}

          <div className="mr-menu-wrap">
            <button
              type="button"
              className={`mr-icon-action-btn ${isBookmarked ? 'is-active' : ''}`}
              aria-label={zh ? '收藏 / 加入收藏夹' : 'Bookmark or add to collection'}
              title={zh ? '收藏与收藏夹' : 'Bookmark / Collections'}
              onClick={() => {
                if (!platform.user) {
                  openPlatformAuthModal('login');
                  return;
                }
                if (platform.collections.length === 0) {
                  void handleToggleFavorite('bookmark');
                } else {
                  setCollectionMenuOpen((v) => !v);
                }
              }}
            >
              <Bookmark size={18} fill={isBookmarked ? 'currentColor' : 'none'} />
            </button>

            {collectionMenuOpen && platform.user && (
              <div className="mr-dropdown">
                <button
                  type="button"
                  className="mr-dropdown-item"
                  onClick={() => {
                    setCollectionMenuOpen(false);
                    void handleToggleFavorite('bookmark');
                  }}
                >
                  <Bookmark size={14} />
                  <span>{isBookmarked ? (zh ? '取消快速收藏' : 'Remove bookmark') : zh ? '快速收藏' : 'Quick bookmark'}</span>
                </button>
                <div className="mr-dropdown-sep" />
                {platform.collections.map((col) => {
                  const inCol = col.modIds.includes(item.id);
                  return (
                    <button
                      key={col.id}
                      type="button"
                      className="mr-dropdown-item"
                      onClick={() => {
                        setCollectionMenuOpen(false);
                        void updatePlatformCollectionMod(col.id, item.id, inCol ? 'remove' : 'add');
                      }}
                    >
                      {inCol && <Check size={14} color="var(--mr-accent)" />}
                      <span>{col.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            className={`mr-icon-action-btn ${copiedKey === 'url' ? 'is-active' : ''}`}
            aria-label={zh ? '复制模组链接' : 'Copy project URL'}
            title={zh ? '复制链接' : 'Copy link'}
            onClick={() => void copyValue('url', detailUrl)}
          >
            {copiedKey === 'url' ? <Check size={17} /> : <Link2 size={17} />}
          </button>

          {isOwner && (
            <button
              type="button"
              className={`mr-btn-outline ${effectiveTab === 'settings' ? 'is-active-edit' : ''}`}
              onClick={() => setTab('settings')}
            >
              <Pencil size={14} />
              <span>{zh ? '修改项目' : 'Edit Project'}</span>
            </button>
          )}
        </div>
      </header>

      {(item.status && item.status !== 'approved') || (item.pendingVersionCount ?? 0) > 0 ? (
        <section className={`mr-review-banner is-${item.status || 'pending'}`}>
          <div className="mr-review-banner-copy">
            <strong>
              <ShieldCheck size={15} />
              <span>
                {item.status === 'pending'
                  ? zh ? '审核渠道：该项目当前处于待审核状态' : 'Moderation Queue: Pending Review'
                  : item.status === 'rejected'
                    ? zh ? '审核未通过：该项目已被驳回' : 'Submission Rejected'
                    : item.status === 'unpublished'
                      ? zh ? '已下架：该项目当前对外隐藏' : 'Unpublished'
                      : zh
                        ? `审核渠道：另有 ${item.pendingVersionCount} 个新上传版本等待审核`
                        : `${item.pendingVersionCount} pending version(s) awaiting review`}
              </span>
            </strong>
            <p>
              {item.status === 'pending'
                ? zh
                  ? '公开列表暂不展示此项目，仅提交者本人与官方管理员可见并可下载包体核验。'
                  : 'Hidden from public catalog until approved by an admin.'
                : item.reviewNote
                  ? `${zh ? '审核意见：' : 'Review note: '}${item.reviewNote}`
                  : zh
                    ? '已通过审核的版本可继续正常下载，待审核版本仅所有者与管理员可见。'
                    : 'Approved versions remain live while pending versions await admin approval.'}
            </p>
          </div>
          {isAdmin && (
            <div className="mr-review-banner-actions">
              <input
                type="text"
                className="mr-inline-input"
                value={reviewNoteInput}
                onChange={(e) => setReviewNoteInput(e.target.value)}
                placeholder={zh ? '可选审核备注 / 驳回原因' : 'Optional note'}
                style={{ minWidth: 180 }}
              />
              {item.status !== 'approved' && (
                <button
                  type="button"
                  className="mr-btn-emerald"
                  disabled={reviewBusy}
                  onClick={() => void handleQuickAdminReview(item.status === 'unpublished' ? 'restore' : 'approve')}
                >
                  {item.status === 'unpublished' ? (zh ? '恢复上架' : 'Restore') : zh ? '审核通过' : 'Approve'}
                </button>
              )}
              {item.status === 'pending' && (
                <button
                  type="button"
                  className="mr-btn-danger-sm"
                  disabled={reviewBusy}
                  onClick={() => void handleQuickAdminReview('reject')}
                >
                  {zh ? '驳回投稿' : 'Reject'}
                </button>
              )}
              {item.status === 'approved' && !item.isSeed && (
                <button
                  type="button"
                  className="mr-btn-outline"
                  disabled={reviewBusy}
                  onClick={() => void handleQuickAdminReview('unpublish')}
                >
                  {zh ? '下架' : 'Unpublish'}
                </button>
              )}
              <Link to="/admin?tab=queue" className="mr-btn-outline">
                {zh ? '管理员后台' : 'Admin Console'}
              </Link>
            </div>
          )}
        </section>
      ) : null}

      <div className="mr-detail-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={effectiveTab === 'description'}
          className={`mr-detail-tab ${effectiveTab === 'description' ? 'is-active' : ''}`}
          onClick={() => setTab('description')}
        >
          {zh ? '描述与宣传' : 'Description'}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={effectiveTab === 'gallery'}
          className={`mr-detail-tab ${effectiveTab === 'gallery' ? 'is-active' : ''}`}
          onClick={() => setTab('gallery')}
        >
          {zh ? `图库 (${gallery.length})` : `Gallery (${gallery.length})`}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={effectiveTab === 'changelog'}
          className={`mr-detail-tab ${effectiveTab === 'changelog' ? 'is-active' : ''}`}
          onClick={() => setTab('changelog')}
        >
          {zh ? '更新日志' : 'Changelog'}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={effectiveTab === 'versions'}
          className={`mr-detail-tab ${effectiveTab === 'versions' ? 'is-active' : ''}`}
          onClick={() => setTab('versions')}
        >
          {zh ? `版本 (${versions.length})` : `Versions (${versions.length})`}
        </button>
        {isOwner && (
          <button
            type="button"
            role="tab"
            aria-selected={effectiveTab === 'settings'}
            className={`mr-detail-tab ${effectiveTab === 'settings' ? 'is-active' : ''}`}
            onClick={() => setTab('settings')}
          >
            <Settings size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} />
            {zh ? '修改项目' : 'Project Settings'}
          </button>
        )}
      </div>

      <div className="mr-detail-grid">
        <div className="mr-detail-panel">
          {effectiveTab === 'description' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {isOwner && (
                <div className="mr-owner-toolbar">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--mr-text-secondary)' }}>
                    <Sparkles size={14} color="var(--mr-accent)" />
                    <span>{zh ? '所有者可自定义宣传标语、视频演示、展示图与项目正文' : 'Customize promotional showcase & page content'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="mr-btn-outline"
                      onClick={() => setInlineEditOpen((v) => !v)}
                    >
                      <Pencil size={13} />
                      <span>{inlineEditOpen ? (zh ? '收起快速编辑' : 'Close Editor') : zh ? '编辑宣传与正文' : 'Edit Showcase'}</span>
                    </button>
                    <button type="button" className="mr-btn-outline" onClick={() => setTab('gallery')}>
                      <Images size={13} />
                      <span>{zh ? '管理展示图' : 'Manage Gallery'}</span>
                    </button>
                  </div>
                </div>
              )}

              {isOwner && inlineEditOpen && (
                <form className="mr-editor-card" onSubmit={(e) => void handleSaveInlineShowcase(e)}>
                  <div className="mr-editor-head">
                    <strong>{zh ? '快速修改宣传页与简介内容' : 'Edit Promotional Showcase & Content'}</strong>
                    <div className="mr-md-tabs">
                      <button
                        type="button"
                        className={inlinePreviewMode === 'edit' ? 'is-active' : ''}
                        onClick={() => setInlinePreviewMode('edit')}
                      >
                        {zh ? '编辑' : 'Edit'}
                      </button>
                      <button
                        type="button"
                        className={inlinePreviewMode === 'preview' ? 'is-active' : ''}
                        onClick={() => setInlinePreviewMode('preview')}
                      >
                        {zh ? '预览效果' : 'Preview'}
                      </button>
                    </div>
                  </div>

                  {inlinePreviewMode === 'edit' ? (
                    <>
                      <div className="mr-editor-grid">
                        <div className="mr-editor-field">
                          <label htmlFor="mr-promo-head">{zh ? '宣传横幅标语 (可选)' : 'Promotional Headline'}</label>
                          <input
                            id="mr-promo-head"
                            type="text"
                            maxLength={90}
                            value={promoHeadDraft}
                            onChange={(e) => setPromoHeadDraft(e.target.value)}
                            placeholder={zh ? '例如：实时看清队友手牌，合作局沟通零延迟' : 'Highlight tagline shown above description'}
                          />
                        </div>
                        <div className="mr-editor-field">
                          <label htmlFor="mr-promo-vid">{zh ? '演示视频链接 (B站 BV号 / YouTube)' : 'Showcase Video URL'}</label>
                          <input
                            id="mr-promo-vid"
                            type="text"
                            maxLength={300}
                            value={promoVideoDraft}
                            onChange={(e) => setPromoVideoDraft(e.target.value)}
                            placeholder="https://www.bilibili.com/video/BV..."
                          />
                        </div>
                      </div>
                      <div className="mr-editor-field">
                        <label htmlFor="mr-short-desc">{zh ? '一句话摘要介绍 *' : 'Short Summary *'}</label>
                        <input
                          id="mr-short-desc"
                          type="text"
                          required
                          minLength={4}
                          maxLength={240}
                          value={shortDescDraft}
                          onChange={(e) => setShortDescDraft(e.target.value)}
                        />
                      </div>
                      <div className="mr-editor-field">
                        <label htmlFor="mr-long-desc">{zh ? '详细宣传正文 (支持 Markdown：### 标题 / **粗体** / 列表)' : 'Markdown Body'}</label>
                        <textarea
                          id="mr-long-desc"
                          rows={9}
                          value={longDescDraft}
                          onChange={(e) => setLongDescDraft(e.target.value)}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="mr-editor-preview">
                      {promoHeadDraft && (
                        <div className="mr-showcase-headline">
                          <Sparkles size={15} />
                          <span>{promoHeadDraft}</span>
                        </div>
                      )}
                      {renderProseBlocks(longDescDraft || shortDescDraft)}
                    </div>
                  )}

                  <div className="mr-editor-actions">
                    <button type="button" className="mr-btn-outline" onClick={() => setInlineEditOpen(false)}>
                      {zh ? '取消' : 'Cancel'}
                    </button>
                    <button type="submit" className="mr-btn-emerald" disabled={inlineBusy}>
                      <Save size={14} />
                      <span>{inlineBusy ? (zh ? '保存中…' : 'Saving…') : zh ? '保存宣传页内容' : 'Save Changes'}</span>
                    </button>
                  </div>
                </form>
              )}

              {hasShowcase && (
                <section className="mr-showcase-stage" aria-label={zh ? '模组展示效果宣传区' : 'Mod Showcase'}>
                  {item.promoHeadline && (
                    <div className="mr-showcase-headline">
                      <Sparkles size={16} />
                      <span>{item.promoHeadline}</span>
                    </div>
                  )}

                  {item.promoVideoUrl && (
                    <div className="mr-showcase-video">
                      <iframe
                        src={item.promoVideoUrl}
                        title={`${item.name} 演示视频`}
                        loading="lazy"
                        allowFullScreen
                        referrerPolicy="no-referrer"
                        sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
                      />
                    </div>
                  )}

                  {activeSlide && (
                    <div className="mr-showcase-carousel">
                      <div className="mr-showcase-hero-frame">
                        <img
                          src={workshopAssetUrl(activeSlide.url)}
                          alt={activeSlide.caption || item.name}
                          onClick={() => setLightboxIdx(activeSlideIdx)}
                        />
                        <button
                          type="button"
                          className="mr-showcase-zoom-btn"
                          onClick={() => setLightboxIdx(activeSlideIdx)}
                          aria-label={zh ? '大图预览' : 'Open Lightbox'}
                        >
                          <Maximize2 size={14} />
                          <span>{zh ? '全屏查看' : 'Zoom'}</span>
                        </button>
                        {gallery.length > 1 && (
                          <>
                            <button
                              type="button"
                              className="mr-showcase-nav is-prev"
                              onClick={() => setActiveSlideIdx((prev) => (prev - 1 + gallery.length) % gallery.length)}
                              aria-label={zh ? '上一张' : 'Previous'}
                            >
                              <ChevronLeft size={18} />
                            </button>
                            <button
                              type="button"
                              className="mr-showcase-nav is-next"
                              onClick={() => setActiveSlideIdx((prev) => (prev + 1) % gallery.length)}
                              aria-label={zh ? '下一张' : 'Next'}
                            >
                              <ChevronRight size={18} />
                            </button>
                          </>
                        )}
                        {(activeSlide.caption || activeSlide.featured) && (
                          <div className="mr-showcase-caption">
                            {activeSlide.featured && <span className="mr-pill is-accent-chip">{zh ? '主宣传图' : 'Featured'}</span>}
                            <span>{activeSlide.caption || item.name}</span>
                          </div>
                        )}
                      </div>

                      {gallery.length > 1 && (
                        <div className="mr-showcase-thumbs">
                          {gallery.map((g, idx) => (
                            <button
                              key={g.id}
                              type="button"
                              className={`mr-showcase-thumb ${idx === activeSlideIdx ? 'is-active' : ''}`}
                              onClick={() => setActiveSlideIdx(idx)}
                            >
                              <img src={workshopAssetUrl(g.url)} alt={g.caption || ''} />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}

              {renderProseBlocks(item.longDescription || item.description)}
            </div>
          )}

          {effectiveTab === 'gallery' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {isOwner && (
                <form className="mr-editor-card" onSubmit={(e) => void handleUploadGallery(e)}>
                  <div className="mr-editor-head">
                    <strong>
                      <Images size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                      {zh ? '上传效果展示图 / 宣传截图 (最多 12 张，单张 <= 4MB)' : 'Upload Showcase Screenshot'}
                    </strong>
                  </div>
                  <div className="mr-editor-grid">
                    <div className="mr-editor-field">
                      <label htmlFor="mr-gal-file">{zh ? '选择图片文件 (PNG / JPG / WebP) *' : 'Image File *'}</label>
                      <input
                        id="mr-gal-file"
                        type="file"
                        required
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => setGalFile(e.target.files?.[0] || null)}
                      />
                    </div>
                    <div className="mr-editor-field">
                      <label htmlFor="mr-gal-cap">{zh ? '图片说明文字 (可选)' : 'Caption (optional)'}</label>
                      <input
                        id="mr-gal-cap"
                        type="text"
                        maxLength={80}
                        value={galCaption}
                        onChange={(e) => setGalCaption(e.target.value)}
                        placeholder={zh ? '例如：局内手牌悬浮窗实拍效果' : 'In-game screenshot caption'}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={galFeatured}
                        onChange={(e) => setGalFeatured(e.target.checked)}
                      />
                      <span>{zh ? '设为模组详情页主宣传封面图' : 'Set as featured showcase image'}</span>
                    </label>
                    <button type="submit" className="mr-btn-emerald" disabled={galBusy || !galFile}>
                      <Upload size={14} />
                      <span>{galBusy ? (zh ? '上传中…' : 'Uploading…') : zh ? '上传展示图' : 'Upload Image'}</span>
                    </button>
                  </div>
                </form>
              )}

              {gallery.length === 0 ? (
                <div className="mr-empty" style={{ borderStyle: 'dashed', padding: '42px 20px' }}>
                  <Images size={28} />
                  <h3>{zh ? '暂无展示效果图片' : 'No gallery screenshots yet'}</h3>
                  <p>
                    {isOwner
                      ? zh
                        ? '上方上传 PNG/JPG/WebP 实机截图后，将在「描述与宣传」页顶部渲染交互轮播图集。'
                        : 'Upload screenshots above to display a showcase carousel.'
                      : zh
                        ? '作者暂未上传展示截图，可在更新后回来查看。'
                        : 'The creator has not uploaded screenshots yet.'}
                  </p>
                </div>
              ) : (
                <div className="mr-gallery-grid">
                  {gallery.map((g, idx) => (
                    <div key={g.id} className="mr-gallery-card">
                      <div className="mr-gallery-thumb" onClick={() => setLightboxIdx(idx)}>
                        <img src={workshopAssetUrl(g.url)} alt={g.caption || item.name} />
                        {g.featured && (
                          <span className="mr-gallery-featured-badge">
                            <Star size={11} />
                            <span>{zh ? '主宣传图' : 'Featured'}</span>
                          </span>
                        )}
                      </div>
                      <div className="mr-gallery-body">
                        {isOwner ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <input
                                type="text"
                                maxLength={80}
                                value={captionDrafts[g.id] ?? ''}
                                onChange={(e) => setCaptionDrafts((prev) => ({ ...prev, [g.id]: e.target.value }))}
                                placeholder={zh ? '补充图片说明…' : 'Caption…'}
                                className="mr-inline-input"
                              />
                              <button
                                type="button"
                                className="mr-btn-outline"
                                disabled={galBusy}
                                onClick={() => void handleUpdateGalleryMeta(g.id, { caption: captionDrafts[g.id] ?? '' })}
                              >
                                {zh ? '保存' : 'Save'}
                              </button>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                              {!g.featured ? (
                                <button
                                  type="button"
                                  className="mr-btn-outline"
                                  disabled={galBusy}
                                  onClick={() => void handleUpdateGalleryMeta(g.id, { featured: true })}
                                >
                                  <Star size={12} />
                                  <span>{zh ? '设为主图' : 'Feature'}</span>
                                </button>
                              ) : (
                                <span style={{ fontSize: 12, color: 'var(--mr-accent)', fontWeight: 600 }}>
                                  {zh ? '当前主宣传封面' : 'Current Cover'}
                                </span>
                              )}
                              <button
                                type="button"
                                className="mr-btn-danger-sm"
                                disabled={galBusy}
                                onClick={() => void handleDeleteGallery(g.id)}
                              >
                                <Trash2 size={12} />
                                <span>{zh ? '删除' : 'Delete'}</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p style={{ margin: 0, fontSize: 13, color: 'var(--mr-text-secondary)' }}>
                            {g.caption || (zh ? `展示截图 #${idx + 1}` : `Screenshot #${idx + 1}`)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {effectiveTab === 'changelog' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {isOwner && (
                <div className="mr-owner-toolbar">
                  <span style={{ fontSize: 13, color: 'var(--mr-text-secondary)' }}>
                    {zh ? '可新增、修改或删除历史版本更新日志说明' : 'Manage changelog entries'}
                  </span>
                  <button type="button" className="mr-btn-outline" onClick={() => setLogEditorOpen((v) => !v)}>
                    <Plus size={14} />
                    <span>{logEditorOpen ? (zh ? '收起表单' : 'Close') : zh ? '新增更新日志' : 'Add Changelog'}</span>
                  </button>
                </div>
              )}

              {isOwner && logEditorOpen && (
                <form className="mr-editor-card" onSubmit={(e) => void handleAddChangelog(e)}>
                  <div className="mr-editor-grid">
                    <div className="mr-editor-field">
                      <label htmlFor="mr-log-ver">{zh ? '版本号 *' : 'Version *'}</label>
                      <input
                        id="mr-log-ver"
                        type="text"
                        required
                        value={logVerInput}
                        onChange={(e) => setLogVerInput(e.target.value)}
                      />
                    </div>
                    <div className="mr-editor-field">
                      <label htmlFor="mr-log-title">{zh ? '更新标题 *' : 'Title *'}</label>
                      <input
                        id="mr-log-title"
                        type="text"
                        required
                        maxLength={80}
                        value={logTitleInput}
                        onChange={(e) => setLogTitleInput(e.target.value)}
                        placeholder={zh ? '例如：新增 3.3.0 适配与界面微调' : 'Release highlights'}
                      />
                    </div>
                  </div>
                  <div className="mr-editor-field">
                    <label htmlFor="mr-log-notes">{zh ? '变更内容详情 *' : 'Notes *'}</label>
                    <textarea
                      id="mr-log-notes"
                      rows={3}
                      required
                      maxLength={600}
                      value={logNotesInput}
                      onChange={(e) => setLogNotesInput(e.target.value)}
                    />
                  </div>
                  <div className="mr-editor-actions">
                    <button type="submit" className="mr-btn-emerald" disabled={logBusy}>
                      <Save size={14} />
                      <span>{logBusy ? (zh ? '提交中…' : 'Saving…') : zh ? '添加日志条目' : 'Add Entry'}</span>
                    </button>
                  </div>
                </form>
              )}

              {changelog.map((entry, idx) => (
                <div key={idx} className="mr-version-row">
                  {isOwner && editingLogIdx === idx && editingLogDraft ? (
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div className="mr-editor-grid">
                        <input
                          type="text"
                          value={editingLogDraft.version}
                          onChange={(e) => setEditingLogDraft({ ...editingLogDraft, version: e.target.value })}
                          className="mr-inline-input"
                          placeholder="Version"
                        />
                        <input
                          type="text"
                          value={editingLogDraft.title}
                          onChange={(e) => setEditingLogDraft({ ...editingLogDraft, title: e.target.value })}
                          className="mr-inline-input"
                          placeholder="Title"
                        />
                      </div>
                      <textarea
                        rows={3}
                        value={editingLogDraft.notes}
                        onChange={(e) => setEditingLogDraft({ ...editingLogDraft, notes: e.target.value })}
                        className="mr-inline-textarea"
                      />
                      <div className="mr-editor-actions">
                        <button
                          type="button"
                          className="mr-btn-outline"
                          onClick={() => {
                            setEditingLogIdx(null);
                            setEditingLogDraft(null);
                          }}
                        >
                          {zh ? '取消' : 'Cancel'}
                        </button>
                        <button
                          type="button"
                          className="mr-btn-emerald"
                          disabled={logBusy}
                          onClick={() => void handleSaveEditedLog(idx)}
                        >
                          <Save size={13} />
                          <span>{zh ? '保存此条' : 'Save'}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
                          <span className="mr-kind-badge is-xspkg">v{entry.version}</span>
                          <strong>{entry.title}</strong>
                          <span style={{ fontSize: 12, color: 'var(--mr-text-muted)' }}>{entry.date}</span>
                        </div>
                        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--mr-text-secondary)', lineHeight: 1.6 }}>
                          {entry.notes}
                        </p>
                      </div>
                      {isOwner && (
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button
                            type="button"
                            className="mr-btn-outline"
                            onClick={() => {
                              setEditingLogIdx(idx);
                              setEditingLogDraft({ ...entry });
                            }}
                          >
                            <Pencil size={12} />
                            <span>{zh ? '编辑' : 'Edit'}</span>
                          </button>
                          <button
                            type="button"
                            className="mr-btn-danger-sm"
                            disabled={logBusy}
                            onClick={() => void handleDeleteLog(idx)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {effectiveTab === 'versions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {isOwner && (
                <form
                  onSubmit={(e) => void handleOwnerUploadVersion(e)}
                  style={{
                    padding: 16,
                    borderRadius: 12,
                    border: '1px dashed var(--mr-accent)',
                    background: 'var(--mr-accent-soft)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <strong style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14 }}>
                    <Upload size={15} />
                    <span>{zh ? '所有者面板：上传新版本 (.xspkg / .zip)' : 'Owner: Upload New Version'}</span>
                  </strong>
                  {verErr && <p style={{ margin: 0, color: '#f87171', fontSize: 12.5 }}>{verErr}</p>}
                  <div className="mr-owner-ver-grid">
                    <input
                      type="text"
                      required
                      value={verInput}
                      onChange={(e) => setVerInput(e.target.value)}
                      placeholder="1.0.1"
                      className="mr-inline-input"
                      title={zh ? '模组版本号' : 'Mod Version'}
                    />
                    <input
                      type="text"
                      required
                      value={verGameInput}
                      onChange={(e) => setVerGameInput(e.target.value)}
                      placeholder="3.3.0"
                      className="mr-inline-input"
                      title={zh ? '适配游戏版本' : 'Game Version'}
                    />
                    <select
                      value={verChannelInput}
                      onChange={(e) => setVerChannelInput(e.target.value as 'release' | 'beta' | 'optional')}
                      className="mr-ver-select"
                      title={zh ? '版本频道' : 'Release Channel'}
                    >
                      <option value="release">{zh ? 'R · 正式推荐' : 'R · Release'}</option>
                      <option value="beta">{zh ? 'B · 测试版' : 'B · Beta'}</option>
                      <option value="optional">{zh ? 'O · 备选方案' : 'O · Optional'}</option>
                    </select>
                    <label className="mr-owner-file-picker" title={verFile?.name || (zh ? '选择 .xspkg / .zip 文件' : 'Choose archive')}>
                      <Upload size={14} />
                      <span>{verFile ? verFile.name : zh ? '选择 .xspkg / .zip 文件' : 'Choose .xspkg / .zip file'}</span>
                      <input
                        type="file"
                        required
                        accept=".xspkg,.zip,.apmm"
                        onChange={(e) => setVerFile(e.target.files?.[0] || null)}
                      />
                    </label>
                    <button type="submit" className="mr-btn-emerald" disabled={verBusy || !verFile}>
                      {verBusy ? (zh ? '上传中…' : 'Uploading…') : zh ? '发布此版本' : 'Publish'}
                    </button>
                  </div>
                  <div className="mr-owner-ver-meta">
                    <input
                      type="text"
                      value={verTitleInput}
                      onChange={(e) => setVerTitleInput(e.target.value)}
                      placeholder={zh ? '版本展示标题（可选，如：PC 端整合包 / 手机端 PE）' : 'Display title (optional)'}
                      className="mr-inline-input"
                    />
                    <select
                      value={verPlatformsInput}
                      onChange={(e) => setVerPlatformsInput(e.target.value)}
                      className="mr-ver-select"
                      title={zh ? '适用端预设' : 'Platform Preset'}
                    >
                      {WORKSHOP_UPLOAD_CHANNEL_PRESETS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {zh ? opt.labelZh : opt.labelEn}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="text"
                    value={verNotes}
                    onChange={(e) => setVerNotes(e.target.value)}
                    placeholder={zh ? '版本更新说明（例如：新增 PC/PE 双端卡面替换）' : 'Release notes'}
                    className="mr-inline-input"
                  />
                </form>
              )}

              {versions.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--mr-text-muted)' }}>
                  {zh ? '该条目暂无网页端可下载包，请在星枢桌面端 ModLibrary 中查看。' : 'No downloadable files attached yet.'}
                </p>
              ) : (
                <div className="mr-ver-shell">
                  <div className="mr-ver-toolbar">
                    <div className="mr-ver-filters">
                      <span className="mr-ver-filter-icon" aria-hidden="true">
                        <Filter size={15} />
                      </span>
                      <select
                        className="mr-ver-select"
                        aria-label={zh ? '按版本频道筛选' : 'Filter by channel'}
                        value={verChannelFilter}
                        onChange={(e) =>
                          setVerChannelFilter(e.target.value as 'all' | 'release' | 'beta' | 'optional')
                        }
                      >
                        <option value="all">{zh ? '版本频道：全部' : 'Channel: All'}</option>
                        <option value="release">{zh ? 'R · 正式推荐' : 'R · Release'}</option>
                        <option value="beta">{zh ? 'B · 测试版' : 'B · Beta'}</option>
                        <option value="optional">{zh ? 'O · 备选方案' : 'O · Optional'}</option>
                      </select>
                      <select
                        className="mr-ver-select"
                        aria-label={zh ? '按平台筛选' : 'Filter by platform'}
                        value={verPlatformFilter}
                        onChange={(e) => setVerPlatformFilter(e.target.value)}
                      >
                        <option value="all">{zh ? '平台 / 方案：全部' : 'Platform: All'}</option>
                        {versionPlatformOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                      <select
                        className="mr-ver-select"
                        aria-label={zh ? '按游戏版本筛选' : 'Filter by game version'}
                        value={verGameVerFilter}
                        onChange={(e) => setVerGameVerFilter(e.target.value)}
                      >
                        <option value="all">{zh ? '游戏版本：全部' : 'Game Version: All'}</option>
                        {versionGameOptions.map((gv) => (
                          <option key={gv} value={gv}>
                            {gv}
                          </option>
                        ))}
                      </select>
                      {(verChannelFilter !== 'all' ||
                        verPlatformFilter !== 'all' ||
                        verGameVerFilter !== 'all') && (
                        <button
                          type="button"
                          className="mr-ver-reset-btn"
                          onClick={() => {
                            setVerChannelFilter('all');
                            setVerPlatformFilter('all');
                            setVerGameVerFilter('all');
                          }}
                        >
                          <RotateCcw size={13} />
                          <span>{zh ? '重置' : 'Reset'}</span>
                        </button>
                      )}
                    </div>
                    <span className="mr-ver-count mr-tabular">
                      {zh
                        ? `共 ${filteredVersions.length} / ${versions.length} 个版本`
                        : `${filteredVersions.length} / ${versions.length} versions`}
                    </span>
                  </div>

                  {filteredVersions.length === 0 ? (
                    <div className="mr-ver-empty">
                      <p>{zh ? '没有符合当前筛选条件的版本。' : 'No versions match the selected filters.'}</p>
                    </div>
                  ) : (
                    <div className="mr-ver-table-wrap">
                      <table className="mr-ver-table" aria-label={zh ? '模组版本列表' : 'Versions'}>
                        <colgroup>
                          <col className="mr-ver-col-ch" />
                          <col className="mr-ver-col-ver" />
                          <col className="mr-ver-col-game" />
                          <col className="mr-ver-col-plat" />
                          <col className="mr-ver-col-date" />
                          <col className="mr-ver-col-dl" />
                          <col className="mr-ver-col-act" />
                        </colgroup>
                        <thead>
                          <tr>
                            <th className="mr-ver-th-ch" aria-label={zh ? '频道' : 'Channel'} />
                            <th>{zh ? '版本' : 'Version'}</th>
                            <th>{zh ? '游戏版本' : 'Game version'}</th>
                            <th>{zh ? '平台 / 方案' : 'Platform'}</th>
                            <th>{zh ? '发布时间' : 'Published'}</th>
                            <th>{zh ? '下载量' : 'Downloads'}</th>
                            <th className="mr-ver-th-act" aria-label={zh ? '操作' : 'Actions'} />
                          </tr>
                        </thead>
                        <tbody>
                          {filteredVersions.map((ver, idx) => {
                            const chKey = normalizeVersionChannel(ver.channel);
                            const chMeta = versionChannelMeta(chKey, zh);
                            const platInfo = formatVersionPlatformText(ver, zh);
                            const verKey = ver.id || `${ver.version}-${idx}`;
                            const verDownloads = ver.downloads ?? 0;
                            const isExpanded = expandedVerKey === verKey;
                            const isMenuOpen = openVerMenuKey === verKey;
                            const hasDetails = Boolean(ver.notes || ver.sha256 || ver.fileName);
                            const resolvedUrl = ver.downloadUrl
                              ? ver.downloadUrl.startsWith('/api/')
                                ? workshopAssetUrl(ver.downloadUrl)
                                : ver.downloadUrl
                              : '';
                            const fullDownloadLink =
                              typeof window !== 'undefined' && resolvedUrl.startsWith('/')
                                ? `${window.location.origin}${resolvedUrl}`
                                : resolvedUrl;

                            return (
                              <React.Fragment key={verKey}>
                                <tr
                                  className={`mr-ver-table-row ${isExpanded ? 'is-expanded' : ''}`}
                                  onClick={(e) => {
                                    const target = e.target as HTMLElement | null;
                                    if (target?.closest('a, button, .mr-ver-menu-wrap')) return;
                                    if (!hasDetails) return;
                                    setExpandedVerKey((prev) => (prev === verKey ? null : verKey));
                                  }}
                                >
                                  <td className="mr-ver-td-ch">
                                    <span
                                      className={`mr-ver-channel-dot ${chMeta.cls}`}
                                      title={chMeta.label}
                                      aria-label={chMeta.label}
                                    >
                                      {chMeta.letter}
                                    </span>
                                  </td>

                                  <td className="mr-ver-td-main">
                                    <div className="mr-ver-title-line">
                                      <strong title={ver.title || ver.fileName || `v${ver.version}`}>
                                        {ver.title || ver.fileName || `v${ver.version}`}
                                      </strong>
                                      {ver.reviewStatus && ver.reviewStatus !== 'approved' && (
                                        <span className="mr-pill is-warn" style={{ marginLeft: 8, padding: '1px 7px', fontSize: 11 }}>
                                          {ver.reviewStatus === 'pending'
                                            ? zh ? '待审核' : 'Pending'
                                            : ver.reviewStatus === 'rejected'
                                              ? zh ? '已驳回' : 'Rejected'
                                              : ver.reviewStatus}
                                        </span>
                                      )}
                                      {isAdmin && ver.reviewStatus === 'pending' && ver.id && (
                                        <span style={{ display: 'inline-flex', gap: 4, marginLeft: 8 }}>
                                          <button
                                            type="button"
                                            className="mr-btn-emerald"
                                            style={{ padding: '2px 8px', fontSize: 11, minHeight: 0 }}
                                            disabled={reviewBusy}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              void handleQuickAdminReview('approve', ver.id);
                                            }}
                                          >
                                            {zh ? '通过' : 'Approve'}
                                          </button>
                                          <button
                                            type="button"
                                            className="mr-btn-danger-sm"
                                            style={{ padding: '2px 8px', fontSize: 11 }}
                                            disabled={reviewBusy}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              void handleQuickAdminReview('reject', ver.id);
                                            }}
                                          >
                                            {zh ? '驳回' : 'Reject'}
                                          </button>
                                        </span>
                                      )}
                                    </div>
                                    <div className="mr-ver-sub-line mr-tabular">
                                      <span className="mr-ver-tag">v{ver.version}</span>
                                      {ver.sizeBytes > 0 && <span>{formatModBytes(ver.sizeBytes)}</span>}
                                      {hasDetails && (
                                        <span className="mr-ver-extra-hint">
                                          <Info size={11} />
                                          <span>{isExpanded ? (zh ? '收起说明' : 'Hide info') : (zh ? '说明与校验' : 'Details')}</span>
                                        </span>
                                      )}
                                    </div>
                                  </td>

                                  <td className="mr-ver-td-game">
                                    <span className="mr-pill mr-tabular">
                                      {ver.gameVersion || item.gameVersion || '3.3.0'}
                                    </span>
                                  </td>

                                  <td className="mr-ver-td-plat">
                                    <span className={`mr-ver-plat-badge ${platInfo.isMobile ? 'is-mobile' : 'is-pc'}`}>
                                      {platInfo.isMobile ? <Smartphone size={12} /> : <Monitor size={12} />}
                                      <span>{platInfo.label}</span>
                                    </span>
                                  </td>

                                  <td className="mr-ver-td-date mr-tabular">
                                    {formatVersionDate(ver.publishedAt, zh)}
                                  </td>

                                  <td className="mr-ver-td-dl mr-tabular">
                                    {verDownloads.toLocaleString()}
                                  </td>

                                  <td className="mr-ver-td-act">
                                    <div className="mr-ver-actions">
                                      {ver.downloadUrl ? (
                                        ver.downloadUrl.startsWith('/api/') ? (
                                          (item.status && item.status !== 'approved') || (ver.reviewStatus && ver.reviewStatus !== 'approved') ? (
                                            <button
                                              type="button"
                                              className="mr-ver-icon-btn is-dl"
                                              title={zh ? `下载审核包体 ${ver.fileName}` : `Download ${ver.fileName}`}
                                              aria-label={zh ? `下载 ${ver.fileName}` : `Download ${ver.fileName}`}
                                              onClick={() => void handleAuthenticatedDownload(ver.downloadUrl!, ver.fileName)}
                                            >
                                              <Download size={16} />
                                            </button>
                                          ) : (
                                            <a
                                              href={resolvedUrl}
                                              download={ver.fileName}
                                              className="mr-ver-icon-btn is-dl"
                                              title={zh ? `下载 ${ver.fileName}` : `Download ${ver.fileName}`}
                                              aria-label={zh ? `下载 ${ver.fileName}` : `Download ${ver.fileName}`}
                                            >
                                              <Download size={16} />
                                            </a>
                                          )
                                        ) : (
                                          <a
                                            href={resolvedUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="mr-ver-icon-btn is-dl"
                                            title={zh ? '前往外部链接下载' : 'Open external link'}
                                            aria-label={zh ? '前往外部链接下载' : 'Open external link'}
                                          >
                                            <ExternalLink size={15} />
                                          </a>
                                        )
                                      ) : null}

                                      <div className="mr-ver-menu-wrap">
                                        <button
                                          type="button"
                                          className={`mr-ver-icon-btn is-more ${isMenuOpen ? 'is-open' : ''}`}
                                          aria-haspopup="menu"
                                          aria-expanded={isMenuOpen}
                                          aria-label={zh ? '更多版本操作' : 'More version actions'}
                                          onClick={() => setOpenVerMenuKey((prev) => (prev === verKey ? null : verKey))}
                                        >
                                          <MoreVertical size={16} />
                                        </button>

                                        {isMenuOpen && (
                                          <div className="mr-ver-menu" role="menu">
                                            {ver.downloadUrl && (
                                              ver.downloadUrl.startsWith('/api/') ? (
                                                <a
                                                  href={resolvedUrl}
                                                  download={ver.fileName}
                                                  className="mr-ver-menu-item is-primary"
                                                  role="menuitem"
                                                  onClick={() => setOpenVerMenuKey(null)}
                                                >
                                                  <Download size={14} />
                                                  <span>{zh ? '下载此版本' : 'Download'}</span>
                                                </a>
                                              ) : (
                                                <a
                                                  href={resolvedUrl}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  className="mr-ver-menu-item"
                                                  role="menuitem"
                                                  onClick={() => setOpenVerMenuKey(null)}
                                                >
                                                  <ExternalLink size={14} />
                                                  <span>{zh ? '在新标签页打开' : 'Open in new tab'}</span>
                                                </a>
                                              )
                                            )}

                                            {hasDetails && (
                                              <button
                                                type="button"
                                                className="mr-ver-menu-item"
                                                role="menuitem"
                                                onClick={() => {
                                                  setExpandedVerKey((prev) => (prev === verKey ? null : verKey));
                                                  setOpenVerMenuKey(null);
                                                }}
                                              >
                                                <Info size={14} />
                                                <span>
                                                  {isExpanded
                                                    ? (zh ? '收起额外信息' : 'Hide extra info')
                                                    : (zh ? '查看额外信息' : 'View details & hash')}
                                                </span>
                                              </button>
                                            )}

                                            {ver.sha256 && (
                                              <button
                                                type="button"
                                                className="mr-ver-menu-item"
                                                role="menuitem"
                                                onClick={() => {
                                                  void copyValue(`sha-${verKey}`, ver.sha256);
                                                  setOpenVerMenuKey(null);
                                                }}
                                              >
                                                <Copy size={14} />
                                                <span>{zh ? '复制 SHA-256 校验码' : 'Copy SHA-256'}</span>
                                              </button>
                                            )}

                                            {fullDownloadLink && (
                                              <button
                                                type="button"
                                                className="mr-ver-menu-item"
                                                role="menuitem"
                                                onClick={() => {
                                                  void copyValue(`url-${verKey}`, fullDownloadLink);
                                                  setOpenVerMenuKey(null);
                                                }}
                                              >
                                                <Link2 size={14} />
                                                <span>{zh ? '复制下载链接' : 'Copy download link'}</span>
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                </tr>

                                {isExpanded && hasDetails && (
                                  <tr className="mr-ver-extra-row">
                                    <td className="mr-ver-extra-spacer" />
                                    <td colSpan={6} className="mr-ver-extra-cell">
                                      <div className="mr-ver-extra-grid">
                                        {ver.fileName && (
                                          <div className="mr-ver-extra-item">
                                            <small>{zh ? '压缩包文件名' : 'File'}</small>
                                            <code>{ver.fileName}</code>
                                          </div>
                                        )}
                                        <div className="mr-ver-extra-item">
                                          <small>{zh ? '版本频道 / 体积' : 'Channel / Size'}</small>
                                          <span className="mr-tabular">
                                            {chMeta.label} · {formatModBytes(ver.sizeBytes)}
                                          </span>
                                        </div>
                                        {ver.sha256 && (
                                          <div className="mr-ver-extra-item">
                                            <small>SHA-256</small>
                                            <div className="mr-ver-extra-sha">
                                              <code title={ver.sha256}>{ver.sha256}</code>
                                              <button
                                                type="button"
                                                className="mr-ver-sha-btn"
                                                onClick={() => void copyValue(`sha-${verKey}`, ver.sha256)}
                                              >
                                                {copiedKey === `sha-${verKey}` ? <Check size={11} /> : <Copy size={11} />}
                                                <span>{copiedKey === `sha-${verKey}` ? (zh ? '已复制' : 'Copied') : (zh ? '复制' : 'Copy')}</span>
                                              </button>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                      {ver.notes && (
                                        <p className="mr-ver-extra-notes">{ver.notes}</p>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {effectiveTab === 'settings' && isOwner && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* 1. Avatar settings */}
              <section className="mr-editor-card">
                <div className="mr-editor-head">
                  <strong>
                    <Camera size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                    {zh ? '模组头像设置' : 'Mod Avatar'}
                  </strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div
                    className="mr-detail-icon"
                    style={{
                      width: 68,
                      height: 68,
                      ...(previewSrc ? {} : { background: visual.accentBg, color: visual.accentFg, borderColor: visual.accentBorder }),
                    }}
                  >
                    {previewSrc ? <img src={previewSrc} alt="" /> : <Icon size={32} />}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--mr-text-secondary)' }}>
                      {zh ? '支持 PNG / JPEG / WebP（<= 2MB），将在工坊首页滚动条、模组发现与详情页同步生效。' : 'PNG/JPG/WebP up to 2MB.'}
                    </span>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="mr-btn-emerald"
                        disabled={avatarBusy}
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        <Upload size={14} />
                        <span>{avatarBusy ? (zh ? '上传中…' : 'Uploading…') : zh ? '上传新头像' : 'Upload New Icon'}</span>
                      </button>
                      {previewSrc && (
                        <button
                          type="button"
                          className="mr-btn-outline"
                          disabled={avatarBusy}
                          onClick={() => void handleResetAvatar()}
                        >
                          <RotateCcw size={14} />
                          <span>{zh ? '恢复默认图标' : 'Reset Default'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {/* 2. Full project metadata & content form */}
              <form className="mr-editor-card" onSubmit={(e) => void handleSaveFullSettings(e)}>
                <div className="mr-editor-head">
                  <strong>
                    <Settings size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                    {zh ? '修改项目基础信息与内容' : 'Edit Project Metadata & Content'}
                  </strong>
                  <div className="mr-md-tabs">
                    <button
                      type="button"
                      className={setMdPreview === 'edit' ? 'is-active' : ''}
                      onClick={() => setSetMdPreview('edit')}
                    >
                      {zh ? '编辑字段' : 'Edit'}
                    </button>
                    <button
                      type="button"
                      className={setMdPreview === 'preview' ? 'is-active' : ''}
                      onClick={() => setSetMdPreview('preview')}
                    >
                      {zh ? '正文预览' : 'Preview'}
                    </button>
                  </div>
                </div>

                {setMdPreview === 'edit' ? (
                  <>
                    <div className="mr-editor-grid">
                      <div className="mr-editor-field">
                        <label htmlFor="mr-set-name">{zh ? '项目名称 *' : 'Project Name *'}</label>
                        <input
                          id="mr-set-name"
                          type="text"
                          required
                          minLength={2}
                          maxLength={60}
                          value={setName}
                          onChange={(e) => setSetName(e.target.value)}
                        />
                      </div>

                      <div className="mr-editor-field">
                        <label htmlFor="mr-set-slug">
                          {zh ? 'URL 别名 (slug)' : 'URL Slug'}
                          {item.isSeed && <small> ({zh ? '官方基础模块锁定' : 'Locked'})</small>}
                        </label>
                        <input
                          id="mr-set-slug"
                          type="text"
                          disabled={item.isSeed}
                          value={setSlug}
                          onChange={(e) => setSetSlug(e.target.value)}
                        />
                      </div>

                      <div className="mr-editor-field">
                        <label htmlFor="mr-set-cat">{zh ? '模组分类' : 'Category'}</label>
                        <select
                          id="mr-set-cat"
                          value={setCategory}
                          onChange={(e) => setSetCategory(e.target.value)}
                        >
                          {WORKSHOP_CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
                            <option key={c.id} value={c.id}>
                              {zh ? c.labelZh : c.labelEn}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="mr-editor-field">
                        <label htmlFor="mr-set-vis">
                          {zh ? '可见性' : 'Visibility'}
                          {item.isSeed && <small> ({zh ? '公开' : 'Public'})</small>}
                        </label>
                        <select
                          id="mr-set-vis"
                          disabled={item.isSeed}
                          value={setVisibility}
                          onChange={(e) => setSetVisibility(e.target.value)}
                        >
                          <option value="public">{zh ? '公开 (展示在首页与发现页)' : 'Public'}</option>
                          <option value="unlisted">{zh ? '未列出 (仅凭链接访问)' : 'Unlisted'}</option>
                          <option value="private">{zh ? '私有 (仅所有者可见)' : 'Private'}</option>
                        </select>
                      </div>

                      <div className="mr-editor-field">
                        <label htmlFor="mr-set-gver">{zh ? '适配游戏版本' : 'Game Version'}</label>
                        <input
                          id="mr-set-gver"
                          type="text"
                          required
                          maxLength={24}
                          value={setGameVersion}
                          onChange={(e) => setSetGameVersion(e.target.value)}
                        />
                      </div>

                      <div className="mr-editor-field">
                        <label htmlFor="mr-set-lic">{zh ? '开源许可证 / 授权说明' : 'License'}</label>
                        <input
                          id="mr-set-lic"
                          type="text"
                          maxLength={32}
                          value={setLicense}
                          onChange={(e) => setSetLicense(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="mr-editor-field">
                      <label>{zh ? '适用游戏渠道' : 'Supported Channels'}</label>
                      <div className="mr-platform-checks">
                        {GAME_BIND_PLATFORMS.map((plat) => {
                          const checked = setPlatforms.includes(plat.id);
                          return (
                            <button
                              key={plat.id}
                              type="button"
                              className={`mr-platform-chip ${checked ? 'is-active' : ''}`}
                              onClick={() => toggleSettingPlatform(plat.id)}
                            >
                              {checked && <Check size={12} />}
                              <span>{zh ? plat.labelZh : plat.labelEn}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mr-editor-grid">
                      <div className="mr-editor-field">
                        <label htmlFor="mr-set-target">{zh ? '目标资源 / 生效模块路径' : 'Target Info'}</label>
                        <input
                          id="mr-set-target"
                          type="text"
                          maxLength={160}
                          value={setTargetInfo}
                          onChange={(e) => setSetTargetInfo(e.target.value)}
                        />
                      </div>

                      <div className="mr-editor-field">
                        <label htmlFor="mr-set-tags">{zh ? '标签（逗号分隔，最多 8 个）' : 'Tags (comma-separated)'}</label>
                        <input
                          id="mr-set-tags"
                          type="text"
                          value={setTags}
                          onChange={(e) => setSetTags(e.target.value)}
                        />
                      </div>
                    </div>

                    {!item.isSeed && (
                      <div className="mr-editor-field">
                        <label htmlFor="mr-set-ext">{zh ? '外部备用下载链接 (可选 HTTPS)' : 'External Download URL'}</label>
                        <input
                          id="mr-set-ext"
                          type="url"
                          maxLength={500}
                          value={setExternalUrl}
                          onChange={(e) => setSetExternalUrl(e.target.value)}
                          placeholder="https://..."
                        />
                      </div>
                    )}

                    <div className="mr-editor-field">
                      <label htmlFor="mr-set-desc">{zh ? '模组简介 (4~240 字，用于发现页与首页卡片) *' : 'Short Description *'}</label>
                      <input
                        id="mr-set-desc"
                        type="text"
                        required
                        minLength={4}
                        maxLength={240}
                        value={setDesc}
                        onChange={(e) => setSetDesc(e.target.value)}
                      />
                    </div>

                    <div className="mr-editor-grid">
                      <div className="mr-editor-field">
                        <label htmlFor="mr-set-ph">{zh ? '宣传横幅标语 (可选)' : 'Promotional Headline'}</label>
                        <input
                          id="mr-set-ph"
                          type="text"
                          maxLength={90}
                          value={setPromoHeadline}
                          onChange={(e) => setSetPromoHeadline(e.target.value)}
                        />
                      </div>
                      <div className="mr-editor-field">
                        <label htmlFor="mr-set-pv">
                          <Film size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                          {zh ? '宣传视频链接 (B站 / YouTube)' : 'Promo Video URL'}
                        </label>
                        <input
                          id="mr-set-pv"
                          type="text"
                          maxLength={300}
                          value={setPromoVideo}
                          onChange={(e) => setSetPromoVideo(e.target.value)}
                          placeholder="https://www.bilibili.com/video/BV..."
                        />
                      </div>
                    </div>

                    <div className="mr-editor-field">
                      <label htmlFor="mr-set-long">{zh ? '详细项目说明正文 (Markdown)' : 'Detailed Project Content (Markdown)'}</label>
                      <textarea
                        id="mr-set-long"
                        rows={10}
                        value={setLongDesc}
                        onChange={(e) => setSetLongDesc(e.target.value)}
                      />
                    </div>
                  </>
                ) : (
                  <div className="mr-editor-preview">
                    {setPromoHeadline && (
                      <div className="mr-showcase-headline">
                        <Sparkles size={15} />
                        <span>{setPromoHeadline}</span>
                      </div>
                    )}
                    {renderProseBlocks(setLongDesc || setDesc)}
                  </div>
                )}

                <div className="mr-editor-actions">
                  <button type="submit" className="mr-btn-emerald" disabled={settingsBusy}>
                    <Save size={14} />
                    <span>{settingsBusy ? (zh ? '保存中…' : 'Saving…') : zh ? '保存全部项目修改' : 'Save Project Settings'}</span>
                  </button>
                </div>
              </form>

              {/* 3. Danger Zone */}
              <section className="mr-danger-zone">
                <div>
                  <strong>{zh ? '危险操作区' : 'Danger Zone'}</strong>
                  <p>
                    {item.isSeed
                      ? zh
                        ? '官方内置基础模块（19 项 .xspkg）受系统保护，不支持直接删除；可通过「版本」标签上传新包覆盖升级。'
                        : 'Official built-in .xspkg modules are protected from deletion.'
                      : zh
                        ? '删除项目后将永久移除所有上传包体、头像与宣传展示图，无法恢复。'
                        : 'Deleting a project permanently removes all files and images.'}
                  </p>
                </div>
                {!item.isSeed && (
                  confirmDeleteStep ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="mr-btn-outline" onClick={() => setConfirmDeleteStep(false)}>
                        {zh ? '取消' : 'Cancel'}
                      </button>
                      <button
                        type="button"
                        className="mr-btn-danger"
                        disabled={settingsBusy}
                        onClick={() => void handleDeleteProjectConfirm()}
                      >
                        <Trash2 size={14} />
                        <span>{zh ? '确认永久删除' : 'Confirm Delete'}</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="mr-btn-danger"
                      onClick={() => setConfirmDeleteStep(true)}
                    >
                      <Trash2 size={14} />
                      <span>{zh ? '删除项目' : 'Delete Project'}</span>
                    </button>
                  )
                )}
              </section>
            </div>
          )}
        </div>

        <aside className="mr-detail-sidebar">
          <div className="mr-side-card">
            <h3>{zh ? '兼容性' : 'Compatibility'}</h3>
            <div>
              <span className="mr-side-label">{zh ? '《吉星派对》版本' : 'Astral Party'}</span>
              <div className="mr-side-chips">
                <span className="mr-side-chip">v{item.gameVersion || '3.3.0'}</span>
                <span className="mr-side-chip">{installKindLabel(item.installKind)}</span>
              </div>
            </div>
            <div>
              <span className="mr-side-label">{zh ? '适用游戏渠道' : 'Channels'}</span>
              <div className="mr-side-chips">
                {(cleanItemPlatforms.length ? cleanItemPlatforms : ['STEAM_CN']).map((p) => (
                  <span key={p} className="mr-side-chip">
                    {formatWorkshopChannelName(p, zh)}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <span className="mr-side-label">{zh ? '支持的运行环境' : 'Supported Environment'}</span>
              <div className="mr-side-chips">
                <span className="mr-side-chip">Windows 客户端</span>
                <span className="mr-side-chip">星枢桌面启动器</span>
                {(cleanItemPlatforms.some((p) => ['ANDROID_CN', 'PE', 'MOBILE'].includes(p.toUpperCase())) ||
                  versions.some((v) => formatVersionPlatformText(v, zh).isMobile)) &&
                  (item.installKind === 'xspkg' ? (
                    <>
                      <span className="mr-side-chip">安卓客户端 (PE)</span>
                      <span className="mr-side-chip">星枢安卓启动器</span>
                    </>
                  ) : (
                    <span className="mr-side-chip">手机端 / PE (modimg)</span>
                  ))}
              </div>
            </div>
            {cleanPlatformLabels.length > 0 && (
              <div>
                <span className="mr-side-label">{zh ? '包含版本 / 端' : 'Available Versions'}</span>
                <div className="mr-side-chips">
                  {cleanPlatformLabels.map((lbl) => (
                    <span key={lbl} className="mr-side-chip">
                      {lbl}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mr-side-card">
            <h3>{zh ? '相关链接' : 'Links'}</h3>
            <div className="mr-side-links">
              <a href={PROJECT_SOURCE} target="_blank" rel="noreferrer" className="mr-side-link">
                <ExternalLink size={14} />
                <span>{zh ? '查看星枢开源仓库 ↗' : 'View source on GitHub ↗'}</span>
              </a>
              <button type="button" className="mr-side-link" onClick={() => void copyValue('link-side', detailUrl)}>
                <Copy size={14} />
                <span>{copiedKey === 'link-side' ? (zh ? '已复制分享链接' : 'Copied URL') : zh ? '复制模组页面链接' : 'Copy Mod URL'}</span>
              </button>
              {item.sha256 && (
                <button type="button" className="mr-side-link" onClick={() => void copyValue('sha-side', item.sha256)}>
                  <ShieldCheck size={14} />
                  <span>{copiedKey === 'sha-side' ? (zh ? '已复制 SHA-256' : 'Copied SHA-256') : zh ? '复制包体 SHA-256 校验码' : 'Copy SHA-256'}</span>
                </button>
              )}
            </div>
          </div>

          <div className="mr-side-card">
            <h3>{zh ? '标签' : 'Tags'}</h3>
            <div className="mr-side-chips">
              <Link to={`/extensions/mods?category=${encodeURIComponent(item.category)}`} className="mr-side-chip">
                {item.categoryLabel}
              </Link>
              {item.tags.map((tag) => (
                <Link key={tag} to={`/extensions/mods?tag=${encodeURIComponent(tag)}`} className="mr-side-chip">
                  {tag}
                </Link>
              ))}
            </div>
          </div>

          <div className="mr-side-card">
            <h3>{zh ? '作者' : 'Creators'}</h3>
            <Link
              to={`/author/${encodeURIComponent(item.authorKey || (isOfficial ? 'official' : item.author))}`}
              className="mr-author-card-link"
            >
              <PlatformUserAvatar
                name={item.author}
                avatarUrl={item.authorAvatarUrl}
                avatarColor={item.authorAvatarColor || (isOfficial ? '#2f7cf6' : '#f02878')}
                size={40}
                fontSize={16}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 14, color: 'var(--mr-text-primary)' }}>{item.author}</strong>
                  {item.authorUid ? <span className="mr-uid-badge">UID #{item.authorUid}</span> : null}
                </div>
                <small style={{ color: 'var(--mr-text-muted)', fontSize: 12, display: 'block', marginTop: 2 }}>
                  {isOfficial ? (zh ? '官方维护 · 点击查看主页 →' : 'Official Owner · View Profile →') : zh ? '创作者 · 点击查看主页 →' : 'Creator · View Profile →'}
                </small>
              </div>
            </Link>
          </div>

          <div className="mr-side-card">
            <h3>{zh ? '信息' : 'Details'}</h3>
            <div className="mr-info-kv">
              <div>
                <span><Scale size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />{zh ? '许可证' : 'License'}</span>
                <strong>{item.license || 'MIT'}</strong>
              </div>
              <div>
                <span>{zh ? '包大小' : 'Size'}</span>
                <strong>{formatModBytes(item.sizeBytes)}</strong>
              </div>
              <div>
                <span><Clock size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />{zh ? '更新版本' : 'Latest'}</span>
                <strong>v{item.version || '1.0.0'}</strong>
              </div>
              <div>
                <span>{zh ? '模组 ID' : 'Project ID'}</span>
                <code style={{ maxWidth: 165, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.id}</code>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {downloadPickerOpen && versions.length > 0 && (
        <div
          className="mr-dl-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={zh ? '选择下载版本' : 'Choose Version to Download'}
          onClick={() => setDownloadPickerOpen(false)}
        >
          <div className="mr-dl-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mr-dl-modal-head">
              <div className="mr-dl-modal-title">
                <div
                  className="mr-dl-modal-icon"
                  style={
                    previewSrc
                      ? undefined
                      : { background: visual.accentBg, color: visual.accentFg, borderColor: visual.accentBorder }
                  }
                >
                  {previewSrc ? <img src={previewSrc} alt={item.name} /> : <Icon size={20} />}
                </div>
                <div>
                  <h3>{zh ? `下载「${item.name}」` : `Download ${item.name}`}</h3>
                  <p>{zh ? '该模组包含多个平台或皮肤方案，请选择需要下载的版本' : 'Select a platform or edition below'}</p>
                </div>
              </div>
              <button
                type="button"
                className="mr-dl-modal-close"
                onClick={() => setDownloadPickerOpen(false)}
                aria-label={zh ? '关闭弹窗' : 'Close'}
              >
                <X size={17} />
              </button>
            </div>

            <div className="mr-dl-modal-list">
              {versions.map((ver, idx) => {
                const chKey = normalizeVersionChannel(ver.channel);
                const chMeta = versionChannelMeta(chKey, zh);
                const platInfo = formatVersionPlatformText(ver, zh);
                const verKey = ver.id || `${ver.version}-${idx}`;
                return (
                  <div key={verKey} className="mr-dl-picker-row">
                    <span className={`mr-ver-channel-dot ${chMeta.cls}`} title={chMeta.label}>
                      {chMeta.letter}
                    </span>
                    <div className="mr-dl-picker-meta">
                      <div className="mr-dl-picker-name">
                        <strong>{ver.title || ver.fileName || `v${ver.version}`}</strong>
                        <span className="mr-ver-tag">v{ver.version}</span>
                        <span className={`mr-ver-plat-badge ${platInfo.isMobile ? 'is-mobile' : 'is-pc'}`}>
                          {platInfo.isMobile ? <Smartphone size={11} /> : <Monitor size={11} />}
                          <span>{platInfo.label}</span>
                        </span>
                      </div>
                      <div className="mr-dl-picker-sub mr-tabular">
                        <span>{ver.fileName}</span>
                        <span>· {formatModBytes(ver.sizeBytes)}</span>
                        <span>· Game {ver.gameVersion || item.gameVersion || '3.3.0'}</span>
                      </div>
                      {ver.notes && <p className="mr-dl-picker-note">{ver.notes}</p>}
                    </div>
                    <div className="mr-dl-picker-action">
                      {ver.downloadUrl ? (
                        ver.downloadUrl.startsWith('/api/') ? (
                          <a
                            href={workshopAssetUrl(ver.downloadUrl)}
                            download={ver.fileName}
                            className="mr-btn-emerald"
                          >
                            <Download size={14} />
                            <span>{zh ? '下载' : 'Download'}</span>
                          </a>
                        ) : (
                          <a href={ver.downloadUrl} target="_blank" rel="noreferrer" className="mr-btn-outline">
                            <ExternalLink size={14} />
                            <span>{zh ? '前往' : 'Open'}</span>
                          </a>
                        )
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mr-dl-modal-foot">
              <button
                type="button"
                className="mr-side-link"
                onClick={() => {
                  setDownloadPickerOpen(false);
                  setTab('versions');
                }}
              >
                <Package size={14} />
                <span>{zh ? '前往「版本」标签页查看全部筛选与 SHA-256 →' : 'View full version table & SHA-256 →'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {lightboxIdx !== null && gallery[lightboxIdx] && (
        <div
          className="mr-lightbox-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxIdx(null)}
        >
          <div className="mr-lightbox-stage" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="mr-lightbox-close"
              onClick={() => setLightboxIdx(null)}
              aria-label={zh ? '关闭预览' : 'Close'}
            >
              <X size={18} />
            </button>
            <img
              src={workshopAssetUrl(gallery[lightboxIdx].url)}
              alt={gallery[lightboxIdx].caption || item.name}
            />
            {gallery.length > 1 && (
              <>
                <button
                  type="button"
                  className="mr-showcase-nav is-prev"
                  onClick={() => setLightboxIdx((lightboxIdx - 1 + gallery.length) % gallery.length)}
                  aria-label={zh ? '上一张' : 'Previous'}
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  type="button"
                  className="mr-showcase-nav is-next"
                  onClick={() => setLightboxIdx((lightboxIdx + 1) % gallery.length)}
                  aria-label={zh ? '下一张' : 'Next'}
                >
                  <ChevronRight size={20} />
                </button>
              </>
            )}
            <div className="mr-lightbox-foot">
              <span>{gallery[lightboxIdx].caption || item.name}</span>
              <span className="mr-tabular">{lightboxIdx + 1} / {gallery.length}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
