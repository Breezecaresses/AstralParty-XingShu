import React, { useEffect, useState } from 'react';
import { platformAvatarUrl } from '../../shared/platformAccountClient';

interface PlatformUserAvatarProps {
  name: string;
  avatarUrl?: string | null;
  avatarColor?: string | null;
  size?: number;
  fontSize?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const PlatformUserAvatar: React.FC<PlatformUserAvatarProps> = ({
  name,
  avatarUrl,
  avatarColor,
  size = 32,
  fontSize,
  className = '',
  style,
}) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);

  const resolvedUrl = avatarUrl ? platformAvatarUrl(avatarUrl) : '';
  const initial = (name || 'X').trim().slice(0, 1).toUpperCase() || 'X';
  const computedFont = fontSize ?? Math.max(10, Math.round(size * 0.42));

  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'inline-grid',
        placeItems: 'center',
        overflow: 'hidden',
        flexShrink: 0,
        background: avatarColor || '#2f7cf6',
        color: '#ffffff',
        fontSize: computedFont,
        fontWeight: 800,
        userSelect: 'none',
        ...style,
      }}
    >
      {resolvedUrl && !failed ? (
        <img
          src={resolvedUrl}
          alt={name}
          onError={() => setFailed(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        initial
      )}
    </span>
  );
};
