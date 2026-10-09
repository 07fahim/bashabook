import Link from 'next/link';
import type { Dict, Locale } from './dictionaries';
import { focus } from './ui';

type Tab = 'home' | 'meals' | 'manage';

/** Bottom tabs on phones, tabs inside the header on wider screens. The Flat tab is only for the person who runs the flat. */
export function Nav({ t, lang, current, showFlat }: { t: Dict; lang: Locale; current: Tab; showFlat: boolean }) {
  const tabs: Tab[] = showFlat ? ['home', 'meals', 'manage'] : ['home', 'meals'];
  return (
    <nav aria-label={t.meals.nav} className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:static md:border-0 md:bg-transparent md:pb-0">
      <ul className="mx-auto flex max-w-md gap-2 px-3 py-2 md:gap-1 md:p-0">
        {tabs.map(tab => (
          <li key={tab} className="flex-1 md:flex-none">
            <Link
              href={`/${lang}/${tab}`}
              aria-current={tab === current ? 'page' : undefined}
              className={`flex min-h-12 items-center justify-center font-semibold md:rounded-none md:border-b-[3px] md:px-4 ${tab === current ? 'bg-turmeric text-on-turmeric md:border-turmeric-ink md:bg-transparent md:text-ink' : 'text-muted hover:text-ink md:border-transparent'} ${focus}`}
            >
              {t.meals.tabs[tab]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
