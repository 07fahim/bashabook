// Real-Postgres races for money between two people (spec 2026-10-29), Supabase test project only. Yes and That's not right
// from two phones: one lands. That's not right and the collector's Remove: removed once, one history row. A Yes or That's not
// right and a month close: the close counts it or refuses while it waits, never closes with it waiting. Money received saved
// just as a handover is accepted: the collector who wrote it stays its holder. Then storms of each, counting deadlocks.
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { createFlat } from '../lib/auth';
import { closeMonth } from '../lib/close';
import type { Db } from '../lib/db';
import { deleteFlat } from '../lib/delete-flat';
import { acceptHandover, flatMoney, offerHandover } from '../lib/handover';
import { addEntry, confirmEntry, openMonth, rejectEntry, removeEntry, type Actor } from '../lib/money-db';

const url = process.env.DATABASE_URL ?? '';
if (new URL(url).username !== 'postgres.wgvoshlmhauxcymwdwjt') throw new Error('not the Supabase test project; refusing');   // the pooler host is shared with production
const ROUNDS = Number(process.env.ROUNDS ?? 8);
const sql = postgres(url, { max: 20, prepare: false, ssl: 'require', onnotice: () => {} });
const db: Db = (t, p = []) => sql.unsafe(t, p as never[]) as never;   // no deadlock retry: every 40P01 is seen

