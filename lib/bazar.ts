import { cleanText } from './auth';
import type { Db } from './db';
import { toPoisha } from './money';

/** One line of what a bazar bought: a name and, if written, what it cost (poisha). */
export type Item = { name: string; amount: number | null };
export const MAX_ITEMS = 30;

/** The form's item lines (names and amounts in the same order). An empty line is skipped; a line with an amount but no name,
 *  a name over 40 characters, an amount that isn't taka, or more than 30 lines: null. */
export function parseItems(names: string[], amounts: string[]): Item[] | null {
  const out: Item[] = [];
  for (let i = 0; i < Math.max(names.length, amounts.length); i++) {
    const name = cleanText(names[i]), raw = (amounts[i] ?? '').trim();
    if (!name && !raw) continue;
    const amount = raw ? toPoisha(raw) : null;
    if (!name || name.length > 40 || (raw && amount === null)) return null;
    out.push({ name, amount });
  }
  return out.length <= MAX_ITEMS ? out : null;
}

/** Item amounts may add up to less than the total (the rest is Other items), never more. */
export const itemsOk = (items: Item[], total: number) => items.length <= MAX_ITEMS
  && items.every(i => i.name.length >= 1 && i.name.length <= 40 && (i.amount === null || (Number.isInteger(i.amount) && i.amount > 0)))
  && items.reduce((a, i) => a + (i.amount ?? 0), 0) <= total;

/** What the item lines leave of the total, shown as Other items: only when some line has an amount. */
export const otherItems = (items: Item[], total: number) =>
  items.some(i => i.amount !== null) ? total - items.reduce((a, i) => a + (i.amount ?? 0), 0) : 0;

/** The flat summary's money lines for a month's own entries (a correction for a closed month stays out, as in Total bazar).
 *  Paid in = confirmed deposits; Total spent = bazar plus bills, whoever paid (a bazar bought with cash from Give money has
 *  a payer, so a flat-money-only total would leave out the flow the collector uses most). */
export function monthTotals(entries: { type: string; status: string; amount: number; forMonth: string | null }[]) {
  const sum = (t: string) => entries.filter(e => e.type === t && e.status === 'ok' && !e.forMonth).reduce((a, e) => a + e.amount, 0);
  const bazar = sum('bazar'), bills = sum('bill');
  return { bazar, bills, spent: bazar + bills, paidIn: sum('deposit') };
}

/** Every item line of a month's bazars, by entry id, in their order. */
export const itemsFor = async (db: Db, flatId: string, month: string) => new Map((await db<{ id: string; items: Item[] }>(
  `select i.ledger_id as id, json_agg(json_build_object('name', i.name, 'amount', i.amount_poisha::int) order by i.pos) as items
   from bazar_items i join ledger l on l.flat_id = i.flat_id and l.id = i.ledger_id
   where i.flat_id = $1 and l.month = $2::text::date group by i.ledger_id`, [flatId, month])).map(r => [r.id, r.items]));

/** A receipt photo, only for someone in the same flat. */
export async function receiptOf(db: Db, flatId: string, ledgerId: string) {
  const [r] = await db<{ photo: Uint8Array }>(`select photo from receipts where flat_id = $1 and ledger_id = $2`, [flatId, ledgerId]);
  return r?.photo ?? null;
}
