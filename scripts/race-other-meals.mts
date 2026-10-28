// Real-Postgres races for "changing a flatmate's meals" (migration 012), on the plan6b-test Neon copy only.
// Temporary: delete after the stage. Each race holds one transaction open after its write, starts the other operation on a
// second connection, checks whether it waits, then commits and checks the end state. Gap races run the other operation
// between a member's read and their write (hook before the write statement).
import postgres from 'postgres';
import { createFlat } from '../lib/auth';
import { closeMonth } from '../lib/close';
import type { Db } from '../lib/db';
import { addGuests, changedByOthers, cookAgain, noCooking, removeGuests, saveMeal, seedLock, setAway, cancelAway, setDefaults, setOtherMeal, setOwn, updateSettings } from '../lib/meals-db';
import { nowDhaka, type Meal } from '../lib/meals';

const url = process.env.DATABASE_URL ?? '';
if (new URL(url).username !== 'postgres.wgvoshlmhauxcymwdwjt') throw new Error('not the Supabase test project; refusing');   // the pooler host is shared with production
const sql = postgres(url, { max: 10, prepare: false, ssl: 'require', onnotice: () => {} });
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
/** A Db that runs `hook` (committed on its own connection) just before the first write statement of a member's change. */
const gap = (hook: () => Promise<unknown>): Db => {
  let fired = false;
  return async (t, p = []) => { if (!fired && /^\s*select locked_own_write/.test(t)) { fired = true; await hook(); } return db(t, p); };
};

const [{ today }] = await db<{ today: string }>(`select ((now() at time zone 'Asia/Dhaka')::date)::text as today`);
const day = (n: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const D = day(3), month = `${today.slice(0, 7)}-01`;
let n = 0;
async function flat() {
  const f = await createFlat(db, { flatName: `Race meals ${++n}`, name: 'Nafis', pin: String(1000 + Math.floor(Math.random() * 9000)), others: ['Fahim', 'Tahsin', 'Zarif'], today: '2026-09-01', lang: 'en' });
  const flatId = f.flatId;
  await db(`update members set pin_hash = 'x' where flat_id = $1 and pin_hash is null`, [flatId]);
  await db(`update flats set cutoff_time = '23:59:59' where id = $1`, [flatId]);
  await db(`insert into months (flat_id, month) values ($1, '2026-09-01'), ($1, '2026-10-01'), ($1, '2026-11-01') on conflict do nothing`, [flatId]);
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [flatId])).map(m => [m.name, m.id])) as Record<'Nafis' | 'Fahim' | 'Tahsin' | 'Zarif', string>;
  return {
    flatId, ids,
    other: (d: Db, actor: string, target: string, date: string, own: 0 | 1, seen: 0 | 1, meal: Meal = 'l') => setOtherMeal(d, flatId, actor, target, date, meal, own, seen),
    own: async (m: string, date = D, meal: Meal = 'l') => (await db<{ v: number }>(
      `select coalesce((select count - guests from meal_changes where member_id = $1 and date = $2::text::date and meal = $3),
         (select (case $3 when 'b' then default_b when 'l' then default_l else default_d end)::int from members where id = $1)) as v`, [m, date, meal]))[0].v,
    plates: async (m: string, date = D, meal: Meal = 'l') => (await db<{ count: number; guests: number }>(
      `select count, guests from meal_changes where member_id = $1 and date = $2::text::date and meal = $3`, [m, date, meal]))[0] ?? null,
    audits: async (actor: string) => (await db<{ n: number }>(`select count(*)::int as n from audit_log where entity = 'meal_changes' and by_member = $1 and entity_id like '%|%|%'`, [actor]))[0].n,
    row: (m: string, count: number, guests = 0, date = D, meal: Meal = 'l') => db(
      `insert into meal_changes (flat_id, member_id, date, meal, count, guests) values ($1, $2, $3::text::date, $4, $5, $6)
       on conflict (member_id, date, meal) do update set count = excluded.count, guests = excluded.guests`, [flatId, m, date, meal, count, guests]),
  };
}

