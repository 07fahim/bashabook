'use client';

import { useEffect, useRef, useState } from 'react';
import { field } from './ui';

type Person = { id: string; name: string; joinedOn: string; leftOn: string | null };

/** "Who paid?" lists the people living here on the form's date, and follows the date field as it changes.
 *  A choice that drops out of the list falls back to the default. Without JavaScript it shows today's list; the server decides anyway. */
export function PayerSelect({ label, fundLabel, people, initial, today }: { label: string; fundLabel: string; people: Person[]; initial: string; today: string }) {
  const ref = useRef<HTMLSelectElement>(null);
  const [date, setDate] = useState(today), [picked, setPicked] = useState(initial);
  useEffect(() => {
    const form = ref.current?.form;
    const onInput = (e: Event) => { const t = e.target as HTMLInputElement; if (t.name === 'date' && t.value) setDate(t.value); };
    form?.addEventListener('input', onInput);
    return () => form?.removeEventListener('input', onInput);
  }, []);
  const here = people.filter(p => p.joinedOn <= date && (p.leftOn === null || p.leftOn >= date));
  const ok = (v: string) => v === 'fund' || here.some(p => p.id === v);
  const value = ok(picked) ? picked : ok(initial) ? initial : 'fund';
  return (
    <label className="block font-semibold">
      {label}
      <select ref={ref} name="who" value={value} onChange={e => setPicked(e.target.value)} className={field}>
        <option value="fund">{fundLabel}</option>
        {here.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  );
}
