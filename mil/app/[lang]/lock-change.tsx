import type { Meal } from '@/lib/meals';
import type { Dict } from './dictionaries';

/** Shown when tomorrow's count moved after the lock time, so whoever already told the cook tells them again. */
export function LockChange({ m, changes }: { m: Dict['meals']; changes: { meal: Meal; from: number; to: number }[] }) {
  if (!changes.length) return null;
  return (
    <p role="status" className="mt-3 rounded-xl border-2 border-turmeric p-3 font-semibold">
      {m.changedAfterLock.replace('{list}', changes.map(c => `${m.names[c.meal]} ${c.from} → ${c.to}`).join(', '))}
    </p>
  );
}
