// Real Realtime signals from the database (migration 022), Supabase test project only. Two throwaway flats, a raw listener on
// each flat's topic and the app's own live() on flat A: a write signals its own flat within a second and never the other; a
// statement writing many rows signals once; a whole month close signals a few times (one per statement), not once per row;
// the Notices page marking itself seen signals nothing; a new join code moves the flat to a new topic. Never prints the key.
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { createFlat, newFlatCode } from '../lib/auth';
import { closeMonth } from '../lib/close';
import type { Db } from '../lib/db';
import { deleteFlat } from '../lib/delete-flat';
import { live, type Sock } from '../lib/live';
import { openMonth } from '../lib/money-db';
import { markNoticesSeen } from '../lib/notices';

const url = process.env.DATABASE_URL ?? '';
const user = new URL(url).username;
if (user !== 'postgres.wgvoshlmhauxcymwdwjt') throw new Error('not the Supabase test project; refusing');   // the pooler host is shared with production
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!key) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY missing');
const base = `https://${user.split('.')[1]}.supabase.co`;
const sql = postgres(url, { max: 4, prepare: false, ssl: 'require', onnotice: () => {} });
const db: Db = (t, p = []) => sql.unsafe(t, p as never[]) as never;

let failed = 0;
const check = (label: string, ok: boolean, detail: unknown = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${JSON.stringify(detail)}`); };
const after = (ms: number) => new Promise(r => setTimeout(r, ms));

/** A raw listener: every 'changed' signal on the topic, with its arrival time. */
function listen(topic: string) {
  const got: number[] = [];
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(key!)}&vsn=1.0.0`);
  const joined = new Promise<void>((ok, bad) => {
    ws.onopen = () => ws.send(JSON.stringify({ topic: `realtime:${topic}`, event: 'phx_join', ref: '1', join_ref: '1',
      payload: { config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [], private: false }, access_token: key } }));
    ws.onmessage = e => {
      const m = JSON.parse(String(e.data));
      if (m.event === 'phx_reply' && m.ref === '1') { if (m.payload?.status === 'ok') ok(); else bad(new Error(JSON.stringify(m.payload))); }
      else if (m.event === 'broadcast') got.push(Date.now());
    };
    setTimeout(() => bad(new Error('join timeout')), 10000);
  });
  const hb = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: 'hb' })), 20000);
  return { got, joined, close: () => { clearInterval(hb); ws.close(); } };
}
const topicOf = async (flatId: string) => (await db<{ t: string }>(`select live_topic as t from flats where id = $1`, [flatId]))[0].t;

const [{ today }] = await db<{ today: string }>(`select ((now() at time zone 'Asia/Dhaka')::date)::text as today`);
const SEP = '2026-09-01';
const made: string[] = [];
const mk = async (name: string) => {
  const f = await createFlat(db, { flatName: `${name} ${randomUUID().slice(0, 6)}`, name: 'Nafis', pin: String(1000 + Math.floor(Math.random() * 9000)), others: ['Tahsin', 'Zarif'], today: SEP, lang: 'en' });
  made.push(f.flatId);
  await db(`update members set pin_hash = 'x' where flat_id = $1 and pin_hash is null`, [f.flatId]);   // all signed up, as the race scripts close
  await openMonth(db, f.flatId, SEP);
  return f;
};
try {
  const A = await mk('Live check A'), B = await mk('Live check B');
  const a = listen(await topicOf(A.flatId)), b = listen(await topicOf(B.flatId));
  let refreshes = 0;
  const stop = live({ url: base, key, topic: await topicOf(A.flatId), open: u => new WebSocket(u) as unknown as Sock, refresh: () => refreshes++, busy: () => false });
  await Promise.all([a.joined, b.joined]);
  await after(3000);   // a fresh socket's first signal took about 1.5 s in the probe

  // 1 one row on A: A hears it within a second, B never; live() refreshes once
  const t0 = Date.now();
  await db(`insert into rooms (flat_id, name, rent_share_poisha) values ($1, 'Live', 100)`, [A.flatId]);
  await after(2000);
  check('1 a write on A reaches A within 1 s', a.got.length === 1 && a.got[0] - t0 < 1000, { got: a.got.length, ms: a.got[0] - t0 });
  check('1 B hears nothing', b.got.length === 0, b.got.length);
  check('1 the app refreshed once', refreshes === 1, refreshes);

  // 2 one statement, many rows (next month opened with two monthly bills): one signal
  await db(`insert into bill_templates (flat_id, name, amount_poisha, split, selected_member_ids) values ($1, 'Gas', 100000, 'equal', '{}'), ($1, 'Wifi', 80000, 'equal', '{}')`, [A.flatId]);
  await after(1500);
  let n = a.got.length;
  const next = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1)).toISOString().slice(0, 10);
  await openMonth(db, A.flatId, next);
  await after(1500);
  check('2 one statement writing many rows sends one signal', a.got.length - n === 1, a.got.length - n);

  // 3 a whole month close: rows written in the hundreds, signals one per statement at most
  n = a.got.length;
  const r = await closeMonth(db, A.flatId, { memberId: A.memberId, role: 'manager' }, SEP, today, { cash: 0, bkash: 0, nagad: 0, bank: 0 });
  await after(2000);
  const [{ rows }] = await db<{ rows: number }>(`select count(*)::int as rows from meal_changes where flat_id = $1`, [A.flatId]);
  check('3 a month close signals 1 to 3 times, not per row', r.result === 'ok' && a.got.length - n >= 1 && a.got.length - n <= 3, { result: r.result, signals: a.got.length - n, mealRows: rows });

  // 4 the Notices page marking itself seen: nothing
  n = a.got.length;
  await markNoticesSeen(db, A.flatId, A.memberId);
  await after(1500);
  check('4 marking notices seen sends nothing', a.got.length === n, a.got.length - n);

  // 5 a new join code: the old topic hears it once (so open pages reload and pick up the new topic), then nothing more
  n = a.got.length;
  await newFlatCode(db, A.flatId, { memberId: A.memberId, role: 'manager' });
  await after(1500);
  check('5 the old topic hears the code change once', a.got.length - n === 1, a.got.length - n);
  n = a.got.length;
  const fresh = listen(await topicOf(A.flatId));
  await fresh.joined; await after(3000);
  await db(`insert into rooms (flat_id, name, rent_share_poisha) values ($1, 'After code', 100)`, [A.flatId]);
  await after(2000);
  check('5 the old topic hears nothing after a new code', a.got.length === n, a.got.length - n);
  check('5 the new topic hears the write', fresh.got.length === 1, fresh.got.length);

  check('B heard nothing all run', b.got.length === 0, b.got.length);
  stop(); a.close(); b.close(); fresh.close();
} catch (e) {
  check('run', false, String(e));
} finally {
  for (const id of made) await deleteFlat(db, id);
  await sql.end({ timeout: 2 });
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
