'use client';

import { useEffect } from 'react';
import { noticesSeenAction } from '../actions';

/** Marks the notices seen once this page is really on screen, up to the newest one it shows (`upTo`): a link prefetch
 *  renders the page too, and must not clear the bell's count before anyone looked. A live redraw with a newer one marks
 *  again. */
export function SeenNow({ lang, upTo }: { lang: string; upTo: string | null }) {
  useEffect(() => { noticesSeenAction(lang, upTo).catch(() => {}); }, [lang, upTo]);
  return null;
}
