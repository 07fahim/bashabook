'use client';

import { useEffect, useState } from 'react';
import { removePushAction, savePushAction } from './actions';
import { link, secondary } from './ui';

type Copy = { on: string; turnOn: string; turnOff: string; hint: string; denied: string; unsupported: string; ios: string };
type State = 'loading' | 'unsupported' | 'ios' | 'denied' | 'off' | 'on' | 'busy';

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const toKey = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '=')), c => c.charCodeAt(0));

/** What this browser can do right now. iPhone in Safari (not installed) gets the Home Screen hint. */
async function detect(): Promise<State> {
  const ios = /iPhone|iPad/.test(navigator.userAgent) && !matchMedia('(display-mode: standalone)').matches;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !KEY) return ios ? 'ios' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await (await navigator.serviceWorker.getRegistration('/sw.js'))?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/** Reminders on this browser: one button, four states. iPhone needs the app on the Home Screen first. */
export function Reminders({ t }: { t: Copy }) {
  const [state, setState] = useState<State>('loading');
  useEffect(() => { detect().then(setState); }, []);
  const on = async () => {
    setState('busy');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      if (await Notification.requestPermission() !== 'granted') return setState('denied');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(KEY) });
      await savePushAction(sub.toJSON() as never);
      setState('on');
    } catch { setState('off'); }
  };
  const off = async () => {
    setState('busy');
    const sub = await (await navigator.serviceWorker.getRegistration('/sw.js'))?.pushManager.getSubscription();
    if (sub) { await removePushAction(sub.endpoint); await sub.unsubscribe(); }
    setState('off');
  };
  if (state === 'loading') return null;
  if (state === 'unsupported' || state === 'ios' || state === 'denied') return <p className="text-[15px] text-muted">{t[state]}</p>;
  if (state === 'on') return <p className="text-[15px]">{t.on} · <button type="button" onClick={off} className={`min-h-11 text-[15px] ${link}`}>{t.turnOff}</button></p>;
  return (
    <>
      <button type="button" onClick={on} disabled={state === 'busy'} className={`${secondary} sm:w-auto`}>{t.turnOn}</button>
      <p className="mt-2 text-[15px] text-muted">{t.hint}</p>
    </>
  );
}
