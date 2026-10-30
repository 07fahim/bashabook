import type { Metadata, Viewport } from 'next';
import { Hind_Siliguri } from 'next/font/google';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Analytics } from './analytics';
import { getDictionary, hasLocale, locales } from './dictionaries';
import '../globals.css';

// Runs before first paint: saved choice, else the phone's setting.
const themeScript = `try{document.documentElement.dataset.theme=localStorage.getItem('theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch(e){}`;

const hind = Hind_Siliguri({ subsets: ['bengali', 'latin'], weight: ['400', '600', '700'], display: 'swap', variable: '--font-hind' });

export function generateStaticParams() {
  return locales.map(lang => ({ lang }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const t = getDictionary(lang);
  return {
    title: t.metaTitle,
    description: t.metaDesc,
    icons: { icon: [{ url: '/favicon.ico', sizes: '48x48' }, { url: '/icon-192.png', sizes: '192x192', type: 'image/png' }], apple: '/apple-icon.png' },
    alternates: { languages: { bn: '/bn', en: '/en' } },
  };
}

export const viewport: Viewport = {
  // Android shrinks the page above the keyboard, so a focused field and its Save button can be scrolled to
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FBF7F0' },
    { media: '(prefers-color-scheme: dark)', color: '#0A0A0A' },
  ],
};

export default async function RootLayout({ children, params }: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  // an unknown language code falls back to English (Next's own 404 is an unstyled white page); any other unknown first part
  // (an icon a phone guesses at, a bot probe) stays a cheap 404
  if (!hasLocale(lang)) { if (/^[a-z]{2}(-[a-z]{2})?$/i.test(lang)) redirect('/en'); notFound(); }
  return (
    <html lang={lang} className={hind.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-paper font-sans text-ink antialiased">
        {children}
        {/* set only on Production in Vercel: previews and local runs send nothing */}
        {process.env.NEXT_PUBLIC_GA_ID && <Suspense fallback={null}><Analytics id={process.env.NEXT_PUBLIC_GA_ID} /></Suspense>}
      </body>
    </html>
  );
}
