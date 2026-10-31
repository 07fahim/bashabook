// Real-Postgres races for Plan 6b on the plan6b-test Neon branch only. Temporary: delete after Plan 6b.
// Each race holds one transaction open after its first write, starts the other operation on a second connection,
// checks that it waits, then commits (or rolls back) the first and checks the end state.
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFlat } from '../lib/auth';
import { setDefaults, updateSettings } from '../lib/meals-db';
import { db as appDb, type Db } from '../lib/db';

const url = process.env.DATABASE_URL ?? '';
if (new URL(url).username !== 'postgres.wgvoshlmhauxcymwdwjt') throw new Error('not the Supabase test project; refusing');   // the pooler host is shared with production
const TEST_FLAT = process.env.TEST_FLAT_CODE ?? '';   // join code of a flat with closed months on the test copy; the cascade check is skipped without it
const sql = postgres(url, { max: 8, prepare: false, ssl: 'require', onnotice: () => {} });
const db: Db = (t, p = []) => sql.unsafe(t, p as never[]) as never;

const results: string[] = [];
let failed = 0;
const check = (label: string, ok: boolean, detail: unknown = '') => {
  if (!ok) failed++;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + JSON.stringify(detail)}`);
};

/** Runs fn in a transaction and keeps it open until release(). */
function hold(fn: (tx: Db) => Promise<unknown>, rollback = false) {
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  let ready!: (v: unknown) => void;
  const started = new Promise(r => (ready = r));
  const done = sql.begin(async tx => {
    const t: Db = (q, p = []) => tx.unsafe(q, p as never[]) as never;
    const r = await fn(t).catch(e => { ready(e); throw e; });
    ready(r);
    await gate;
    if (rollback) throw new Error('rollback on purpose');
    return r;
  }).catch(e => (rollback && e.message === 'rollback on purpose' ? 'rolled back' : Promise.reject(e)));
  return { started, release, done };
}
/** true when p is still waiting after 800 ms (it is blocked on a lock). */
const waits = async (p: Promise<unknown>) =>
  (await Promise.race([p.then(() => false, () => false), new Promise(r => setTimeout(() => r(true), 800))])) as boolean;

let n = 0;
async function flat() {
  const f = await createFlat(db, { flatName: `Race 6b ${++n}`, name: 'Nafis', pin: String(1000 + Math.floor(Math.random() * 9000)), others: ['Tahsin', 'Zarif'], today: '2026-09-01', lang: 'en' });
  const flatId = f.flatId;
  await db(`update members set pin_hash = 'x' where flat_id = $1 and pin_hash is null`, [flatId]);
  await db(`insert into months (flat_id, month) values ($1, '2026-09-01'), ($1, '2026-10-01') on conflict do nothing`, [flatId]);
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [flatId])).map(m => [m.name, m.id])) as Record<'Nafis' | 'Tahsin' | 'Zarif', string>;
  const name = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  const r = async (d: Db, q: string, p: unknown[]) => (await d<{ r: string }>(q, p))[0].r;
  const v = async () => (await db<{ v: number }>(`select offer_version as v from flats where id = $1`, [flatId]))[0].v;
  const api = {
    flatId, ids, v,
    offer: async (d: Db, by: string, to: string, seen?: number) => r(d, `select offer_handover($1, $2, $3, $4, 1000) as r`, [flatId, by, to, seen ?? await v()]),
    accept: (d: Db, id: string, me: string) => r(d, `select accept_handover($1, $2, $3) as r`, [flatId, id, me]),
    override: (d: Db, to: string) => r(d, `select override_collector($1, $2, 'phone lost', 'race test') as r`, [flatId, to]),
    leave: (d: Db, by: string, m: string, day: string | null) => r(d, `select set_leaving($1, $2, $3, $4::date, '2026-10-10'::date) as r`, [flatId, by, m, day]),
    decline: async (d: Db, id: string, me: string) => (await d(`update handovers set status = 'declined', decided_by = $3, decided_at = now() where flat_id = $1 and id = $2 and status = 'offered' and to_member = $3 returning 1`, [flatId, id, me])).length,
    cancel: async (d: Db, id: string, me: string) => (await d(`update handovers set status = 'cancelled', decided_by = $3, decided_at = now() where flat_id = $1 and id = $2 and status = 'offered' and from_member = $3 returning 1`, [flatId, id, me])).length,
    deposit: async (d: Db, who: string) => (await d<{ id: string; held_by: string }>(`insert into ledger (flat_id, month, type, amount_poisha, member_id, date, status, created_by)
      values ($1, '2026-10-01', 'deposit', 50000, $2, '2026-10-05', 'pending', $2) returning id, held_by`, [flatId, who]))[0],
    payout: async (d: Db, by: string, to: string) => (await d<{ id: string; held_by: string }>(`insert into ledger (flat_id, month, type, amount_poisha, member_id, date, status, created_by)
      values ($1, '2026-10-01', 'payout', 20000, $2, '2026-10-05', 'pending', $3) returning id, held_by`, [flatId, to, by]))[0],
    offerId: async () => (await db<{ id: string }>(`select id from handovers where flat_id = $1 and status = 'offered'`, [flatId]))[0]?.id,
    state: async () => {
      const collectors = (await db<{ id: string }>(`select id from members where flat_id = $1 and role = 'manager'`, [flatId])).map(x => name[x.id]);
      const hs = (await db<{ status: string; from_member: string; to_member: string; cash_confirmed: boolean }>(
        `select status, from_member, to_member, cash_confirmed from handovers where flat_id = $1 order by created_at`, [flatId]))
        .map(h => `${name[h.from_member]}>${name[h.to_member]}:${h.status}${h.cash_confirmed ? '+cash' : ''}`);
      const [{ c }] = await db<{ c: number }>(`select count(*)::int as c from ledger where flat_id = $1`, [flatId]);
      return { collectors, hs, ledger: c, v: await v() };
    },
    name,
  };
  return api;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  // the branch got 011 before the flat locks became FOR NO KEY UPDATE: reload the four functions from the file
  const file = readFileSync(join(import.meta.dirname, '../db/migrations/011_handover.sql'), 'utf8');
  for (const fn of ['offer_handover', 'accept_handover', 'set_leaving', 'override_collector']) {
    const m = file.match(new RegExp(`create function ${fn}\\([\\s\\S]*?end \\$\\$;`));
    if (!m) throw new Error(`${fn} not found in 011`);
    await sql.unsafe(m[0].replace('create function', 'create or replace function'));
  }
  const [{ n }] = await db<{ n: number }>(`select count(*)::int as n from pg_proc where proname in ('offer_handover','accept_handover','set_leaving','override_collector') and prosrc like '%for no key update%'`);
  console.log(`functions with FOR NO KEY UPDATE on the branch: ${n}/4\n`);
  // 1a. a ledger write already begun when the accept starts: write first → accept refuses the stale offer
  {
    const f = await flat(); const { Nafis: N, Tahsin: T, Zarif: Z } = f.ids;
    await f.offer(db, N, T); const id = await f.offerId();
    const h = hold(tx => f.deposit(tx, Z)); await h.started;
    const acc = f.accept(db, id, T);
    const w = await waits(acc); h.release(); await h.done;
    const s = await f.state();
    check('1a held deposit, then accept: accept waits and refuses; one deposit; roles unchanged', w && await acc === 'changed' && same(s.collectors, ['Nafis']) && s.ledger === 1 && same(s.hs, ['Nafis>Tahsin:cancelled']), { w, s });
  }
  // 1b/11b/I1. the accept already holding the flat when a deposit and a payout start: they land after it
  {
    const f = await flat(); const { Nafis: N, Tahsin: T, Zarif: Z } = f.ids;
    await f.offer(db, N, T); const id = await f.offerId();
    const h = hold(tx => f.accept(tx, id, T)); await h.started;
    const dep = f.deposit(db, Z); const pay = f.payout(db, N, Z);
    const w = await waits(Promise.all([dep, pay])); h.release(); await h.done;
    const d = await dep; const p = await pay; const s = await f.state();
    check('1b held accept, then a deposit: deposit waits, then lands after the handover', w && same(s.collectors, ['Tahsin']) && s.ledger === 2 && same(s.hs, ['Nafis>Tahsin:accepted+cash']), { w, s });
    check(`11b/1b the late deposit is labelled with the collector of its start (held_by ${f.name[d.held_by]}): shown "paid to Nafis" to Tahsin`, d.held_by === N || d.held_by === T, d);
    check('I1 a payout recorded by Nafis just after the accept keeps held_by Nafis', p.held_by === N, p);
  }
  // 2. a held write that rolls back → accept succeeds
  {
    const f = await flat(); const { Nafis: N, Tahsin: T, Zarif: Z } = f.ids;
    await f.offer(db, N, T); const id = await f.offerId();
    const h = hold(tx => f.deposit(tx, Z), true); await h.started;
    const acc = f.accept(db, id, T);
    const w = await waits(acc); h.release(); await h.done;
    const s = await f.state();
    check('2  held deposit rolled back: accept waits, then ok; no ledger row', w && await acc === 'ok' && same(s.collectors, ['Tahsin']) && s.ledger === 0, { w, s });
  }
  // 3. two Accept taps at once → one switch, both ok
  {
    const f = await flat(); const { Nafis: N, Tahsin: T } = f.ids;
    await f.offer(db, N, T); const id = await f.offerId(); const v0 = await f.v();
    const h = hold(tx => f.accept(tx, id, T)); await h.started;
    const second = f.accept(db, id, T);
    const w = await waits(second); h.release(); const first = await h.done;
    const s = await f.state();
    check('3  two accepts: second waits; both ok; one switch; counter moved once', w && first === 'ok' && await second === 'ok' && same(s.collectors, ['Tahsin']) && s.v === v0 + 1, { w, first, s, v0 });
  }
  // 4. two offers at once (same version read) → exactly one offered row
  {
    const f = await flat(); const { Nafis: N, Tahsin: T, Zarif: Z } = f.ids;
    const seen = await f.v();
    const h = hold(tx => f.offer(tx, N, T, seen)); await h.started;
    const second = f.offer(db, N, Z, seen);
    const w = await waits(second); h.release(); const first = await h.done;
    const s = await f.state();
    check('4  two offers: second waits and refuses; one offered row', w && first === 'ok' && await second === 'changed' && same(s.hs, ['Nafis>Tahsin:offered']), { w, first, s });
  }
  // 5a/8. accept first, an override waiting behind it → records Tahsin (the actual collector) as from
  {
    const f = await flat(); const { Nafis: N, Tahsin: T, Zarif: Z } = f.ids;
    await f.offer(db, N, T); const id = await f.offerId();
    const h = hold(tx => f.accept(tx, id, T)); await h.started;
    const ov = f.override(db, Z);
    const w = await waits(ov); h.release(); await h.done;
    const s = await f.state();
    check('5a/8 accept then override: override waits, records Tahsin>Zarif, no cash flag on it', w && await ov === 'ok' && same(s.collectors, ['Zarif']) && same(s.hs, ['Nafis>Tahsin:accepted+cash', 'Tahsin>Zarif:overridden']), { w, s });
  }
  // 5b. override first, the accept waiting → accept finds the offer cancelled
  {
    const f = await flat(); const { Nafis: N, Tahsin: T, Zarif: Z } = f.ids;
    await f.offer(db, N, T); const id = await f.offerId();
    const h = hold(tx => f.override(tx, Z)); await h.started;
    const acc = f.accept(db, id, T);
    const w = await waits(acc); h.release(); await h.done;
    const s = await f.state();
    check('5b override then accept: accept waits, gets cancelled; Zarif only collector; no cash flag', w && await acc === 'cancelled' && same(s.collectors, ['Zarif']) && same(s.hs, ['Nafis>Tahsin:cancelled', 'Nafis>Zarif:overridden']), { w, s });
  }
  // 6. a decline racing a cancel → the first stands
  {
    const f = await flat(); const { Nafis: N, Tahsin: T } = f.ids;
    await f.offer(db, N, T); const id = await f.offerId();
    const h = hold(tx => f.decline(tx, id, T)); await h.started;
    const c = f.cancel(db, id, N);
    const w = await waits(c); h.release(); await h.done;
    const s = await f.state();
    check('6  decline then cancel: cancel waits and changes nothing; declined stands', w && await c === 0 && same(s.hs, ['Nafis>Tahsin:declined']) && same(s.collectors, ['Nafis']), { w, s });
  }
  // 7a. move-out of the recipient first → accept refuses
  {
    const f = await flat(); const { Nafis: N, Tahsin: T } = f.ids;
    await f.offer(db, N, T); const id = await f.offerId();
    const h = hold(tx => f.leave(tx, N, T, '2026-12-31')); await h.started;
    const acc = f.accept(db, id, T);
    const w = await waits(acc); h.release(); await h.done;
    const s = await f.state();
    check('7a move-out then accept: accept waits and refuses; roles unchanged', w && await acc === 'changed' && same(s.collectors, ['Nafis']), { w, s });
  }
  // 7b. accept first → the old collector's move-out of the new collector is refused
  {
    const f = await flat(); const { Nafis: N, Tahsin: T } = f.ids;
    await f.offer(db, N, T); const id = await f.offerId();
    const h = hold(tx => f.accept(tx, id, T)); await h.started;
    const lv = f.leave(db, N, T, '2026-12-31');
    const w = await waits(lv); h.release(); await h.done;
    const [{ l }] = await db<{ l: string | null }>(`select left_on::text as l from members where id = $1`, [T]);
    const s = await f.state();
    check('7b accept then move-out: move-out waits and is refused; Tahsin keeps no date', w && await lv === 'no' && l === null && same(s.collectors, ['Tahsin']), { w, l, s });
  }
  // 9a. decline first, accept waiting → accept reads declined
  {
    const f = await flat(); const { Nafis: N, Tahsin: T } = f.ids;
    await f.offer(db, N, T); const id = await f.offerId();
    const h = hold(tx => f.decline(tx, id, T)); await h.started;
    const acc = f.accept(db, id, T);
    const w = await waits(acc); h.release(); await h.done;
    const s = await f.state();
    check('9a decline then accept: accept waits, reads declined; nobody switched', w && await acc === 'declined' && same(s.collectors, ['Nafis']) && same(s.hs, ['Nafis>Tahsin:declined']), { w, s });
  }
  // 9b. accept first, decline waiting → decline changes nothing
  {
    const f = await flat(); const { Nafis: N, Tahsin: T } = f.ids;
    await f.offer(db, N, T); const id = await f.offerId();
    const h = hold(tx => f.accept(tx, id, T)); await h.started;
    const dc = f.decline(db, id, T);
    const w = await waits(dc); h.release(); await h.done;
    const s = await f.state();
    check('9b accept then decline: decline waits and changes nothing; accepted stands', w && await dc === 0 && same(s.collectors, ['Tahsin']) && same(s.hs, ['Nafis>Tahsin:accepted+cash']), { w, s });
  }
  // 10a. override first, offer waiting → no offer from someone who is no longer collector
  {
    const f = await flat(); const { Nafis: N, Tahsin: T, Zarif: Z } = f.ids;
    const seen = await f.v();
    const h = hold(tx => f.override(tx, Z)); await h.started;
    const of = f.offer(db, N, T, seen);
    const w = await waits(of); h.release(); await h.done;
    const s = await f.state();
    check('10a override then offer: offer waits and refuses; no offered row', w && await of === 'changed' && same(s.hs, ['Nafis>Zarif:overridden']), { w, s });
  }
  // 10b. offer first, override waiting → the override cancels it
  {
    const f = await flat(); const { Nafis: N, Tahsin: T, Zarif: Z } = f.ids;
    const h = hold(tx => f.offer(tx, N, T)); await h.started;
    const ov = f.override(db, Z);
    const w = await waits(ov); h.release(); await h.done;
    const s = await f.state();
    check('10b offer then override: override waits, cancels the offer', w && await ov === 'ok' && same(s.hs, ['Nafis>Tahsin:cancelled', 'Nafis>Zarif:overridden']) && same(s.collectors, ['Zarif']), { w, s });
  }
  // 11a. a pending deposit held while the offer starts → offer refuses
  {
    const f = await flat(); const { Nafis: N, Tahsin: T, Zarif: Z } = f.ids;
    const seen = await f.v();
    const h = hold(tx => f.deposit(tx, Z)); await h.started;
    const of = f.offer(db, N, T, seen);
    const w = await waits(of); h.release(); await h.done;
    const s = await f.state();
    check('11a deposit then offer: offer waits and refuses', w && await of === 'changed' && s.hs.length === 0, { w, s });
  }
  // 11c. offer held, deposit waiting → deposit lands after; the accept then refuses (stale)
  {
    const f = await flat(); const { Nafis: N, Tahsin: T, Zarif: Z } = f.ids;
    const h = hold(tx => f.offer(tx, N, T)); await h.started;
    const dep = f.deposit(db, Z);
    const w = await waits(dep); h.release(); await h.done; await dep;
    const acc = await f.accept(db, (await f.offerId())!, T);
    const s = await f.state();
    check('11c offer then deposit: deposit waits, lands; the accept then refuses', w && acc === 'changed' && same(s.collectors, ['Nafis']), { w, acc, s });
  }
  // 12. role swap on real Postgres (deferred one-collector constraint); a second collector is refused
  {
    const f = await flat(); const { Nafis: N, Tahsin: T } = f.ids;
    await db(`update members set role = case when id = $2 then 'manager' else 'member' end where flat_id = $1 and id in ($2, $3)`, [f.flatId, T, N]);
    const err = await db(`update members set role = 'manager' where id = $1`, [N]).then(() => null, e => e.code);
    const s = await f.state();
    check('12 swap in one statement works; a second collector is refused (23P01)', err === '23P01' && same(s.collectors, ['Tahsin']), { err, s });
  }
  // deadlock run: ledger write, move-out, settings save and usual meals at the same moment, two open months
  // first without the retry (to see each deadlock's detail), then through the app's db, which retries once
  for (const [label, d] of [['no retry', db], ['app db with retry', appDb]] as const) {
    const f = await flat(); const { Nafis: N, Zarif: Z } = f.ids;
    const errs: Record<string, number> = {};
    const details = new Set<string>();
    const note = (op: string) => (e: { code?: string; message?: string; detail?: string }) => {
      const k = `${op}:${e.code ?? e.message}`; errs[k] = (errs[k] ?? 0) + 1;
      if (e.detail) details.add(e.detail.replace(/[0-9a-f-]{36}/g, 'id').replace(/\d+/g, 'n'));
    };
    for (let i = 0; i < 40; i++) {
      await Promise.all([
        sql.begin(async tx => { const t: Db = (q, p = []) => tx.unsafe(q, p as never[]) as never; await f.deposit(t, Z); await t(`select pg_sleep(0.02)`); await f.deposit(t, N); }).catch(note('ledger')),
        f.leave(d, N, Z, i % 2 ? '2026-12-31' : null).catch(note('moveOut')),
        updateSettings(d, f.flatId, N, { weights: { b: i % 2 ? 50 : 60, l: 100, d: 100 } }, '2026-10-10T12:00').catch(note('settings')),
        setDefaults(d, f.flatId, Z, { b: i % 2 === 0, l: true, d: true }, '2026-09-01', '2026-10-10').catch(note('usualMeals')),
      ]);
    }
    if (label === 'no retry') check(`deadlock run (no retry): 40 rounds of 4 writers, no deadlocks`, Object.keys(errs).length === 0, { errs, details: [...details] });
    else check(`deadlock run (${label}): 40 rounds of 4 writers, no errors`, Object.keys(errs).length === 0, errs);
  }
  // deleting a flat with closed months (TEST_FLAT_CODE on this copy), rolled back
  if (TEST_FLAT) {
    const [{ c }] = await db<{ c: number }>(`select count(*)::int as c from months m join flats f on f.id = m.flat_id where f.join_code = $1 and m.status = 'closed'`, [TEST_FLAT]);
    const err = await sql.begin(async tx => { await tx.unsafe(`delete from flats where join_code = $1`, [TEST_FLAT]); throw new Error('undo'); })
      .then(() => null, e => (e.message === 'undo' ? null : `${e.code} ${e.message}`));
    check(`delete a flat with ${c} closed months (rolled back): ${err ?? 'cascade works'}`, err === null, err);
  }
  // keep one flat with a normal collector for the override script run
  const k = await flat();
  const [{ code }] = await db<{ code: string }>(`select join_code as code from flats where id = $1`, [k.flatId]);
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} passed. Override script flat: join code ${code} (collector Nafis)`);
}

// lib/db keeps its own pool open, so exit explicitly
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await sql.end(); process.exit(); });