const results: string[] = [];
let failed = 0, deadlocks = 0, errors = 0;
const check = (label: string, ok: boolean, detail: unknown = '') => {
  if (!ok) failed++;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + JSON.stringify(detail)}`);
};
/** Any error is counted (a deadlock apart) and returned as 'error' so a storm runs to its end. */
const safe = <T,>(p: Promise<T>) => p.catch(e => {
  if ((e as { code?: string }).code === '40P01') deadlocks++; else { errors++; console.error(String(e)); }
  return 'error' as const;
});
/** Runs fn in a transaction and keeps it open until release(). */
function hold<T>(fn: (tx: Db) => Promise<T>) {
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  let ready!: (v: unknown) => void;
  const started = new Promise(r => (ready = r));
  const done = sql.begin(async tx => {
    const r = await fn((q, p = []) => tx.unsafe(q, p as never[]) as never).catch(e => { ready(e); throw e; });
    ready(r);
    await gate;
    return r;
  }) as Promise<T>;
  return { started, release, done };
}
const waits = async (p: Promise<unknown>) =>
  (await Promise.race([p.then(() => false, () => false), new Promise(r => setTimeout(() => r(true), 800))])) as boolean;
const jitter = (ms = 40) => new Promise(r => setTimeout(r, Math.random() * ms));
const after = (ms: number) => new Promise(r => setTimeout(r, ms));

const [{ today }] = await db<{ today: string }>(`select ((now() at time zone 'Asia/Dhaka')::date)::text as today`);
if (today < '2026-10-01') throw new Error('needs a Dhaka date on or after 1 October 2026');
const SEP = '2026-09-01';
const made: string[] = [];   // every flat this run makes, deleted at the end
const received = (id: string, from: string, date: string) =>
  ({ id, type: 'deposit' as const, amount: 50000, date, note: null, paidBy: null, memberId: from, split: null, selected: [] });
/** Nafis (collector), Tahsin, Zarif, all signed up; September and this month open; Nafis wrote that Tahsin gave him ৳500 on
 *  5 September (Money received), waiting for Tahsin. */
async function flat() {
  const f = await createFlat(db, { flatName: `Race confirm ${randomUUID().slice(0, 6)}`, name: 'Nafis', pin: String(1000 + Math.floor(Math.random() * 9000)), others: ['Tahsin', 'Zarif'], today: SEP, lang: 'en' });
  made.push(f.flatId);
  await db(`update members set pin_hash = 'x' where flat_id = $1 and pin_hash is null`, [f.flatId]);
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id])) as Record<'Nafis' | 'Tahsin' | 'Zarif', string>;
  const nafis: Actor = { memberId: ids.Nafis, role: 'manager' }, tahsin: Actor = { memberId: ids.Tahsin, role: 'member' };
  await openMonth(db, f.flatId, SEP);
  await openMonth(db, f.flatId, `${today.slice(0, 7)}-01`);
  const id = randomUUID();
  const r = await addEntry(db, f.flatId, nafis, received(id, ids.Tahsin, '2026-09-05'));
  if (r !== 'ok') throw new Error(`received: ${r}`);
  return { flatId: f.flatId, ids, nafis, tahsin, id };
}
type F = Awaited<ReturnType<typeof flat>>;
/** The entry's status, or 'gone'. */
const row = async (f: F) => (await db<{ s: string }>(`select status as s from ledger where id = $1`, [f.id]))[0]?.s ?? 'gone';
/** The entry's history rows in order: added, ok (a Yes), rejected (That's not right), removed (Remove). */
const audits = async (f: F) => (await db<{ k: string }>(
  `select case when after->>'rejected' = 'true' then 'rejected' when after->>'removed' = 'true' then 'removed'
     when after->>'status' = 'ok' then 'ok' else 'added' end as k
   from audit_log where entity = 'ledger' and entity_id = $1 order by id`, [f.id])).map(a => a.k).join();
const status = async (f: F) => (await db<{ s: string }>(`select status as s from months where flat_id = $1 and month = $2::text::date`, [f.flatId, SEP]))[0].s;
/** Tahsin's frozen paid in for September, or null while it is open. */
const paidIn = async (f: F) => (await db<{ p: number }>(
  `select paid_in::int as p from month_balances where flat_id = $1 and month = $2::text::date and member_id = $3`, [f.flatId, SEP, f.ids.Tahsin]))[0]?.p ?? null;
const close = (f: F) => async () => closeMonth(db, f.flatId, f.nafis, SEP, today, { cash: Math.max(0, await flatMoney(db, f.flatId, today)), bkash: 0, nagad: 0, bank: 0 });

try {
  { // 1. a Yes in progress: That's not right from the other phone waits, then finds nothing waiting
    const f = await flat();
    const yes = hold(tx => confirmEntry(tx, f.flatId, f.tahsin, f.id)); await yes.started;
    const no = rejectEntry(db, f.flatId, f.tahsin, f.id);
    check('1 That’s not right waits for a Yes in progress', await waits(no));
    yes.release(); await yes.done;
    check('1 then finds nothing waiting: the Yes stands', (await no) === null && (await row(f)) === 'ok' && (await audits(f)) === 'added,ok',
      { no: await no, row: await row(f), audits: await audits(f) });
  }
  { // 2. That's not right in progress: the Yes waits, then finds nothing
    const f = await flat();
    const no = hold(tx => rejectEntry(tx, f.flatId, f.tahsin, f.id)); await no.started;
    const yes = confirmEntry(db, f.flatId, f.tahsin, f.id);
    check('2 a Yes waits for That’s not right in progress', await waits(yes));
    no.release(); const writer = await no.done;
    check('2 then finds nothing: gone once, in the history as not right', writer === f.ids.Nafis && (await yes) === false && (await row(f)) === 'gone' && (await audits(f)) === 'added,rejected',
      { writer, yes: await yes, row: await row(f), audits: await audits(f) });
  }
  { // 3. That's not right in progress: the collector's Remove waits, then removes nothing
    const f = await flat();
    const no = hold(tx => rejectEntry(tx, f.flatId, f.tahsin, f.id)); await no.started;
    const rm = removeEntry(db, f.flatId, f.nafis, f.id, today);
    check('3 the collector’s Remove waits for That’s not right in progress', await waits(rm));
    no.release(); await no.done;
    check('3 then removes nothing: one history row', (await rm) === false && (await audits(f)) === 'added,rejected', { rm: await rm, audits: await audits(f) });
  }
  { // 4. a Yes in progress: a close waits or refuses, and never closes with the entry waiting
    const f = await flat();
    const yes = hold(tx => confirmEntry(tx, f.flatId, f.tahsin, f.id)); await yes.started;
    const c = closeMonth(db, f.flatId, f.nafis, SEP, today, { cash: 50000, bkash: 0, nagad: 0, bank: 0 });
    const blocked = await waits(c);
    yes.release(); await yes.done;
    const r = (await c).result;
    check(`4 a close during a Yes (waited: ${blocked}, result: ${r}) closes only with it counted`,
      r === 'ok' ? (await paidIn(f)) === 50000 : (await status(f)) === 'open', { r, paidIn: await paidIn(f) });
  }

  // Storms: the same operations at once on up to 20 connections
  { // A. Yes and That's not right from Tahsin's two phones at once
    const won = { yes: 0, no: 0 };
    let bad = 0;
    for (let k = 0; k < ROUNDS * 2; k++) {
      const f = await flat();
      const [y, n] = await Promise.all([
        (async () => { await jitter(); return safe(confirmEntry(db, f.flatId, f.tahsin, f.id)); })(),
        (async () => { await jitter(); return safe(rejectEntry(db, f.flatId, f.tahsin, f.id)); })()]);
      if (y === true) won.yes++;
      if (n === f.ids.Nafis) won.no++;
      const a = await audits(f), r = await row(f);
      if (!((y === true && n === null && r === 'ok' && a === 'added,ok') || (y === false && n === f.ids.Nafis && r === 'gone' && a === 'added,rejected'))) bad++;
    }
    check(`A Yes vs That’s not right: ${ROUNDS * 2} rounds, exactly one lands each time (Yes ${won.yes}, not right ${won.no})`, bad === 0, { bad });
  }
  { // B. That's not right and the collector's Remove at once
    const won = { no: 0, rm: 0 };
    let bad = 0;
    for (let k = 0; k < ROUNDS * 2; k++) {
      const f = await flat();
      const [n, m] = await Promise.all([
        (async () => { await jitter(); return safe(rejectEntry(db, f.flatId, f.tahsin, f.id)); })(),
        (async () => { await jitter(); return safe(removeEntry(db, f.flatId, f.nafis, f.id, today)); })()]);
      if (n === f.ids.Nafis) won.no++;
      if (m === true) won.rm++;
      const a = await audits(f), r = await row(f);
      if (r !== 'gone' || !((n === f.ids.Nafis && m === false && a === 'added,rejected') || (n === null && m === true && a === 'added,removed'))) bad++;
    }
    check(`B That’s not right vs Remove: ${ROUNDS * 2} rounds, removed once with one history row (not right ${won.no}, Remove ${won.rm})`, bad === 0, { bad });
  }
  { // C. a Yes (even rounds) or That's not right (odd rounds) against closes started over 0.9 s
    let closedMid = 0, bad = 0;
    for (let k = 0; k < ROUNDS; k++) {
      const f = await flat(), c = close(f), yes = k % 2 === 0;
      const out = await Promise.all([
        (async () => { await jitter(400); return safe<boolean | string | null>(yes ? confirmEntry(db, f.flatId, f.tahsin, f.id) : rejectEntry(db, f.flatId, f.tahsin, f.id)); })(),
        ...[0, 200, 500, 900].map(async ms => { await after(ms); return safe(c()); })]);
      let st = await status(f);
      if (st === 'closed') closedMid++;
      else if ((await c()).result === 'ok') st = await status(f);   // nothing left stuck: the next close goes through
      const r = await row(f), p = await paidIn(f);
      if (out[0] === 'error' || st !== 'closed' || (yes ? r !== 'ok' || p !== 50000 : r !== 'gone' || p !== 0)) bad++;
    }
    check(`C taps vs closes: ${ROUNDS} rounds × 1 tap + 4 closes, ${closedMid} closed mid-storm, the rest by the next close; never closed with the entry waiting`, bad === 0, { bad });
  }
  { // D. Nafis saves Money received from Zarif while Tahsin accepts the handover Nafis offered
    let accepted = 0, bad = 0;
    for (let k = 0; k < ROUNDS; k++) {
      const f = await flat();
      await confirmEntry(db, f.flatId, f.tahsin, f.id);   // nothing waits, so the offer can be made
      const offered = await offerHandover(db, f.flatId, f.nafis, f.ids.Tahsin, await flatMoney(db, f.flatId, today), today);
      const [h] = await db<{ id: string }>(`select id from handovers where flat_id = $1 and status = 'offered'`, [f.flatId]);
      const id = randomUUID();
      // Nafis's page still says he collects: his save may land just after the role moved
      const [acc, add] = await Promise.all([
        (async () => { await jitter(); return safe(acceptHandover(db, f.flatId, f.ids.Tahsin, h.id)); })(),
        (async () => { await jitter(); return safe(addEntry(db, f.flatId, f.nafis, received(id, f.ids.Zarif, today))); })()]);
      if (acc === 'ok') accepted++;
      const [d] = await db<{ h: string; s: string }>(`select held_by as h, status as s from ledger where id = $1`, [id]);
      const bosses = await db(`select 1 from members where flat_id = $1 and role = 'manager'`, [f.flatId]);
      const zarif: Actor = { memberId: f.ids.Zarif, role: 'member' };
      if (offered !== 'ok' || add !== 'ok' || (acc !== 'ok' && acc !== 'changed') || d?.h !== f.ids.Nafis || d?.s !== 'pending' || bosses.length !== 1
        || !(await confirmEntry(db, f.flatId, zarif, id))) bad++;
    }
    check(`D handover accept vs Money received: ${ROUNDS} rounds, ${accepted} accepted; always held by the collector who wrote it and waiting for Zarif’s Yes`, bad === 0, { bad });
  }
} catch (x) {
  check('no errors', false, String(x));
} finally {
  for (const id of made) await deleteFlat(db, id);
}
check(`no deadlocks (${deadlocks}) and no other errors (${errors})`, deadlocks === 0 && errors === 0);

console.log(results.join('\n'));
console.log(`\n${results.length - failed}/${results.length} passed`);
await sql.end();
process.exit(failed ? 1 : 0);
