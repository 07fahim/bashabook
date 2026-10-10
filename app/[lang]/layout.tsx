import type { Metadata, Viewport } from 'next';
import { Hind_Siliguri } from 'next/font/google';
import { notFound } from 'next/navigation';
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
    icons: { icon: '/icon-192.png', apple: '/apple-icon.png' },
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
  if (!hasLocale(lang)) notFound();
  return (
    <html lang={lang} className={hind.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-paper font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
