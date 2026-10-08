import type { Metadata, Viewport } from 'next';
import { Anek_Bangla, Hind_Siliguri } from 'next/font/google';
import { notFound } from 'next/navigation';
import { getDictionary, hasLocale, locales } from './dictionaries';
import '../globals.css';

const hind = Hind_Siliguri({ subsets: ['bengali', 'latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-hind' });
const anek = Anek_Bangla({ subsets: ['bengali', 'latin'], axes: ['wdth'], display: 'swap', variable: '--font-anek' });

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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FBF7F0' },
    { media: '(prefers-color-scheme: dark)', color: '#14130F' },
  ],
};

export default async function RootLayout({ children, params }: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return (
    <html lang={lang} className={`${hind.variable} ${anek.variable}`}>
      <body className="min-h-dvh bg-paper font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
