'use client';

import { useEffect } from 'react';

// The last resort when the layout itself fails: it renders its own document, without the app's styles or theme, so it keeps
// to plain inline styles, follows the phone's light or dark setting, and says it in both languages.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', colorScheme: 'light dark' }}>
        <main style={{ maxWidth: 28 * 16, margin: '0 auto', padding: '64px 20px', lineHeight: 1.5 }}>
          <h1 style={{ fontSize: 28, margin: 0 }}>Something went wrong</h1>
          <p>The app didn’t load properly. Check your internet and try again. If you were saving something check whether it was saved before you enter it again.</p>
          <h2 style={{ fontSize: 20, marginBottom: 0 }} lang="bn">কিছু একটা গোলমাল হয়েছে</h2>
          <p lang="bn">অ্যাপটা ঠিকমতো আসেনি। ইন্টারনেট দেখে আবার চেষ্টা করুন। কিছু সেভ করছিলেন? আবার লেখার আগে দেখে নিন সেটা সেভ হয়েছে কিনা।</p>
          {error.digest && <p style={{ opacity: 0.7 }}>#{error.digest}</p>}
          <button type="button" onClick={() => retry()}
            style={{ minHeight: 48, width: '100%', borderRadius: 999, border: 0, background: '#D9901A', color: '#1C1A16', fontSize: 16, fontWeight: 600 }}>
            Try again · আবার চেষ্টা করুন
          </button>
        </main>
      </body>
    </html>
  );
}
