// Real-Postgres races, Neon test copy only: while September has ended but is still open, a ticked fix (rent, room or meal
// weights) holds; an unticked change saved at the same moment that puts the old value back would change September again.
// It must be asked (the tick), never applied silently from the value it read before the fix committed.
import postgres from 'postgres';
import { createFlat } from '../lib/auth';
import type { Db } from '../lib/db';
import { setDefaults, updateSettings } from '../lib/meals-db';
import { addEntry, addRoom, openMonth, setRent, setRoom, type NewEntry } from '../lib/money-db';

const url = process.env.DATABASE_URL ?? '';
if (!new URL(url).hostname.startsWith('ep-calm-shape-')) throw new Error('not the test copy; refusing');
const sql = postgres(url, { max: 10, prepare: false, onnotice: () => {} });
const db: Db = (t, p = []) => sql.unsafe(t, p as never[]) as never;

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
    const r = await fn((q, p = []) => tx.unsafe(q, p as never[]) as never);
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
const SEP = '2026-09-01', NOW = `${today}T10:00`, fix = (yes: boolean) => ({ today, fix: yes });
const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>): NewEntry =>
  ({ date: '2026-09-05', note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });
let n = 0;
async function flat() {
  const f = await createFlat(db, { flatName: `Race guard ${++n}`, name: 'Nafis', pin: String(1000 + Math.floor(Math.random() * 9000)), others: ['Tahsin'], today: SEP, lang: 'en' });
  const flatId = f.flatId;
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [flatId])).map(m => [m.name, m.id])) as Record<'Nafis' | 'Tahsin', string>;
  const nafis = { memberId: ids.Nafis, role: 'manager' as const };
  await setDefaults(db, flatId, ids.Tahsin, { b: false, l: true, d: true }, null, '2026-08-31');
  await openMonth(db, flatId, SEP);
  const big = (await addRoom(db, flatId, nafis, 'Big', 300000)) as string, small = (await addRoom(db, flatId, nafis, 'Small', 100000)) as string;
  await setRoom(db, flatId, nafis, ids.Nafis, big);
  await setRoom(db, flatId, nafis, ids.Tahsin, small);
  await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 400000, note: 'Rent', split: 'room' }));
  await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 900000 }));
  await openMonth(db, flatId, `${today.slice(0, 7)}-01`);
  const [w] = await db<{ b: number; l: number; d: number; cutoff: string }>(
    `select weight_b as b, weight_l as l, weight_d as d, to_char(cutoff_time, 'HH24:MI') as cutoff from flats where id = $1`, [flatId]);
  return { flatId, ids, nafis, big, small, w };
}

try {
  {
    const f = await flat();
    const h = hold(tx => setRent(tx, f.flatId, f.nafis, f.small, 150000, fix(true))); await h.started;
    const back = setRent(db, f.flatId, f.nafis, f.small, 100000, fix(false));
    const w = await waits(back);
    h.release(); await h.done;
    const r = await back;
    const [x] = await db<{ rent: number }>(`select rent_share_poisha::int as rent from rooms where id = $1`, [f.small]);
    check('rent: an unticked change back to ৳1,000, saved while a ticked fix to ৳1,500 holds, is asked and changes nothing',
      w && r === 'earlier' && x.rent === 150000, { w, r, x });
  }
  {
    const f = await flat();
    const h = hold(tx => setRoom(tx, f.flatId, f.nafis, f.ids.Tahsin, f.big, fix(true))); await h.started;
    const back = setRoom(db, f.flatId, f.nafis, f.ids.Tahsin, f.small, fix(false));
    const w = await waits(back);
    h.release(); await h.done;
    const r = await back;
    const [x] = await db<{ room: string }>(`select room_id::text as room from members where id = $1`, [f.ids.Tahsin]);
    check('room: an unticked move back to Small, saved while a ticked move to Big holds, is asked and changes nothing',
      w && r === 'earlier' && x.room === f.big, { w, r, x });
  }
  {
    const f = await flat();
    const W1 = { b: 100, l: 100, d: 100 }, W0 = { b: f.w.b, l: f.w.l, d: f.w.d };
    const h = hold(tx => updateSettings(tx, f.flatId, f.ids.Nafis, { cutoff: f.w.cutoff, weights: W1 }, NOW, true)); await h.started;
    const back = updateSettings(db, f.flatId, f.ids.Nafis, { cutoff: f.w.cutoff, weights: W0 }, NOW, false);
    const w = await waits(back);
    h.release(); await h.done;
    const r = await back;
    const [x] = await db<{ b: number }>(`select weight_b as b from flats where id = $1`, [f.flatId]);
    check(`weights: an unticked change back to breakfast ${W0.b / 100}, saved while a ticked fix to 1 holds, is asked and changes nothing`,
      W0.b !== 100 && w && r === 'earlier' && x.b === 100, { W0, w, r, x });
  }
  {
    // no race: the same unticked change made after the fix committed is asked too (the plain guard still works)
    const f = await flat();
    await setRent(db, f.flatId, f.nafis, f.small, 150000, fix(true));
    check('rent: the same change made afterwards is asked', await setRent(db, f.flatId, f.nafis, f.small, 100000, fix(false)) === 'earlier');
    check('rent: saving the rent it already has is not asked and writes nothing', await setRent(db, f.flatId, f.nafis, f.small, 150000, fix(false)) === false);
  }
  {
    // lock order: a ledger write dated September locks the flat, then September (migration 011). A lock-time-only save at
    // the same moment must take the flat first too, or the two deadlock.
    const f = await flat();
    let step!: () => void; const go = new Promise<void>(r => (step = r)); let locked!: () => void; const has = new Promise<void>(r => (locked = r));
    const ledger = sql.begin(async tx => {
      await tx.unsafe(`select 1 from flats where id = $1 for no key update`, [f.flatId]); locked(); await go;
      await tx.unsafe(`select 1 from months where flat_id = $1 and month = $2::date for no key update`, [f.flatId, SEP]);
    }).then(() => 'ok', x => String((x as { code?: string }).code ?? x));
    await has;
    const save = updateSettings(db, f.flatId, f.ids.Nafis, { cutoff: '21:30', weights: { b: f.w.b, l: f.w.l, d: f.w.d } }, NOW, false)
      .then(r => r, x => String((x as { code?: string }).code ?? x));
    await new Promise(r => setTimeout(r, 800)); step();
    const [l, s] = await Promise.all([ledger, save]);
    check('lock order: a lock-time-only save and a September ledger write at the same moment both finish (no deadlock)', l === 'ok' && s === 'ok', { l, s });
  }
} catch (x) {
  check('no errors', false, String(x));
}

console.log(results.join('\n'));
console.log(`\n${results.length - failed}/${results.length} passed`);
await sql.end();
process.exit(failed ? 1 : 0);
