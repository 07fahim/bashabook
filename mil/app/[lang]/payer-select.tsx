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
    const lives = (id: string, d: string) => people.some(p => p.id === id && p.joinedOn <= d && (p.leftOn === null || p.leftOn >= d));
    const onInput = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (t.name !== 'date' || !t.value) return;
      setDate(t.value);
      setPicked(v => (v === 'fund' || lives(v, t.value) ? v : initial));   // a pick that drops out goes back to the default for good
    };
    const onReset = () => { setDate(today); setPicked(initial); };       // a cleared form starts from today again
    form?.addEventListener('input', onInput);
    form?.addEventListener('reset', onReset);
    return () => { form?.removeEventListener('input', onInput); form?.removeEventListener('reset', onReset); };
  }, [people, initial, today]);
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
