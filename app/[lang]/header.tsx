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

export function Header({ t, lang, path, notices, children }: { t: Dict; lang: Locale; path: string; notices?: number; children?: ReactNode }) {
  const other = lang === 'bn' ? 'en' : 'bn';
  const badge = notices === undefined ? null : notices > 9 ? '9+' : notices > 0 ? String(notices) : null;
  return (
    <header className="border-b border-line md:sticky md:top-0 md:z-20 md:bg-paper">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
      <div className="flex items-center gap-4 lg:gap-8">
        {/* under 375 px the name ran over the bell at full size: a smaller name and tighter controls there, so it stays */}
        <Link href={notices === undefined ? `/${lang}` : `/${lang}/home`} className={`flex min-h-11 items-center gap-2 font-display text-2xl font-bold max-[374px]:gap-1 max-[374px]:text-lg ${focus}`}>
          <Image src="/logo-mark.png" alt="" width={32} height={32} priority className="max-[374px]:size-7" />
          <span>
            {t.brand}
            <span className="text-turmeric-ink">{t.brandAccent}</span>
          </span>
        </Link>
        {children}
      </div>
      <div className="flex items-center gap-1 max-[374px]:gap-0">
        {notices !== undefined && (
          <Link
            href={`/${lang}/notices`}
            aria-label={badge ? t.notices.bellNew.replace('{n}', String(notices)) : t.notices.bell}
            title={t.notices.bell}
            className={`relative grid size-11 place-items-center rounded-lg text-muted hover:text-ink ${focus}`}
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 20a2 2 0 0 0 4 0" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {badge && <span aria-hidden="true" className="absolute top-1 right-1 min-w-4 rounded-full bg-chili px-1 text-center text-[11px] leading-4 font-bold text-paper">{badge}</span>}
          </Link>
        )}
        <ThemeToggle label={t.themeToggle} />
        <Link href={`/${other}${path}`} hrefLang={other} lang={other} className={`inline-flex min-h-11 min-w-11 items-center justify-center px-3 max-[374px]:px-1 text-muted underline-offset-4 hover:underline ${focus}`}>
          {t.switchLang}
        </Link>
      </div>
      </div>
    </header>
  );
}

