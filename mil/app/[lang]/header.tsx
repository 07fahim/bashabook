import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Dict, Locale } from './dictionaries';
import { ThemeToggle } from './theme-toggle';
import { focus } from './ui';

/** Brand, theme toggle, and a link to this page in the other language.
 *  With tabs (children) it becomes a side menu on wider screens. */
export function Header({ t, lang, path, children }: { t: Dict; lang: Locale; path: string; children?: ReactNode }) {
  const other = lang === 'bn' ? 'en' : 'bn';
  const side = children
    ? 'md:fixed md:inset-y-0 md:left-0 md:w-60 md:flex-col md:items-stretch md:border-r md:border-line md:bg-surface md:py-8'
    : '';
  return (
    <header className={`mx-auto flex max-w-5xl items-center justify-between px-5 py-5 ${side}`}>
      <div className={children ? 'md:flex md:flex-col md:gap-8' : ''}>
        <Link href={`/${lang}`} className={`flex items-center gap-2 font-display text-2xl font-bold ${focus}`}>
          <Image src="/logo-mark.png" alt="" width={31} height={32} priority />
          <span>
            {t.brand}
            <span className="text-turmeric-ink">{t.brandAccent}</span>
          </span>
        </Link>
        {children}
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle label={t.themeToggle} />
        <Link href={`/${other}${path}`} hrefLang={other} lang={other} className={`inline-flex min-h-11 items-center px-3 text-muted underline-offset-4 hover:underline ${focus}`}>
          {t.switchLang}
        </Link>
      </div>
    </header>
  );
}

