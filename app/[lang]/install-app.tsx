'use client';

import { useState, useSyncExternalStore } from 'react';
import { apple, secondary } from './ui';

type Prompt = Event & { prompt: () => Promise<void> };
declare global { interface Window { bip?: Prompt | null } }

// the layout's head script keeps the browser's latest offer in window.bip (it may come before this page is ready) and
// drops it once installed; its listeners run before these, so the snapshot is already new when React reads it
const watch = (changed: () => void) => {
  addEventListener('beforeinstallprompt', changed); addEventListener('appinstalled', changed);
  return () => { removeEventListener('beforeinstallprompt', changed); removeEventListener('appinstalled', changed); };
};
const still = () => () => {};
const installed = () => matchMedia('(display-mode: standalone)').matches || !!(navigator as { standalone?: boolean }).standalone;

/** Install the app, shown only when the browser can install it right now (Chrome's own popup comes and goes by its own
 *  rules; this button stays). iPhone has no install popup at all, so it gets the Share steps. Nothing once installed. */
export function InstallApp({ t, className }: { t: { button: string; lead: string; ios: string }; className?: string }) {
  const offer = useSyncExternalStore(watch, () => window.bip ?? null, () => null);
  const ios = useSyncExternalStore(still, () => apple() && !installed(), () => false);
  // an offer works once: if it is turned down the browser makes a new one later and the button comes back with it
  const [used, setUsed] = useState<Prompt | null>(null);
  const ready = offer && offer !== used && !installed() ? offer : null;
  // cleared for the whole tab too: another page's button must not offer it again
  const install = () => { window.bip = null; setUsed(ready); ready?.prompt().catch(() => {}); };
  if (ready) return (
    <div className={className}>
      <button type="button" onClick={install} className={`${secondary} sm:w-auto`}>{t.button}</button>
      <p className="mt-2 text-[15px] text-muted">{t.lead}</p>
    </div>
  );
  return ios ? <p className={`text-[15px] text-muted ${className ?? ''}`}>{t.ios}</p> : null;
}
