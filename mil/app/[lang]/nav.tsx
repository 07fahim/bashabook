import Link from 'next/link';
import type { Dict, Locale } from './dictionaries';
import { focus } from './ui';

type Tab = 'home' | 'meals' | 'manage';

/** Bottom tabs. The Flat tab is only for the person who runs the flat, for now. */
export function Nav({ t, lang, current, showFlat }: { t: Dict; lang: Locale; current: Tab; showFlat: boolean }) {
  const tabs: Tab[] = showFlat ? ['home', 'meals', 'manage'] : ['home', 'meals'];
  return (
    <nav aria-label={t.meals.nav} className="fixed inset-x-0 bottom-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-md gap-2 px-3 py-2">
        {tabs.map(tab => (
          <li key={tab} className="flex-1">
            <Link
              href={`/${lang}/${tab}`}
              aria-current={tab === current ? 'page' : undefined}
              className={`flex min-h-12 items-center justify-center font-semibold ${tab === current ? 'bg-turmeric text-on-turmeric' : 'text-muted hover:text-ink'} ${focus}`}
            >
              {t.meals.tabs[tab]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
