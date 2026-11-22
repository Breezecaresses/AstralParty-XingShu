import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Image as ImageIcon,
  Paintbrush,
  RefreshCw,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import {
  fetchMyWorkshopProjects,
  isPlatformAdmin,
  openPlatformAuthModal,
  usePlatformAccount,
} from '../../shared/platformAccountClient';
import {
  WORKSHOP_UPLOAD_CHANNEL_PRESETS,
  formatModBytes,
  installKindLabel,
  modPlatformSummaryBadge,
  submitWorkshopMod,
  type WorkshopCategory,
  type WorkshopModItem,
  type WorkshopSubmitResponse,
} from '../../shared/workshopClient';
import './extensions.css';

function creatorReviewStatusText(status?: string): { label: string; color: string; bg: string } {
  switch ((status || 'approved').toLowerCase()) {
    case 'pending':
      return { label: '审核中（待审核）', color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.14)' };
    case 'rejected':
      return { label: '已驳回', color: '#f87171', bg: 'rgba(239, 68, 68, 0.14)' };
    case 'unpublished':
      return { label: '已下架', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.14)' };
    default:
      return { label: '已通过', color: '#34d399', bg: 'rgba(16, 185, 129, 0.14)' };
  }
}

export function WorkshopCreatorPage() {
  const platform = usePlatformAccount();
  const isAdmin = isPlatformAdmin(platform.user);

  // Submission form state
  const [subName, setSubName] = useState('');
  const [subAuthor, setSubAuthor] = useState('');
  const [subCategory, setSubCategory] = useState<Exclude<WorkshopCategory, 'all'>>('skin');
  const [subPlatforms, setSubPlatforms] = useState('STEAM_CN,TAPTAP,BILIBILI,WEGAME');
  const [subTags, setSubTags] = useState('');
  const [subTargetInfo, setSubTargetInfo] = useState('');
  const [subDescription, setSubDescription] = useState('');
  const [subExternalUrl, setSubExternalUrl] = useState('');
  const [subArchive, setSubArchive] = useState<File | null>(null);
  const [subPreview, setSubPreview] = useState<File | null>(null);
  const [subSubmitting, setSubSubmitting] = useState(false);
  const [subError, setSubError] = useState('');
  const [subResult, setSubResult] = useState<WorkshopSubmitResponse | null>(null);

  // Creator review status list
  const [myProjects, setMyProjects] = useState<WorkshopModItem[]>([]);
  const [myLoading, setMyLoading] = useState(false);
  const [myError, setMyError] = useState('');

  const loadMyProjects = useCallback(async () => {
    if (!platform.user) {
      setMyProjects([]);
      return;
    }
    setMyLoading(true);
    setMyError('');
    try {
      const items = await fetchMyWorkshopProjects();
      setMyProjects(items);
    } catch (err) {
      setMyError(err instanceof Error ? err.message : String(err));
    } finally {
      setMyLoading(false);
    }
  }, [platform.user]);

  useEffect(() => {
    if (platform.user && !subAuthor) {
      setSubAuthor(platform.user.displayName || platform.user.username);
    }
  }, [platform.user, subAuthor]);

  useEffect(() => {
    void loadMyProjects();
  }, [loadMyProjects]);


  const resetSubmissionForm = () => {
    setSubName('');
    setSubAuthor(platform.user?.displayName || platform.user?.username || '');
    setSubCategory('skin');
    setSubPlatforms('STEAM_CN,TAPTAP,BILIBILI,WEGAME');
    setSubTags('');
    setSubTargetInfo('');
    setSubDescription('');
    setSubExternalUrl('');
    setSubArchive(null);
    setSubPreview(null);
    setSubError('');
  };

  const handleSubmitMod = async (e: FormEvent) => {
    e.preventDefault();
    setSubError('');
    setSubResult(null);
    setSubSubmitting(true);
    try {
      const res = await submitWorkshopMod({
        name: subName,
        author: subAuthor,
        category: subCategory,
        platforms: subPlatforms,
        tags: subTags,
        targetInfo: subTargetInfo,
        description: subDescription,
        externalUrl: subExternalUrl,
        archiveFile: subArchive,
        previewFile: subPreview,
        token: platform.token,
      });
      setSubResult(res);
      resetSubmissionForm();
      void loadMyProjects();
    } catch (err) {
      setSubError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubSubmitting(false);
    }
  };

  return (
    <div className="workshop-web-page workshop-creator-page">
      <header className="panel workshop-hero">
        <div className="workshop-hero-copy">
          <div className="workshop-eyebrow"><Paintbrush size={15} /><span>CREATOR · 创作与投稿</span></div>
          <h1>创作者入口</h1>
          <p>在这里提交你的 Mod、卡牌替换、角色皮肤和语音特效作品，审核通过后展示在模组工坊。</p>
        </div>
        <Link to="/extensions/mods" className="btn btn-secondary"><ArrowLeft size={14} />返回工坊</Link>
      </header>

      <div className="workshop-creator-grid">
        <section className="panel workshop-creator-editor" aria-labelledby="creator-submit-title">
          <header className="workshop-creator-heading">
            <h2 id="creator-submit-title">投稿作品</h2>
            <p>填写作品信息，上传文件或提供发布链接。</p>
          </header>
          <form onSubmit={handleSubmitMod} className="workshop-form workshop-creator-form">
            {subResult ? (
              <div className="workshop-submit-success">
                <CheckCircle2 size={22} />
                <div>
                  <strong>{subResult.message}</strong>
                  <p>投稿编号：{subResult.id} · 识别类型：{installKindLabel(subResult.installKind)}</p>
                  {subResult.sha256 && <p>SHA-256：<code>{subResult.sha256}</code></p>}
                </div>
              </div>
            ) : (
              <>
                <div className="workshop-form-row">
                  <label>
                    <span>模组名称 *</span>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={80}
                      value={subName}
                      onChange={(e) => setSubName(e.target.value)}
                      placeholder="例如：芙兰卡高冷立绘替换 / 优化特效卡面"
                    />
                  </label>
                  <label>
                    <span>作者署名 *</span>
                    <input
                      type="text"
                      required
                      minLength={1}
                      maxLength={40}
                      value={subAuthor}
                      onChange={(e) => setSubAuthor(e.target.value)}
                      placeholder="你的昵称或署名"
                    />
                  </label>
                </div>

                <div className="workshop-form-row">
                  <label>
                    <span>模组分类 *</span>
                    <select
                      value={subCategory}
                      onChange={(e) => setSubCategory(e.target.value as Exclude<WorkshopCategory, 'all'>)}
                    >
                      <option value="optimization">优化 Mod</option>
                      <option value="card">卡牌替换</option>
                      <option value="skin">角色皮肤</option>
                      <option value="voice_vfx">语音·特效</option>
                    </select>
                  </label>
                  <label>
                    <span>适用渠道 *</span>
                    <select
                      value={subPlatforms}
                      onChange={(e) => setSubPlatforms(e.target.value)}
                    >
                      {WORKSHOP_UPLOAD_CHANNEL_PRESETS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.labelZh}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="workshop-form-row">
                  <label>
                    <span>标签（逗号分隔，最多 8 个）</span>
                    <input
                      type="text"
                      value={subTags}
                      onChange={(e) => setSubTags(e.target.value)}
                      placeholder="角色皮肤, 莉莉, 轻量化"
                    />
                  </label>
                  <label>
                    <span>替换目标说明（角色、卡牌或 Bundle 名）</span>
                    <input
                      type="text"
                      maxLength={160}
                      value={subTargetInfo}
                      onChange={(e) => setSubTargetInfo(e.target.value)}
                      placeholder="例如：UT_Hero_Bust_103 / 治疗卡卡面优化"
                    />
                  </label>
                </div>

                <label>
                  <span>模组说明 *</span>
                  <textarea
                    rows={3}
                    required
                    minLength={4}
                    maxLength={600}
                    value={subDescription}
                    onChange={(e) => setSubDescription(e.target.value)}
                    placeholder="说明具体修改内容、适配版本（如 3.3.0）及注意事项…"
                  />
                </label>

                <div className="workshop-form-row">
                  <label className="workshop-file-input">
                    <span>上传模组压缩包（.zip / .xspkg，≤ 32MB）</span>
                    <div className="workshop-file-picker">
                      <Upload size={15} />
                      <span>{subArchive ? `${subArchive.name} (${formatModBytes(subArchive.size)})` : '选择本地 .zip 或 .xspkg'}</span>
                      <input
                        type="file"
                        accept=".zip,.xspkg"
                        onChange={(e) => setSubArchive(e.target.files?.[0] || null)}
                      />
                    </div>
                  </label>
                  <label className="workshop-file-input">
                    <span>可选预览图（PNG / JPG / WebP，≤ 2MB）</span>
                    <div className="workshop-file-picker">
                      <ImageIcon size={15} />
                      <span>{subPreview ? `${subPreview.name} (${formatModBytes(subPreview.size)})` : '选择效果截图'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => setSubPreview(e.target.files?.[0] || null)}
                      />
                    </div>
                  </label>
                </div>

                <label>
                  <span>或填写安全 HTTPS 外部下载链接（GitHub Release / 网盘外链）</span>
                  <input
                    type="url"
                    value={subExternalUrl}
                    onChange={(e) => setSubExternalUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </label>

                <p className="workshop-detail-note">
                  安全说明：所有投稿压缩包都会检查可执行脚本黑名单、路径穿越，并记录 SHA-256 摘要；管理员审核通过后将对全部玩家开放下载与桌面端一键安装。
                </p>
              </>
            )}

            {subError && <p className="extension-error">{subError}</p>}

            <footer className="workshop-modal-footer">
              <Link
                to="/extensions/mods"
                className="btn btn-secondary"
                aria-disabled={subSubmitting}
                onClick={(event) => { if (subSubmitting) event.preventDefault(); }}
              >
                返回工坊
              </Link>
              {subResult ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setSubResult(null)}
                >
                  继续投稿
                </button>
              ) : (
                <button type="submit" className="btn btn-primary" disabled={subSubmitting}>
                  <Upload size={14} />
                  {subSubmitting ? '正在校验并上传…' : '提交投稿'}
                </button>
              )}
            </footer>
          </form>
        </section>

        <aside className="panel workshop-creator-guide" aria-label="创作者投稿指南">
          <h2>投稿指南</h2>
          <ol>
            <li><strong>准备作品</strong><p>支持优化 Mod、卡牌替换、角色皮肤与语音特效；请写清适配的游戏版本、渠道和替换目标。</p></li>
            <li><strong>上传或提供链接</strong><p>压缩包支持 .zip / .xspkg，最大 32MB；更大的作品可填写 HTTPS 发布页或网盘链接。预览图最大 2MB。</p></li>
            <li><strong>提交审核</strong><p>提交后保存投稿编号，审核通过的作品会在模组工坊展示。</p></li>
          </ol>
          <div className="workshop-creator-credit">
            <h3>创作与署名</h3>
            <p>请使用原创或已获授权的内容，填写作者署名，并在作品说明中注明引用素材的来源和授权要求。</p>
            <p>作品与游戏素材遵循各自的许可，星枢项目自身的代码授权条款不替代作品本身的授权。</p>
          </div>
        </aside>
      </div>

      <section
        className="panel"
        aria-label="我的投稿与审核状态"
        style={{ marginTop: 18, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>我的投稿与审核状态</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
              {isAdmin
                ? '你是官方管理员账号，可前往管理后台审阅社区投稿或查看统计数据。'
                : '普通创作者提交的新项目或新版本将进入审核渠道；审核通过前仅你本人和管理员可见。'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isAdmin && (
              <Link to="/admin" className="btn btn-primary btn-sm">
                <ShieldCheck size={14} />
                进入管理员后台
              </Link>
            )}
            {platform.user ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={myLoading}
                onClick={() => void loadMyProjects()}
              >
                <RefreshCw size={14} />
                {myLoading ? '刷新中…' : '刷新进度'}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => openPlatformAuthModal('login')}
              >
                登录查看审核进度
              </button>
            )}
          </div>
        </div>

        {myError && <p className="extension-error" style={{ margin: 0 }}>{myError}</p>}

        {platform.user && !myLoading && myProjects.length === 0 && (
          <div style={{ fontSize: 13.5, color: 'var(--text-muted)', padding: '8px 0' }}>
            暂无关联到当前账号的项目；使用上方或导航栏「发布 → 新建项目」创建后，可在此实时追踪审核进展。
          </div>
        )}

        {platform.user && myProjects.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12 }}>
            {myProjects.map((proj) => {
              const st = creatorReviewStatusText(proj.status);
              const badge = modPlatformSummaryBadge(proj, true);
              const pendingVers = Number(proj.pendingVersionCount || 0);
              return (
                <article
                  key={proj.id}
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-secondary)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <Link
                      to={`/mod/${encodeURIComponent(proj.slug || proj.id)}`}
                      style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text-primary)', textDecoration: 'none' }}
                    >
                      {proj.name}
                    </Link>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 11.5,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 999,
                        color: st.color,
                        background: st.bg,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {proj.status === 'rejected' ? (
                        <XCircle size={12} />
                      ) : proj.status === 'pending' ? (
                        <Clock size={12} />
                      ) : (
                        <CheckCircle2 size={12} />
                      )}
                      {st.label}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)' }}>
                    <span>{proj.categoryLabel}</span>
                    <span>· v{proj.version}</span>
                    {badge && <span>· {badge}</span>}
                    {pendingVers > 0 && (
                      <span style={{ color: '#fbbf24', fontWeight: 600 }}>
                        · 另有 {pendingVers} 个版本待审核
                      </span>
                    )}
                  </div>

                  {proj.reviewNote && (
                    <div
                      style={{
                        fontSize: 12,
                        padding: '6px 9px',
                        borderRadius: 8,
                        background: 'rgba(15, 23, 42, 0.35)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      审核意见：{proj.reviewNote}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 4 }}>
                    <Link to={`/mod/${encodeURIComponent(proj.slug || proj.id)}`} className="btn btn-secondary btn-sm">
                      查看详情与版本
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
