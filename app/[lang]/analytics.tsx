'use client';

import { usePathname } from 'next/navigation';
import Script from 'next/script';
import { useEffect, useRef } from 'react';
import { gaPath } from '@/lib/analytics';

declare global { interface Window { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void } }

/** Google Analytics 4, for the app team's own counts. Its own page views are off: each page view is sent from here with the
 *  join code hidden and no query string, and every later event (engagement, scrolls) reports that same cleaned address. */
export function Analytics({ id }: { id: string }) {
  const path = usePathname(), sent = useRef('');
  useEffect(() => {
    if (sent.current === path) return;   // once per address, also when React runs the effect twice
    sent.current = path;
    if (!window.gtag) {
      window.dataLayer ??= [];
      // gtag.js reads `arguments` objects from the queue, so this must stay a function, not an arrow
      window.gtag = function () { window.dataLayer!.push(arguments); };   // eslint-disable-line prefer-rest-params
      window.gtag('js', new Date());
      window.gtag('config', id, { send_page_view: false });
    }
    const page_location = location.origin + gaPath(path);
    window.gtag('set', { page_location });
    window.gtag('event', 'page_view', { page_location });   // gtag.js reads the title itself when it sends
  }, [id, path]);
  return <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" />;
}
