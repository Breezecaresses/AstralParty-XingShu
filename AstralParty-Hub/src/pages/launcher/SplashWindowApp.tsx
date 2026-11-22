import React, { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { LauncherStartupSplash } from './LauncherStartupSplash';
import { getStartupAnimEnabled, getStoredTheme } from './launcherTheme';
import './launcher-shell.css';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  );
}

export const SplashWindowApp: React.FC = () => {
  const theme = getStoredTheme();
  const isReplay =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('replay') === '1';
  const skipImmediate = !isReplay && (!getStartupAnimEnabled() || prefersReducedMotion());
  const finishedRef = useRef(false);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    invoke('finish_splash_and_show_main').catch(() => {});
  }, []);

  useEffect(() => {
    if (skipImmediate) {
      finish();
    }
  }, [skipImmediate, finish]);

  if (skipImmediate) {
    return null;
  }

  return (
    <div className="pcl-splash-standalone" data-pcl-theme={theme}>
      <LauncherStartupSplash active mode="floating" onComplete={finish} onSkip={finish} />
    </div>
  );
};

export default SplashWindowApp;
