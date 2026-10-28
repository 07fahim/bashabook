// Real-Postgres races for the collector's check (020), Supabase test project only. A check waits for a close holding the
// month row, then writes nothing into the closed month. A close waits for a check holding it, then closes (a check moves no
// version). A check tapped while a Fix it is still saving writes nothing. Two checkers at once: one lands. A waiting handover
// stays valid through checks. Then storms of the same on many connections, counting deadlocks.
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { createFlat } from '../lib/auth';
import { checkEntry, fixEntry } from '../lib/bazar';
import { closeMonth } from '../lib/close';
import type { Db } from '../lib/db';
import { deleteFlat } from '../lib/delete-flat';
import { acceptHandover, flatMoney, offerHandover } from '../lib/handover';
import { addEntry, openMonth, type Actor } from '../lib/money-db';

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
/** Nafis (collector), Tahsin, Zarif, all signed up; September and this month open; ৳50,000 deposited in September; `n` bazars
 *  in September, alternately added by Nafis from flat money (Tahsin or Zarif may check) and by Tahsin paying himself (Nafis may). */
async function flat(n = 1) {
  const f = await createFlat(db, { flatName: `Race check ${randomUUID().slice(0, 6)}`, name: 'Nafis', pin: String(1000 + Math.floor(Math.random() * 9000)), others: ['Tahsin', 'Zarif'], today: SEP, lang: 'en' });
  made.push(f.flatId);
  await db(`update members set pin_hash = 'x' where flat_id = $1 and pin_hash is null`, [f.flatId]);
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id])) as Record<'Nafis' | 'Tahsin' | 'Zarif', string>;
  const nafis: Actor = { memberId: ids.Nafis, role: 'manager' }, tahsin: Actor = { memberId: ids.Tahsin, role: 'member' }, zarif: Actor = { memberId: ids.Zarif, role: 'member' };
  await openMonth(db, f.flatId, SEP);
  await openMonth(db, f.flatId, `${today.slice(0, 7)}-01`);
  await addEntry(db, f.flatId, nafis, { type: 'deposit', amount: 5000000, date: '2026-09-02', note: null, paidBy: null, memberId: ids.Nafis, split: null, selected: [] });
  const entries: { id: string; byNafis: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const id = randomUUID(), byNafis = i % 2 === 0;
    const r = await addEntry(db, f.flatId, byNafis ? nafis : tahsin, { id, type: 'bazar', amount: 100000 + i, date: '2026-09-05', note: null, paidBy: byNafis ? null : ids.Tahsin, memberId: null, split: null, selected: [] });
    if (r !== 'ok') throw new Error(`bazar ${i}: ${r}`);
    entries.push({ id, byNafis });
  }
  return { flatId: f.flatId, ids, nafis, tahsin, zarif, id: entries[0].id, entries };
}
type F = Awaited<ReturnType<typeof flat>>;
const rows = async (id: string) => (await db(`select 1 from entry_checks where ledger_id = $1`, [id])).length;
const audits = async (id: string) => (await db(`select 1 from audit_log where entity = 'ledger' and entity_id = $1 and after ? 'checked'`, [id])).length;
const close = (f: F) => async () => closeMonth(db, f.flatId, f.nafis, SEP, today, { cash: await flatMoney(db, f.flatId, today), bkash: 0, nagad: 0, bank: 0 });
const status = async (f: F) => (await db<{ s: string }>(`select status as s from months where flat_id = $1 and month = $2::text::date`, [f.flatId, SEP]))[0].s;

