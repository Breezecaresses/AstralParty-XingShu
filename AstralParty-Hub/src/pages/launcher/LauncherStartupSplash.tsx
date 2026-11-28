import React, { useEffect, useRef, useState } from 'react';

function isZhLocale(): boolean {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('ui.locale') : null;
    if (saved === 'zh-CN') return true;
    if (saved === 'en-US') return false;
    return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');
  } catch {
    return true;
  }
}

export interface LauncherStartupSplashProps {
  active: boolean;
  mode?: 'floating' | 'overlay';
  onReveal?: () => void;
  onComplete: () => void;
  onSkip: () => void;
}

const STAGE_DISSOLVE_MS = 900;
const STAGE_COMPLETE_MS = 1220;

export const LauncherStartupSplash: React.FC<LauncherStartupSplashProps> = ({
  active,
  mode = 'floating',
  onReveal,
  onComplete,
  onSkip,
}) => {
  const zh = isZhLocale();
  const [phase, setPhase] = useState<'intro' | 'dissolving'>('intro');
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    finishedRef.current = false;
    setPhase('intro');

    const dissolveTimer = window.setTimeout(() => {
      setPhase('dissolving');
      onReveal?.();
    }, STAGE_DISSOLVE_MS);

    const completeTimer = window.setTimeout(() => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onComplete();
    }, STAGE_COMPLETE_MS);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === ' ') {
        event.preventDefault();
        if (finishedRef.current) return;
        finishedRef.current = true;
        onSkip();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.clearTimeout(dissolveTimer);
      window.clearTimeout(completeTimer);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [active, onReveal, onComplete, onSkip]);

  if (!active) return null;

  const triggerSkip = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onSkip();
  };

  return (
    <div
      className={`pcl-splash-overlay ${mode === 'floating' ? 'is-floating' : 'is-overlay'}${phase === 'dissolving' ? ' is-dissolving' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={zh ? '星枢启动器正在启动' : 'XingShu Launcher starting'}
      onClick={triggerSkip}
    >
      <div className="pcl-splash-stage">
        <div className="pcl-splash-emblem-wrap" aria-hidden="true">
          <svg
            className="pcl-splash-svg"
            viewBox="0 0 240 240"
            width="236"
            height="236"
            fill="none"
          >
            <defs>
              {/* Outer PCL-inspired metallic beveled hexagon gradient */}
              <linearGradient id="pcl-hex-bevel" x1="36" y1="24" x2="204" y2="216" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="var(--pcl-hex-bevel-top, #74c4ff)" />
                <stop offset="36%" stopColor="var(--pcl-hex-bevel-mid, #1c7ef6)" />
                <stop offset="100%" stopColor="var(--pcl-hex-bevel-bot, #0a46b8)" />
              </linearGradient>

              <linearGradient id="pcl-hex-bracket" x1="120" y1="21" x2="120" y2="55" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.92" />
                <stop offset="32%" stopColor="var(--pcl-hex-bevel-top, #74c4ff)" />
                <stop offset="100%" stopColor="var(--pcl-hex-bevel-mid, #1c7ef6)" />
              </linearGradient>

              {/* Recessed dark mechanical trench */}
              <linearGradient id="pcl-hex-trench" x1="52" y1="42" x2="188" y2="198" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="var(--pcl-hex-trench-top, #071e4b)" />
                <stop offset="100%" stopColor="var(--pcl-hex-trench-bot, #0d3278)" />
              </linearGradient>

              {/* Luminous inner hexagonal core */}
              <radialGradient id="pcl-hex-core" cx="44%" cy="30%" r="74%">
                <stop offset="0%" stopColor="var(--pcl-hex-core-top, #46a8ff)" />
                <stop offset="56%" stopColor="var(--pcl-hex-core-mid, #1370f3)" />
                <stop offset="100%" stopColor="var(--pcl-hex-core-bot, #0a49b8)" />
              </radialGradient>

              {/* Specular glass sheen bar */}
              <linearGradient id="pcl-hex-sheen" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="48%" stopColor="#ffffff" stopOpacity="0.34" />
                <stop offset="56%" stopColor="#ffffff" stopOpacity="0.48" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>

              {/* Warm astral-gold satellite orb */}
              <radialGradient id="pcl-hex-gold" cx="34%" cy="30%" r="72%">
                <stop offset="0%" stopColor="#fff4b8" />
                <stop offset="44%" stopColor="#ffd166" />
                <stop offset="100%" stopColor="#ff9924" />
              </radialGradient>

              {/* Star base fill */}
              <linearGradient id="pcl-hex-star-base" x1="82" y1="82" x2="158" y2="158" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#d4e8ff" />
              </linearGradient>

              {/* Subtle floating shadow for desktop wallpaper separation */}
              <filter id="pcl-hex-shadow" x="-22%" y="-22%" width="144%" height="144%">
                <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#05183c" floodOpacity="0.36" />
              </filter>

              <clipPath id="pcl-hex-core-clip">
                <path d="M120 49L181.49 84.5V155.5L120 191L58.51 155.5V84.5Z" />
              </clipPath>

              {/* Mask for XingShu star: forward launch chevron cutout + front-orbit 3D clearance */}
              <mask id="pcl-hex-star-mask">
                <rect width="240" height="240" fill="#ffffff" />
                <path d="M112.5 109L132 120L112.5 131L116.8 120Z" fill="#000000" />
                <g transform="rotate(-32 120 120)">
                  <path
                    d="M167.5 120A47.5 20 0 0 1 72.5 120L76.5 120A43.5 16.5 0 0 0 163.5 120Z"
                    fill="#000000"
                  />
                </g>
              </mask>

              {/* Mask for orbital ring breaks around satellite orb and counter-spark */}
              <mask id="pcl-hex-orbit-mask">
                <rect width="240" height="240" fill="#ffffff" />
                <circle cx="151.7" cy="92" r="8.8" fill="#000000" />
                <circle cx="88.3" cy="148" r="6.8" fill="#000000" />
              </mask>
            </defs>

            {/* Expanding hexagonal pulse ring */}
            <path
              className="pcl-hex-ripple"
              d="M120 24L203.14 72V168L120 216L36.86 168V72Z"
              stroke="var(--pcl-4)"
              strokeWidth="2.4"
            />

            {/* Floating hexagonal mechanical shield + XingShu emblem */}
            <g className="pcl-hex-float" filter="url(#pcl-hex-shadow)">
              <g className="pcl-hex-body">
                {/* Base chamfered outer hexagon */}
                <path
                  d="M120 30L197.94 75V165L120 210L42.06 165V75Z"
                  fill="url(#pcl-hex-bevel)"
                />
                <path
                  d="M120 31.4L196.7 75.7V164.3L120 208.6L43.3 164.3V75.7Z"
                  stroke="#ffffff"
                  strokeOpacity="0.45"
                  strokeWidth="1.2"
                />

                {[
                  { angle: 0, cls: 'pcl-hex-bracket-a' },
                  { angle: 120, cls: 'pcl-hex-bracket-b' },
                  { angle: 240, cls: 'pcl-hex-bracket-c' },
                ].map(({ angle, cls }) => (
                  <g key={angle} transform={`rotate(${angle} 120 120)`}>
                    <path
                      className={`pcl-hex-bracket ${cls}`}
                      d="M76 46.4L120 21L164 46.4L159.5 54.2L120 31.4L80.5 54.2Z"
                      fill="url(#pcl-hex-bracket)"
                      stroke="#0a275c"
                      strokeOpacity="0.42"
                      strokeWidth="1"
                      strokeLinejoin="round"
                    />
                  </g>
                ))}

                {/* Recessed dark mechanical trench */}
                <path
                  d="M120 41L188.42 80.5V159.5L120 199L51.58 159.5V80.5Z"
                  fill="url(#pcl-hex-trench)"
                />

                {/* Inner luminous hexagonal core plate */}
                <path
                  d="M120 49L181.49 84.5V155.5L120 191L58.51 155.5V84.5Z"
                  fill="url(#pcl-hex-core)"
                  stroke="#ffffff"
                  strokeOpacity="0.42"
                  strokeWidth="1.4"
                />

                {/* Inner astrolabe + XingShu star + diagonal glass sheen */}
                <g clipPath="url(#pcl-hex-core-clip)">
                  <circle
                    className="pcl-hex-compass"
                    cx="120"
                    cy="120"
                    r="46"
                    stroke="#ffffff"
                    strokeOpacity="0.24"
                    strokeWidth="1.2"
                    strokeDasharray="2 5.5"
                  />
                  <path
                    d="M120 69V74M120 166V171M69 120H74M166 120H171"
                    stroke="#ffffff"
                    strokeOpacity="0.32"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />

                  {/* Rear & front tilted orbital astrolabe arcs */}
                  <g mask="url(#pcl-hex-orbit-mask)">
                    <g transform="rotate(-32 120 120)">
                      <path
                        className="pcl-hex-orbit-rear"
                        d="M75 120A45 18.5 0 0 1 165 120"
                        pathLength={100}
                        stroke="#ffffff"
                        strokeOpacity="0.46"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                      />
                    </g>
                  </g>

                  {/* Faceted 4-point celestial white star */}
                  <g className="pcl-hex-star-group" mask="url(#pcl-hex-star-mask)">
                    <path
                      d="M120 77L129.5 110.5L163 120L129.5 129.5L120 163L110.5 129.5L77 120L110.5 110.5Z"
                      fill="url(#pcl-hex-star-base)"
                    />
                    <path d="M120 77L120 120L110.5 110.5Z" fill="#ffffff" />
                    <path d="M77 120L120 120L110.5 110.5Z" fill="#ffffff" />
                    <path d="M120 163L129.5 129.5L120 120Z" fill="#9bc7f8" fillOpacity="0.52" />
                    <path d="M163 120L129.5 129.5L120 120Z" fill="#b4d6fb" fillOpacity="0.42" />
                  </g>

                  {/* Front luminous orbital arc passing over lower-right star arm */}
                  <g mask="url(#pcl-hex-orbit-mask)">
                    <g transform="rotate(-32 120 120)">
                      <path
                        className="pcl-hex-orbit-front"
                        d="M165 120A45 18.5 0 0 1 75 120"
                        pathLength={100}
                        stroke="#ffffff"
                        strokeWidth="3.6"
                        strokeLinecap="round"
                      />
                    </g>
                  </g>

                  {/* Warm astral-gold satellite orb & counter spark */}
                  <g className="pcl-hex-orb-group">
                    <circle cx="151.7" cy="92" r="6.2" fill="url(#pcl-hex-gold)" />
                    <circle cx="149.8" cy="90.1" r="1.9" fill="#ffffff" fillOpacity="0.82" />
                  </g>
                  <path
                    className="pcl-hex-spark"
                    d="M88.3 142.2L89.9 146.4L94.1 148L89.9 149.6L88.3 153.8L86.7 149.6L82.5 148L86.7 146.4Z"
                    fill="#bfe2ff"
                  />

                  {/* Diagonal glass sheen sweep */}
                  <rect
                    className="pcl-hex-sheen-bar"
                    x="55"
                    y="20"
                    width="48"
                    height="200"
                    fill="url(#pcl-hex-sheen)"
                  />
                </g>
              </g>
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
};
