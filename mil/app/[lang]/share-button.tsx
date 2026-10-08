'use client';

import { useState } from 'react';
import { primary } from './ui';

/** Opens the phone's share sheet for a link (path) or a text; copies it where sharing isn't available. */
export function ShareButton({ path, text, label, copied }: { path?: string; text?: string; label: string; copied: string }) {
  const [done, setDone] = useState(false);
  const share = async () => {
    const value = path ? location.origin + path : text!;
    if (navigator.share) return navigator.share(path ? { url: value } : { text: value }).catch(() => {});
    await navigator.clipboard.writeText(value);
    setDone(true);
  };
  return (
    <button type="button" onClick={share} className={`mt-5 ${primary}`}>
      {done ? copied : label}
    </button>
  );
}
