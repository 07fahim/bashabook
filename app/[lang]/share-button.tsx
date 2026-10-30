'use client';

import { useState } from 'react';
import { primary } from './ui';

/** Opens the phone's share sheet for a link (path, with `text` as the sentence before it) or a text; copies it where sharing
 *  isn't available. */
export function ShareButton({ path, text, label, copied }: { path?: string; text?: string; label: string; copied: string }) {
  const [done, setDone] = useState(false);
  const share = async () => {
    const url = path ? location.origin + path : undefined;
    if (navigator.share) return navigator.share({ text, url }).catch(() => {});
    await navigator.clipboard.writeText([text, url].filter(Boolean).join('\n'));
    setDone(true);
  };
  return (
    <button type="button" onClick={share} className={`mt-5 ${primary}`}>
      {done ? copied : label}
    </button>
  );
}
