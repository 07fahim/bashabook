import { staticFile } from 'remotion';
import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill } from 'remotion';

/** Paper background, content centred, the product UI shown at 1.3× so 16 px type reads at 1080p. */
export function Stage({ children, style, scale = 1.3, top }: { children: ReactNode; style?: CSSProperties; scale?: number; top?: boolean }) {
  // `top`: a page screen hangs from the top like a browser window; a lone card sits in the middle
  return (
    <AbsoluteFill className="bg-paper text-ink font-sans antialiased" style={{ justifyContent: top ? 'flex-start' : 'center', alignItems: 'center', paddingTop: top ? 90 : 0 }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: top ? 'top center' : 'center', ...style }}>{children}</div>
    </AbsoluteFill>
  );
}

/** The app's top bar: logo mark, brand, tabs. `current` gets the turmeric pill, exactly as nav.tsx does. */
export function TopBar({ brand, accent, tabs, current }: { brand: string; accent: string; tabs: string[]; current: number }) {
  return (
    <header className="border-b border-line">
      <div className="flex items-center gap-8 px-8 py-4">
        <span className="flex items-center gap-2 font-display text-2xl font-bold">
          <img src={staticFile('logo-mark.png')} alt="" width={31} height={32} />
          <span>{brand}<span className="text-turmeric-ink">{accent}</span></span>
        </span>
        <ul className="flex gap-1">
          {tabs.map((tab, i) => (
            <li key={tab} className={`flex min-h-11 items-center justify-center rounded-full px-5 font-semibold ${i === current ? 'bg-turmeric text-on-turmeric' : 'text-muted'}`}>{tab}</li>
          ))}
        </ul>
      </div>
    </header>
  );
}
