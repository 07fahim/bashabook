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
