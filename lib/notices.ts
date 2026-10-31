import type { Db } from './db';
import { CONFIRMER } from './money-db';

export type Notice = {
  at: string; kind: 'paid' | 'handover' | 'handoverDone' | 'closeMonth' | 'meal' | 'account' | 'rejected' | 'today';
  actor: string | null; amount: number | null; date: string | null; meal: string | null; month: string | null;
  detail: Record<string, unknown> | null; pending: boolean;
};

/** Every important thing addressed to one person, from rows the app already writes. $1 flat, $2 me, $3 am I the collector. A waiting money row is mine when I answer it (CONFIRMER); its actor is whoever wrote it.
 *  Pending rows carry their creation time, so an old unconfirmed deposit is not new again on every visit.
 *  The meal row carries the change (own plate, and whether guests moved), not the stored state, so the text names what happened.
 *  An account row by the app team has no by_member: its actor is null. A rejected row tells its writer who said That's not right.
 *  A today row is someone else's change to today's meals, made today (the same changes lib/meal-push sends): only to people
 *  who eat with the flat or the collector, not muted (meal_push), never their own change, never a change to my own meal
 *  (the meal row says that). detail.k is the push kind, so the bell uses the push's words. */
const SOURCES = `
  select l.created_at as at, 'paid' as kind, w.name as actor, l.amount_poisha::int as amount, l.date::text as date, null::text as meal, null::text as month,
         jsonb_build_object('type', l.type, 'gave', l.type = 'deposit' and l.member_id = $2) as detail, true as pending
    from ledger l join members w on w.flat_id = l.flat_id and w.id = l.created_by
   where l.flat_id = $1 and l.status = 'pending' and ${CONFIRMER} = $2 and l.created_by <> $2
  union all
  select h.created_at, 'handover', f.name, h.amount::int, null, null, null, null, true
    from handovers h join members f on f.flat_id = h.flat_id and f.id = h.from_member
   where h.flat_id = $1 and h.status = 'offered' and h.to_member = $2
  union all
  select h.decided_at, 'handoverDone', t.name, h.amount::int, null, null, null, jsonb_build_object('status', h.status), false
    from handovers h join members t on t.flat_id = h.flat_id and t.id = h.to_member
   where h.flat_id = $1 and h.status in ('accepted', 'declined') and h.from_member = $2
  union all
  select (mo.month + interval '1 month')::timestamp at time zone 'Asia/Dhaka', 'closeMonth', null, null, null, null, mo.month::text, null, false
    from months mo
   where mo.flat_id = $1 and $3::boolean and mo.status = 'open' and mo.month < date_trunc('month', (now() at time zone 'Asia/Dhaka'))::date
  union all
  select a.at, 'meal', b.name, null, split_part(a.entity_id, '|', 2), split_part(a.entity_id, '|', 3), null,
         jsonb_build_object('own', (a.after->>'count')::int - coalesce((a.after->>'guests')::int, 0),
                            'guestsChanged', coalesce((a.after->>'guests')::int, 0) <> coalesce((a.before->>'guests')::int, 0)), false
    from audit_log a join members b on b.flat_id = a.flat_id and b.id = a.by_member
   where a.flat_id = $1 and a.entity = 'meal_changes' and a.entity_id like $2::text || '|%' and split_part(a.entity_id, '|', 1) = $2::text
     and a.by_member <> $2 and a.entity_id not like '%|away'
  union all
  select a.at, 'rejected', b.name, (a.before->>'amount_poisha')::int, a.before->>'date', null, null, null, false
    from audit_log a join members b on b.flat_id = a.flat_id and b.id = a.by_member
   where a.flat_id = $1 and a.entity = 'ledger' and a.after->>'rejected' = 'true' and a.before->>'created_by' = $2::text
  union all
  select a.at, 'account', b.name, null, null, null, null, a.after, false
    from audit_log a left join members b on b.flat_id = a.flat_id and b.id = a.by_member
   where a.flat_id = $1 and a.entity = 'members' and a.entity_id = $2::text and a.by_member is distinct from $2 and not a.after ? 'added' and not a.after ? 'locked'
  union all
  select a.at, 'today', b.name, null, null, null, null,
         jsonb_build_object('who', w.name, 'meals', coalesce(a.after->>'meals', split_part(a.entity_id, '|', 3)), 'k', case
           when a.entity_id = 'flat|nocook' then case when a.after ? 'nocook' then 'noCook' else 'cookAgain' end
           when a.entity_id like '%|away' then 'away'
           when split_part(a.entity_id, '|', 1) <> a.by_member::text then 'other'
           when coalesce((a.after->>'guests')::int, 0) > coalesce((a.before->>'guests')::int, 0) then 'guestsAdd'
           when coalesce((a.after->>'guests')::int, 0) < coalesce((a.before->>'guests')::int, 0) then 'guestsGone'
           when (a.after->>'count')::int - coalesce((a.after->>'guests')::int, 0) > 0 then 'on' else 'off' end), false
    from audit_log a join members b on b.flat_id = a.flat_id and b.id = a.by_member
    left join members w on w.flat_id = a.flat_id and w.id::text = split_part(a.entity_id, '|', 1)
    cross join (select (now() at time zone 'Asia/Dhaka')::date as d) today
   where a.flat_id = $1 and a.entity = 'meal_changes' and a.by_member <> $2 and split_part(a.entity_id, '|', 1) <> $2::text
     and (a.at at time zone 'Asia/Dhaka')::date = today.d
     and exists (select 1 from members v where v.flat_id = $1 and v.id = $2 and v.meal_push and (v.in_meals or v.role = 'manager'))
     and ((a.entity_id ~ '^[^|]+[|][0-9]{4}-[0-9]{2}-[0-9]{2}[|][bld]$' and split_part(a.entity_id, '|', 2)::date = today.d)
          or (a.entity_id like '%|away' and (a.after->'away'->>0)::date = today.d)
          or (a.entity_id = 'flat|nocook' and today.d between coalesce(a.after->'nocook'->>0, a.after->'cookAgain'->>0)::date
                                                       and coalesce(a.after->'nocook'->>1, a.after->'cookAgain'->>1)::date))`;

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
