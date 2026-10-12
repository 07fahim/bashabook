import { useCurrentFrame } from 'remotion';
import type { Locale } from '../../../app/[lang]/dictionaries';
import { fmtDay } from '../../../app/[lang]/format';
import type { Data } from '../data';
import { ease, rise } from '../ui/anim';
import { secondary } from '../ui/classes';
import { Stage, TopBar } from '../ui/Stage';

/** Scene 6. Tahsin's Home: the Waiting for you card (money/bits.tsx ConfirmList). The tap at 2 s dims the button, then the turmeric border fades to a plain line. */
export function Confirm({ d, lang }: { d: Data; lang: Locale }) {
  const frame = useCurrentFrame(), x = d.t.money;
  const tapped = frame >= 60, done = ease(frame, 75, 15);
  return (
    <Stage top scale={1.3} style={{ width: 1400 }}>
      <TopBar brand={d.t.brand} accent={d.t.brandAccent} tabs={d.tabs} current={0} />
      <main className="px-8 pt-8">
        <h1 className="font-display text-3xl font-bold" style={rise(frame, 0, 12)}>{d.t.app.hi}, {d.n.tahsin}</h1>
        <section className="mt-6 w-[760px] rounded-3xl bg-surface p-5 shadow-card" style={{ ...rise(frame, 6, 14), border: `2px solid color-mix(in srgb, var(--turmeric) ${(1 - done) * 100}%, var(--line))` }}>
          <h2 className="text-xl font-bold">{x.waitingTitle} (1)</h2>
          <ul className="mt-2">
            <li className="flex items-center justify-between gap-4 py-3">
              <span>
                {x.confirmDeposit.replace('{name}', d.n.rafi).replace('{t}', '৳3,000.00')}
                <span className="block text-[15px] text-muted">{fmtDay('2026-09-11', lang)} · bKash</span>
              </span>
              <div className={`${secondary} shrink-0`} style={{ width: 'auto', opacity: tapped && done < 1 ? 0.6 : 1, borderColor: done === 1 ? 'var(--leaf)' : undefined, color: done === 1 ? 'var(--leaf)' : undefined }}>
                {done === 1 ? '✓' : x.confirmYes}
              </div>
            </li>
          </ul>
        </section>
      </main>
    </Stage>
  );
}
