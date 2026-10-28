'use client';

import { useEffect, useRef, useState } from 'react';
import { focus } from './ui';

const SIDE = 1280, MAX = 250_000;   // the long side in px; the server's limit in bytes (lib/photo.ts MAX_RECEIPT)

/** Picks a receipt photo and shrinks it on the phone: long side 1280 px, JPEG quality 0.7 (lower only if it would pass
 *  250 KB), nothing cropped, so a slow connection sends a small file. It waits in a hidden field until the form is saved;
 *  a cleared form (after a save) drops it. */
export function ReceiptPicker({ label, change, added, failed }: { label: string; change: string; added: string; failed: string }) {
  const file = useRef<HTMLInputElement>(null), out = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'none' | 'added' | 'failed'>('none');
  useEffect(() => {
    const form = out.current?.form, clear = () => { if (out.current) out.current.value = ''; setState('none'); };
    form?.addEventListener('reset', clear);   // a hidden field keeps its value through reset(): clear it by hand
    return () => form?.removeEventListener('reset', clear);
  }, []);
  const pick = (f: File | undefined) => {
    if (!f) return;
    const img = new window.Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const k = Math.min(1, SIDE / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);   // a transparent PNG would turn black as JPEG
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      if (!out.current) return;   // the form went away while the photo loaded
      // base64 is 4/3 of the bytes; a busy photo steps its quality down rather than being refused by the server
      let q = 0.7, s = c.toDataURL('image/jpeg', q);
      while ((s.length - 23) * 0.75 > MAX && q > 0.35) s = c.toDataURL('image/jpeg', (q -= 0.1));
      out.current.value = s;
      setState('added');
    };
    // a photo the phone can't open (some HEIC files): nothing is sent, and the line below says so
    img.onerror = () => { URL.revokeObjectURL(url); if (!out.current) return; out.current.value = ''; setState('failed'); };
    img.src = url;
  };
  return (
    <div>
      <input ref={out} type="hidden" name="receipt" />
      <input ref={file} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      <button type="button" onClick={() => file.current?.click()}
        className={`inline-flex min-h-11 items-center rounded-full border border-muted bg-surface px-4 font-semibold hover:bg-paper ${focus}`}>{state === 'added' ? change : label}</button>
      <p role="status" className={`text-[15px] font-semibold ${state === 'failed' ? 'mt-2 text-chili' : state === 'added' ? 'mt-2 text-leaf' : ''}`}>
        {state === 'added' ? added : state === 'failed' ? failed : ''}
      </p>
    </div>
  );
}
