'use client';

import { useParams } from 'next/navigation';
import { primary } from './ui';

// A mistyped or outdated address under /bn or /en. Like error.tsx, it reads the language from the URL, since a not-found
// page gets no params.
const copy = {
  bn: { title: 'এই পেজটা নেই', lead: 'ঠিকানাটা ভুল, বা পেজটা আর নেই। হোম থেকে আবার শুরু করুন।', home: 'হোমে যান' },
  en: { title: 'This page doesn’t exist', lead: 'The address is wrong, or the page is gone. Start again from Home.', home: 'Go to Home' },
};

export default function NotFound() {
  const { lang } = useParams<{ lang: string }>();
  const en = lang === 'en', c = en ? copy.en : copy.bn;
  return (
    <main className="mx-auto max-w-md px-5 pt-16 pb-28">
      <h1 className="font-display text-3xl font-bold">{c.title}</h1>
      <p className="mt-3 max-w-prose text-muted">{c.lead}</p>
      <a href={`/${en ? 'en' : 'bn'}/home`} className={`mt-6 ${primary}`}>{c.home}</a>
    </main>
  );
}
