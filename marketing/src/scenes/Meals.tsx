import { useCurrentFrame } from 'remotion';
import type { Locale } from '../../../app/[lang]/dictionaries';
import { fmtDay, fmtRange, fmtTime } from '../../../app/[lang]/format';
import { MEALS } from '../../../lib/meals';
import { CUTOFF, TODAY, TOMORROW, WEEK, type Data } from '../data';
import { ease, push, rise } from '../ui/anim';
import { Stage, TopBar } from '../ui/Stage';

/** Scene 3. The Meals week as week-chart.tsx draws it on wide screens; tomorrow's dinner chip goes off at 2.4 s. */
export function Meals({ d, lang }: { d: Data; lang: Locale }) {
  const frame = useCurrentFrame(), m = d.t.meals;
  const off = ease(frame, 72, 8);   // the chip's turmeric drains
  const chip = (on: boolean, label: string, drain = 0) => (
    <div className={`flex min-h-12 items-center justify-center gap-x-1.5 rounded-full font-semibold ${on ? 'bg-turmeric text-on-turmeric' : 'border border-line bg-surface text-muted'}`}
      style={drain ? { backgroundColor: `color-mix(in srgb, var(--turmeric) ${(1 - drain) * 100}%, var(--surface))`, color: drain > 0.5 ? 'var(--muted)' : undefined, border: drain > 0.5 ? '1px solid var(--line)' : undefined } : undefined}>
      {drain ? (drain > 0.5 ? m.off : m.on) : label}
    </div>
  );
  return (
    <Stage top scale={1.22} style={{ width: 1500 }}>
      <TopBar brand={d.t.brand} accent={d.t.brandAccent} tabs={d.tabs.slice(0, 3)} current={1} />
      <main className="px-8 pt-8" style={rise(frame, 0, 14)}>
        <h1 className="font-display text-3xl font-bold">{m.mealsTitle}</h1>
        <p className="mt-2 max-w-prose text-muted">{m.lockTime.replace('{t}', fmtTime(CUTOFF))}</p>
        <p className="mt-6 text-center font-semibold">{fmtRange(WEEK[0], WEEK[6])}</p>
        <section className="mt-4 rounded-3xl border border-line border-t-4 border-t-turmeric bg-surface p-6 shadow-card" style={push(frame, 180, 0.03)}>
          <ul className="grid grid-flow-col grid-cols-[auto_repeat(7,minmax(0,1fr))] grid-rows-[auto_repeat(3,auto)] gap-2">
            <li className="contents">
              <span />
              {MEALS.map(x => <span key={x} className="self-center pr-4 font-semibold">{m.names[x]}</span>)}
            </li>
            {WEEK.map(date => (
              <li key={date} className="contents">
                <p className={`pb-2 text-center text-[15px] font-semibold leading-snug ${date === TOMORROW ? 'text-turmeric-ink' : ''}`}>
                  {date === TODAY && <span className="mb-1 inline-block rounded-full bg-turmeric px-2.5 text-on-turmeric">{m.today}</span>}
                  {date === TOMORROW && <span className="block">{m.tomorrow}</span>}
                  <span className={date === TODAY ? 'block' : ''}>{fmtDay(date, lang)}</span>
                </p>
                {MEALS.map(meal => {
                  const past = date < TOMORROW, on = !(meal === 'b' && (date === WEEK[1] || date === WEEK[5]));
                  if (date === TOMORROW && meal === 'd') return <div key={meal}>{chip(true, m.on, off)}</div>;
                  return <div key={meal} style={past ? { opacity: 0.9 } : undefined}>{chip(on, on ? m.on : m.off)}</div>;
                })}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </Stage>
  );
}
