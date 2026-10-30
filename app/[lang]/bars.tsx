import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { focus } from './ui';

/** Charts drawn by the app: SVG and CSS only, no script, colours from the theme tokens. Values are poisha or hundredths of a
 *  meal; the caller formats them. A zero maximum draws nothing and never divides by zero. The words beside each chart already
 *  say everything, so the drawn parts are decorative. Each card gets the form its numbers need: bars to compare people, a
 *  grid for days, two bars for a balance, a table for months. */
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

export type Cell = { own: number; guests: number } | null;

/** A month of one person's meals: a row of day squares per meal. Filled: I ate; an outline: I didn't; a dot: guests ate that
 *  meal; nothing: not living here yet, or a day still to come. `n` is the month's length, so a running month leaves room.
 *  Legend in the order shown: ate, guests, didn't eat, guests only (shown when the month has one). */
export function MealGrid({ rows, n, legend }: { rows: { key: string; label: string; total: string; note: string; cells: Cell[] }[]; n: number; legend: [string, string, string, string] }) {
  const cols: CSSProperties = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };
  const square = 'relative block aspect-square rounded-[3px] border';
  const ate = `${square} border-turmeric-ink bg-turmeric`, skipped = `${square} border-muted`;
  const dot = (on: boolean) => <span className={`absolute inset-[28%] rounded-full ${on ? 'bg-on-turmeric' : 'bg-ink'}`} />;
  return (
    <div>
      <ul className="space-y-4">
        {rows.map(r => (
          <li key={r.key}>
            <p className="flex justify-between gap-3"><span>{r.label}</span><span className="font-semibold tabular-nums">{r.total}</span></p>
            {r.note && <p className="text-[13px] text-muted tabular-nums">{r.note}</p>}
            <div aria-hidden="true" className="mt-1.5 grid gap-[2px] sm:gap-1" style={cols}>
              {Array.from({ length: n }, (_, i) => {
                const c = r.cells[i] ?? null;
                if (!c) return <span key={i} className={`${square} border-transparent`} />;
                return <span key={i} className={c.own ? ate : skipped}>{c.guests > 0 && dot(c.own > 0)}</span>;
              })}
            </div>
          </li>))}
      </ul>
      <div aria-hidden="true" className="mt-1.5 grid text-[13px] text-muted tabular-nums" style={cols}>
        {[1, 8, 15, 22, 29].filter(d => d <= n).map(d => <span key={d} className="whitespace-nowrap" style={{ gridColumnStart: d }}>{d}</span>)}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
        <li className="flex items-center gap-2"><span aria-hidden="true" className={`${ate} size-3`} />{legend[0]}</li>
        <li className="flex items-center gap-2"><span aria-hidden="true" className={`${ate} size-3`}>{dot(true)}</span>{legend[1]}</li>
        <li className="flex items-center gap-2"><span aria-hidden="true" className={`${skipped} size-3`} />{legend[2]}</li>
        {rows.some(r => r.cells.some(c => c && !c.own && c.guests > 0)) && <li className="flex items-center gap-2"><span aria-hidden="true" className={`${skipped} size-3`}>{dot(false)}</span>{legend[3]}</li>}
      </ul>
    </div>
  );
}

export type MonthRow = { key: string; label: string; aria: string; href: string; rate: number; rateText: string; spend: number; spendText: string;
  rateNote?: { text: string; tone: string }; spendNote?: { text: string; tone: string } };

/** Closed months as a small table, newest first, each row a link to that month. Every number says in words how it moved from
 *  the month before (+4% vs Aug, chili when it costs more), with a thin bar from zero under it so the size reads at a glance. */
