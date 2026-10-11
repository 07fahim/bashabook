'use client';

import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { primary, secondary } from './ui';

// Shown instead of a page when it fails: the database is unreachable, the network dropped mid-save, or a bug. The text never
// promises nothing was saved: a money entry may have gone through before the reply was lost, so it says to check first.
const copy = {
  bn: {
    title: 'কিছু একটা গোলমাল হয়েছে',
    lead: 'পেজটা ঠিকমতো আসেনি। ইন্টারনেট ঠিক আছে কিনা দেখে আবার চেষ্টা করুন। কিছু সেভ করছিলেন? আবার লেখার আগে দেখে নিন সেটা সেভ হয়ে গেছে কিনা।',
    retry: 'আবার চেষ্টা করুন',
    home: 'হোমে যান',
  },
  en: {
    title: 'Something went wrong',
    lead: 'This page didn’t load properly. Check your internet and try again. Were you saving something? Before you enter it again, check whether it was saved.',
    retry: 'Try again',
    home: 'Go to Home',
  },
};

export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { lang } = useParams<{ lang: string }>();
  const c = lang === 'en' ? copy.en : copy.bn;
  useEffect(() => { console.error(error); }, [error]);   // the server logs it too, under the same digest
  return (
    <main className="mx-auto max-w-md px-5 pt-16 pb-28">
      <h1 className="font-display text-3xl font-bold">{c.title}</h1>
      <p className="mt-3 max-w-prose text-muted">{c.lead}</p>
      {/* the digest matches the server log line, if someone reports it */}
      {error.digest && <p className="mt-3 text-[15px] text-muted tabular-nums">#{error.digest}</p>}
      <div className="mt-6 flex flex-col gap-3">
        <button type="button" onClick={() => retry()} className={primary}>{c.retry}</button>
        {/* a full load, not a client navigation: the app may be in a bad state */}
        <a href={`/${lang === 'bn' ? 'bn' : 'en'}/home`} className={secondary}>{c.home}</a>
      </div>
    </main>
  );
}
