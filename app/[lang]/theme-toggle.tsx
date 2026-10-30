'use client';

import { useLayoutEffect } from 'react';

/** The phone's status bar follows the app's theme, not only the phone's setting (the layout's theme-color metas, one per scheme). */
const statusBar = (theme: string) =>
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(m => { m.content = theme === 'dark' ? '#0A0A0A' : '#FBF7F0'; });

/** Flips light/dark and remembers it. Icons swap with CSS, so no React state is needed. */
export function ThemeToggle({ label }: { label: string }) {
  // Dev Strict Mode remounts can clear data-theme on <html>; put it back.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme ??= localStorage.getItem('theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    statusBar(document.documentElement.dataset.theme);
  }, []);
  const toggle = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    statusBar(next);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="hidden size-11 place-items-center [[data-theme]_&]:grid rounded-lg text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      {/* moon, shown in light mode */}
      <svg className="size-5 dark:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" strokeLinejoin="round" />
      </svg>
      {/* sun, shown in dark mode */}
      <svg className="hidden size-5 dark:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" />
      </svg>
    </button>
  );
}
