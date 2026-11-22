import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, SmilePlus, X } from 'lucide-react';
import { useTranslation } from '../../i18n';
import {
  ALL_GAME_EMOTES,
  ANIMATED_GAME_EMOTES,
  DEFAULT_REACTION_EMOTE_ID,
  FEATURED_EMOTE_IDS,
  GAME_EMOTE_GROUPS,
  emoteImageUrl,
  findEmoteMeta,
} from '../../shared/gameEmotes';
import {
  openPlatformAuthModal,
  setPlatformModReaction,
  usePlatformAccount,
} from '../../shared/platformAccountClient';
import type { WorkshopReactionCount } from '../../shared/workshopClient';

export interface EmoteReactionUpdate {
  reactions: WorkshopReactionCount[];
  reactionTotal: number;
  viewerEmoteId: string | null;
}

interface EmoteReactionBarProps {
  modId: string;
  reactions?: WorkshopReactionCount[];
  reactionTotal?: number;
  viewerEmoteId?: string | null;
  mode: 'card' | 'detail';
  onUpdated?: (next: EmoteReactionUpdate) => void;
}

export const EmoteReactionBar: React.FC<EmoteReactionBarProps> = ({
  modId,
  reactions = [],
  viewerEmoteId,
  mode,
  onUpdated,
}) => {
  const { locale } = useTranslation();
  const zh = locale === 'zh-CN';
  const platform = usePlatformAccount();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedCharId, setSelectedCharId] = useState<string>('featured');
  const [errMsg, setErrMsg] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const activeEmoteId = platform.user
    ? platform.loaded
      ? platform.reactions[modId] ?? null
      : viewerEmoteId ?? null
    : null;

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [pickerOpen]);

  const displayedPills = useMemo(() => {
    const base = [...reactions];
    if (activeEmoteId && !base.some((r) => r.emoteId === activeEmoteId)) {
      base.unshift({ emoteId: activeEmoteId, count: 1 });
    }
    return mode === 'card' ? base.slice(0, 6) : base.slice(0, 14);
  }, [reactions, activeEmoteId, mode]);

  const hiddenCount = Math.max(0, reactions.length - displayedPills.length);

  const visibleEmotes = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (q) {
      return ALL_GAME_EMOTES.filter(
        (em) =>
          em.name.toLowerCase().includes(q) ||
          em.characterName.toLowerCase().includes(q) ||
          em.characterEnName.toLowerCase().includes(q) ||
          em.id.toLowerCase().includes(q),
      ).slice(0, 72);
    }
    if (selectedCharId === 'featured') {
      const featuredSet = new Set(FEATURED_EMOTE_IDS);
      return ALL_GAME_EMOTES.filter((em) => featuredSet.has(em.id));
    }
    if (selectedCharId === 'animated') {
      return ANIMATED_GAME_EMOTES;
    }
    if (selectedCharId === 'all') {
      return ALL_GAME_EMOTES.slice(0, 96);
    }
    const group = GAME_EMOTE_GROUPS.find((g) => g.id === selectedCharId);
    return group ? group.emotes : [];
  }, [searchText, selectedCharId]);

  const triggerReaction = async (
    emoteId: string,
    action: 'toggle' | 'set' | 'remove' = 'toggle',
    closeAfter = false,
  ) => {
    if (!platform.user) {
      openPlatformAuthModal('login');
      return;
    }
    if (busy) return;
    setBusy(true);
    setErrMsg('');
    try {
      const res = await setPlatformModReaction(modId, emoteId, action);
      onUpdated?.({
        reactions: res.reactions,
        reactionTotal: res.reactionTotal,
        viewerEmoteId: res.viewerEmoteId,
      });
      if (closeAfter) setPickerOpen(false);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const togglePicker = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!platform.user) {
      openPlatformAuthModal('login');
      return;
    }
    setErrMsg('');
    setPickerOpen((prev) => !prev);
  };

  const activeMeta = activeEmoteId ? findEmoteMeta(activeEmoteId) : null;
  const triggerEmoteSrc = emoteImageUrl(activeEmoteId || DEFAULT_REACTION_EMOTE_ID);

  return (
    <div
      ref={wrapRef}
      className={`mr-emote-bar ${mode === 'detail' ? 'is-detail' : 'is-card'} ${pickerOpen ? 'is-open' : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      {displayedPills.map((item) => {
        const meta = findEmoteMeta(item.emoteId);
        const isMine = activeEmoteId === item.emoteId;
        const label = meta
          ? `${zh ? meta.characterName : meta.characterEnName} · ${meta.name}`
          : item.emoteId;
        return (
          <button
            key={item.emoteId}
            type="button"
            disabled={busy}
            className={`mr-emote-pill ${isMine ? 'is-active' : ''}`}
            title={
              isMine
                ? `${label}（${zh ? '再次点击取消回应' : 'Click to remove'}）`
                : `${label}（${zh ? '点击切换引用此角色表情' : 'Click to react with this sticker'}）`
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void triggerReaction(item.emoteId, 'toggle', false);
            }}
          >
            <img src={emoteImageUrl(item.emoteId)} alt={label} loading="lazy" />
            <span className="mr-tabular">{item.count}</span>
          </button>
        );
      })}

      {hiddenCount > 0 && (
        <span className="mr-emote-more" title={zh ? '打开表情面板查看全部' : 'Open picker for all'}>
          +{hiddenCount}
        </span>
      )}

      {mode === 'detail' ? (
        <button
          type="button"
          className={`mr-emote-trigger-btn ${activeEmoteId ? 'is-active' : ''}`}
          aria-expanded={pickerOpen}
          aria-label={zh ? '选择或切换角色表情包回应' : 'Choose character sticker reaction'}
          title={
            activeMeta
              ? `${zh ? '当前回应' : 'Your reaction'}: ${zh ? activeMeta.characterName : activeMeta.characterEnName} · ${activeMeta.name}`
              : zh
                ? '使用游戏内角色表情包回应'
                : 'React with Astral Party sticker'
          }
          onClick={togglePicker}
        >
          <img
            src={triggerEmoteSrc}
            alt=""
            className={activeEmoteId ? 'is-selected-sticker' : 'is-default-sticker'}
          />
          <span>{activeEmoteId ? (zh ? '切换表情' : 'Switch') : zh ? '表情回应' : 'React'}</span>
          <Plus size={13} />
        </button>
      ) : (
        <button
          type="button"
          className={`mr-emote-add-btn ${activeEmoteId ? 'is-active' : ''}`}
          aria-expanded={pickerOpen}
          aria-label={zh ? '引用角色表情包' : 'Pick character sticker'}
          title={zh ? '使用游戏内角色表情包表态或切换引用' : 'React / switch character sticker'}
          onClick={togglePicker}
        >
          <SmilePlus size={14} />
          <span>{activeEmoteId ? (zh ? '换表情' : 'Switch') : zh ? '表态' : 'React'}</span>
        </button>
      )}

      {pickerOpen && (
        <div
          className="mr-emote-popover is-left"
          role="dialog"
          aria-label={zh ? '选择游戏内角色表情包' : 'Astral Party Sticker Picker'}
        >
          <div className="mr-emote-pop-head">
            <div className="mr-emote-search-box">
              <Search size={13} />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={zh ? '搜索角色名或表情名…' : 'Search character or sticker…'}
                autoFocus
              />
              {searchText && (
                <button type="button" onClick={() => setSearchText('')} aria-label={zh ? '清空搜索' : 'Clear'}>
                  <X size={12} />
                </button>
              )}
            </div>
            <button
              type="button"
              className="mr-emote-close-btn"
              onClick={() => setPickerOpen(false)}
              aria-label={zh ? '关闭表情面板' : 'Close'}
            >
              <X size={14} />
            </button>
          </div>

          {!searchText.trim() && (
            <div className="mr-emote-char-tabs" role="tablist" aria-label={zh ? '按角色筛选' : 'Filter by character'}>
              <button
                type="button"
                className={selectedCharId === 'featured' ? 'is-active' : ''}
                onClick={() => setSelectedCharId('featured')}
              >
                {zh ? '推荐常用' : 'Featured'}
              </button>
              <button
                type="button"
                className={selectedCharId === 'animated' ? 'is-active' : ''}
                onClick={() => setSelectedCharId('animated')}
              >
                {zh ? `动态表情 (${ANIMATED_GAME_EMOTES.length})` : `Animated (${ANIMATED_GAME_EMOTES.length})`}
              </button>
              <button
                type="button"
                className={selectedCharId === 'all' ? 'is-active' : ''}
                onClick={() => setSelectedCharId('all')}
              >
                {zh ? '全部角色' : 'All'}
              </button>
              {GAME_EMOTE_GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={selectedCharId === g.id ? 'is-active' : ''}
                  onClick={() => setSelectedCharId(g.id)}
                >
                  {zh ? g.name : g.enName}
                </button>
              ))}
            </div>
          )}

          {errMsg && <p className="mr-emote-error">{errMsg}</p>}

          <div className="mr-emote-grid">
            {visibleEmotes.length === 0 ? (
              <div className="mr-emote-empty">
                {zh ? '未找到匹配的角色表情包' : 'No matching stickers'}
              </div>
            ) : (
              visibleEmotes.map((em, idx) => {
                const isSelected = activeEmoteId === em.id;
                const charDisplay = zh ? em.characterName : em.characterEnName;
                return (
                  <button
                    key={em.id}
                    type="button"
                    disabled={busy}
                    className={`mr-emote-option ${isSelected ? 'is-active' : ''}`}
                    title={`${charDisplay} · ${em.name}`}
                    onClick={() => void triggerReaction(em.id, 'toggle', true)}
                  >
                    <img
                      src={emoteImageUrl(em.id)}
                      alt={`${charDisplay} ${em.name}`}
                      loading={idx < 12 ? 'eager' : 'lazy'}
                    />
                    {em.animated && (
                      <em className="mr-emote-anim-tag" aria-label={zh ? '动态表情' : 'Animated'}>
                        {zh ? '动' : 'GIF'}
                      </em>
                    )}
                    <span>{em.name}</span>
                  </button>
                );
              })
            )}
          </div>

          {activeEmoteId && (
            <div className="mr-emote-pop-foot">
              <span className="mr-emote-current-label">
                <img src={emoteImageUrl(activeEmoteId)} alt="" />
                <span>
                  {activeMeta
                    ? `${zh ? activeMeta.characterName : activeMeta.characterEnName} · ${activeMeta.name}`
                    : activeEmoteId}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                className="mr-emote-clear-btn"
                onClick={() => void triggerReaction(activeEmoteId, 'remove', true)}
              >
                {zh ? '取消当前引用' : 'Remove'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
