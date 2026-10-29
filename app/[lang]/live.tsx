'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { busy, live, whenFree, type Field, type Sock } from '@/lib/live';

/** Keeps this page up to date while it is on screen (lib/live.ts). Hidden: the socket closes, so idle tabs hold none of
 *  Supabase's 200 connections. Back on screen: one refresh (changes may have happened meanwhile), then the socket again.
 *  Without the two settings (local runs) only the refresh on return works. */
export function Live({ topic }: { topic: string }) {
  const router = useRouter();
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, ''), key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const isBusy = () => busy(document.activeElement as Field | null, document.querySelectorAll('input, textarea') as unknown as Iterable<Field>);
    const refresh = () => router.refresh();
    let stop: (() => void) | undefined, back: (() => void) | undefined;
    const show = () => {
      if (url && key) stop = live({ url, key, topic, open: u => new WebSocket(u) as unknown as Sock, refresh, busy: isBusy });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { stop?.(); stop = undefined; back?.(); back = undefined; }
      else if (!stop) { back = whenFree(isBusy, refresh, 0); show(); }
    };
    if (document.visibilityState === 'visible') show();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); stop?.(); back?.(); };
  }, [topic, router]);
  return null;
}
