import type { Db } from './db';

/** Every table a flat's rows live in, for the count before and after. */
export const FLAT_TABLES = ['flats', 'members', 'rooms', 'months', 'ledger', 'bill_split_members', 'bill_templates', 'month_balances', 'meal_changes', 'no_cook', 'audit_log', 'handovers', 'sessions', 'entry_checks', 'bazar_items', 'receipts'] as const;

/** How many rows of each table belong to the flat (sessions through its members). */
export async function flatRowCounts(db: Db, flatId: string) {
  const out: Record<string, number> = {};
  for (const t of FLAT_TABLES) {
    const where = t === 'flats' ? 'id = $1' : t === 'sessions' ? 'member_id in (select id from members where flat_id = $1)'
      : t === 'bill_split_members' ? 'ledger_id in (select id from ledger where flat_id = $1)' : 'flat_id = $1';
    out[t] = (await db<{ n: number }>(`select count(*)::int as n from ${t} where ${where}`, [flatId]))[0].n;
  }
  return out;
}

/** Deletes a whole flat: one statement, every row cascades from the flat row (schema: on delete cascade all the way down).
 *  App team only, on the flat's request (ops/data-retention.md). Returns false if there is no such flat. */
export async function deleteFlat(db: Db, flatId: string) {
  return (await db(`delete from flats where id = $1 returning id`, [flatId])).length > 0;
}
