import type { Db } from './db';

/** What the browser's PushSubscription.toJSON() gives, and what web-push needs. */
export type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } };

const STAYING = "(left_on is null or left_on >= (now() at time zone 'Asia/Dhaka')::date)";

/** One row per browser. The endpoint is unique: a browser that subscribes again as someone else moves to them.
 *  At most 5 browsers per person: a sixth is ignored, so one person can't fill the table or slow every reminder run. */
export const savePush = async (db: Db, flatId: string, memberId: string, s: PushSub) => {
  await db(
    `insert into push_subs (flat_id, member_id, endpoint, p256dh, auth)
     select $1, $2, $3, $4, $5 where (select count(*) from push_subs where member_id = $2 and endpoint <> $3) < 5
     on conflict (endpoint) do update set flat_id = excluded.flat_id, member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    [flatId, memberId, s.endpoint, s.keys.p256dh, s.keys.auth]);
};

export const removePush = async (db: Db, memberId: string, endpoint: string) => {
  await db(`delete from push_subs where member_id = $1 and endpoint = $2`, [memberId, endpoint]);
};

/** Every subscription of these members, leavers excluded (they stop the day after left_on, like sign-in). */
export const subsFor = (db: Db, memberIds: string[]) => memberIds.length === 0 ? Promise.resolve([] as PushSub[]) : db<PushSub>(
  `select p.endpoint, jsonb_build_object('p256dh', p.p256dh, 'auth', p.auth) as keys
   from push_subs p join members m on m.id = p.member_id where p.member_id = any($1::uuid[]) and ${STAYING} order by p.endpoint`, [memberIds]);
