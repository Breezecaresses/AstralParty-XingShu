import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LogIn, UserPlus, X } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { useLauncherTheme } from '../../pages/launcher/launcherTheme';
import { isTauriRuntime } from '../../shared/runtime';
import {
  closePlatformAuthModal,
  loginPlatformAccount,
  openPlatformAuthModal,
  registerPlatformAccount,
  usePlatformAccount,
} from '../../shared/platformAccountClient';
import './platform-account.css';

export const PlatformAuthModal: React.FC = () => {
  const { locale } = useTranslation();
  const zh = locale === 'zh-CN';
  const { authModalMode } = usePlatformAccount();
  const { theme } = useLauncherTheme();
  const isDesktop = isTauriRuntime();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authModalMode) return;
    setError('');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePlatformAuthModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authModalMode]);

  if (!authModalMode) return null;
  const isRegister = authModalMode === 'register';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (isRegister) {
        await registerPlatformAccount({
          username: username.trim(),
          displayName: displayName.trim() || username.trim(),
          email: email.trim(),
          password,
        });
      } else {
        await loginPlatformAccount({
          username: username.trim(),
          password,
        });
      }
      setPassword('');
      closePlatformAuthModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className={`xp-scope ${isDesktop ? 'is-desktop' : ''}`} data-pcl-theme={isDesktop ? theme : undefined}>
      <div className="xp-modal-backdrop" onClick={closePlatformAuthModal}>
        <div
          className="xp-modal"
          role="dialog"
          aria-modal="true"
          aria-label={zh ? '星枢平台账号登录与注册' : 'XingShu Platform Account Sign In'}
          onClick={(e) => e.stopPropagation()}
        >
          <header className="xp-modal-head">
            <div>
              <h2>{zh ? '星枢平台账号' : 'XingShu Platform Account'}</h2>
              <p className="xp-modal-sub">
                {zh
                  ? '全端通用的星枢社区身份：用于发布 Mod、同步收藏与绑定游戏账号'
                  : 'Unified XingShu identity for publishing mods, syncing collections, and linking game UIDs'}
              </p>
            </div>
            <button
              type="button"
              className="xp-close-btn"
              onClick={closePlatformAuthModal}
              aria-label={zh ? '关闭' : 'Close'}
            >
              <X size={16} />
            </button>
          </header>

          <div className="xp-seg-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={!isRegister}
              className={!isRegister ? 'is-active' : ''}
              onClick={() => openPlatformAuthModal('login')}
            >
              {zh ? '登录已有账号' : 'Sign In'}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isRegister}
              className={isRegister ? 'is-active' : ''}
              onClick={() => openPlatformAuthModal('register')}
            >
              {zh ? '注册新账号' : 'Create Account'}
            </button>
          </div>

          <form className="xp-form" onSubmit={(e) => void handleSubmit(e)}>
            {error && <div className="xp-alert-err">{error}</div>}

            <div className="xp-field">
              <label htmlFor="xp-auth-username">
                {isRegister
                  ? zh
                    ? '用户名 *'
                    : 'Username *'
                  : zh
                  ? '用户名或邮箱 *'
                  : 'Username or Email *'}
              </label>
              <input
                id="xp-auth-username"
                type="text"
                required
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={isRegister ? 'xingshu_creator' : zh ? '输入星枢用户名或邮箱…' : 'Enter username or email…'}
              />
              {isRegister && (
                <small>{zh ? '3~24 位字母、数字、下划线、点或连字符。' : '3–24 chars: letters, digits, _, ., -'}</small>
              )}
            </div>

            {isRegister && (
              <div className="xp-grid-2">
                <div className="xp-field">
                  <label htmlFor="xp-auth-display">{zh ? '显示昵称' : 'Display Name'}</label>
                  <input
                    id="xp-auth-display"
                    type="text"
                    maxLength={32}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={zh ? '例如：星枢旅人' : 'Display name'}
                  />
                </div>
                <div className="xp-field">
                  <label htmlFor="xp-auth-email">{zh ? '邮箱 (可选)' : 'Email (optional)'}</label>
                  <input
                    id="xp-auth-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                  />
                </div>
              </div>
            )}

            <div className="xp-field">
              <label htmlFor="xp-auth-password">{zh ? '密码 *' : 'Password *'}</label>
              <input
                id="xp-auth-password"
                type="password"
                required
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={zh ? '至少 8 位密码…' : 'At least 8 characters…'}
              />
            </div>

            <footer className="xp-modal-foot">
              <button type="button" className="xp-btn-secondary" onClick={closePlatformAuthModal}>
                {zh ? '取消' : 'Cancel'}
              </button>
              <button type="submit" className="xp-btn-primary" disabled={busy}>
                {isRegister ? <UserPlus size={15} /> : <LogIn size={15} />}
                <span>
                  {busy
                    ? zh
                      ? '处理中…'
                      : 'Submitting…'
                    : isRegister
                    ? zh
                      ? '创建星枢账号'
                      : 'Create Account'
                    : zh
                    ? '立即登录'
                    : 'Sign In'}
                </span>
              </button>
            </footer>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
};
