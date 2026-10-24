// Real-Postgres races for Plan 7 item 10, Neon test copy only: a room or rent change made while another one is still
// uncommitted must record, as its old value, whatever that other change left committed (its new value, or the original
// value if it rolled back), never a stale one.
import postgres from 'postgres';
import { createFlat } from '../lib/auth';
import type { Db } from '../lib/db';
import { addRoom, openMonth, setRent, setRoom } from '../lib/money-db';

const url = process.env.DATABASE_URL ?? '';
if (!new URL(url).hostname.startsWith('ep-muddy-mud-')) throw new Error('not the test copy; refusing');
const sql = postgres(url, { max: 10, prepare: false, onnotice: () => {} });
const db: Db = (t, p = []) => sql.unsafe(t, p as never[]) as never;

const results: string[] = [];
let failed = 0;
const check = (label: string, ok: boolean, detail: unknown = '') => {
  if (!ok) failed++;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + JSON.stringify(detail)}`);
};
/** Runs fn in a transaction and keeps it open until release(); rollback() ends it without committing. */
function hold<T>(fn: (tx: Db) => Promise<T>) {
  let finish!: (commit: boolean) => void;
  const gate = new Promise<boolean>(r => (finish = r));
  let ready!: (v: unknown) => void;
  const started = new Promise(r => (ready = r));
  const done = sql.begin(async tx => {
    const r = await fn((q, p = []) => tx.unsafe(q, p as never[]) as never);
    ready(r);
    if (!(await gate)) throw new Error('rollback');
    return r;
  }).catch(e => { if (String(e).includes('rollback')) return 'rolled back'; throw e; });
  return { started, release: () => finish(true), rollback: () => finish(false), done };
}
const waits = async (p: Promise<unknown>) =>
  (await Promise.race([p.then(() => false, () => false), new Promise(r => setTimeout(() => r(true), 800))])) as boolean;

const [{ today }] = await db<{ today: string }>(`select ((now() at time zone 'Asia/Dhaka')::date)::text as today`);
let n = 0;
async function flat() {
  const f = await createFlat(db, { flatName: `Race history ${++n}`, name: 'Nafis', pin: String(1000 + Math.floor(Math.random() * 9000)), others: ['Tahsin'], today, lang: 'en' });
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
  const nafis = { memberId: ids.Nafis, role: 'manager' as const };
  await openMonth(db, f.flatId, `${today.slice(0, 7)}-01`);
  const big = (await addRoom(db, f.flatId, nafis, 'Big', 300000)) as string, small = (await addRoom(db, f.flatId, nafis, 'Small', 100000)) as string;
  await setRoom(db, f.flatId, nafis, ids.Tahsin, small);
  const last = async (entityId: string) => (await db<{ before: Record<string, unknown> | null; after: Record<string, unknown> }>(
    `select before, after from audit_log where flat_id = $1 and entity = 'rooms' and entity_id = $2 order by id desc limit 1`, [f.flatId, entityId]))[0];
  return { flatId: f.flatId, ids, nafis, big, small, last };
}

try {
  for (const commit of [true, false]) {
    const f = await flat();
    const h = hold(tx => setRent(tx, f.flatId, f.nafis, f.big, 350000)); await h.started;
    const second = setRent(db, f.flatId, f.nafis, f.big, 400000);
    const w = await waits(second);
    (commit ? h.release : h.rollback)(); await h.done;
    const ok = await second, a = await f.last(f.big), want = commit ? 350000 : 300000;
    check(`rent: a change waiting on another that ${commit ? 'commits' : 'rolls back'} records ৳${(want / 100).toLocaleString('en-US')} → ৳4,000`,
      w && ok === true && a.before?.rent_share_poisha === want && a.after.rent_share_poisha === 400000, { w, ok, a });
  }
  for (const commit of [true, false]) {
    const f = await flat();
    const h = hold(tx => setRoom(tx, f.flatId, f.nafis, f.ids.Tahsin, f.big)); await h.started;
    const second = setRoom(db, f.flatId, f.nafis, f.ids.Tahsin, null);
    const w = await waits(second);
    (commit ? h.release : h.rollback)(); await h.done;
    const ok = await second, a = await f.last(f.ids.Tahsin), want = commit ? 'Big' : 'Small';
    check(`room: a move waiting on another that ${commit ? 'commits' : 'rolls back'} records ${want} → no room`,
      w && ok === true && a.before?.room === want && a.after.roomId === null, { w, ok, a });
  }
  {
    // a change back to the original value while another holds: applied after it, never skipped as "nothing changed"
    const f = await flat();
    const h = hold(tx => setRent(tx, f.flatId, f.nafis, f.big, 350000)); await h.started;
    const back = setRent(db, f.flatId, f.nafis, f.big, 300000);
    const w = await waits(back);
    h.release(); await h.done;
    const ok = await back, a = await f.last(f.big);
    check('rent: a change back to ৳3,000 waiting on one to ৳3,500 is applied and records ৳3,500 → ৳3,000',
      w && ok === true && a.before?.rent_share_poisha === 350000 && a.after.rent_share_poisha === 300000, { w, ok, a });
  }
  {
    const f = await flat();
    const h = hold(tx => setRoom(tx, f.flatId, f.nafis, f.ids.Tahsin, f.big)); await h.started;
    const back = setRoom(db, f.flatId, f.nafis, f.ids.Tahsin, f.small);
    const w = await waits(back);
    h.release(); await h.done;
    const ok = await back, a = await f.last(f.ids.Tahsin);
    check('room: a move back to Small waiting on one to Big is applied and records Big → Small',
      w && ok === true && a.before?.room === 'Big' && a.after.room === 'Small', { w, ok, a });
  }
} catch (x) {
  check('no errors', false, String(x));
}

console.log(results.join('\n'));
console.log(`\n${results.length - failed}/${results.length} passed`);
await sql.end();
process.exit(failed ? 1 : 0);
