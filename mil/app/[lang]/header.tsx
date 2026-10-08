import Image from 'next/image';
import Link from 'next/link';
import type { Dict, Locale } from './dictionaries';
import { ThemeToggle } from './theme-toggle';
import { focus } from './ui';

/** Brand, theme toggle, and a link to this page in the other language. */
export function Header({ t, lang, path }: { t: Dict; lang: Locale; path: string }) {
  const other = lang === 'bn' ? 'en' : 'bn';
  return (
    <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
      <Link href={`/${lang}`} className={`flex items-center gap-2 font-display text-2xl font-bold ${focus}`}>
        <Image src="/logo-mark.png" alt="" width={31} height={32} priority />
        <span>
          {t.brand}
          <span className="text-turmeric-ink">{t.brandAccent}</span>
        </span>
      </Link>
      <div className="flex items-center gap-1">
        <ThemeToggle label={t.themeToggle} />
        <Link href={`/${other}${path}`} hrefLang={other} lang={other} className={`px-3 py-2 text-muted underline-offset-4 hover:underline ${focus}`}>
          {t.switchLang}
        </Link>
      </div>
    </header>
  );
}
