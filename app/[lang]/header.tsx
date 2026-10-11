import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Dict, Locale } from './dictionaries';
import { ThemeToggle } from './theme-toggle';
import { focus } from './ui';

/** Full-width top bar: brand, tabs (children), theme toggle, and this page in the other language. */
/** The same page in the other language keeps its month, person and view; a one-time note (?why=) is not carried along. */
export const withQuery = (path: string, sp: Record<string, string | string[] | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && k !== 'why') q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
};

export function Header({ t, lang, path, children }: { t: Dict; lang: Locale; path: string; children?: ReactNode }) {
  const other = lang === 'bn' ? 'en' : 'bn';
  return (
    <header className="border-b border-line md:sticky md:top-0 md:z-20 md:bg-paper">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
      <div className="flex items-center gap-8">
        <Link href={`/${lang}`} className={`flex min-h-11 items-center gap-2 font-display text-2xl font-bold ${focus}`}>
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
      </div>
    </header>
  );
}

