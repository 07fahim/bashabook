'use client';

import Link from 'next/link';
import { useEffect, useSyncExternalStore } from 'react';
import { FLAT_KEY, readFlat } from '@/lib/flat-memory';
import { link } from './ui';

/** Home keeps this flat on the phone each time it opens, so the current code and name are the ones kept. */
export function RememberFlat({ code, name }: { code: string; name: string }) {
  useEffect(() => { try { localStorage.setItem(FLAT_KEY, JSON.stringify({ code, name })); } catch { /* storage off: nothing kept */ } }, [code, name]);
  return null;
}

const still = () => () => {};
const kept = () => { try { return localStorage.getItem(FLAT_KEY); } catch { return null; } };

/** One tap back to the flat this phone opened last (its name list, then the PIN). Nothing on the server's first paint,
 *  nothing when nothing usable is kept. A code changed since then reaches the code-not-found page, which says what to do. */
export function BackToFlat({ lang, label, className }: { lang: string; label: string; className?: string }) {
  const flat = readFlat(useSyncExternalStore(still, kept, () => null));
  if (!flat) return null;
  return (
    <p className={className}>
      <Link href={`/${lang}/j/${flat.code}`} prefetch={false} className={`inline-flex min-h-11 items-center text-lg ${link}`}>{label.replace('{flat}', flat.name)}</Link>
    </p>
  );
}
