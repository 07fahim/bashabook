'use client';
import { useRef, useState } from 'react';
import { focus } from '../ui';

const RING = ['stroke-turmeric', 'stroke-leaf', 'stroke-muted', 'stroke-chili', 'stroke-ink'] as const;   // the legend beside it names every part
const SWATCH = ['bg-turmeric', 'bg-leaf', 'bg-muted', 'bg-chili', 'bg-ink'] as const;

/** A ring of up to five slices with the total in the middle and a legend beside it. Point at or tap a slice, or tap its legend
 *  row: that part stands out, the rest steps back and the middle says its name, amount and share. Tap again to see all. */
export function Ring({ slices, total }: { slices: { label: string; value: number; text: string }[]; total: string }) {
  const [on, setOn] = useState<number | null>(null);
  const mouse = useRef(false);
  const sum = slices.reduce((a, s) => a + s.value, 0);
  const share = (v: number) => (sum ? Math.round((v / sum) * 100) : 0);
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((a, s) => a + (s.value / sum) * 100, 0));
  const pick = (i: number) => setOn(o => (o === i ? null : i));
  const dim = (i: number) => (on !== null && on !== i ? 'opacity-30' : '');
  const fade = 'motion-safe:transition-[opacity,stroke-width] motion-safe:duration-200';
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative size-40 flex-none">
        <svg aria-hidden="true" className="size-full -rotate-90" viewBox="0 0 42 42" onPointerLeave={e => { if (e.pointerType !== 'touch') setOn(null); }}>
          <circle className="stroke-paper" cx="21" cy="21" fill="none" r="15.9155" strokeWidth="5" />
          {sum > 0 && slices.map((s, i) => (
            <circle key={i} className={`${RING[i]} ${dim(i)} ${fade} cursor-pointer`} cx="21" cy="21" fill="none" r="15.9155"
              strokeDasharray={`${(s.value / sum) * 100} ${100 - (s.value / sum) * 100}`} strokeDashoffset={-starts[i]} strokeWidth={on === i ? 6.5 : 5}
              // a mouse already picked it on the way in, so its click keeps it; a tap toggles, a scroll does nothing
              onPointerDown={e => { mouse.current = e.pointerType === 'mouse'; }} onClick={() => (mouse.current ? setOn(i) : pick(i))}
              onPointerEnter={e => { if (e.pointerType === 'mouse') setOn(i); }} />
          ))}
        </svg>
        {/* the middle answers for the part picked, else for the whole; screen readers get the same from the pressed legend row */}
        <p aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          {on === null ? <span className="text-lg font-bold tabular-nums">{total}</span> : (<>
            <span className="max-w-full truncate text-[13px] text-muted">{slices[on].label}</span>
            <span className="text-lg leading-tight font-bold tabular-nums">{slices[on].text}</span>
            <span className="text-[13px] text-muted tabular-nums">{share(slices[on].value)}%</span>
          </>)}
        </p>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1 text-[15px]">
        {slices.map((s, i) => (
          <li key={i}>
            <button type="button" aria-pressed={on === i} onClick={() => pick(i)}
              className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left hover:bg-paper aria-pressed:bg-paper aria-pressed:font-semibold ${focus}`}>
              <span aria-hidden="true" className={`size-3 flex-none rounded-sm ${SWATCH[i]}`} />
              <span className="min-w-0 flex-1">{s.label}</span>
              <span className="tabular-nums">{s.text}</span>
              <span className="w-11 text-right text-[13px] text-muted tabular-nums">{share(s.value)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
