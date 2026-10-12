import { useCurrentFrame } from 'remotion';
import { fmtMonth } from '../../../app/[lang]/format';
import { MONTH, type Data } from '../data';
import { count, ease, fade, push, rise } from '../ui/anim';
import { alertCard, field, primary } from '../ui/classes';
import { Stage, TopBar } from '../ui/Stage';

const fmt = (n: number) => n.toLocaleString('en-GB');
/** The first two sentences of the close lead; Bangla ends a sentence with the daree. */
const lead = (s: string) => { const stop = s.includes('।') ? '।' : '.'; return s.split(stop).slice(0, 2).join(stop) + stop; };

/** Scene 8. The collector's close card (close-card.tsx + cash-count.tsx): four boxes fill one by one, the total matches, Close September goes live. */
export function Close({ d }: { d: Data }) {
  const frame = useCurrentFrame(), x = d.t.money, month = fmtMonth(MONTH);
  const keys = ['cash', 'bkash', 'nagad', 'bank'] as const;
  const vals = keys.map((k, i) => count(frame, 24 + i * 24, 18, 0, d.cash[k]));
  const total = vals.reduce((a, b) => a + b, 0), allIn = frame >= 24 + 3 * 24 + 18;
  const live = ease(frame, 130, 10), pressed = frame >= 175;
  return (
    <Stage top scale={1.22} style={{ width: 1500 }}>
      <TopBar brand={d.t.brand} accent={d.t.brandAccent} tabs={d.tabs} current={3} />
      <main className="px-8 pt-8">
        <section className={`w-[960px] ${alertCard}`} style={{ ...rise(frame, 0, 14), ...push(frame, 210, 0.03) }}>
          <h2 className="text-xl font-bold">{x.closeTitle.replace('{month}', month)}</h2>
          <p className="mt-1 max-w-prose text-muted">{lead(x.closeLead)}</p>
          <p className="mt-4 font-semibold">{x.expected.replace('{t}', d.held)}</p>
          <div className="mt-3 grid grid-cols-4 gap-3">
            {keys.map((k, i) => (
              <label key={k} className="block font-semibold">{x.cashMethods[k]}
                <div className={`${field} tabular-nums ${vals[i] ? '' : 'text-muted'}`}>{vals[i] ? fmt(vals[i]) : '0'}</div>
              </label>
            ))}
          </div>
          <p className="mt-3 font-semibold" style={fade(frame, 24, 8)}>
            {x.counted.replace('{t}', `৳${fmt(total)}.00`)}{allIn && <span className="text-leaf" style={fade(frame, 115, 10)}> · {x.matches}</span>}
          </p>
          <div className={`mt-5 ${primary} inline-flex`} style={{ width: 'auto', opacity: 0.6 + 0.4 * live - (pressed ? 0.15 : 0) }}>{x.closeBtn.replace('{month}', month)}</div>
        </section>
      </main>
    </Stage>
  );
}
