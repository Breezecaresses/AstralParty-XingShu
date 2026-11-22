import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronUp, Plus, Upload, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../../i18n';
import { useLauncherTheme } from '../../pages/launcher/launcherTheme';
import { isTauriRuntime } from '../../shared/runtime';
import {
  closeCreateProjectModal,
  createWorkshopProject,
  isPlatformAdmin,
  usePlatformAccount,
} from '../../shared/platformAccountClient';
import { WORKSHOP_UPLOAD_CHANNEL_PRESETS, type WorkshopCategory } from '../../shared/workshopClient';
import './platform-account.css';

function suggestSlug(name: string): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
  if (ascii.length >= 2) return ascii;
  return `mod-${Math.random().toString(36).slice(2, 8)}`;
}

export const CreateProjectModal: React.FC = () => {
  const { locale } = useTranslation();
  const zh = locale === 'zh-CN';
  const navigate = useNavigate();
  const { user, createProjectModalOpen } = usePlatformAccount();
  const { theme } = useLauncherTheme();
  const isDesktop = isTauriRuntime();

  const [category, setCategory] = useState<Exclude<WorkshopCategory, 'all'>>('optimization');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [visibility, setVisibility] = useState<'public' | 'unlisted' | 'private'>('public');
  const [platformsPreset, setPlatformsPreset] = useState<string>('STEAM_CN,TAPTAP,BILIBILI,WEGAME');
  const [description, setDescription] = useState('');
  const [uploadExpanded, setUploadExpanded] = useState(false);
  const [version, setVersion] = useState('1.0.0');
  const [tags, setTags] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!createProjectModalOpen) return;
    setError('');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCreateProjectModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createProjectModalOpen]);

  if (!createProjectModalOpen) return null;

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugTouched) {
      setSlug(suggestSlug(val));
    }
  };

  const resetAndClose = () => {
    setName('');
    setSlug('');
    setSlugTouched(false);
    setVisibility('public');
    setPlatformsPreset('STEAM_CN,TAPTAP,BILIBILI,WEGAME');
    setDescription('');
    setUploadExpanded(false);
    setVersion('1.0.0');
    setTags('');
    setExternalUrl('');
    setArchiveFile(null);
    setPreviewFile(null);
    setError('');
    closeCreateProjectModal();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const created = await createWorkshopProject({
        category,
        name: name.trim(),
        slug: slug.trim() || suggestSlug(name),
        visibility,
        description: description.trim(),
        version: version.trim() || '1.0.0',
        platforms: platformsPreset,
        tags,
        externalUrl,
        archiveFile,
        previewFile,
      });
      const dest = `/mod/${encodeURIComponent(created.slug || created.id)}`;
      resetAndClose();
      navigate(dest);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const ownerLabel = user?.displayName ? `${user.displayName} (@${user.username})` : user?.username || 'xingshu_user';

  return createPortal(
    <div className={`xp-scope ${isDesktop ? 'is-desktop' : ''}`} data-pcl-theme={isDesktop ? theme : undefined}>
      <div className="xp-modal-backdrop" onClick={resetAndClose}>
        <div
          className="xp-modal is-wide"
          role="dialog"
          aria-modal="true"
          aria-label={zh ? '创建项目' : 'Create Project'}
          onClick={(e) => e.stopPropagation()}
        >
          <header className="xp-modal-head">
            <div>
              <h2>{zh ? '创建项目' : 'Create Project'}</h2>
              <p className="xp-modal-sub">
                {zh
                  ? '创建一个星枢工坊 Mod 项目页；可立即附带 .xspkg / .zip 发布或稍后上传版本'
                  : 'Create a project page on XingShu Workshop with optional .xspkg / .zip upload'}
              </p>
            </div>
            <button type="button" className="xp-close-btn" onClick={resetAndClose} aria-label={zh ? '关闭' : 'Close'}>
              <X size={16} />
            </button>
          </header>

          <form className="xp-form" onSubmit={(e) => void handleSubmit(e)}>
            {error && <div className="xp-alert-err">{error}</div>}

            <div className="xp-field">
              <label htmlFor="xp-proj-category">{zh ? '类型' : 'Type'}</label>
              <select
                id="xp-proj-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as Exclude<WorkshopCategory, 'all'>)}
              >
                <option value="optimization">{zh ? '功能优化 Mod (.xspkg / 局内功能)' : 'Optimization Mod (.xspkg)'}</option>
                <option value="skin">{zh ? '角色皮肤 (立绘 / 模型资源)' : 'Character Skin'}</option>
                <option value="card">{zh ? '卡牌替换 (卡面 / UI)' : 'Card Replacer'}</option>
                <option value="voice_vfx">{zh ? '语音 · 特效' : 'Voice & VFX'}</option>
              </select>
            </div>

            <div className="xp-field">
              <label htmlFor="xp-proj-name">{zh ? '名称' : 'Name'}</label>
              <input
                id="xp-proj-name"
                type="text"
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder={zh ? '输入项目名称…' : 'Enter project name…'}
              />
            </div>

            <div className="xp-field">
              <label htmlFor="xp-proj-slug">{zh ? 'URL 链接' : 'URL Slug'}</label>
              <div className="xp-url-preview">
                <span>https://astralparty-xingshu.lanxichaxu.cn/xingshu-hub/mod/</span>
                <input
                  id="xp-proj-slug"
                  type="text"
                  required
                  pattern="[a-z0-9][a-z0-9_-]{1,48}"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                  placeholder="my-mod-slug"
                />
              </div>
              <small>{zh ? '仅限小写英文、数字、连字符 (-) 或下划线 (_)。' : 'Lowercase letters, numbers, - or _ only.'}</small>
            </div>

            <div className="xp-field">
              <label htmlFor="xp-proj-owner">{zh ? '所有者' : 'Owner'}</label>
              <select id="xp-proj-owner" value={ownerLabel} disabled>
                <option value={ownerLabel}>{ownerLabel}</option>
              </select>
              <small>{zh ? '将项目所有者设置为你当前登录的星枢平台账号。' : 'Set to your active XingShu account.'}</small>
            </div>

            <div className="xp-field">
              <span className="xp-field-label">{zh ? '可见性' : 'Visibility'}</span>
              <div className="xp-vis-group">
                {(
                  [
                    { id: 'public', labelZh: '公开', labelEn: 'Public' },
                    { id: 'unlisted', labelZh: '未列出', labelEn: 'Unlisted' },
                    { id: 'private', labelZh: '私有', labelEn: 'Private' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`xp-vis-btn ${visibility === item.id ? 'is-active' : ''}`}
                    onClick={() => setVisibility(item.id)}
                  >
                    {visibility === item.id && <Check size={13} />}
                    <span>{zh ? item.labelZh : item.labelEn}</span>
                  </button>
                ))}
              </div>
              <small>{zh ? '你的项目在审核通过并上传模组包后即可按此可见性展示。' : 'Controls visibility once approved & published.'}</small>
            </div>

            <div className="xp-field">
              <label htmlFor="xp-proj-platforms">{zh ? '适用端 / 渠道' : 'Target Platforms'}</label>
              <select
                id="xp-proj-platforms"
                value={platformsPreset}
                onChange={(e) => setPlatformsPreset(e.target.value)}
              >
                {WORKSHOP_UPLOAD_CHANNEL_PRESETS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {zh ? opt.labelZh : opt.labelEn}
                  </option>
                ))}
              </select>
              <small>
                {zh
                  ? '可在后续上传版本时按 PC 端或手机端 (安卓 / PE) 单独补充对应包体。'
                  : 'You can also upload separate PC or Mobile (Android / PE) builds per version.'}
              </small>
            </div>

            {!isPlatformAdmin(user) && (
              <div
                style={{
                  padding: '9px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  background: 'rgba(245, 158, 11, 0.08)',
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: 'var(--mr-text-secondary, #cbd5e1)',
                }}
              >
                {zh
                  ? '审核渠道提示：新建项目与新版本将先进入管理员审核队列（本人可在详情页与「创作者入口」查看进度），审核通过后即在工坊公开上架。'
                  : 'Submissions enter the moderation queue first and become public once approved by an admin.'}
              </div>
            )}

            <div className="xp-field">
              <label htmlFor="xp-proj-desc">{zh ? '概述' : 'Summary'}</label>
              <textarea
                id="xp-proj-desc"
                rows={3}
                required
                minLength={4}
                maxLength={600}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={zh ? '这个项目为《吉星派对》增加了…' : 'Describe your project in a sentence or two…'}
              />
              <small>{zh ? '一两句话描述你的项目。' : 'Describe your project concisely.'}</small>
            </div>

            <button
              type="button"
              className="xp-collapse-toggle"
              onClick={() => setUploadExpanded((v) => !v)}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Upload size={14} />
                {zh ? '可选：同时上传首个 .xspkg / .zip 版本与封面预览图' : 'Optional: Upload initial .xspkg / .zip version'}
              </span>
              {uploadExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>

            {uploadExpanded && (
              <div className="xp-collapse-box">
                <div className="xp-grid-2">
                  <div className="xp-field">
                    <label htmlFor="xp-proj-ver">{zh ? '版本号' : 'Version'}</label>
                    <input
                      id="xp-proj-ver"
                      type="text"
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                      placeholder="1.0.0"
                    />
                  </div>
                  <div className="xp-field">
                    <label htmlFor="xp-proj-tags">{zh ? '标签 (逗号分隔)' : 'Tags'}</label>
                    <input
                      id="xp-proj-tags"
                      type="text"
                      value={tags}
                      onChange={(e) => setTags(e.target.value)}
                      placeholder={zh ? '局内信息, 轻量化' : 'utility, ui'}
                    />
                  </div>
                </div>

                <div className="xp-grid-2">
                  <div className="xp-field">
                    <label htmlFor="xp-proj-archive">{zh ? '模组文件 (.xspkg / .zip)' : 'Mod Archive'}</label>
                    <input
                      id="xp-proj-archive"
                      type="file"
                      accept=".xspkg,.zip,.apmm"
                      onChange={(e) => setArchiveFile(e.target.files?.[0] || null)}
                    />
                  </div>
                  <div className="xp-field">
                    <label htmlFor="xp-proj-preview">{zh ? '预览图 (PNG/JPG/WebP)' : 'Icon / Preview'}</label>
                    <input
                      id="xp-proj-preview"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => setPreviewFile(e.target.files?.[0] || null)}
                    />
                  </div>
                </div>

                <div className="xp-field">
                  <label htmlFor="xp-proj-ext">{zh ? '或填写外部 HTTPS 下载链接' : 'Or external HTTPS URL'}</label>
                  <input
                    id="xp-proj-ext"
                    type="url"
                    value={externalUrl}
                    onChange={(e) => setExternalUrl(e.target.value)}
                    placeholder="https://github.com/..."
                  />
                </div>
              </div>
            )}

            <footer className="xp-modal-foot">
              <button type="button" className="xp-btn-secondary" onClick={resetAndClose}>
                <X size={14} />
                <span>{zh ? '取消' : 'Cancel'}</span>
              </button>
              <button type="submit" className="xp-btn-primary" disabled={busy}>
                <Plus size={15} />
                <span>{busy ? (zh ? '创建中…' : 'Creating…') : zh ? '创建项目' : 'Create project'}</span>
              </button>
            </footer>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
};
