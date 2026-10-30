import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { focus } from './ui';

/** Charts drawn by the app: SVG and CSS only, no script, colours from the theme tokens. Values are poisha or hundredths of a
 *  meal; the caller formats them. A zero maximum draws nothing and never divides by zero. The words beside each chart already
 *  say everything, so the drawn parts are decorative. Each card gets the form its numbers need: bars to compare people, a
 *  grid for days, a meter and a receipt for a balance, bars and cards for months. */
const pct = (v: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);

export type Split = { key: string; label: ReactNode; text: string; food: number; bills: number; total: string; sr: string; strong?: boolean };

/** People's cost as one thick bar each, food then bills, on one scale, with a dashed rule at the average through every bar.
 *  Each part says what it is inside it: the word and the amount when both fit, the amount alone when only that fits, nothing
 *  when not even that does (the legend and the total still say it). Phones put the name and total above the bar, so the bar
 *  gets the card's full width. */
export function SplitBars({ rows, mark, words, fmt }: { rows: Split[]; mark?: number; words: [string, string]; fmt: (v: number) => string }) {
  const max = Math.max(...rows.map(r => r.food + r.bills), 0);
  const tag = 'hidden px-2 text-[13px] font-semibold tabular-nums';
  // each part is its own container, so what fits inside is measured against the part itself
  const part = (v: number, word: string, color: string) => v > 0 && (
    <span className={`@container flex h-full flex-none items-center overflow-hidden whitespace-nowrap ${color}`} style={{ width: `${pct(v, max)}%` }}>
      <span className={`${tag} @min-[7.5rem]:inline`}>{word} {fmt(v)}</span>
      <span className={`${tag} @min-[4.5rem]:inline @min-[7.5rem]:hidden`}>{fmt(v)}</span>
    </span>);
  return (
    <ul className="space-y-4 sm:space-y-3">
      {rows.map(r => (
        <li key={r.key} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(0,9rem)_1fr_5.5rem] ${r.strong ? 'font-semibold' : ''}`}>
          <span className="truncate" title={r.text}>{r.label}</span>
          <span aria-hidden="true" className="relative col-span-2 row-start-2 flex h-8 overflow-hidden rounded-lg bg-paper font-normal sm:col-span-1 sm:row-start-auto">
            {part(r.food, words[0], 'bg-turmeric text-on-turmeric')}
            {part(r.bills, words[1], 'border-l-2 border-surface bg-muted text-paper')}
            {mark !== undefined && max > 0 && <span className="absolute inset-y-0 border-l-2 border-dashed border-ink" style={{ left: `${pct(mark, max)}%` }} />}
          </span>
          <span className="text-right font-semibold tabular-nums">{r.total}<span className="sr-only">. {r.sr}</span></span>
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

export type MonthRow = { key: string; label: string; long: string; aria: string; href: string; rate: number; rateText: string; spend: number; spendText: string;
  rateNote?: { text: string; tone: string }; spendNote?: { text: string; tone: string } };

const Move = ({ tone }: { tone: string }) => tone === 'text-chili' || tone === 'text-leaf' ? (
  <svg aria-hidden="true" className={`size-3.5 flex-none ${tone === 'text-chili' ? 'stroke-chili' : 'rotate-180 stroke-leaf'}`} fill="none" strokeWidth="2" viewBox="0 0 16 16"><path d="M8 13V3M3 8l5-5 5 5" /></svg>) : null;

/** Closed months, oldest first in `rows`, shown twice. First two small bar charts, meal rate and spend, the latest month in full
 *  colour, for the shape at a glance (a bar opens its month; the cards below carry the same links for the keyboard). Then one
 *  card a month, newest first, every number saying how it moved from the month before (chili when it costs more); the cards
 *  scroll sideways when they don't fit. */
export function MonthCards({ rows, words }: { rows: MonthRow[]; words: { rate: string; spend: string; latest: string | null } }) {
  const chart = (title: string, get: (r: MonthRow) => number, text: (r: MonthRow) => string, on: string, off: string) => {
    const max = Math.max(...rows.map(get), 0);
    return (
      <div>
        <p className="text-[13px] font-semibold text-muted">{title}</p>
        <ol className="mt-2 flex gap-1.5">
          {rows.map((r, i) => {
            const last = i === rows.length - 1;
            return (
              <li key={r.key} className="min-w-0 flex-1">
                <Link href={r.href} tabIndex={-1} className="group flex flex-col items-center gap-1">
                  <span className="flex h-16 w-full items-end justify-center">
                    <span className={`relative w-full max-w-9 rounded-t-[3px] ${last ? on : off}`} style={{ height: `${Math.max(pct(get(r), max), 4)}%` }}>
                      {/* a mouse over a bar reads its value; the end bars' chips open inwards, so they never leave the card */}
                      <span className={`pointer-events-none absolute bottom-full z-10 mb-1.5 hidden rounded-lg bg-ink px-2 py-1 text-[13px] font-semibold whitespace-nowrap text-paper tabular-nums group-hover:block ${
                        i === 0 ? 'left-0' : last ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}>{r.label} {text(r)}</span>
                    </span>
                  </span>
                  <span className={`text-[13px] ${last ? 'font-semibold' : 'text-muted'}`}>{r.label}</span>
                </Link>
              </li>);
          })}
        </ol>
      </div>);
  };
  const line = (title: string, value: string, note?: { text: string; tone: string }) => (
    <>
      <span className="mt-3 block text-[13px] text-muted">{title}</span>
      <span className="flex items-center gap-1.5 text-lg font-bold tabular-nums">{value}{note && <Move tone={note.tone} />}</span>
      {note && <span className={`block text-[13px] tabular-nums ${note.tone || 'text-muted'}`}>{note.text}</span>}
    </>);
  return (
    <div>
      {/* side by side while a phone's half fits the bars (three months), else only where the card is wide enough for six
          bars each: stacked on a phone and in the half-width card at md */}
      <div aria-hidden="true" className={`grid gap-5 ${rows.length > 3 ? 'sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2' : 'grid-cols-2'}`}>
        {chart(words.rate, r => r.rate, r => r.rateText, 'bg-ink', 'bg-ink/25')}
        {chart(words.spend, r => r.spend, r => r.spendText, 'bg-turmeric', 'bg-turmeric/40')}
      </div>
      <ol className="-mx-5 mt-5 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-2">
        {[...rows].reverse().map((r, i) => (
          <li key={r.key} className="w-44 flex-none snap-start">
            <Link aria-label={r.aria} href={r.href} className={`block h-full rounded-2xl border border-line p-4 hover:bg-paper ${focus}`}>
              <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 font-semibold">{r.long}
                {i === 0 && words.latest && <span className="rounded-full bg-turmeric px-2 text-[13px] text-on-turmeric">{words.latest}</span>}</span>
              {line(words.rate, r.rateText, r.rateNote)}
              {line(words.spend, r.spendText, r.spendNote)}
            </Link>
          </li>))}
      </ol>
    </div>
  );
}

