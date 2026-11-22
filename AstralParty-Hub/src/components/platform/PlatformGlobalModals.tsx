import React, { useEffect } from 'react';
import { refreshPlatformAccount } from '../../shared/platformAccountClient';
import { CreateProjectModal } from './CreateProjectModal';
import { PlatformAuthModal } from './PlatformAuthModal';

export const PlatformGlobalModals: React.FC = () => {
  useEffect(() => {
    void refreshPlatformAccount();
  }, []);

  return (
    <>
      <PlatformAuthModal />
      <CreateProjectModal />
    </>
  );
};
