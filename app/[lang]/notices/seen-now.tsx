'use client';

import { useEffect } from 'react';
import { noticesSeenAction } from '../actions';

/** Marks the notices seen once this page is really on screen: a link prefetch renders the page too, and must not clear
 *  the bell's count before anyone looked. */
export function SeenNow({ lang }: { lang: string }) {
  useEffect(() => { noticesSeenAction(lang).catch(() => {}); }, [lang]);
  return null;
}
