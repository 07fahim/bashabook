// Real-Postgres races for Plan 7 item 1 (room, rent and weight changes while an ended month is open), Neon test copy only.
// Each case checks the end state in month_balances: if the close wins, a later change never alters the closed month; if the
// change wins, the close either uses it or returns 'changed' and closes with it on retry.
import postgres from 'postgres';
import { createFlat } from '../lib/auth';
import { closeMonth } from '../lib/close';
import type { Db } from '../lib/db';
import { flatMoney } from '../lib/handover';
import { setDefaults, updateSettings } from '../lib/meals-db';
import { addEntry, addRoom, openMonth, setRoom, type NewEntry } from '../lib/money-db';

const url = process.env.DATABASE_URL ?? '';
if (!new URL(url).hostname.startsWith('ep-calm-shape-')) throw new Error('not the test copy; refusing');
const sql = postgres(url, { max: 10, prepare: false, onnotice: () => {} });
const db: Db = (t, p = []) => sql.unsafe(t, p as never[]) as never;   // no deadlock retry: every 40P01 is seen

const results: string[] = [];
let failed = 0;
const check = (label: string, ok: boolean, detail: unknown = '') => {
  if (!ok) failed++;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + JSON.stringify(detail)}`);
};
/** Runs fn in a transaction and keeps it open until release(). */
function hold<T>(fn: (tx: Db) => Promise<T>) {
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  let ready!: (v: unknown) => void;
  const started = new Promise(r => (ready = r));
  const done = sql.begin(async tx => {
    const t: Db = (q, p = []) => tx.unsafe(q, p as never[]) as never;
    const r = await fn(t).catch(e => { ready(e); throw e; });
    ready(r);
    await gate;
    return r;
  }) as Promise<T>;
  return { started, release, done };
}
const waits = async (p: Promise<unknown>) =>
  (await Promise.race([p.then(() => false, () => false), new Promise(r => setTimeout(() => r(true), 800))])) as boolean;

const [{ today }] = await db<{ today: string }>(`select ((now() at time zone 'Asia/Dhaka')::date)::text as today`);
if (today < '2026-10-01') throw new Error('needs a Dhaka date on or after 1 October 2026');
const SEP = '2026-09-01', NOW = `${today}T10:00`, W1 = { b: 100, l: 100, d: 100 };
const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>): NewEntry =>
  ({ date: '2026-09-05', note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });
let n = 0;
async function flat() {
  const f = await createFlat(db, { flatName: `Race 7 ${++n}`, name: 'Nafis', pin: String(1000 + Math.floor(Math.random() * 9000)), others: ['Tahsin', 'Zarif'], today: SEP, lang: 'en' });
  const flatId = f.flatId;
  await db(`update members set pin_hash = 'x' where flat_id = $1 and pin_hash is null`, [flatId]);
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [flatId])).map(m => [m.name, m.id])) as Record<'Nafis' | 'Tahsin' | 'Zarif', string>;
  const nafis = { memberId: ids.Nafis, role: 'manager' as const };
  await setDefaults(db, flatId, ids.Tahsin, { b: false, l: true, d: true }, null, '2026-08-31');
  await openMonth(db, flatId, SEP);
  const big = (await addRoom(db, flatId, nafis, 'Big', 300000)) as string, small = (await addRoom(db, flatId, nafis, 'Small', 100000)) as string;
  for (const [who, r] of [['Nafis', big], ['Tahsin', small], ['Zarif', small]] as const) await setRoom(db, flatId, nafis, ids[who], r);
  await addEntry(db, flatId, nafis, e({ type: 'deposit', amount: 1300000, memberId: ids.Tahsin }));
  await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 400000, note: 'Rent', split: 'room' }));
  await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 900000 }));
  await openMonth(db, flatId, `${today.slice(0, 7)}-01`);
  const close = async (d: Db = db, afterLoad?: () => Promise<void>) =>
    closeMonth(d, flatId, nafis, SEP, today, { cash: Math.max(0, await flatMoney(db, flatId, today)), bkash: 0, nagad: 0, bank: 0 }, afterLoad);
  const frozen = async () => (await db<{ rent: number; food: number }>(
    `select bill_share::int as rent, food_cost::int as food from month_balances where flat_id = $1 and month = $2::date and member_id = $3`, [flatId, SEP, ids.Tahsin]))[0];
  const move = (d: Db, fix: boolean) => setRoom(d, flatId, nafis, ids.Tahsin, big, { today, fix });
  return { flatId, ids, close, frozen, move };
}

try {
  {
    const f = await flat();
    const h = hold(tx => f.close(tx)); await h.started;
    const m = f.move(db, true);
    const w = await waits(m);
    h.release(); const r = await h.done;
    const moved = await m;
    check('1 close holds, a ticked move waits; the close wins with the old rent and the move applies after',
      w && r.result === 'ok' && moved === true && (await f.frozen())?.rent === 50000, { w, r: r.result, moved, frozen: await f.frozen() });
  }
  {
    // deterministic: the ticked move commits on its own connection after the close has read the month, before it writes
    const f = await flat();
    const r1 = await f.close(db, async () => { await f.move(db, true); });
    const r2 = await f.close();
    check('2 a ticked move commits between the close’s read and write: changed, and the retry closes with ৳1,500',
      r1.result === 'changed' && r2.result === 'ok' && (await f.frozen())?.rent === 150000, { r1: r1.result, r2: r2.result, frozen: await f.frozen() });
  }
  {
    const f = await flat();
    const r1 = await f.close(db, async () => { await updateSettings(db, f.flatId, f.ids.Nafis, { cutoff: '22:00', weights: W1 }, NOW, true); });
    const r2 = await f.close();
    check('3 ticked meal weights commit between the close’s read and write: changed, and the retry closes with ৳2,250 food',
      r1.result === 'changed' && r2.result === 'ok' && (await f.frozen())?.food === 225000, { r1: r1.result, r2: r2.result, frozen: await f.frozen() });
    const [a] = await db<{ t: string; fixFor: string | null }>(
      `select jsonb_typeof(after) as t, after->>'fixFor' as "fixFor" from audit_log where flat_id = $1 and entity_id = 'flat|settings' order by id desc limit 1`, [f.flatId]);
    check('3 the history row is a JSON object naming the corrected month (not a double-encoded string)', a?.t === 'object' && a.fixFor === SEP, a);
  }
  {
    // truly concurrent, no assumption about timing: whichever way it lands, the closed month carries the correction exactly once
    const f = await flat();
    const h = hold(tx => f.move(tx, true)); await h.started;
    const c = f.close();
    await new Promise(r => setTimeout(r, 300));
    h.release(); await h.done;
    const r1 = await c, r2 = r1.result === 'changed' ? await f.close() : r1;
    check(`2c a ticked move and a close at the same time: closed with ৳1,500 (${r1.result === 'ok' ? 'read after the commit' : 'changed, then retried'})`,
      r2.result === 'ok' && (await f.frozen())?.rent === 150000, { r1: r1.result, r2: r2.result, frozen: await f.frozen() });
  }
  {
    const f = await flat();
    const refused = await f.move(db, false);
    const r = await f.close();
    check('4 without the tick the move is refused and the close keeps ৳500', refused === 'earlier' && r.result === 'ok' && (await f.frozen())?.rent === 50000,
      { refused, r: r.result, frozen: await f.frozen() });
  }
} catch (x) {
  check('no errors', false, String(x));
}

console.log(results.join('\n'));
console.log(`\n${results.length - failed}/${results.length} passed`);
await sql.end();
process.exit(failed ? 1 : 0);
