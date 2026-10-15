import type { Db } from './db';

export type Notice = {
  at: string; kind: 'paid' | 'handover' | 'handoverDone' | 'closeMonth' | 'meal' | 'account';
  actor: string | null; amount: number | null; date: string | null; meal: string | null; month: string | null;
  detail: Record<string, unknown> | null; pending: boolean;
};

/** Every important thing addressed to one person, from rows the app already writes. $1 flat, $2 me, $3 am I the collector.
 *  Pending rows carry their creation time, so an old unconfirmed deposit is not new again on every visit. */
const SOURCES = `
  select l.created_at as at, 'paid' as kind, m.name as actor, l.amount_poisha::int as amount, l.date::text as date, null::text as meal, null::text as month,
         jsonb_build_object('type', l.type) as detail, true as pending
    from ledger l join members m on m.flat_id = l.flat_id and m.id = l.member_id
   where l.flat_id = $1 and l.status = 'pending' and ((l.type = 'deposit' and $3::boolean) or (l.type = 'payout' and l.member_id = $2))
  union all
  select h.created_at, 'handover', f.name, h.amount::int, null, null, null, null, true
    from handovers h join members f on f.flat_id = h.flat_id and f.id = h.from_member
   where h.flat_id = $1 and h.status = 'offered' and h.to_member = $2
  union all
  select h.decided_at, 'handoverDone', t.name, h.amount::int, null, null, null, jsonb_build_object('status', h.status), false
    from handovers h join members t on t.flat_id = h.flat_id and t.id = h.to_member
   where h.flat_id = $1 and h.status in ('accepted', 'declined') and h.from_member = $2
  union all
  select (mo.month + interval '1 month')::timestamptz, 'closeMonth', null, null, null, null, mo.month::text, null, true
    from months mo
   where mo.flat_id = $1 and $3::boolean and mo.status = 'open' and mo.month < date_trunc('month', (now() at time zone 'Asia/Dhaka'))::date
  union all
  select a.at, 'meal', b.name, null, split_part(a.entity_id, '|', 2), split_part(a.entity_id, '|', 3), null, a.after, false
    from audit_log a join members b on b.flat_id = a.flat_id and b.id = a.by_member
   where a.flat_id = $1 and a.entity = 'meal_changes' and split_part(a.entity_id, '|', 1) = $2::text and a.by_member <> $2
     and a.entity_id not like '%|away'
  union all
  select a.at, 'account', b.name, null, null, null, null, a.after, false
    from audit_log a join members b on b.flat_id = a.flat_id and b.id = a.by_member
   where a.flat_id = $1 and a.entity = 'members' and a.entity_id = $2::text and a.by_member <> $2 and not a.after ? 'added'`;

export const listNotices = (db: Db, flatId: string, memberId: string, boss: boolean, limit = 50) => db<Notice>(
  `select at::text as at, kind, actor, amount, date, meal, month, detail, pending from (${SOURCES}) n order by at desc limit $4::int`,
  [flatId, memberId, boss, limit]);

export const noticeCount = async (db: Db, flatId: string, memberId: string, boss: boolean) =>
  (await db<{ n: number }>(
    `select count(*)::int as n from (${SOURCES}) n where n.at > (select notices_seen_at from members where flat_id = $1 and id = $2)`,
    [flatId, memberId, boss]))[0].n;

export const markNoticesSeen = async (db: Db, flatId: string, memberId: string) => {
  await db(`update members set notices_seen_at = now() where flat_id = $1 and id = $2`, [flatId, memberId]);
};
