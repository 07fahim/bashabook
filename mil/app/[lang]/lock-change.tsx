import type { Meal } from '@/lib/meals';
import { toldCookAction } from './actions';
import type { Dict, Locale } from './dictionaries';
import { secondary } from './ui';

/** Shown when tomorrow's count moved after the lock time, so whoever already told the cook tells them again.
 *  The button sends the count on this screen: it becomes the baseline, and the warning goes for everyone. */
export function LockChange({ m, lang, date, hc, changes }: {
  m: Dict['meals']; lang: Locale; date: string; hc: Record<Meal, number>; changes: { meal: Meal; from: number; to: number }[];
}) {
  if (!changes.length) return null;
  return (
    <div role="status" className="mt-3 rounded-xl border-2 border-turmeric p-3">
      <p className="font-semibold">{m.changedAfterLock.replace('{list}', changes.map(c => `${m.names[c.meal]} ${c.from} → ${c.to}`).join(', '))}</p>
      <form action={toldCookAction} className="mt-3">
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="date" value={date} />
        {(Object.keys(hc) as Meal[]).map(x => <input key={x} type="hidden" name={x} value={hc[x]} />)}
        <button className={secondary}>{m.toldCook}</button>
      </form>
    </div>
  );
}
