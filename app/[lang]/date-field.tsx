'use client';

import { useEffect, useId, useRef, useState, type ComponentProps } from 'react';
import type { Locale } from './dictionaries';
import { fmtDay } from './format';
import { field } from './ui';

/** A date picker that also writes the chosen day in words ('Sat, 10 October 2026'),
 *  because phones show the picker as 10/10/2026 in whatever order their language uses. */
export function DateField({ label, hint, lang, ...input }: { label: string; hint?: string; lang: Locale; name: string } & ComponentProps<'input'>) {
  const [value, setValue] = useState(String(input.defaultValue ?? '')), id = useId(), ref = useRef<HTMLInputElement>(null);   // unique: a page can have a date field per person
  useEffect(() => {   // a form reset (after a save) puts the default day back; the words follow it
    const f = ref.current?.form, back = () => setValue(String(input.defaultValue ?? ''));
    f?.addEventListener('reset', back); return () => f?.removeEventListener('reset', back);
  }, [input.defaultValue]);
  return (
    <label className="block font-semibold">
      {label}
      <input ref={ref} type="date" className={field} aria-describedby={id} {...input} onChange={e => setValue(e.target.value)} />
      <span id={id} className="mt-1 block text-[15px] font-normal">
        {/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${fmtDay(value, lang)} ${value.slice(0, 4)}` : ''}
      </span>
      {hint && <span className="mt-1 block text-[15px] font-normal text-muted">{hint}</span>}
    </label>
  );
}
