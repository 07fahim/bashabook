import { staticFile, useCurrentFrame } from 'remotion';
import type { Data } from '../data';
import { rise, writeIn } from '../ui/anim';
import { card, primary } from '../ui/classes';
import { Stage } from '../ui/Stage';

/** Scene 9. Settle up lines write in, then the landing page's group-chat bubble carries the same lines. */
export function Settle({ d }: { d: Data }) {
  const frame = useCurrentFrame(), x = d.t.money, t = d.t;
  const split = (line: string) => { const at = line.includes('৳') ? line.indexOf('৳') : line.length; return [line.slice(0, at).trim(), line.slice(at)]; };
  return (
    <Stage scale={1.6} style={{ display: 'flex', gap: 56, alignItems: 'flex-start' }}>
      <section className={`w-[520px] ${card}`} style={rise(frame, 0, 12)}>
        <h2 className="text-xl font-bold">{x.settleUp}</h2>
        <ul className="mt-3 divide-y divide-line tabular-nums">
          {d.settle.map((line, i) => { const [a, b] = split(line); return (
            <li key={line} className="flex justify-between gap-4 py-2" style={writeIn(frame, 8 + i * 8, 12)}><span>{a}</span><span className="font-semibold">{b}</span></li>
          ); })}
        </ul>
        <div className={`mt-5 ${primary}`} style={{ ...rise(frame, 44, 10), opacity: frame >= 60 && frame < 68 ? 0.6 : undefined }}>{t.meals.share}</div>
      </section>
      <figure className="w-[460px] overflow-hidden rounded-3xl border border-line bg-surface" style={rise(frame, 70, 16)}>
        <figcaption className="flex items-center gap-3 border-b border-line px-5 py-3 font-semibold">
          <span className="grid size-9 place-items-center rounded-full bg-paper text-[15px]">4B</span>{d.n.flat} · {t.chat.group.split('·')[1]?.trim()}
        </figcaption>
        <div className="space-y-4 bg-paper p-5">
          <div className="flex items-start gap-2">
            <img src={staticFile('logo-mark.png')} alt="" width={31} height={32} className="mt-7 shrink-0" />
            <div className="w-full">
              <p className="mb-1 text-[15px] text-muted">{t.chat.sender}</p>
              <div className="rounded-2xl rounded-tl-sm bg-turmeric px-4 py-3 text-on-turmeric">
                <p className="font-bold">{d.settleHead}</p>
                <ul className="mt-2 space-y-1 tabular-nums">
                  <li>{d.rateLine}</li>
                  {d.settle.map(line => { const [a, b] = split(line); return <li key={line} className="flex justify-between gap-4"><span>{a}</span><span className="font-semibold">{b}</span></li>; })}
                </ul>
              </div>
            </div>
          </div>
          <p className="ml-auto w-fit rounded-2xl rounded-tr-sm bg-ink px-4 py-2 text-paper" style={rise(frame, 115, 12)}>{t.chat.reply}</p>
        </div>
      </figure>
    </Stage>
  );
}
