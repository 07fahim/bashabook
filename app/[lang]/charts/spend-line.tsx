'use client';
import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { pickDay } from '@/lib/charts';
import { focus } from '../ui';

export type Tip = { date: string; total: string; add: string | null };

/** The spend so far by day, a line climbing on ruled paper the way a khata page runs. Days after `upTo` stay blank and a
 *  dashed rule marks today while the month runs. Point, tap, drag sideways or use the arrow keys to read a day: its date, the
 *  total by then and what that day added. A vertical drag still scrolls the page. */
export function SpendLine({ values, upTo, running, label, tips }: { values: number[]; upTo: number; running: boolean; label: string; tips: Tip[] }) {
  const [at, setAt] = useState<number | null>(null);
  const fill = `spend${useId().replace(/\W/g, '')}`;
  const n = values.length, max = Math.max(...values.slice(0, upTo + 1), 1);
  const x = (i: number) => (i / (n - 1)) * 100, y = (v: number) => 38 - (v / max) * 34;
  const line = values.slice(0, upTo + 1).map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const i = at === null ? null : Math.min(at, upTo);   // a live refresh can shorten the drawn days
  const shown = i ?? upTo, top = (y(values[shown]) / 40) * 100, tip = tips[shown];
  const move = (e: PointerEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); setAt(pickDay((e.clientX - r.left) / r.width, n, upTo)); };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = ({ ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 } as Record<string, number>)[e.key];
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? upTo : step === undefined ? null : Math.max(0, Math.min(upTo, shown + step));
    if (to === null) return;
    e.preventDefault();
    setAt(to);
  };
  return (
    <div role="slider" tabIndex={0} aria-label={label} aria-valuemin={1} aria-valuemax={upTo + 1} aria-valuenow={shown + 1}
      aria-valuetext={[tip.date, tip.total, tip.add].filter(Boolean).join(', ')}
      className={`relative h-40 cursor-crosshair touch-pan-y select-none rounded-lg sm:h-48 ${focus}`}
      onBlur={() => setAt(null)} onFocus={() => setAt(a => a ?? upTo)} onKeyDown={key}
      onPointerDown={move} onPointerMove={move} onPointerLeave={e => { if (e.pointerType === 'mouse') setAt(null); }}>
      <svg aria-hidden="true" className="size-full text-turmeric" preserveAspectRatio="none" viewBox="0 0 100 40">
        <defs>
          <linearGradient id={fill} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.4" /><stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[4, 15.33, 26.67, 38].map(r => <line key={r} className="stroke-line" vectorEffect="non-scaling-stroke" x1="0" x2="100" y1={r} y2={r} />)}
        <polygon fill={`url(#${fill})`} points={`0,38 ${line} ${x(upTo)},38`} />
        <polyline className="stroke-turmeric" fill="none" points={line} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {running && <line className="stroke-ink" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" x1={x(upTo)} x2={x(upTo)} y1="2" y2="38" />}
      </svg>
      {i !== null && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-muted" style={{ left: `${x(i)}%` }} />}
      {/* the point at rest marks where the line ends, so the chart looks like something to touch */}
      <span aria-hidden="true" className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-turmeric shadow-card"
        style={{ left: `${x(shown)}%`, top: `${top}%` }} />
      {/* above the point when there is room (a finger sits below it), else below; sliding by its own width as the point moves
          right keeps it inside the card at both ends */}
      {i !== null && (
        <span aria-hidden="true" className="pointer-events-none absolute z-10 rounded-xl border border-line bg-surface px-3 py-1.5 text-[13px] whitespace-nowrap shadow-card"
          style={{ left: `${x(i)}%`, transform: `translateX(-${x(i)}%)`, ...(top > 50 ? { bottom: `calc(${100 - top}% + 14px)` } : { top: `calc(${top}% + 14px)` }) }}>
          <span className="block text-muted">{tip.date}</span>
          <span className="block text-[15px] font-bold tabular-nums">{tip.total}</span>
          {tip.add && <span className="block text-muted tabular-nums">{tip.add}</span>}
        </span>)}
    </div>
  );
}
