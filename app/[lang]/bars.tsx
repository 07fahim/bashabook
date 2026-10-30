import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { focus } from './ui';

/** Charts drawn by the app: SVG and CSS only, no script, colours from the theme tokens. Values are poisha or hundredths of a
 *  meal; the caller formats them. A zero maximum draws nothing and never divides by zero. The words beside each chart already
 *  say everything, so the drawn parts are decorative. Each card gets the form its numbers need: bars to compare people, a
 *  grid for days, steps for a balance, a line for a rate over months. */
const pct = (v: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);

export type HRow = { key: string; label: ReactNode; text: string; value: number; valueText?: string; tail?: number; strong?: boolean };

/** One slim bar per row: label, bar, value. `tail` draws a second part after the bar (bills); `mark` a dashed rule through every
 *  row at one value (the average), so whoever sits far from it stands out. */
export function HBars({ rows, fmt, tailColor = 'fill-line', mark }: { rows: HRow[]; fmt: (v: number) => string; tailColor?: string; mark?: number }) {
  const max = Math.max(...rows.map(r => r.value + (r.tail ?? 0)), 0);
  return (
    <ul className="space-y-3">
      {rows.map(r => (
        <li key={r.key} className={`grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 ${r.strong ? 'font-semibold' : ''}`}>
          <span className="truncate" title={r.text}>{r.label}</span>
          <svg aria-hidden="true" className="h-5 w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 6">
            <rect className="fill-turmeric" height="2" rx="1" width={pct(r.value, max)} y="2" />
            {r.tail ? <rect className={tailColor} height="2" rx="1" width={pct(r.tail, max)} x={pct(r.value, max)} y="2" /> : null}
            {mark !== undefined && <line className="stroke-ink" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" x1={pct(mark, max)} x2={pct(mark, max)} y1="-2" y2="8" />}
          </svg>
          <span className="tabular-nums">{r.valueText ?? fmt(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export type Cell = { plates: number; guests: number } | null;

/** A month of one person's meals: a row of day squares per meal. Filled: ate; filled with a dot: guests too; an outline: didn't
 *  eat; nothing: not living here yet, or a day still to come. `n` is the month's length, so a running month leaves room. */
export function MealGrid({ rows, n, legend }: { rows: { key: string; label: string; total: string; cells: Cell[] }[]; n: number; legend: [string, string, string] }) {
  const cols: CSSProperties = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };
  const square = 'block aspect-square rounded-[3px]';
  return (
    <div>
      <ul className="space-y-4">
        {rows.map(r => (
          <li key={r.key}>
            <p className="flex justify-between gap-3"><span>{r.label}</span><span className="font-semibold tabular-nums">{r.total}</span></p>
            <div aria-hidden="true" className="mt-1.5 grid gap-[2px] sm:gap-1" style={cols}>
              {Array.from({ length: n }, (_, i) => {
                const c = r.cells[i] ?? null;
                if (!c) return <span key={i} className={square} />;
                if (!c.plates) return <span key={i} className={`${square} border border-muted`} />;
                return <span key={i} className={`${square} relative bg-turmeric`}>{c.guests > 0 && <span className="absolute inset-[30%] rounded-full bg-ink" />}</span>;
              })}
            </div>
          </li>))}
      </ul>
      <div aria-hidden="true" className="mt-1.5 grid text-[13px] text-muted tabular-nums" style={cols}>
        {[1, 8, 15, 22, 29].filter(d => d <= n).map(d => <span key={d} className="whitespace-nowrap" style={{ gridColumnStart: d }}>{d}</span>)}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
        <li className="flex items-center gap-2"><span aria-hidden="true" className="size-3 rounded-[3px] bg-turmeric" />{legend[0]}</li>
        <li className="flex items-center gap-2"><span aria-hidden="true" className="relative size-3 rounded-[3px] bg-turmeric"><span className="absolute inset-[30%] rounded-full bg-ink" /></span>{legend[2]}</li>
        <li className="flex items-center gap-2"><span aria-hidden="true" className="size-3 rounded-[3px] border border-muted" />{legend[1]}</li>
      </ul>
    </div>
  );
}

export type MonthCol = { key: string; label: string; aria: string; href: string; rate: number; rateText: string; spend: number; spendText: string };

/** Closed months side by side, each a link to its own charts: the meal rate as a line in its own band on top (its own scale,
 *  so a small change still shows), the flat's spend as slim bars from zero below. Phones show the latest four. */
export function Months({ cols }: { cols: MonthCol[] }) {
  const lo = Math.min(...cols.map(c => c.rate)), hi = Math.max(...cols.map(c => c.rate)), max = Math.max(...cols.map(c => c.spend), 0);
  const y = (r: number) => (hi > lo ? 82 - ((r - lo) / (hi - lo)) * 64 : 50);   // percent from the band's top, a margin each side
  return (
    <ol className="flex">
      {cols.map((c, i) => {
        const prev = cols[i - 1], next = cols[i + 1];
        return (
          <li key={c.key} className={`${i < cols.length - 4 ? 'hidden sm:block' : ''} min-w-0 flex-1`}>
            <Link aria-label={c.aria} className={`group block rounded-2xl py-2 hover:bg-paper ${focus}`} href={c.href}>
              {/* the line runs edge to edge: each month draws its half of the way to each neighbour, meeting at the column edge */}
              <span aria-hidden="true" className="relative block h-16">
                <svg className="absolute inset-0 size-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 100">
                  {prev && <line className="stroke-ink" strokeWidth="1.5" vectorEffect="non-scaling-stroke" x1="0" x2="50" y1={(y(prev.rate) + y(c.rate)) / 2} y2={y(c.rate)} />}
                  {next && <line className="stroke-ink" strokeWidth="1.5" vectorEffect="non-scaling-stroke" x1="50" x2="100" y1={y(c.rate)} y2={(y(c.rate) + y(next.rate)) / 2} />}
                </svg>
                <span className="absolute left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink group-hover:border-paper" style={{ top: `${y(c.rate)}%` }} />
                <span className="absolute left-1/2 -translate-x-1/2 text-[13px] whitespace-nowrap tabular-nums" style={y(c.rate) > 50 ? { bottom: `calc(${100 - y(c.rate)}% + 8px)` } : { top: `calc(${y(c.rate)}% + 8px)` }}>{c.rateText}</span>
              </span>
              {/* the bar has a box of its own, so its amount above never squeezes it out of proportion */}
              <span aria-hidden="true" className="mt-3 flex flex-col items-center gap-1">
                <span className="text-[13px] whitespace-nowrap tabular-nums">{c.spendText}</span>
                <span className="flex h-24 w-full items-end justify-center">
                  <span className="w-3 rounded-t-[3px] bg-turmeric sm:w-4" style={{ height: `${Math.max(pct(c.spend, max), 2)}%` }} />
                </span>
              </span>
              <span aria-hidden="true" className="mt-2 block text-center text-[13px] font-semibold text-muted group-hover:text-ink">{c.label}</span>
            </Link>
          </li>);
      })}
    </ol>
  );
}

export type Step = { key: string; label: string; value: number; from: number; to: number };

/** A balance built step by step: each bar starts where the one before ended (money for you to the right in leaf, against you
 *  to the left in chili), and the last row is where it lands. A rule marks zero. Amounts are exact, signed the plain way. */
export function Waterfall({ steps, fmt, total }: { steps: Step[]; fmt: (v: number) => string; total: { label: string; value: number; text: string; tone: string } }) {
  const ends = [0, ...steps.flatMap(s => [s.from, s.to])];
  const lo = Math.min(...ends), span = Math.max(...ends) - lo;
  const x = (v: number) => (span > 0 ? ((v - lo) / span) * 100 : 0);
  const bar = (from: number, to: number, color: string) => (
    <span aria-hidden="true" className="relative order-last col-span-2 block h-5 sm:order-none sm:col-span-1">
      <span className="absolute inset-y-0 w-px bg-line" style={{ left: `${x(0)}%` }} />
      <span className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[3px] ${color}`} style={{ left: `${x(Math.min(from, to))}%`, width: `max(${Math.abs(x(to) - x(from))}%, 3px)` }} />
    </span>);
  const row = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[minmax(0,9rem)_1fr_auto]';
  return (
    <dl className="divide-y divide-line text-[15px]">
      {steps.map(s => (
        <div key={s.key} className={row}>
          <dt>{s.label}</dt>{bar(s.from, s.to, s.value >= 0 ? 'bg-leaf' : 'bg-chili')}
          <dd className="whitespace-nowrap tabular-nums">{s.value > 0 ? '+' : ''}{fmt(s.value)}</dd>
        </div>))}
      <div className={`${row} font-semibold ${total.tone}`}>
        <dt>{total.label}</dt>{bar(0, total.value, total.value > 0 ? 'bg-leaf' : total.value < 0 ? 'bg-chili' : 'bg-muted')}
        <dd className="whitespace-nowrap tabular-nums">{total.text}</dd>
      </div>
    </dl>
  );
}

export type Pop = { key: string; label: ReactNode; text: string; initial: string; value: number; tail?: number; valueText: string; strong?: boolean };

/** People as lollipops: a thin stem to their count, a disc with their initial at its end, guests as a dotted stem beyond it.
 *  Lighter than bars, and it reads as people. Mine is the ink disc. */
export function Lollipops({ rows }: { rows: Pop[] }) {
  const max = Math.max(...rows.map(r => r.value + (r.tail ?? 0)), 0);
  return (
    <ul className="space-y-2">
      {rows.map(r => (
        <li key={r.key} className={`grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 ${r.strong ? 'font-semibold' : ''}`}>
          <span className="truncate" title={r.text}>{r.label}</span>
          {/* the track stops a disc's half short, so a full stem's disc never spills over the number */}
          <span aria-hidden="true" className="relative mr-3.5 ml-3.5 block h-7">
            <span className="absolute top-1/2 -left-3.5 h-0.5 -translate-y-1/2 bg-turmeric" style={{ width: `calc(${pct(r.value, max)}% + 0.875rem)` }} />
            {r.tail ? <span className="absolute top-1/2 h-0 -translate-y-1/2 border-t-2 border-dotted border-muted" style={{ left: `${pct(r.value, max)}%`, width: `${pct(r.tail, max)}%` }} /> : null}
            <span className={`absolute top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[13px] font-bold ${r.strong ? 'bg-ink text-paper' : 'bg-turmeric text-on-turmeric'}`}
              style={{ left: `${pct(r.value, max)}%` }}>{r.initial}</span>
          </span>
          <span className="tabular-nums">{r.valueText}</span>
        </li>
      ))}
    </ul>
  );
}
