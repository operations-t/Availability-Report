'use client';

import { useEffect } from 'react';

export default function DashboardBoot({ runtimeConfig }) {
  useEffect(() => {
    window.__CKP_RUNTIME_CONFIG__ = runtimeConfig;
    // React Strict Mode can run effects twice in local development. Guard the
    // legacy browser module so it is attached exactly once.
    if (window.__CKP_SCRIPT_ATTACHED__) return;
    window.__CKP_SCRIPT_ATTACHED__ = true;
    const script = document.createElement('script');
    script.type = 'module';
    script.src = `${runtimeConfig.basePath || ''}/js/app.js`;
    script.dataset.ckpDashboard = 'true';
    script.onerror = () => {
      window.__CKP_SCRIPT_ATTACHED__ = false;
      console.error('Failed to load dashboard browser module:', script.src);
    };
    document.body.appendChild(script);
  }, [runtimeConfig]);
  return null;
}