export function MonthTable({ rows, head }: { rows: MonthRow[]; head: [string, string, string] }) {
  const maxRate = Math.max(...rows.map(r => r.rate), 0), maxSpend = Math.max(...rows.map(r => r.spend), 0);
  const cols = 'grid grid-cols-[minmax(0,3.5rem)_minmax(0,1fr)_minmax(0,1fr)_1rem] items-start gap-x-3';
  const cell = (text: string, v: number, max: number, bar: string, note?: { text: string; tone: string }) => (
    <span className="min-w-0">
      <span className="block text-[15px] font-semibold tabular-nums sm:text-base">{text}</span>
      <span aria-hidden="true" className="mt-1 block h-1 rounded-full bg-line"><span className={`block h-full rounded-full ${bar}`} style={{ width: `${pct(v, max)}%` }} /></span>
      {note && <span className={`mt-1 block text-[13px] tabular-nums ${note.tone || 'text-muted'}`}>{note.text}</span>}
    </span>);
  return (
    <div>
      <p aria-hidden="true" className={`${cols} px-2 pb-2 text-[13px] text-muted`}><span>{head[0]}</span><span>{head[1]}</span><span>{head[2]}</span></p>
      <ol className="divide-y divide-line border-t border-line">
        {rows.map(r => (
          <li key={r.key}>
            <Link aria-label={r.aria} href={r.href} className={`${cols} group rounded-xl px-2 py-3 hover:bg-paper ${focus}`}>
              <span className="font-semibold">{r.label}</span>
              {cell(r.rateText, r.rate, maxRate, 'bg-ink', r.rateNote)}
              {cell(r.spendText, r.spend, maxSpend, 'bg-turmeric', r.spendNote)}
              <svg aria-hidden="true" className="mt-1 size-4 stroke-muted group-hover:stroke-ink" fill="none" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" strokeWidth="1.5" /></svg>
            </Link>
          </li>))}
      </ol>
    </div>
  );
}

export type Part = { key: string; label: string; value: number; color: string };

/** My month in two bars on one scale: the money that came in (from earlier months, paid in) over the money used (food, bills,
 *  advances). Where the shorter one stops, a bracket runs to the end of the longer: that gap is the balance, the same amount as
 *  the line above it. Under them every part with its exact amount, grouped by side. */
export function InOut({ came, used, sides, gap, fmt }: { came: Part[]; used: Part[]; sides: [string, string]; gap: { text: string; tone: string } | null; fmt: (v: number) => string }) {
  const sum = (ps: Part[]) => ps.reduce((a, p) => a + p.value, 0);
  const a = sum(came), b = sum(used), max = Math.max(a, b);
  const lo = pct(Math.min(a, b), max), hi = pct(Math.max(a, b), max), mid = (lo + hi) / 2;
  const bar = (ps: Part[]) => (
    <span aria-hidden="true" className="mt-1.5 flex h-3 gap-0.5">
      {ps.map(p => <span key={p.key} className={`h-full rounded-[3px] ${p.color}`} style={{ width: `${pct(p.value, max)}%`, minWidth: 3 }} />)}
    </span>);
  const side = (label: string, ps: Part[], total: number) => (
    <div>
      <p className="flex justify-between gap-3 text-[15px]"><span className="font-semibold">{label}</span><span className="tabular-nums">{fmt(total)}</span></p>
      {bar(ps)}
    </div>);
  const list = (label: string, ps: Part[]) => ps.length > 0 && (
    <div>
      <dt className="text-[13px] font-semibold text-muted">{label}</dt>
      {ps.map(p => (
        <dd key={p.key} className="flex items-center gap-2 py-1">
          <span aria-hidden="true" className={`size-3 flex-none rounded-[3px] ${p.color}`} /><span className="min-w-0 flex-1">{p.label}</span><span className="tabular-nums">{fmt(p.value)}</span>
        </dd>))}
    </div>);
  return (
    <div>
      <div className="space-y-3">
        {side(sides[0], came, a)}
        {side(sides[1], used, b)}
      </div>
      {/* the bracket under the gap; its label slides by its own width, so it stays inside the card at either end */}
      {gap && hi > lo && (
        <div aria-hidden="true" className="relative mt-1 h-8">
          <span className={`absolute top-0 h-2 rounded-b-[3px] border-x-2 border-b-2 border-current ${gap.tone}`} style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
          <span className={`absolute top-3 text-[13px] font-semibold whitespace-nowrap tabular-nums ${gap.tone}`} style={{ left: `${mid}%`, transform: `translateX(-${mid}%)` }}>{gap.text}</span>
        </div>)}
      <dl className="mt-4 grid gap-4 text-[15px] sm:grid-cols-2">{list(sides[0], came)}{list(sides[1], used)}</dl>
    </div>
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
