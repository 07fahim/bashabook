import { useCurrentFrame } from 'remotion';
import type { Locale } from '../../../app/[lang]/dictionaries';
import { fmtDay } from '../../../app/[lang]/format';
import { TODAY, type Data } from '../data';
import { ease, rise, writeIn } from '../ui/anim';
import { card, field, primary } from '../ui/classes';
import { Stage, TopBar } from '../ui/Stage';

/** Scene 5. Money: the Add bazar fold open on the left, this month's entries on the right. The amount types in, Tahsin is picked, the row writes in. */
export function Bazar({ d, lang }: { d: Data; lang: Locale }) {
  const frame = useCurrentFrame(), x = d.t.money;
  const typed = '1250'.slice(0, Math.floor(ease(frame, 20, 24) * 4));
  const picked = frame >= 60, saved = frame >= 110;
  // the notebook's own entries, newest first; Rafi's deposit is still waiting for a tap, so it isn't settled here
  const rows = [
    [`${x.types.bill} · Wi-Fi`, '৳1,200', x.paidBy.replace('{name}', d.n.zarif), fmtDay('2026-09-20', lang)],
    [x.types.bazar, '৳2,120', x.paidBy.replace('{name}', d.n.zarif), fmtDay('2026-09-09', lang)],
    [x.types.bazar, '৳1,980', x.paidBy.replace('{name}', d.n.tahsin), fmtDay('2026-09-05', lang)],
  ];
  return (
    <Stage top scale={1.22} style={{ width: 1500 }}>
      <TopBar brand={d.t.brand} accent={d.t.brandAccent} tabs={d.tabs.slice(0, 3)} current={2} />
      <main className="grid grid-cols-3 gap-6 px-8 pt-8">
        <section className={card} style={rise(frame, 0, 14)}>
          <h2 className="text-xl font-bold">{x.addBazar}</h2>
          <p className="mt-1 text-[15px] text-muted">{x.bazarLead}</p>
          <label className="mt-4 block font-semibold">{x.amount}
            <div className={`${field} tabular-nums ${typed ? '' : 'text-muted'}`}>{typed || '0'}{typed.length < 4 && frame > 20 && frame % 20 < 10 && <span className="text-ink">|</span>}</div>
          </label>
          <label className="mt-3 block font-semibold">{x.date}<div className={field}>{fmtDay(TODAY, lang)}</div></label>
          <label className="mt-3 block font-semibold">{x.whoPaidShop}
            <div className={`${field} flex items-center justify-between`} style={picked ? { borderColor: 'var(--turmeric)' } : undefined}>
              <span className={picked ? '' : 'text-muted'}>{picked ? d.n.tahsin : x.flatMoney.replace('{name}', d.n.tahsin)}</span><span className="text-muted">⌄</span>
            </div>
          </label>
          <div className={`mt-5 ${primary}`} style={{ opacity: saved && frame < 118 ? 0.6 : 1 }}>{x.save}</div>
        </section>
        <section className={`col-span-2 ${card}`} style={rise(frame, 8, 14)}>
          <h2 className="text-xl font-bold">{x.entries}</h2>
          <ul className="mt-3 divide-y divide-line">
            {saved && (
              <li className="grid grid-cols-[1fr_auto] gap-4 py-3" style={writeIn(frame, 112, 14)}>
                <span><span className="font-semibold">{x.types.bazar}</span><span className="block text-[15px] text-muted">{x.paidBy.replace('{name}', d.n.tahsin)} · {fmtDay(TODAY, lang)}</span></span>
                <span className="font-semibold tabular-nums">৳1,250</span>
              </li>
            )}
            {rows.map(([what, amt, by, date]) => (
              <li key={what} className="grid grid-cols-[1fr_auto] gap-4 py-3">
                <span><span className="font-semibold">{what}</span><span className="block text-[15px] text-muted">{by} · {date}</span></span>
                <span className="font-semibold tabular-nums">{amt}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </Stage>
  );
}
