import { useCurrentFrame } from 'remotion';
import type { Data } from '../data';
import { ease, push, rise } from '../ui/anim';
import { focal, link, tile } from '../ui/classes';
import { Stage } from '../ui/Stage';

/** Scene 7. My balance with How this adds up open (money/page.tsx #balance), and the thin line that ties plates → rate → balance. */
export function Breakdown({ d }: { d: Data }) {
  const frame = useCurrentFrame(), x = d.t.money;
  const line = ease(frame, 20, 24);
  const chain = [[d.t.khata.totalMeals, d.khata.totalMeals], [x.mealRate, d.rate], [x.balance, d.balance]] as const;
  return (
    <Stage scale={1.55} style={{ display: 'flex', gap: 56, alignItems: 'center' }}>
      <div className="relative w-[420px]">
        <div className="absolute left-[50%] top-6 h-[calc(100%-3rem)] w-[3px] -translate-x-1/2 bg-line" />
        <div className="absolute left-[50%] top-6 w-[3px] -translate-x-1/2 bg-turmeric" style={{ height: `calc((100% - 3rem) * ${line})` }} />
        <ul className="relative space-y-10">
          {chain.map(([k, v], i) => (
            <li key={k} className={`${tile} border border-line bg-surface px-4`} style={rise(frame, 6 + i * 10, 12)}>
              <p className="text-[15px] text-muted">{k}</p><p className="text-2xl font-bold tabular-nums">{v}</p>
            </li>
          ))}
        </ul>
      </div>
      <section className={`w-[560px] ${focal}`} style={rise(frame, 0, 14, push(frame, 180, 0.03))}>
        <h2 className="text-xl font-bold">{d.t.app.hi}, {d.n.nafis}</h2>
        <p className="mt-2 text-2xl font-bold text-leaf">{d.balanceLine}</p>
        <p className={`mt-3 inline-flex min-h-11 items-center ${link}`}>{x.breakdown}</p>
        <dl className="mt-2 space-y-1 [&>div]:flex [&>div]:justify-between [&>div]:gap-4 [&_dd]:tabular-nums">
          {d.breakdown.map((row, i) => (
            <div key={i} className={row.kind === 'head' ? 'font-semibold' : row.kind === 'sub' ? 'pl-4' : row.kind === 'total' ? 'border-t border-line pt-1 font-bold' : ''} style={rise(frame, 30 + i * 3, 10)}>
              <dt>{row.label}</dt><dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </Stage>
  );
}
