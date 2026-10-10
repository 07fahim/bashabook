// Real-Postgres races for Plan 6c (close fills a month's missing meal rows first), on the Neon test copy only.
// Each case checks the end state: the closed month's calendar (recomputed from loadMeals) equals its frozen bill
// (month_balances), and a row saved before the race is unchanged.
import postgres from 'postgres';
import { createFlat } from '../lib/auth';
import { closeMonth, freezeMonth } from '../lib/close';
import type { Db } from '../lib/db';
import { loadMeals, saveMeal, setDefaults } from '../lib/meals-db';
import { daysOfMonth, weightedMeals } from '../lib/meals';

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
const SEP = '2026-09-01', OFF = { b: false, l: false, d: false }, ZERO = { cash: 0, bkash: 0, nagad: 0, bank: 0 };
if (today < '2026-10-01') throw new Error('needs a Dhaka date on or after 1 October 2026 to close September');
let n = 0;
async function flat() {
  const f = await createFlat(db, { flatName: `Race 6c ${++n}`, name: 'Nafis', pin: String(1000 + Math.floor(Math.random() * 9000)), others: ['Tahsin', 'Zarif'], today: SEP, lang: 'en' });
  const flatId = f.flatId;
  await db(`update members set pin_hash = 'x' where flat_id = $1 and pin_hash is null`, [flatId]);
  await db(`insert into months (flat_id, month) values ($1, $2::text::date) on conflict do nothing`, [flatId, SEP]);
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [flatId])).map(m => [m.name, m.id])) as Record<'Nafis' | 'Tahsin' | 'Zarif', string>;
  const nafis = { memberId: ids.Nafis, role: 'manager' as const };
  // a saved row that differs from Tahsin's usual meal: it must survive every race
  await saveMeal(db, flatId, ids.Nafis, { memberId: ids.Tahsin, date: '2026-09-05', meal: 'l', count: 0, guests: 0 }, false);
  const close = (d: Db = db, afterLoad?: () => Promise<void>) => closeMonth(d, flatId, nafis, SEP, today, ZERO, afterLoad);
  const usualOff = (d: Db) => setDefaults(d, flatId, ids.Tahsin, OFF, SEP, today, false);
  /** The end state: closed; calendar equals bill for everyone; the saved row kept; Tahsin's other September days keep the old usual meal. */
  const settled = async (label: string) => {
    await agree(label);
    // the regression itself: usual meals change after the close; the closed month must not move
    await setDefaults(db, flatId, ids.Zarif, OFF, `${today.slice(0, 7)}-01`, today, false);
    await agree(`${label} + usual meals changed after the close`);
  };
  const agree = async (label: string) => {
    const [m] = await db<{ status: string }>(`select status from months where flat_id = $1 and month = $2::text::date`, [flatId, SEP]);
    const { flat: fl, members, changes } = await loadMeals(db, flatId, SEP, daysOfMonth(SEP).at(-1)!);
    const cal = weightedMeals(members, changes, SEP, fl.weights);
    const bill = await db<{ id: string; m: number }>(`select member_id as id, weighted_meals as m from month_balances where flat_id = $1 and month = $2::text::date`, [flatId, SEP]);
    const off = bill.filter(b => cal.get(b.id) !== b.m).map(b => ({ id: b.id, cal: cal.get(b.id), bill: b.m }));
    const [kept] = await db<{ count: number }>(`select count from meal_changes where member_id = $1 and date = '2026-09-05' and meal = 'l'`, [ids.Tahsin]);
    const [old] = await db<{ count: number }>(`select count from meal_changes where member_id = $1 and date = '2026-09-06' and meal = 'l'`, [ids.Tahsin]);
    check(`${label}: closed, calendar equals bill for all 3, saved row kept, old usual meal kept`,
      m.status === 'closed' && bill.length === 3 && !off.length && kept?.count === 0 && old?.count === 1, { status: m.status, bill: bill.length, off, kept, old });
  };
  return { flatId, ids, close, usualOff, settled };
}

try {
  {
    const f = await flat();
    await f.usualOff(db);
    check('1 usual meals committed first, then close: ok', (await f.close()).result === 'ok');
    await f.settled('1');
  }
  {
    const f = await flat();
    await freezeMonth(db, f.flatId, SEP);
    await f.usualOff(db);
    check('2 snapshot committed first, usual meals, then close: ok', (await f.close()).result === 'ok');
    await f.settled('2');
  }
  {
    const f = await flat();
    const h = hold(tx => f.usualOff(tx)); await h.started;
    const c = f.close();
    const w = await waits(c);
    h.release(); await h.done;
    const r = await c;
    check('3 usual meals held open, close starts: it waits, then closes', w && r.result === 'ok', { w, r: r.result });
    await f.settled('3');
  }
  {
    const f = await flat();
    const h = hold(tx => freezeMonth(tx, f.flatId, SEP)); await h.started;
    const u = f.usualOff(db);
    const w = await waits(u);
    h.release(); await h.done; await u;
    check('4 snapshot held open, usual meals start: they wait', w, { w });
    check('4 then close: ok', (await f.close()).result === 'ok');
    await f.settled('4');
  }
  {
    const f = await flat();
    const r1 = await f.close(db, async () => { await f.usualOff(db); });
    const r2 = await f.close();
    check('5 usual meals between the close’s load and write: changed, a retry closes', r1.result === 'changed' && r2.result === 'ok', { r1: r1.result, r2: r2.result });
    await f.settled('5');
  }
} catch (e) {
  check('no errors', false, String(e));
}

console.log(results.join('\n'));
console.log(`\n${results.length - failed}/${results.length} passed`);
await sql.end();
process.exit(failed ? 1 : 0);