export type Part = { key: string; label: string; value: number; color: string };

/** My month as a meter, then a receipt. The meter is the money that came in, filled with what was used, part by part; what is
 *  left shows in leaf. When more was used than came in, a tick marks where the money that came in ran out. The receipt lists
 *  every part with its exact amount, plus in and minus out, down to the balance: the same sum as lib/money.ts. Its swatches
 *  are the meter's legend. */
export function Meter({ came, used, fmt, words, total }: {
  came: Part[]; used: Part[]; fmt: (v: number) => string; total: { label: string; text: string; tone: string };
  words: { usedOf: string; usedOnly: string; usedOver: string; left: string; short: string; cameIn: string };
}) {
  const sum = (ps: Part[]) => ps.reduce((a, p) => a + p.value, 0);
  const a = sum(came), b = sum(used), whole = Math.max(a, b), over = b > a && a > 0, at = pct(a, whole);
  const row = (p: Part, sign: string, swatch: boolean) => (
    <div key={`${sign}${p.key}`} className="flex items-center gap-2 py-1">
      <dt className="flex min-w-0 flex-1 items-center gap-2"><span aria-hidden="true" className={`size-3 flex-none rounded-[3px] ${swatch ? p.color : ''}`} />{p.label}</dt>
      <dd className="tabular-nums">{sign}{fmt(p.value)}</dd>
    </div>);
  return (
    <div>
      <div aria-hidden="true" className={`relative ${over ? 'pt-6' : ''}`}>
        {/* the label slides by its own width, so it stays inside the card at either end */}
        {over && <span className="absolute top-0 text-[13px] whitespace-nowrap text-muted" style={{ left: `${at}%`, transform: `translateX(-${at}%)` }}>{words.cameIn}</span>}
        <div className="flex h-4 overflow-hidden rounded-full bg-line">
          {used.map(p => <span key={p.key} className={`h-full border-r-2 border-surface last:border-r-0 ${p.color}`} style={{ width: `${pct(p.value, whole)}%` }} />)}
          {a > b && <span className="h-full bg-leaf" style={{ width: `${pct(a - b, whole)}%` }} />}
        </div>
        {over && <span className="absolute -bottom-1 top-5 w-0.5 -translate-x-1/2 bg-ink" style={{ left: `${at}%` }} />}
      </div>
      <p className="mt-2 flex flex-wrap justify-between gap-x-4 text-[13px]">
        <span className="text-muted">{(a === 0 ? words.usedOnly : b > a ? words.usedOver : words.usedOf).replace('{u}', fmt(b)).replace('{c}', fmt(a))}</span>
        {a !== b && <span className={`font-semibold ${a > b ? 'text-leaf' : 'text-chili'}`}>{(a > b ? words.left : words.short).replace('{t}', fmt(Math.abs(a - b)))}</span>}
      </p>
      <dl className="mt-4 rounded-2xl bg-paper p-4 text-[15px]">
        {came.map(p => row(p, '+', false))}
        {used.map(p => row(p, '−', true))}
        <div className={`mt-2 flex items-center gap-2 border-t-2 border-dashed border-muted pt-3 text-lg font-bold ${total.tone}`}>
          <dt className="flex min-w-0 flex-1 items-center gap-2"><span aria-hidden="true" className={`size-3 flex-none rounded-[3px] ${a > b ? 'bg-leaf' : ''}`} />{total.label}</dt>
          <dd className="tabular-nums">{total.text}</dd>
        </div>
      </dl>
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
