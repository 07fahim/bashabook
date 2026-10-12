import { useCurrentFrame } from 'remotion';
import type { Data } from '../data';
import { ease, fade, rise, writeIn } from '../ui/anim';
import { Stage } from '../ui/Stage';

/** Scenes 1 and 2. The landing page's ledger, driven by frames instead of CSS: rows write in, then one gets struck out. */
export function Khata({ d, part }: { d: Data; part: 'write' | 'argue' }) {
  const frame = useCurrentFrame();
  const { khata: k, t } = d, n = k.rows.length;
  const step = (i: number) => (part === 'write' ? 10 + i * 11 : -100);   // 350 ms stagger, as the site
  const strike = part === 'argue' ? ease(frame, 20, 10) : 0;
  return (
    <Stage scale={1.6} style={{ display: 'flex', gap: 64, alignItems: 'center' }}>
      <figure className="w-[520px] rounded-3xl border border-line bg-surface p-6 shadow-card">
        <figcaption className="font-display text-xl font-semibold">{k.title}</figcaption>
        <dl className="mt-4">
          {k.rows.map(([date, what, amount], i) => (
            <div key={date} className="relative grid h-11 grid-cols-[5.5rem_1fr_auto] items-end border-b border-line pb-2" style={writeIn(frame, step(i))}>
              <dt className="text-[15px] text-muted">{date}</dt>
              <dd className="border-l-2 border-chili/40 pl-3">{what}</dd>
              <dd className="font-semibold tabular-nums">৳{amount}</dd>
              {i === n - 1 && part === 'argue' && (<>
                <span className="absolute left-0 top-[60%] h-[3px] bg-chili" style={{ width: `${strike * 100}%` }} />
                <span className="absolute -right-10 top-1 text-3xl font-bold text-chili" style={fade(frame, 34, 8)}>?</span>
              </>)}
            </div>
          ))}
          <div className="grid h-11 grid-cols-[1fr_auto] items-end pb-2 pl-[5.5rem]" style={writeIn(frame, step(n))}>
            <dt className="pl-3 text-muted">{t.khata.totalBazar}</dt><dd className="font-semibold tabular-nums">৳{k.totalBazar}</dd>
          </div>
          <div className="grid h-11 grid-cols-[1fr_auto] items-end pb-2 pl-[5.5rem]" style={writeIn(frame, step(n + 1))}>
            <dt className="pl-3 text-muted">{t.khata.totalMeals}</dt><dd className="font-semibold tabular-nums">{k.totalMeals}</dd>
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-4 border-t-2 border-ink pt-4" style={writeIn(frame, step(n + 2))}>
            <dt className="text-lg font-semibold">{t.khata.mealRate}</dt>
            <dd className="border-b-[3px] border-double border-ink font-display text-3xl font-bold tabular-nums">৳{k.rate}</dd>
          </div>
        </dl>
      </figure>
      {part === 'argue' && (
        <h1 className="max-w-[560px] font-display text-5xl font-bold leading-tight" style={rise(frame, 60, 14)}>{t.heroTitle}</h1>
      )}
    </Stage>
  );
}
