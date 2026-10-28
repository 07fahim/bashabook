'use client';

import { useEffect, useRef, useState } from 'react';
import { field, link } from './ui';

const input = field.replace('mt-1.5 ', '');   // the grid's gap spaces the lines

/** A bazar's item lines: a name and an optional amount each, up to 30. Empty lines are skipped by the server; Add item puts
 *  the cursor in the new line. */
export function ItemLines({ initial = [], title, hint, name, amount, add }: {
  initial?: { name: string; amount: string }[]; title: string; hint: string; name: string; amount: string; add: string;
}) {
  const [n, setN] = useState(Math.max(initial.length, 1)), box = useRef<HTMLDivElement>(null), grew = useRef(false);
  useEffect(() => {
    const form = box.current?.closest('form'), back = () => setN(Math.max(initial.length, 1));
    form?.addEventListener('reset', back);   // a cleared form (after a save) goes back to its first lines
    return () => form?.removeEventListener('reset', back);
  }, [initial.length]);
  useEffect(() => {
    if (!grew.current) return;
    grew.current = false;
    box.current?.querySelectorAll<HTMLInputElement>('input[name=itemName]')[n - 1]?.focus();
  }, [n]);
  return (
    <fieldset>
      <legend className="font-semibold">{title}</legend>
      <p className="text-[15px] text-muted">{hint}</p>
      <div ref={box} className="mt-2 space-y-2">
        <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2 text-[15px] text-muted"><span>{name}</span><span>{amount}</span></div>
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
            <input name="itemName" maxLength={40} aria-label={`${name} ${i + 1}`} defaultValue={initial[i]?.name} className={input} />
            <input name="itemAmount" inputMode="decimal" aria-label={`${amount} ${i + 1}`} defaultValue={initial[i]?.amount} className={input} />
          </div>
        ))}
      </div>
      {n < 30 && <button type="button" onClick={() => { grew.current = true; setN(n + 1); }} className={`mt-2 inline-flex min-h-11 items-center ${link}`}>{add}</button>}
    </fieldset>
  );
}
