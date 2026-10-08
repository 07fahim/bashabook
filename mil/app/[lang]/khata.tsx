import type { CSSProperties } from 'react';
import type { Dict } from './dictionaries';

const step = (i: number) => ({ '--i': i }) as CSSProperties;

/** The hero ledger: entries write themselves in, then the totals settle under a double rule. */
export function Khata({ t }: { t: Dict['khata'] }) {
  const n = t.rows.length;
  return (
    <figure className="rounded-2xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgb(0_0_0/0.06)] sm:p-6">
      <figcaption className="font-display text-xl font-semibold">{t.title}</figcaption>
      <dl className="mt-4">
        {t.rows.map(([date, what, amount], i) => (
          <div key={date} className="write grid h-11 grid-cols-[4.5rem_1fr_auto] items-end border-b border-line pb-2" style={step(i)}>
            <dt className="text-sm text-muted">{date}</dt>
            <dd className="border-l-2 border-chili/40 pl-3">{what}</dd>
            <dd className="tabular-nums">৳{amount}</dd>
          </div>
        ))}
        <div className="write grid h-11 grid-cols-[1fr_auto] items-end pb-2 pl-[4.5rem]" style={step(n)}>
          <dt className="pl-3 text-muted">{t.totalBazar}</dt>
          <dd className="tabular-nums">৳{t.figures.totalBazar}</dd>
        </div>
        <div className="write grid h-11 grid-cols-[1fr_auto] items-end border-b border-line pb-2 pl-[4.5rem]" style={step(n + 1)}>
          <dt className="pl-3 text-muted">{t.totalMeals}</dt>
          <dd className="tabular-nums">{t.figures.totalMeals}</dd>
        </div>
        <div className="write grid grid-cols-[1fr_auto] items-end pt-4 pl-[4.5rem]" style={step(n + 2)}>
          <dt className="pl-3 font-semibold">{t.mealRate}</dt>
          <dd className="border-b-[3px] border-double border-ink font-display text-4xl font-bold tabular-nums">৳{t.figures.rate}</dd>
        </div>
      </dl>
      <p className="mt-5 text-sm text-muted">{t.caption}</p>
      <div className="mt-5 rounded-xl bg-paper p-4">
        <p className="mb-2 font-semibold">{t.you.who}</p>
        <dl className="space-y-1">
        {[[t.you.food, t.figures.food], [t.you.bills, t.figures.bills], [t.you.paid, t.figures.paid]].map(([label, amount]) => (
          <div key={label} className="flex justify-between text-muted">
            <dt>{label}</dt>
            <dd className="tabular-nums">৳{amount}</dd>
          </div>
        ))}
        <div className="flex justify-between border-t border-line pt-2 font-semibold text-leaf">
          <dt>{t.you.result}</dt>
          <dd className="tabular-nums">+৳{t.figures.result}</dd>
        </div>
        </dl>
      </div>
    </figure>
  );
}