async function main() {
  const now = nowDhaka();

  // 1. two flatmates on the same meal: the second's guard fails
  for (const withRow of [true, false]) {
    const f = await flat(); const { Fahim: F, Tahsin: T, Zarif: Z } = f.ids;
    if (withRow) await f.row(F, 1);
    const h = hold(tx => f.other(tx, T, F, D, 0, 1)); await h.started;
    const b = f.other(db, Z, F, D, 0, 1);
    const w = await waits(b); h.release(); const a = await h.done;
    check(`1${withRow ? 'a' : 'b'} two flatmates, ${withRow ? 'saved row' : 'no row'}: second waits, gets changed, writes nothing`,
      w && a === 'ok' && await b === 'changed' && await f.own(F) === 0 && await f.audits(Z) === 0, { w, a, b: await b });
  }
  // 2a. another flatmate holds; the person's own tap waits and is the later change
  {
    const f = await flat(); const { Fahim: F, Tahsin: T } = f.ids;
    const h = hold(tx => f.other(tx, T, F, D, 0, 1)); await h.started;
    const b = setOwn(db, f.flatId, F, D, 'l', 1, now);
    const w = await waits(b); h.release(); await h.done;
    check('2a flatmate then own tap: tap waits, wins (own on), both in history', w && await b === 'open' && await f.own(F) === 1 && await f.audits(T) === 1 && await f.audits(F) === 1, { w, own: await f.own(F) });
  }
  // 2b. the person's own tap holds; the flatmate's guard fails
  {
    const f = await flat(); const { Fahim: F, Tahsin: T } = f.ids;
    await f.row(F, 1);
    const h = hold(tx => setOwn(tx, f.flatId, F, D, 'l', 0, now)); await h.started;
    const b = f.other(db, T, F, D, 0, 1);
    const w = await waits(b); h.release(); await h.done;
    check('2b own tap then flatmate: flatmate waits, gets changed', w && await b === 'changed' && await f.own(F) === 0 && await f.audits(T) === 0, { w, b: await b });
  }
  // 3a/A4. a guest add with a flatmate's change committed between its read and its write: own stays off, guest added
  {
    const f = await flat(); const { Fahim: F, Tahsin: T } = f.ids;
    const r = await addGuests(gap(() => f.other(db, T, F, D, 0, 1)), f.flatId, F, D, 'l', 1, now);
    check('3a guest add across a flatmate change: own off kept, guest added', r === 'open' && JSON.stringify(await f.plates(F)) === JSON.stringify({ count: 1, guests: 1 }), { r, p: await f.plates(F) });
  }
  // 3b. remove guests across a flatmate change: own off kept, guests gone
  {
    const f = await flat(); const { Fahim: F, Tahsin: T } = f.ids;
    await f.row(F, 3, 2);
    const r = await removeGuests(gap(() => f.other(db, T, F, D, 0, 1)), f.flatId, F, D, 'l', now);
    check('3b remove guests across a flatmate change: own off kept, guests gone', r === 'open' && JSON.stringify(await f.plates(F)) === JSON.stringify({ count: 0, guests: 0 }), { r, p: await f.plates(F) });
  }
  // 4a. no cooking committed first: refused
  {
    const f = await flat(); const { Nafis: N, Fahim: F, Tahsin: T } = f.ids;
    await noCooking(db, f.flatId, N, D, D, ['l'], today);
    check('4a no cooking committed, then flatmate: closed', await f.other(db, T, F, D, 1, 0) === 'closed' && await f.audits(T) === 0);
  }
  // 4b. no cooking holds (flat lock): the flatmate waits, then closed
  {
    const f = await flat(); const { Nafis: N, Fahim: F, Tahsin: T } = f.ids;
    const h = hold(tx => noCooking(tx, f.flatId, N, D, D, ['l'], today)); await h.started;
    const b = f.other(db, T, F, D, 0, 1);
    const w = await waits(b); h.release(); await h.done;
    check('4b no cooking holds, flatmate waits: closed, no history', w && await b === 'closed' && await f.audits(T) === 0, { w, b: await b });
  }
  // 4c. the flatmate holds; no cooking waits, zeroes; cook again restores the flatmate's value
  {
    const f = await flat(); const { Nafis: N, Fahim: F, Tahsin: T } = f.ids;
    const h = hold(tx => f.other(tx, T, F, D, 0, 1)); await h.started;
    const b = noCooking(db, f.flatId, N, D, D, ['l'], today);
    const w = await waits(b); h.release(); await h.done; await b;
    const zero = await f.own(F);
    await cookAgain(db, f.flatId, N, D, D, ['l'], day(1));
    check('4c flatmate then no cooking (waits), cook again restores the flatmate\'s off', w && zero === 0 && await f.own(F) === 0, { w, zero, after: await f.own(F) });
  }
  // A3. cook again holds: a flatmate waits (flat lock) and sees the restored value; an own tap waits on the row and applies
  {
    const f = await flat(); const { Nafis: N, Fahim: F, Tahsin: T } = f.ids;
    await noCooking(db, f.flatId, N, D, D, ['l'], today);
    const h = hold(tx => cookAgain(tx, f.flatId, N, D, D, ['l'], day(1))); await h.started;
    const b = f.other(db, T, F, D, 1, 0);
    const w = await waits(b); h.release(); await h.done;
    check('A3a cook again holds, flatmate saw the zero: waits, changed', w && await b === 'changed' && await f.own(F) === 1, { w, b: await b, own: await f.own(F) });
    await noCooking(db, f.flatId, N, D, D, ['l'], today);
    const h2 = hold(tx => cookAgain(tx, f.flatId, N, D, D, ['l'], day(1))); await h2.started;
    const b2 = setOwn(db, f.flatId, F, D, 'l', 0, now);
    const w2 = await waits(b2); h2.release(); await h2.done;
    // the tap reads no cooking as still committed, so it is refused at once: serial order "tap, then cook again"
    check('A3b cook again holds, own tap: closed (no cooking still on), then cook again restores', await b2 === 'closed' && await f.own(F) === 1, { w2, r: await b2, own: await f.own(F) });
  }
  // A1. no cooking committed between an own tap's decision and its write: the write's guard refuses
  {
    const f = await flat(); const { Nafis: N, Fahim: F } = f.ids;
    await f.row(F, 0);
    const r = await setOwn(gap(() => noCooking(db, f.flatId, N, D, D, ['l'], today)), f.flatId, F, D, 'l', 1, now);
    check('A1 no cooking between own decision and write: closed, own stays off', r === 'closed' && await f.own(F) === 0, { r, own: await f.own(F) });
  }
  // A2. no cooking still in flight while an own tap writes (the known gap: the guard reads the statement's snapshot)
  {
    const f = await flat(); const { Nafis: N, Fahim: F } = f.ids;
    await f.row(F, 0);
    const h = hold(tx => noCooking(tx, f.flatId, N, D, D, ['l'], today)); await h.started;
    const b = setOwn(db, f.flatId, F, D, 'l', 1, now);
    const w = await waits(b); h.release(); await h.done;
    check('A2 no cooking in flight, own tap on: must not leave a plate on a no-cooking meal', await f.own(F) === 0, { w, r: await b, own: await f.own(F) });
  }
  // 5a. leaving shared meals holds (flat lock): the flatmate waits, then closed
  {
    const f = await flat(); const { Fahim: F, Tahsin: T } = f.ids;
    const h = hold(tx => setDefaults(tx, f.flatId, F, { b: false, l: false, d: false }, '2026-09-01', today, false)); await h.started;
    const b = f.other(db, T, F, D, 0, 1);
    const w = await waits(b); h.release(); await h.done;
    check('5a leaving shared meals holds, flatmate waits: closed', w && await b === 'closed' && await f.audits(T) === 0, { w, b: await b });
  }
  // 5b. the flatmate switches on (insert path) and holds; leaving shared meals waits, then clears the row
  {
    const f = await flat(); const { Fahim: F, Tahsin: T } = f.ids;
    await setDefaults(db, f.flatId, F, { b: true, l: false, d: true }, '2026-09-01', today, null);
    const h = hold(tx => f.other(tx, T, F, D, 1, 0)); await h.started;
    const b = setDefaults(db, f.flatId, F, { b: false, l: false, d: false }, '2026-09-01', today, false);
    const w = await waits(b); h.release(); await h.done; await b;
    check('5b flatmate on, then leaving shared meals (waits): the on row is cleared, nothing billed', w && await f.own(F) === 0, { w, own: await f.own(F), p: await f.plates(F) });
  }
  // 5c. a usual-meals change holds; the flatmate saw the old usual meal: changed
  {
    const f = await flat(); const { Fahim: F, Tahsin: T } = f.ids;
    const h = hold(tx => setDefaults(tx, f.flatId, F, { b: true, l: false, d: true }, '2026-09-01', today, null)); await h.started;
    const b = f.other(db, T, F, D, 0, 1);
    const w = await waits(b); h.release(); await h.done;
    check('5c usual meals change holds, flatmate waits: changed', w && await b === 'changed', { w, b: await b });
  }
  // 6a. away holds (no flat lock): the flatmate's write waits on the row, then the re-check rolls it back
  {
    const f = await flat(); const { Fahim: F, Tahsin: T } = f.ids;
    await f.row(F, 0);
    const h = hold(tx => setAway(tx, f.flatId, F, D, D)); await h.started;
    const b = f.other(db, T, F, D, 1, 0);
    const w = await waits(b); h.release(); await h.done;
    check('6a away holds, flatmate on: waits, re-check closed, rolled back', w && await b === 'closed' && await f.own(F) === 0 && await f.audits(T) === 0, { w, b: await b, own: await f.own(F) });
    check('6a no Home notice from the refused attempt', (await changedByOthers(db, f.flatId, F, today)).length === 0);
  }
  // 6b. the flatmate holds; away waits and overwrites
  {
    const f = await flat(); const { Fahim: F, Tahsin: T } = f.ids;
    const h = hold(tx => f.other(tx, T, F, D, 0, 1)); await h.started;
    const b = setAway(db, f.flatId, F, D, D);
    const w = await waits(b); h.release(); await h.done; await b;
    check('6b flatmate then away (waits): off, both in history', w && await f.own(F) === 0 && await f.audits(T) === 1, { w });
  }
  // 6c. cancel away in flight: the flatmate still sees away, closed
  {
    const f = await flat(); const { Fahim: F, Tahsin: T } = f.ids;
    await setAway(db, f.flatId, F, D, D);
    const h = hold(tx => cancelAway(tx, f.flatId, F, D, D)); await h.started;
    const b = f.other(db, T, F, D, 1, 0);
    await waits(b); h.release(); await h.done;
    check('6c cancel away in flight: flatmate closed (away still committed)', await b === 'closed' && await f.audits(T) === 0, { b: await b });
  }
  // 7. the collector's fix vs a flatmate, both orders
  {
    const f = await flat(); const { Nafis: N, Fahim: F, Tahsin: T } = f.ids;
    const h = hold(tx => saveMeal(tx, f.flatId, N, { memberId: F, date: D, meal: 'l', count: 0, guests: 0 }, false)); await h.started;
    const b = f.other(db, T, F, D, 0, 1);
    const w = await waits(b); h.release(); await h.done;
    check('7a collector holds, flatmate waits: changed', w && await b === 'changed', { w, b: await b });
    const h2 = hold(tx => f.other(tx, T, F, D, 1, 0)); await h2.started;
    const b2 = saveMeal(db, f.flatId, N, { memberId: F, date: D, meal: 'l', count: 0, guests: 0 }, false);
    const w2 = await waits(b2); h2.release(); await h2.done; await b2;
    check('7b flatmate holds, collector waits and wins', w2 && await f.own(F) === 0, { w2, own: await f.own(F) });
  }
  // 8a. move-out of the target holds (flat lock): closed
  {
    const f = await flat(); const { Nafis: N, Fahim: F, Tahsin: T } = f.ids;
    const h = hold(tx => tx(`select set_leaving($1, $2, $3, $4::text::date, $5::text::date) as r`, [f.flatId, N, F, day(2), today])); await h.started;
    const b = f.other(db, T, F, D, 0, 1);
    const w = await waits(b); h.release(); await h.done;
    check('8a move-out holds, flatmate waits: closed', w && await b === 'closed', { w, b: await b });
  }
  // 8b. a handover accept holds the flat: the flatmate waits, then ok
  {
    const f = await flat(); const { Nafis: N, Fahim: F, Tahsin: T, Zarif: Z } = f.ids;
    const [{ v }] = await db<{ v: number }>(`select offer_version as v from flats where id = $1`, [f.flatId]);
    await db(`select offer_handover($1, $2, $3, $4, 0)`, [f.flatId, N, T, v]);
    const [{ id }] = await db<{ id: string }>(`select id from handovers where flat_id = $1 and status = 'offered'`, [f.flatId]);
    const h = hold(tx => tx(`select accept_handover($1, $2, $3) as r`, [f.flatId, id, T])); await h.started;
    const b = f.other(db, Z, F, D, 0, 1);
    const w = await waits(b); h.release(); await h.done;
    check('8b accept holds the flat, flatmate waits: ok', w && await b === 'ok', { w, b: await b });
  }
  // 9a. the lock time moves to now (tomorrow locks) while the flatmate edits tomorrow
  {
    const f = await flat(); const { Nafis: N, Fahim: F, Tahsin: T } = f.ids;
    const h = hold(tx => updateSettings(tx, f.flatId, N, { cutoff: '00:00', weights: { b: 50, l: 100, d: 100 } }, now)); await h.started;
    const b = f.other(db, T, F, day(1), 0, 1);
    const w = await waits(b); h.release(); await h.done;
    check('9a cutoff moves to now (holds), flatmate on tomorrow waits: closed', w && await b === 'closed', { w, b: await b });
  }
  // 9b. seedLock with tomorrow locked, against a flatmate on a later day
  {
    const f = await flat(); const { Fahim: F, Tahsin: T } = f.ids;
    await db(`update flats set cutoff_time = '00:00' where id = $1`, [f.flatId]);
    const h = hold(tx => seedLock(tx, f.flatId, nowDhaka())); await h.started;
    const b = f.other(db, T, F, D, 0, 1);
    await waits(b); h.release(); await h.done;
    check('9b seedLock vs flatmate on a later day: ok, no error', await b === 'ok', { b: await b });
  }
  // 10. a deposit while the flatmate's call holds the flat and the month row
  {
    const f = await flat(); const { Fahim: F, Tahsin: T } = f.ids;
    const h = hold(tx => f.other(tx, T, F, D, 0, 1)); await h.started;
    const b = db(`insert into ledger (flat_id, month, type, amount_poisha, member_id, date, status, created_by)
      values ($1, $2::text::date, 'deposit', 50000, $3, $4::text::date, 'pending', $3) returning id`, [f.flatId, month, F, today]);
    const w = await waits(b); h.release(); await h.done; await b;
    check('10 deposit waits behind the flatmate call, both commit', w, { w });
  }
  // A5. the Home notice query can use the new index
  {
    const f = await flat();
    const plan = await sql.begin(async tx => {
      await tx.unsafe(`set local enable_seqscan = off`);
      const ex: Db = (t, p = []) => tx.unsafe(`explain ${t}`, p as never[]) as never;
      return (await changedByOthers(ex, f.flatId, f.ids.Fahim, today) as unknown as Record<string, string>[]).map(r => Object.values(r)[0]).join('\n');
    });
    check('A5 changedByOthers can use audit_log_flat_entity', plan.includes('audit_log_flat_entity'), plan.split('\n').slice(0, 6));
  }
  // 11/A6. deadlock storm: other-meal edits over two months, no cooking across the month boundary, usual meals, move-out,
  // own taps, deposits, and closing the previous month, all at once; no retry, so every 40P01 is counted
  {
    const f = await flat(); const { Nafis: N, Fahim: F, Tahsin: T, Zarif: Z } = f.ids;
    const days = [D, day(4), '2026-11-01', '2026-11-02'];
    const errs: Record<string, number> = {}; let oks = 0;
    const note = (op: string) => (e: { code?: string; message?: string }) => { const k = `${op}:${e.code ?? e.message?.slice(0, 40)}`; errs[k] = (errs[k] ?? 0) + 1; };
    for (let i = 0; i < 30; i++) {
      const d = days[i % days.length];
      const seen = (await f.own(F, d)) as 0 | 1;
      await Promise.all([
        f.other(db, T, F, d, seen ? 0 : 1, seen).then(r => { if (r === 'ok') oks++; }).catch(note('other')),
        f.other(db, Z, N, days[(i + 1) % days.length], 0, 1).catch(note('other2')),
        (i % 2 ? noCooking(db, f.flatId, N, '2026-10-30', '2026-11-02', ['d'], today) : cookAgain(db, f.flatId, N, '2026-10-30', '2026-11-02', ['d'], day(1))).catch(note('nocook')),
        setDefaults(db, f.flatId, Z, { b: i % 2 === 0, l: true, d: true }, '2026-09-01', today, null).catch(note('usual')),
        db(`select set_leaving($1, $2, $3, $4::text::date, $5::text::date)`, [f.flatId, N, Z, i % 2 ? '2026-12-31' : null, today]).catch(note('moveOut')),
        setOwn(db, f.flatId, F, days[(i + 2) % days.length], 'b', (i % 2) as 0 | 1, now).catch(note('ownTap')),
        db(`insert into ledger (flat_id, month, type, amount_poisha, member_id, date, status, created_by)
          values ($1, $2::text::date, 'deposit', 1000, $3, $4::text::date, 'pending', $3)`, [f.flatId, month, F, today]).catch(note('deposit')),
        i === 5 ? closeMonth(db, f.flatId, { memberId: N, role: 'manager' }, '2026-09-01', today, { cash: 0, bkash: 0, nagad: 0, bank: 0 }).catch(note('close')) : Promise.resolve(),
      ]);
    }
    check('11 deadlock storm (30 rounds, 8 writers, two months): no deadlocks or errors', Object.keys(errs).length === 0, errs);
    check('11 every ok flatmate change has exactly one history row; refused ones none', await f.audits(T) === oks, { oks, audits: await f.audits(T) });
  }

  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} passed`);
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => sql.end());
