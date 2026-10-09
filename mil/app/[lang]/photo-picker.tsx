'use client';

import { useRef } from 'react';
import { focus } from './ui';

/** Picks a photo, crops it to a small square on the phone (192 px JPEG, about 10 KB) and sends that, so uploads are tiny
 *  on slow connections and the server never stores a full camera photo. */
export function PhotoPicker({ label }: { label: string }) {
  const file = useRef<HTMLInputElement>(null), out = useRef<HTMLInputElement>(null);
  const pick = (f: File | undefined) => {
    if (!f) return;
    const img = new window.Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas');
      c.width = c.height = 192;
      c.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 192, 192);
      URL.revokeObjectURL(url);
      out.current!.value = c.toDataURL('image/jpeg', 0.82);
      out.current!.form!.requestSubmit();
    };
    img.src = url;
  };
  return (
    <>
      <input ref={out} type="hidden" name="photo" />
      <input ref={file} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={e => pick(e.target.files?.[0])} />
      <button type="button" onClick={() => file.current?.click()}
        className={`inline-flex min-h-11 items-center rounded-full border border-muted bg-surface px-4 font-semibold hover:bg-paper ${focus}`}>{label}</button>
    </>
  );
}
