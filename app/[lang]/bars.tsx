import type { ReactNode } from 'react';

/** Bars drawn by the app: SVG only, no script, colours from the theme tokens. Values are poisha or hundredths of a meal; the
 *  caller formats them. A zero maximum draws empty bars and never divides by zero. The text beside each bar already says
 *  everything, so every SVG is decorative. */
const pct = (v: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);

export type HRow = { key: string; label: ReactNode; text: string; value: number; valueText?: string; tail?: number; strong?: boolean };

/** One horizontal bar per row: label, bar, value. `tail` draws a second part after the bar (guest meals, bills). */
export function HBars({ rows, fmt, tailColor = 'fill-line' }: { rows: HRow[]; fmt: (v: number) => string; tailColor?: string }) {
  const max = Math.max(...rows.map(r => r.value + (r.tail ?? 0)), 0);
  return (
    <ul className="space-y-3">
      {rows.map(r => (
        <li key={r.key} className={`grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 ${r.strong ? 'font-semibold' : ''}`}>
          <span className="truncate" title={r.text}>{r.label}</span>
          <svg aria-hidden="true" className="h-4 w-full" preserveAspectRatio="none" viewBox="0 0 100 4">
            <rect className="fill-turmeric" height="4" rx="1" width={pct(r.value, max)} />
            {r.tail ? <rect className={tailColor} height="4" rx="1" width={pct(r.tail, max)} x={pct(r.value, max)} /> : null}
          </svg>
          <span className="tabular-nums">{r.valueText ?? fmt(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical bars for a short series (months): value above, label below. */
export function VBars({ cols, fmt }: { cols: { key: string; label: string; value: number }[]; fmt: (v: number) => string }) {
  const max = Math.max(...cols.map(c => c.value), 0);
  return (
    <ol className="flex items-end gap-2">
      {cols.map((c, i) => (
        // six values do not fit a phone: the oldest columns beyond five show from sm up
        <li key={c.key} className={`${i < cols.length - 5 ? 'hidden sm:flex' : 'flex'} min-w-0 flex-1 flex-col items-center gap-1 text-[13px]`}>
          <span className="tabular-nums">{fmt(c.value)}</span>
          {/* the bar box has its own height, so the tallest bar's label never climbs out of the chart */}
          <div className="flex h-28 w-full items-end">
            <svg aria-hidden="true" className="w-full" preserveAspectRatio="none" style={{ height: `${Math.max(pct(c.value, max), 2)}%` }} viewBox="0 0 4 100">
              <rect className="fill-turmeric" height="100" rx="1" width="4" />
            </svg>
          </div>
          <span className="text-muted">{c.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** Bars in parts on one scale, with one legend: a cost bar (food, bills) over a paid-in bar, so the eye compares the two. */
export type Part = { key: string; label: string; value: number; color: string; swatch: string };
export function Stacked({ rows, fmt }: { rows: Part[][]; fmt: (v: number) => string }) {
  const max = Math.max(...rows.map(r => r.reduce((a, p) => a + p.value, 0)), 0);
  return (
    <div>
      {rows.map((parts, i) => {
        const starts = parts.map((_, j) => parts.slice(0, j).reduce((a, p) => a + pct(p.value, max), 0));   // each part begins where the last ended
        return (
          <svg key={i} aria-hidden="true" className="mt-2 h-6 w-full first:mt-0" preserveAspectRatio="none" viewBox="0 0 100 6">
            {parts.map((p, j) => <rect key={p.key} className={p.color} height="6" width={pct(p.value, max)} x={starts[j]} />)}
          </svg>);
      })}
      <ul className="mt-3 grid grid-cols-3 gap-2 text-[15px]">
        {rows.flat().map(p => (
          <li key={p.key}><span aria-hidden="true" className={`mr-2 inline-block size-3 rounded-sm ${p.swatch}`} />{p.label}<span className="block font-semibold tabular-nums">{fmt(p.value)}</span></li>
        ))}
      </ul>
    </div>
  );
}

const RING = ['stroke-turmeric', 'stroke-leaf', 'stroke-muted', 'stroke-chili', 'stroke-line'] as const;
const SWATCH = ['bg-turmeric', 'bg-leaf', 'bg-muted', 'bg-chili', 'bg-line'] as const;

/** A ring of up to five slices with the total in the middle and a legend beside it. */
export function Ring({ slices, fmt }: { slices: { label: string; value: number }[]; fmt: (v: number) => string }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((a, s) => a + (s.value / total) * 100, 0));
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative size-40 flex-none">
        <svg aria-hidden="true" className="size-full -rotate-90" viewBox="0 0 42 42">
          <circle className="stroke-paper" cx="21" cy="21" fill="none" r="15.9155" strokeWidth="5" />
          {total > 0 && slices.map((s, i) => (
            <circle key={i} className={RING[i]} cx="21" cy="21" fill="none" r="15.9155" strokeDasharray={`${(s.value / total) * 100} ${100 - (s.value / total) * 100}`} strokeDashoffset={-starts[i]} strokeWidth="5" />
          ))}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-lg font-bold tabular-nums">{fmt(total)}</span>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-2 text-[15px]">
        {slices.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span aria-hidden="true" className={`size-3 flex-none rounded-sm ${SWATCH[i]}`} />
            <span className="min-w-0 flex-1">{s.label}</span>
            <span className="tabular-nums">{fmt(s.value)}</span>
            <span className="w-11 text-right text-[13px] text-muted tabular-nums">{total ? Math.round((s.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
