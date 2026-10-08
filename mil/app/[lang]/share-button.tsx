'use client';

import { useState } from 'react';
import { primary } from './ui';

/** Opens the phone's share sheet; copies the link where sharing isn't available. */
export function ShareButton({ path, label, copied }: { path: string; label: string; copied: string }) {
  const [done, setDone] = useState(false);
  const share = async () => {
    const url = location.origin + path;
    if (navigator.share) return navigator.share({ url }).catch(() => {});
    await navigator.clipboard.writeText(url);
    setDone(true);
  };
  return (
    <button type="button" onClick={share} className={`mt-5 ${primary}`}>
      {done ? copied : label}
    </button>
  );
}
