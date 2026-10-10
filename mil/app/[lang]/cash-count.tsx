'use client';

import { useState } from 'react';
import { CASH_KEYS, parseCash, type Cash } from '@/lib/money';
import type { Dict } from './dictionaries';
import { fmtExact } from './format';
import { Field } from './ui';

/** The four cash boxes, with the counted total and how far it is from the app's fund while typing (same rules as the server). */
export function CashCount({ x, fund }: { x: Dict['money']; fund: number }) {
  const [raw, setRaw] = useState<Record<keyof Cash, string>>({ cash: '', bkash: '', nagad: '', bank: '' });
  const cash = parseCash(raw), total = cash ? cash.cash + cash.bkash + cash.nagad + cash.bank : 0, diff = total - fund;
  return (<>
    <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
      {CASH_KEYS.map(k => <Field key={k} label={x.cashMethods[k]} name={k} inputMode="decimal" placeholder="0" value={raw[k]} onChange={e => setRaw({ ...raw, [k]: e.target.value })} />)}
    </div>
    <p aria-live="polite" className="font-semibold">
      {!cash ? x.errors.cashBoxes : `${x.counted.replace('{t}', fmtExact(total))} · ${diff === 0 ? x.matches : (diff < 0 ? x.short : x.over).replace('{d}', fmtExact(diff))}`}
    </p>
  </>);
}
