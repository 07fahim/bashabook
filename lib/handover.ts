import type { Db } from './db';
import { loadMonth, type Actor } from './money-db';

/** All the flat money the collector should hold, in poisha: the latest closed month's frozen fund plus every open month
 *  after it. loadMonth carries that fund into the oldest open month only, so summing the open months' funds counts it once.
 *  Every month closed: the latest closed fund (not zero). */
export async function flatMoney(db: Db, flatId: string, today: string) {
  const [last] = await db<{ month: string; fund: number }>(
    `select month::text as month, closing_fund::float8 as fund from months where flat_id = $1 and status = 'closed' order by month desc limit 1`, [flatId]);
  const open = await db<{ month: string }>(
    `select month::text as month from months where flat_id = $1 and status = 'open' and month > coalesce($2::date, '-infinity'::date) order by month`,
    [flatId, last?.month ?? null]);
  if (!open.length) return last?.fund ?? 0;
  const funds = await Promise.all(open.map(({ month }) => loadMonth(db, flatId, month, today)));
  return funds.reduce((a, m) => a + m.result.fund, 0);
}

export type OfferResult = 'ok' | 'changed' | 'notCollector' | 'recipient' | 'waiting' | 'already' | 'negative';

/** The collector offers the flat money to a flatmate. `shown` is the amount the card showed: if the money moved since, nothing
 *  is offered. The version is read before the total, so any write in between makes the database function refuse. */
export async function offerHandover(db: Db, flatId: string, by: Actor, to: string, shown: number, today: string): Promise<OfferResult> {
  if (by.role !== 'manager') return 'notCollector';
  const [{ v }] = await db<{ v: number }>(`select offer_version as v from flats where id = $1`, [flatId]);
  const total = await flatMoney(db, flatId, today);
  if (total !== shown) return 'changed';
  const [r] = await db<{ r: OfferResult }>(`select offer_handover($1, $2, $3, $4, $5) as r`, [flatId, by.memberId, to, v, total]);
  return r.r;
}

/** The named recipient accepts: one database call; see accept_handover in migration 011. */
export async function acceptHandover(db: Db, flatId: string, me: string, id: string) {
  const [r] = await db<{ r: string }>(`select accept_handover($1, $2, $3) as r`, [flatId, id, me]);
  return r.r;
}

const decide = async (db: Db, flatId: string, id: string, sql: string, params: unknown[]) => {
  if ((await db(sql, params)).length) return 'ok';
  const [h] = await db<{ status: string }>(`select status from handovers where flat_id = $1 and id = $2`, [flatId, id]);
  return h?.status ?? 'gone';
};

/** "No, the amount isn't right": only the named recipient, only while waiting. Roles never change; no ledger entry. */
export const declineHandover = (db: Db, flatId: string, me: string, id: string) => decide(db, flatId, id,
  `update handovers set status = 'declined', decided_by = $3, decided_at = now()
   where flat_id = $1 and id = $2 and status = 'offered' and to_member = $3 returning 1`, [flatId, id, me]);

/** The offerer takes the offer back, only while waiting. */
export const cancelHandover = (db: Db, flatId: string, me: string, id: string) => decide(db, flatId, id,
  `update handovers set status = 'cancelled', decided_by = $3, decided_at = now()
   where flat_id = $1 and id = $2 and status = 'offered' and from_member = $3 returning 1`, [flatId, id, me]);

export async function currentOffer(db: Db, flatId: string) {
  const [o] = await db<{ id: string; from: string; to: string; amount: number }>(
    `select h.id, f.name as "from", t.name as "to", h.amount::float8 as amount
     from handovers h join members f on f.id = h.from_member join members t on t.id = h.to_member
     where h.flat_id = $1 and h.status = 'offered'`, [flatId]);
  return o ?? null;
}

/** Who got the role and how: newest first. The current holder comes from the role; this only explains it. */
export const handoverHistory = (db: Db, flatId: string) => db<{ status: 'accepted' | 'overridden'; from: string; to: string; amount: number | null; at: string }>(
  `select h.status, f.name as "from", t.name as "to", h.amount::float8 as amount, h.decided_at::text as at
   from handovers h join members f on f.id = h.from_member join members t on t.id = h.to_member
   where h.flat_id = $1 and h.status in ('accepted', 'overridden') order by h.decided_at desc`, [flatId]);

/** My latest offer, if it ended without a handover and nothing newer happened: the Flat tab says why.
 *  `stale` = cancelled by nobody (no decided_by): the money changed, someone's move-out changed, or the offerer was replaced. */
export async function lastOutcome(db: Db, flatId: string, me: string) {
  const [o] = await db<{ status: string; to: string; stale: boolean; fromMe: boolean }>(
    `select h.status, t.name as "to", (h.status = 'cancelled' and h.decided_by is null) as "stale", h.from_member = $2 as "fromMe"
     from handovers h join members t on t.id = h.to_member where h.flat_id = $1 order by h.created_at desc limit 1`, [flatId, me]);
  return o && o.fromMe && (o.status === 'declined' || o.status === 'cancelled')
    ? { status: o.status as 'declined' | 'cancelled', to: o.to, stale: o.stale } : null;
}

/** The latest offer made to me, for Home: waiting, or how it ended. `recent` = decided in the last 24 hours and still the flat's latest handover. */
export async function myLatestHandover(db: Db, flatId: string, me: string) {
  const [o] = await db<{ id: string; status: string; from: string; amount: number; decidedBy: string | null; recent: boolean }>(
    `select h.id, h.status, f.name as "from", h.amount::float8 as amount, h.decided_by as "decidedBy",
       coalesce(h.decided_at > now() - interval '24 hours', false)
         and not exists (select 1 from handovers n where n.flat_id = h.flat_id and n.created_at > h.created_at) as recent
     from handovers h join members f on f.id = h.from_member
     where h.flat_id = $1 and h.to_member = $2 order by h.created_at desc limit 1`, [flatId, me]);
  return o ?? null;
}

export async function pendingCount(db: Db, flatId: string) {
  const [r] = await db<{ n: number }>(`select count(*)::int as n from ledger where flat_id = $1 and status = 'pending'`, [flatId]);
  return r.n;
}

/** App team only (scripts/override-collector.mts). */
export async function overrideCollector(db: Db, flatId: string, to: string, reason: string, admin: string) {
  const [r] = await db<{ r: 'ok' | 'noCollector' | 'recipient' | 'reason' }>(`select override_collector($1, $2, $3, $4) as r`, [flatId, to, reason, admin]);
  return r.r;
}