try {
  { // 1. a close holds September's month row: the check waits, then finds the month closed
    const f = await flat();
    const c = hold(tx => tx(`update months set status = 'closed', closed_at = now() where flat_id = $1 and month = $2::text::date returning 1`, [f.flatId, SEP]));
    await c.started;
    const tap = checkEntry(db, f.flatId, f.zarif, f.id, 'ok', null, today);
    check('1 a check waits for a close in progress', await waits(tap));
    c.release(); await c.done;
    check('1 then writes nothing into the closed month', (await tap) === null && (await rows(f.id)) === 0);
  }
  { // 2. a check holds the month row: a close waits, then goes through (no version moved)
    const f = await flat();
    const tap = hold(tx => checkEntry(tx, f.flatId, f.zarif, f.id, 'ok', null, today));
    await tap.started;
    const v = (await db<{ v: number }>(`select version as v from months where flat_id = $1 and month = $2::text::date`, [f.flatId, SEP]))[0].v;
    const c = db(`update months set status = 'closed' where flat_id = $1 and month = $2::text::date and version = $3 returning 1`, [f.flatId, SEP, v]);
    check('2 a close waits for a check in progress', await waits(c));
    tap.release(); await tap.done;
    check('2 then closes: the check moved no version', (await c).length === 1 && (await rows(f.id)) === 1);
  }
  { // 3. Fix it is saving: a check on the same entry writes nothing
    const f = await flat();
    await checkEntry(db, f.flatId, f.zarif, f.id, 'fix', 'Rice price', today);
    const fx = hold(tx => fixEntry(tx, f.flatId, f.nafis, { id: f.id, type: 'bazar', amount: 90000, date: '2026-09-05', paidBy: f.ids.Tahsin, note: null, items: [], receipt: null }, today));
    await fx.started;
    const tap = checkEntry(db, f.flatId, f.zarif, f.id, 'ok', null, today);
    const blocked = await waits(tap);
    fx.release(); const r = await fx.done;
    check(`3 a check during a fix writes nothing (waited: ${blocked})`, r.result === 'ok' && (await tap) === null && (await rows(f.id)) === 0, { r, rows: await rows(f.id) });
  }
  { // 4. a check held open while the recipient accepts a waiting handover: the accept goes through
    const f = await flat();
    const offered = await offerHandover(db, f.flatId, f.nafis, f.ids.Tahsin, await flatMoney(db, f.flatId, today), today);
    const [h] = await db<{ id: string }>(`select id from handovers where flat_id = $1 and status = 'offered'`, [f.flatId]);
    const tap = hold(tx => checkEntry(tx, f.flatId, f.zarif, f.id, 'ok', null, today));
    await tap.started;
    const acc = acceptHandover(db, f.flatId, f.ids.Tahsin, h.id);
    const blocked = await waits(acc);
    tap.release(); await tap.done;
    check(`4 a check in progress leaves a waiting handover valid (accept waited: ${blocked})`, offered === 'ok' && (await acc) === 'ok' && (await rows(f.id)) === 1, { offered, acc: await acc });
  }

  // Storms: the same operations at once on up to 20 connections, ROUNDS times each
  { // A. Verified tapped twice on each of 6 bazars by both people allowed (or the collector twice), against closes started over 1.6 s
    let closed = 0, bad = 0;
    for (let k = 0; k < ROUNDS; k++) {
      const f = await flat(6), c = close(f);
      const taps = f.entries.flatMap(e => e.byNafis
        ? [[f.tahsin, e.id, 'ok'], [f.zarif, e.id, 'ok']] as const
        : [[f.nafis, e.id, 'ok'], [f.nafis, e.id, 'ok']] as const);
      const out = await Promise.all([
        ...taps.map(async ([by, id, s]) => { await jitter(400); return safe(checkEntry(db, f.flatId, by, id, s, null, today)); }),
        ...[0, 400, 900, 1600].map(async ms => { await after(ms); return safe(c()); })]);
      const landed = out.slice(0, taps.length).filter(r => r && r !== 'error').length;
      const per = await Promise.all(f.entries.map(async e => [await rows(e.id), await audits(e.id)]));
      let st = await status(f);
      if (st === 'closed') closed++;
      else if ((await c()).result === 'ok') st = await status(f);   // nothing left stuck: the next close goes through
      const allOk = (await db(`select 1 from ledger l join entry_checks c on c.ledger_id = l.id and c.state = 'ok' where l.flat_id = $1 and l.type = 'bazar'`, [f.flatId])).length === f.entries.length;
      if (per.some(([r, a]) => r !== 1 || a !== 1) || landed !== f.entries.length || st !== 'closed' || !allOk) bad++;
    }
    check(`A checks vs closes: ${ROUNDS} rounds × 12 checks + 4 closes, ${closed} closed mid-storm, the rest by the next close; one check row and one history row per entry, closed only with all Verified`, bad === 0, { bad });
  }
  { // B. Fix it saving while the old checker and the new one tap Verified
    let landedAfter = 0, bad = 0;
    for (let k = 0; k < ROUNDS; k++) {
      const f = await flat();
      await checkEntry(db, f.flatId, f.zarif, f.id, 'fix', 'Rice price', today);
      const [fx, a, b] = await Promise.all([
        safe(fixEntry(db, f.flatId, f.nafis, { id: f.id, type: 'bazar', amount: 90000, date: '2026-09-05', paidBy: f.ids.Tahsin, note: null, items: [{ name: 'Rice', amount: 50000 }], receipt: null }, today)),
        (async () => { await jitter(1500); return safe(checkEntry(db, f.flatId, f.zarif, f.id, 'ok', null, today)); })(),
        (async () => { await jitter(1500); return safe(checkEntry(db, f.flatId, f.tahsin, f.id, 'ok', null, today)); })()]);
      const n = await rows(f.id);
      // a Verified may land only after the fix committed (then it is on the fixed values): its history row comes later
      const order = await db<{ k: string }>(`select case when after ? 'fixed' then 'fix' else 'check' end as k from audit_log
        where entity = 'ledger' and entity_id = $1 and (after ? 'fixed' or after->>'checked' = 'ok') order by id`, [f.id]);
      if (n) landedAfter++;
      if (fx === 'error' || fx.result !== 'ok' || a === 'error' || b === 'error' || n > 1 || (n === 1 && order.map(o => o.k).join() !== 'fix,check')) bad++;
    }
    check(`B fix vs two checks: ${ROUNDS} rounds, every fix saved, ${landedAfter} Verified landed after the fix committed, none before`, bad === 0, { bad });
  }
  { // C. two checkers at once on the collector's own bazar (Verified and Needs correction)
    const won = { ok: 0, fix: 0 };
    let bad = 0;
    for (let k = 0; k < ROUNDS * 2; k++) {
      const f = await flat();
      const [a, b] = await Promise.all([safe(checkEntry(db, f.flatId, f.tahsin, f.id, 'ok', null, today)),
        safe(checkEntry(db, f.flatId, f.zarif, f.id, 'fix', 'Too much', today))]);
      const landed = [a, b].filter(r => r && r !== 'error').length;
      if (a && a !== 'error') won.ok++; if (b && b !== 'error') won.fix++;
      if (landed !== 1 || (await rows(f.id)) !== 1 || (await audits(f.id)) !== 1) bad++;
    }
    check(`C two checkers at once: ${ROUNDS * 2} rounds, exactly one lands each time (Verified ${won.ok}, Needs correction ${won.fix})`, bad === 0, { bad, won });
  }
  { // D. a waiting handover accepted while 6 checks land
    let bad = 0;
    for (let k = 0; k < ROUNDS; k++) {
      const f = await flat(6);
      const offered = await offerHandover(db, f.flatId, f.nafis, f.ids.Tahsin, await flatMoney(db, f.flatId, today), today);
      const [h] = await db<{ id: string }>(`select id from handovers where flat_id = $1 and status = 'offered'`, [f.flatId]);
      const out = await Promise.all([
        ...f.entries.map(async e => { await jitter(); return safe(checkEntry(db, f.flatId, e.byNafis ? f.zarif : f.nafis, e.id, 'ok', null, today)); }),
        (async () => { await jitter(); return safe(acceptHandover(db, f.flatId, f.ids.Tahsin, h.id)); })()]);
      // each check still lands once: the rule allows each checker before and after the handover
      const per = await Promise.all(f.entries.map(async e => [await rows(e.id), await audits(e.id)]));
      if (offered !== 'ok' || out.at(-1) !== 'ok' || out.slice(0, -1).some(r => !r || r === 'error') || per.some(([r, a]) => r !== 1 || a !== 1)) bad++;
    }
    check(`D handover accept vs checks: ${ROUNDS} rounds × 6 checks, every accept ok, every check landed once`, bad === 0, { bad });
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
