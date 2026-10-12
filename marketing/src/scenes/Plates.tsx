import { useCurrentFrame } from 'remotion';
import type { Locale } from '../../../app/[lang]/dictionaries';
import { fmtDay, fmtTime } from '../../../app/[lang]/format';
import { MEALS, type Meal } from '../../../lib/meals';
import { CUTOFF, TOMORROW, type Data } from '../data';
import { count, push, rise } from '../ui/anim';
import { card, focal, primary, secondary, tile } from '../ui/classes';
import { Stage, TopBar } from '../ui/Stage';

/** Scene 4. Home's two cards, as home/page.tsx lays them out: Plates to cook (focal) beside My balance. Dinner counts 9 → 8. */
export function Plates({ d, lang }: { d: Data; lang: Locale }) {
  const frame = useCurrentFrame(), m = d.t.meals, x = d.t.money;
  const plates: Record<Meal, number> = { b: 7, l: 8, d: count(frame, 40, 12, 9, 8) };
  return (
    <Stage top scale={1.3} style={{ width: 1400 }}>
      <TopBar brand={d.t.brand} accent={d.t.brandAccent} tabs={d.tabs.slice(0, 3)} current={0} />
      <main className="px-8 pt-8">
        <h1 className="font-display text-3xl font-bold" style={rise(frame, 0, 12)}>{d.t.app.hi}, {d.n.nafis}</h1>
        <div className="mt-8 grid grid-cols-2 gap-6">
          <section className={`flex flex-col ${focal}`} style={{ ...rise(frame, 4, 14), ...push(frame, 180, 0.03) }}>
            <h2 className="text-xl font-bold">{m.headcountTitle}</h2>
            <p className="mt-1 text-[15px] text-muted">{m.tomorrow} · {fmtDay(TOMORROW, lang)} · {m.locksAt.replace('{t}', fmtTime(CUTOFF))}</p>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {MEALS.map(k => (
                <div key={k} className={tile}>
                  <dt className="text-[15px] text-muted">{m.names[k]}</dt>
                  <dd className="text-3xl font-bold tabular-nums">{plates[k]}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[15px] text-muted">{m.today}: {MEALS.map(k => `${m.names[k]} ${{ b: 7, l: 9, d: 9 }[k]}`).join(' · ')}</p>
            <div className="grow" />
            <div className={`mt-5 ${primary}`} style={rise(frame, 70, 12)}>{m.share}</div>
          </section>
          <section className={`flex flex-col ${card}`} style={rise(frame, 12, 14)}>
            <h2 className="text-xl font-bold">{x.title}</h2>
            <p className="mt-1 text-lg font-bold text-leaf">{d.balanceLine}</p>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {([[x.mealRate, '৳31.72'], [x.myMeals, x.mealsN.replace('{n}', '41')], [x.withName.replace('{name}', d.n.tahsin), '৳27,212']] as const).map(([k, v]) => (
                <div key={k} className={`${tile} px-1`}>
                  <dt className="text-[15px] text-muted">{k}</dt>
                  <dd className="text-2xl font-bold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="grow" />
            <div className={`mt-5 ${secondary}`}>{x.seeMoney}</div>
          </section>
        </div>
      </main>
    </Stage>
  );
}
