import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, migrate, pg } from '../db/test-db';
import { createFlat } from './auth';
import { saveMeal } from './meals-db';
import { addEntry, confirmEntry, loadMonth, putBack, removeEntry, toConfirm, type NewEntry } from './money-db';
import { closeMonth } from './close';
import { setLeaving } from './auth';
import { acceptHandover, cancelHandover, currentOffer, declineHandover, flatMoney, handoverHistory, lastOutcome, myLatestHandover, offerHandover, overrideCollector, pendingCount } from './handover';

async function flat() {
  await migrate();
  const f = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin', 'Zarif'], today: '2026-09-01', lang: 'bn' });
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
  const v = async () => (await db<{ v: number }>(`select offer_version as v from flats where id = $1`, [f.flatId]))[0].v;
  const collector = async () => (await db<{ id: string }>(`select id from members where flat_id = $1 and role = 'manager'`, [f.flatId])).map(r => r.id);
  const call = async (sql: string, p: unknown[]) => (await db<{ r: string }>(sql, p))[0].r;
  return { flatId: f.flatId, ids, v, collector, call };
}

// the backfill block of 011, read from the migration itself
const backfill = () => pg.exec(readFileSync(join(__dirname, '../db/migrations/011_handover.sql'), 'utf8').split('-- backfill start')[1].split('-- backfill end')[0]);

describe('handover database rules', { timeout: 30000 }, () => {
  it('every ledger write bumps offer_version, a meal write does not', async () => {
    const { flatId, ids, v } = await flat();
    const v0 = await v();
    await db(`insert into months (flat_id, month) values ($1, '2026-09-01') on conflict do nothing`, [flatId]);
    const [row] = await db<{ id: string }>(`insert into ledger (flat_id, month, type, amount_poisha, member_id, date, status, created_by)
      values ($1, '2026-09-01', 'deposit', 1000, $2, '2026-09-03', 'pending', $2) returning id`, [flatId, ids.Tahsin]);
    expect(await v()).toBe(v0 + 1);
    await db(`update ledger set status = 'ok' where id = $1`, [row.id]);
    expect(await v()).toBe(v0 + 2);
    await db(`delete from ledger where id = $1`, [row.id]);
    expect(await v()).toBe(v0 + 3);
    await saveMeal(db, flatId, ids.Nafis, { memberId: ids.Tahsin, date: '2026-09-06', meal: 'l', count: 0, guests: 0 }, false);
    expect(await v()).toBe(v0 + 3);
  });

  it('one collector per flat: a swap in one statement works in either row order, a second collector is refused', async () => {
    const { flatId, ids, collector } = await flat();
    await db(`update members set role = case when id = $2 then 'manager' else 'member' end where flat_id = $1 and id in ($2, $3)`, [flatId, ids.Tahsin, ids.Nafis]);
    expect(await collector()).toEqual([ids.Tahsin]);
    await db(`update members set role = case when id = $2 then 'manager' else 'member' end where flat_id = $1 and id in ($3, $2)`, [flatId, ids.Nafis, ids.Tahsin]);   // the row order the old unique index rejected mid-statement
    expect(await collector()).toEqual([ids.Nafis]);
    await expect(db(`update members set role = 'manager' where id = $1`, [ids.Zarif])).rejects.toThrow(/one_manager_per_flat/);
  });

  it('offer, wrong person, accept, second tap', async () => {
    const { flatId, ids, v, collector, call } = await flat();
    const seen = await v();
    expect(await call(`select offer_handover($1, $2, $3, $4, $5) as r`, [flatId, ids.Nafis, ids.Tahsin, seen, 250000])).toBe('ok');
    const [h] = await db<{ id: string; offer_version: number; status: string }>(`select id, offer_version, status from handovers where flat_id = $1`, [flatId]);
    expect([h.status, h.offer_version, await v()]).toEqual(['offered', seen + 1, seen + 1]);   // stores the version after its own bump
    expect(await call(`select accept_handover($1, $2, $3) as r`, [flatId, h.id, ids.Zarif])).toBe('notYou');
    expect(await v()).toBe(seen + 1);                                                          // a wrong tap changes nothing
    expect(await call(`select accept_handover($1, $2, $3) as r`, [flatId, h.id, ids.Tahsin])).toBe('ok');
    const [a] = await db<{ status: string; cash_confirmed: boolean; decided_by: string }>(`select status, cash_confirmed, decided_by from handovers where id = $1`, [h.id]);
    expect([a.status, a.cash_confirmed, a.decided_by, await collector(), await v()]).toEqual(['accepted', true, ids.Tahsin, [ids.Tahsin], seen + 2]);
    expect(await call(`select accept_handover($1, $2, $3) as r`, [flatId, h.id, ids.Tahsin])).toBe('ok');
    expect([await collector(), await v()]).toEqual([[ids.Tahsin], seen + 2]);                 // second tap: same answer, no change
  });

  it('offer refusals', async () => {
    const { flatId, ids, v, call } = await flat();
    const offer = (by: string, to: string, seen: number, total = 1000) => call(`select offer_handover($1, $2, $3, $4, $5) as r`, [flatId, by, to, seen, total]);
    expect(await offer(ids.Tahsin, ids.Zarif, await v())).toBe('notCollector');
    expect(await offer(ids.Nafis, ids.Nafis, await v())).toBe('recipient');
    expect(await offer(ids.Nafis, ids.Tahsin, (await v()) - 1)).toBe('changed');
    expect(await offer(ids.Nafis, ids.Tahsin, await v(), -500)).toBe('negative');
    await db(`update members set left_on = '2026-12-31' where id = $1`, [ids.Zarif]);
    expect(await offer(ids.Nafis, ids.Zarif, await v())).toBe('recipient');
    await db(`insert into months (flat_id, month) values ($1, '2026-09-01') on conflict do nothing`, [flatId]);
    const [p] = await db<{ id: string }>(`insert into ledger (flat_id, month, type, amount_poisha, member_id, date, status, created_by)
      values ($1, '2026-09-01', 'payout', 1000, $2, '2026-09-03', 'pending', $3) returning id`, [flatId, ids.Tahsin, ids.Nafis]);
    expect(await offer(ids.Nafis, ids.Tahsin, await v())).toBe('waiting');                    // a pending payout blocks too
    await db(`delete from ledger where id = $1`, [p.id]);
    expect(await offer(ids.Nafis, ids.Tahsin, await v())).toBe('ok');
    expect(await offer(ids.Nafis, ids.Tahsin, await v())).toBe('already');
  });

  it('a stale offer is cancelled at accept: money moved, recipient moving out, offerer replaced', async () => {
    const { flatId, ids, v, collector, call } = await flat();
    const offerAndId = async () => {
      expect(await call(`select offer_handover($1, $2, $3, $4, $5) as r`, [flatId, ids.Nafis, ids.Tahsin, await v(), 1000])).toBe('ok');
      return (await db<{ id: string }>(`select id from handovers where flat_id = $1 and status = 'offered'`, [flatId]))[0].id;
    };
    await db(`insert into months (flat_id, month) values ($1, '2026-09-01') on conflict do nothing`, [flatId]);
    let id = await offerAndId();
    await db(`insert into ledger (flat_id, month, type, amount_poisha, member_id, date, status, created_by)
      values ($1, '2026-09-01', 'deposit', 1000, $2, '2026-09-03', 'pending', $2)`, [flatId, ids.Zarif]);   // a pending deposit after the offer
    expect(await call(`select accept_handover($1, $2, $3) as r`, [flatId, id, ids.Tahsin])).toBe('changed');
    expect([(await db<{ s: string }>(`select status as s from handovers where id = $1`, [id]))[0].s, await collector()]).toEqual(['cancelled', [ids.Nafis]]);
    await db(`delete from ledger where flat_id = $1`, [flatId]);
    id = await offerAndId();
    await db(`update members set left_on = '2026-12-31' where id = $1`, [ids.Tahsin]);
    await db(`update flats set offer_version = offer_version + 1 where id = $1`, [flatId]);           // what setLeaving does (Task 2)
    expect(await call(`select accept_handover($1, $2, $3) as r`, [flatId, id, ids.Tahsin])).toBe('changed');
    await db(`update members set left_on = null where id = $1`, [ids.Tahsin]);
    id = await offerAndId();
    expect(await call(`select override_collector($1, $2, $3, $4) as r`, [flatId, ids.Zarif, 'phone lost', 'app team: Fahim'])).toBe('ok');
    expect(await call(`select accept_handover($1, $2, $3) as r`, [flatId, id, ids.Tahsin])).toBe('cancelled');
    expect(await collector()).toEqual([ids.Zarif]);
  });

  it('override records the real outgoing collector, never confirms cash, refuses someone leaving', async () => {
    const { flatId, ids, v, collector, call } = await flat();
    const v0 = await v();
    await db(`update members set left_on = '2026-12-31' where id = $1`, [ids.Zarif]);
    expect(await call(`select override_collector($1, $2, $3, $4) as r`, [flatId, ids.Zarif, 'x', 'y'])).toBe('recipient');
    expect(await call(`select override_collector($1, $2, $3, $4) as r`, [flatId, ids.Tahsin, ' ', 'y'])).toBe('reason');
    expect(await call(`select override_collector($1, $2, $3, $4) as r`, [flatId, ids.Tahsin, 'phone lost', 'app team: Fahim'])).toBe('ok');
    const [o] = await db<{ from_member: string; status: string; cash_confirmed: boolean; reason: string; admin: string; amount: string | null }>(
      `select from_member, status, cash_confirmed, reason, admin, amount from handovers where flat_id = $1`, [flatId]);
    expect([o.from_member, o.status, o.cash_confirmed, o.reason, o.admin, o.amount]).toEqual([ids.Nafis, 'overridden', false, 'phone lost', 'app team: Fahim', null]);
    expect([await collector(), await v()]).toEqual([[ids.Tahsin], v0 + 1]);
  });

  it('decline and cancel decide only a waiting offer; roles never change', async () => {
    const { flatId, ids, v, collector, call } = await flat();
    expect(await call(`select offer_handover($1, $2, $3, $4, $5) as r`, [flatId, ids.Nafis, ids.Tahsin, await v(), 1000])).toBe('ok');
    const [{ id }] = await db<{ id: string }>(`select id from handovers where flat_id = $1`, [flatId]);
    const decline = () => db(`update handovers set status = 'declined', decided_by = $3, decided_at = now() where flat_id = $1 and id = $2 and status = 'offered' and to_member = $3 returning 1`, [flatId, id, ids.Tahsin]);
    const cancel = () => db(`update handovers set status = 'cancelled', decided_by = $3, decided_at = now() where flat_id = $1 and id = $2 and status = 'offered' and from_member = $3 returning 1`, [flatId, id, ids.Nafis]);
    expect((await decline()).length).toBe(1);
    expect((await cancel()).length).toBe(0);                      // the first decision stands
    expect(await call(`select accept_handover($1, $2, $3) as r`, [flatId, id, ids.Tahsin])).toBe('declined');
    expect(await collector()).toEqual([ids.Nafis]);
  });

  it('cancel then accept: accept reports cancelled, roles never change', async () => {
    const { flatId, ids, v, collector, call } = await flat();
    expect(await call(`select offer_handover($1, $2, $3, $4, $5) as r`, [flatId, ids.Nafis, ids.Tahsin, await v(), 1000])).toBe('ok');
    const [{ id }] = await db<{ id: string }>(`select id from handovers where flat_id = $1`, [flatId]);
    expect(await cancelHandover(db, flatId, ids.Nafis, id)).toBe('ok');
    expect(await call(`select accept_handover($1, $2, $3) as r`, [flatId, id, ids.Tahsin])).toBe('cancelled');
    expect(await collector()).toEqual([ids.Nafis]);
  });

  it('held_by: filled from the collector at insert, kept after the role moves', async () => {
    const { flatId, ids, call } = await flat();
    await db(`insert into months (flat_id, month) values ($1, '2026-09-01') on conflict do nothing`, [flatId]);
    const [d] = await db<{ id: string; held_by: string }>(`insert into ledger (flat_id, month, type, amount_poisha, member_id, date, status, created_by)
      values ($1, '2026-09-01', 'deposit', 1000, $2, '2026-09-03', 'pending', $2) returning id, held_by`, [flatId, ids.Tahsin]);
    expect(d.held_by).toBe(ids.Nafis);
    expect(await call(`select override_collector($1, $2, $3, $4) as r`, [flatId, ids.Zarif, 'phone lost', 'app team'])).toBe('ok');
    await db(`update ledger set status = 'ok' where id = $1`, [d.id]);                                          // Zarif confirms
    expect((await db<{ h: string }>(`select held_by as h from ledger where id = $1`, [d.id]))[0].h).toBe(ids.Nafis);
    const [p] = await db<{ held_by: string }>(`insert into ledger (flat_id, month, type, amount_poisha, member_id, date, status, created_by)
      values ($1, '2026-09-01', 'payout', 500, $2, '2026-09-04', 'pending', $3) returning held_by`, [flatId, ids.Tahsin, ids.Zarif]);
    expect(p.held_by).toBe(ids.Zarif);
    const [b] = await db<{ held_by: string | null }>(`insert into ledger (flat_id, month, type, amount_poisha, date, status, created_by)
      values ($1, '2026-09-01', 'bazar', 500, '2026-09-04', 'ok', $2) returning held_by`, [flatId, ids.Zarif]);
    expect(b.held_by).toBeNull();
  });

  it('set_leaving: only the current collector, never the collector, date and counter together', async () => {
    const { flatId, ids, v, call } = await flat();
    const leave = (by: string, m: string, day: string | null) => call(`select set_leaving($1, $2, $3, $4::date, '2026-09-10'::date) as r`, [flatId, by, m, day]);
    const v0 = await v();
    expect(await leave(ids.Nafis, ids.Zarif, '2026-12-31')).toBe('ok');
    expect(await v()).toBe(v0 + 1);
    expect(await leave(ids.Nafis, ids.Nafis, '2026-12-31')).toBe('no');                      // not the collector themself
    expect(await leave(ids.Tahsin, ids.Zarif, null)).toBe('no');                             // not the collector
    expect(await call(`select override_collector($1, $2, $3, $4) as r`, [flatId, ids.Tahsin, 'x', 'y'])).toBe('ok');
    expect(await leave(ids.Nafis, ids.Tahsin, '2026-12-31')).toBe('no');                     // the old collector, after a handover
    expect((await db<{ l: string | null }>(`select left_on::text as l from members where id = $1`, [ids.Tahsin]))[0].l).toBeNull();
    expect(await leave(ids.Tahsin, ids.Zarif, null)).toBe('ok');                             // the new collector takes Zarif's date back
  });

  it('a failure inside accept rolls back status, roles and counter together', async () => {
    const { flatId, ids, v, collector, call } = await flat();
    expect(await call(`select offer_handover($1, $2, $3, $4, $5) as r`, [flatId, ids.Nafis, ids.Tahsin, await v(), 1000])).toBe('ok');
    const [{ id }] = await db<{ id: string }>(`select id from handovers where flat_id = $1`, [flatId]);
    const before = await v();
    await db(`create function test_sabotage() returns trigger language plpgsql as $$ begin if new.role = 'manager' and old.role = 'member' then new.role := 'member'; end if; return new; end $$`);
    await db(`create trigger test_sabotage before update on members for each row execute function test_sabotage()`);
    try {
      await expect(db(`select accept_handover($1, $2, $3) as r`, [flatId, id, ids.Tahsin])).rejects.toThrow('handover invariant broken');
      const [h] = await db<{ status: string; cash_confirmed: boolean }>(`select status, cash_confirmed from handovers where id = $1`, [id]);
      expect([h.status, h.cash_confirmed, await collector(), await v()]).toEqual(['offered', false, [ids.Nafis], before]);
    } finally {
      await db(`drop trigger test_sabotage on members`);
      await db(`drop function test_sabotage()`);
    }
  });

  it('the 011 held_by backfill fills a closed month and leaves it protected', async () => {
    const { flatId, ids } = await flat();
    await db(`insert into months (flat_id, month) values ($1, '2026-09-01') on conflict do nothing`, [flatId]);
    await db(`insert into ledger (flat_id, month, type, amount_poisha, member_id, date, status, created_by)
      values ($1, '2026-09-01', 'deposit', 1000, $2, '2026-09-03', 'ok', $2), ($1, '2026-09-01', 'payout', 500, $2, '2026-09-04', 'ok', $3)`, [flatId, ids.Tahsin, ids.Nafis]);
    await db(`update months set status = 'closed' where flat_id = $1 and month = '2026-09-01'`, [flatId]);
    await db(`alter table ledger disable trigger ledger_month`);
    await db(`update ledger set held_by = null where flat_id = $1`, [flatId]);
    await db(`alter table ledger enable trigger ledger_month`);
    await backfill();
    const rows = await db<{ type: string; h: string }>(`select type, held_by as h from ledger where flat_id = $1 order by type`, [flatId]);
    expect(rows).toEqual([{ type: 'deposit', h: ids.Nafis }, { type: 'payout', h: ids.Nafis }]);
    await expect(db(`update ledger set status = 'ok' where flat_id = $1 and month = '2026-09-01'`, [flatId])).rejects.toThrow('month_closed');
  });

  it('the 011 backfill gives a removal record from before 011 its holder', async () => {
    const { flatId, ids } = await flat();
    const [{ id }] = await db<{ id: string }>(`insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
      values ($1, 'ledger', gen_random_uuid()::text, jsonb_build_object('type', 'deposit', 'amount_poisha', 1000), '{"removed":true}', $2) returning id::text`, [flatId, ids.Nafis]);
    await backfill();
    expect((await db<{ h: string }>(`select before->>'held_by' as h from audit_log where id = $1`, [id]))[0].h).toBe(ids.Nafis);
  });
});

const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount' | 'date'>): NewEntry => ({ note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });

describe('handover in the app', { timeout: 30000 }, () => {
  it('the total: open months only, two open months, every month closed', async () => {
    const { flatId, ids } = await flat();
    const nafis = { memberId: ids.Nafis, role: 'manager' as const };
    expect(await flatMoney(db, flatId, '2026-09-10')).toBe(0);
    expect(await addEntry(db, flatId, nafis, e({ type: 'deposit', amount: 300000, date: '2026-09-03', memberId: ids.Tahsin }))).toBe('ok');
    expect(await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 50000, date: '2026-09-04' }))).toBe('ok');
    expect(await flatMoney(db, flatId, '2026-09-10')).toBe(250000);
    expect(await addEntry(db, flatId, nafis, e({ type: 'deposit', amount: 20000, date: '2026-10-02', memberId: ids.Zarif }))).toBe('ok');
    expect(await flatMoney(db, flatId, '2026-10-05')).toBe(270000);                 // September (not closed) + October
    expect((await closeMonth(db, flatId, nafis, '2026-09-01', '2026-10-05', { cash: 250000, bkash: 0, nagad: 0, bank: 0 })).result).toBe('ok');
    expect(await flatMoney(db, flatId, '2026-10-05')).toBe(270000);                 // a close changes nothing
    await db(`delete from ledger where flat_id = $1 and month = '2026-10-01'`, [flatId]);
    await db(`delete from months where flat_id = $1 and month = '2026-10-01'`, [flatId]);
    expect(await flatMoney(db, flatId, '2026-10-05')).toBe(250000);                 // every month closed: F, not zero
  });

  it('an offer stays valid across a month close (the total and the counter do not move)', async () => {
    const { flatId, ids, collector } = await flat();
    const nafis = { memberId: ids.Nafis, role: 'manager' as const };
    await addEntry(db, flatId, nafis, e({ type: 'deposit', amount: 300000, date: '2026-09-03', memberId: ids.Tahsin }));
    await addEntry(db, flatId, nafis, e({ type: 'deposit', amount: 20000, date: '2026-10-02', memberId: ids.Zarif }));
    expect(await offerHandover(db, flatId, nafis, ids.Tahsin, 320000, '2026-10-05')).toBe('ok');
    expect((await closeMonth(db, flatId, nafis, '2026-09-01', '2026-10-05', { cash: 300000, bkash: 0, nagad: 0, bank: 0 })).result).toBe('ok');
    expect(await flatMoney(db, flatId, '2026-10-05')).toBe(320000);
    expect(await acceptHandover(db, flatId, ids.Tahsin, (await currentOffer(db, flatId))!.id)).toBe('ok');
    expect(await collector()).toEqual([ids.Tahsin]);
  });

  it('offer and accept through the app, history, a second handover', async () => {
    const { flatId, ids, collector } = await flat();
    const nafis = { memberId: ids.Nafis, role: 'manager' as const }, tahsin = { memberId: ids.Tahsin, role: 'manager' as const };
    await addEntry(db, flatId, nafis, e({ type: 'deposit', amount: 300000, date: '2026-09-03', memberId: ids.Tahsin }));
    expect(await offerHandover(db, flatId, nafis, ids.Tahsin, 299999, '2026-09-10')).toBe('changed');   // the card showed another amount
    expect(await offerHandover(db, flatId, nafis, ids.Tahsin, 300000, '2026-09-10')).toBe('ok');
    const o = await currentOffer(db, flatId);
    expect([o?.from, o?.to, o?.amount]).toEqual(['Nafis', 'Tahsin', 300000]);
    expect(await acceptHandover(db, flatId, ids.Tahsin, o!.id)).toBe('ok');
    expect(await currentOffer(db, flatId)).toBeNull();
    expect(await offerHandover(db, flatId, tahsin, ids.Zarif, 300000, '2026-09-10')).toBe('ok');
    expect(await acceptHandover(db, flatId, ids.Zarif, (await currentOffer(db, flatId))!.id)).toBe('ok');
    expect(await collector()).toEqual([ids.Zarif]);
    const h = await handoverHistory(db, flatId);
    expect(h.map(x => `${x.status} ${x.from}→${x.to} ${x.amount}`)).toEqual(['accepted Tahsin→Zarif 300000', 'accepted Nafis→Tahsin 300000']);
  });

  it('move-out after the offer invalidates it; decline and cancel outcomes', async () => {
    const { flatId, ids, collector } = await flat();
    const nafis = { memberId: ids.Nafis, role: 'manager' as const };
    expect(await offerHandover(db, flatId, nafis, ids.Tahsin, 0, '2026-09-10')).toBe('ok');
    expect(await setLeaving(db, flatId, ids.Nafis, ids.Tahsin, '2026-12-31', '2026-09-10')).toBe('ok');
    expect(await acceptHandover(db, flatId, ids.Tahsin, (await db<{ id: string }>(`select id from handovers where flat_id = $1`, [flatId]))[0].id)).toBe('changed');
    expect(await lastOutcome(db, flatId, ids.Nafis)).toEqual({ status: 'cancelled', to: 'Tahsin', stale: true });
    expect(await offerHandover(db, flatId, nafis, ids.Zarif, 0, '2026-09-10')).toBe('ok');
    const id = (await currentOffer(db, flatId))!.id;
    expect(await declineHandover(db, flatId, ids.Tahsin, id)).toBe('offered');     // not addressed to Tahsin: nothing changes
    expect(await declineHandover(db, flatId, ids.Zarif, id)).toBe('ok');
    expect(await cancelHandover(db, flatId, ids.Nafis, id)).toBe('declined');      // the first decision stands
    expect(await lastOutcome(db, flatId, ids.Nafis)).toEqual({ status: 'declined', to: 'Zarif', stale: false });
    expect(await collector()).toEqual([ids.Nafis]);
  });

  it('myLatestHandover: waiting, accepted, then a stale cancel; old results are not recent', async () => {
    const { flatId, ids } = await flat();
    const nafis = { memberId: ids.Nafis, role: 'manager' as const }, tahsin = { memberId: ids.Tahsin, role: 'manager' as const };
    expect(await myLatestHandover(db, flatId, ids.Tahsin)).toBeNull();
    expect(await offerHandover(db, flatId, nafis, ids.Tahsin, 0, '2026-09-10')).toBe('ok');
    const o = await myLatestHandover(db, flatId, ids.Tahsin);
    expect([o?.status, o?.from, o?.amount, o?.decidedBy, o?.recent]).toEqual(['offered', 'Nafis', 0, null, false]);
    expect(await acceptHandover(db, flatId, ids.Tahsin, o!.id)).toBe('ok');
    const a = await myLatestHandover(db, flatId, ids.Tahsin);
    expect([a?.status, a?.decidedBy, a?.recent]).toEqual(['accepted', ids.Tahsin, true]);
    expect(await offerHandover(db, flatId, tahsin, ids.Zarif, 0, '2026-09-10')).toBe('ok');
    await addEntry(db, flatId, tahsin, e({ type: 'deposit', amount: 5000, date: '2026-09-10', memberId: ids.Zarif }));   // the money moves
    expect(await acceptHandover(db, flatId, ids.Zarif, (await currentOffer(db, flatId))!.id)).toBe('changed');
    const z = await myLatestHandover(db, flatId, ids.Zarif);
    expect([z?.status, z?.from, z?.decidedBy, z?.recent]).toEqual(['cancelled', 'Tahsin', null, true]);
    await db(`update handovers set decided_at = now() - interval '25 hours' where id = $1`, [z!.id]);
    expect((await myLatestHandover(db, flatId, ids.Zarif))?.recent).toBe(false);
    await db(`update handovers set decided_at = now() where id = $1`, [z!.id]);
    expect(await overrideCollector(db, flatId, ids.Nafis, 'lost phone', 'App team')).toBe('ok');   // a newer handover ends the stale notice
    expect((await myLatestHandover(db, flatId, ids.Zarif))?.recent).toBe(false);
  });

  it('myLatestHandover: a later handover ends my accepted notice', async () => {
    const { flatId, ids } = await flat();
    const nafis = { memberId: ids.Nafis, role: 'manager' as const }, tahsin = { memberId: ids.Tahsin, role: 'manager' as const };
    expect(await offerHandover(db, flatId, nafis, ids.Tahsin, 0, '2026-09-10')).toBe('ok');
    expect(await acceptHandover(db, flatId, ids.Tahsin, (await currentOffer(db, flatId))!.id)).toBe('ok');
    expect((await myLatestHandover(db, flatId, ids.Tahsin))?.recent).toBe(true);
    expect(await offerHandover(db, flatId, tahsin, ids.Zarif, 0, '2026-09-10')).toBe('ok');
    expect(await acceptHandover(db, flatId, ids.Zarif, (await currentOffer(db, flatId))!.id)).toBe('ok');
    expect((await myLatestHandover(db, flatId, ids.Tahsin))?.recent).toBe(false);
    expect((await myLatestHandover(db, flatId, ids.Zarif))?.recent).toBe(true);
  });

  it('pending money blocks the offer; pendingCount', async () => {
    const { flatId, ids } = await flat();
    const nafis = { memberId: ids.Nafis, role: 'manager' as const }, tahsin = { memberId: ids.Tahsin, role: 'member' as const };
    await addEntry(db, flatId, tahsin, e({ type: 'deposit', amount: 50000, date: '2026-09-03', memberId: ids.Tahsin }));
    expect(await pendingCount(db, flatId)).toBe(1);
    expect(await offerHandover(db, flatId, nafis, ids.Zarif, 0, '2026-09-10')).toBe('waiting');
    await confirmEntry(db, flatId, nafis, (await toConfirm(db, flatId, ids.Nafis, true))[0].id);
    expect(await offerHandover(db, flatId, nafis, ids.Zarif, 50000, '2026-09-10')).toBe('ok');
  });

  it('override from the app layer; a deposit made before any handover shows who it was paid to', async () => {
    const { flatId, ids, collector } = await flat();
    const tahsin = { memberId: ids.Tahsin, role: 'member' as const };
    await addEntry(db, flatId, tahsin, e({ type: 'deposit', amount: 50000, date: '2026-09-03', memberId: ids.Tahsin }));
    expect(await overrideCollector(db, flatId, ids.Zarif, 'phone lost', 'app team: Fahim')).toBe('ok');
    expect(await collector()).toEqual([ids.Zarif]);
    const [w] = await toConfirm(db, flatId, ids.Zarif, true);
    expect([w.name, w.paidTo]).toEqual(['Tahsin', 'Nafis']);                      // waiting deposit untouched, labelled by held_by
    await addEntry(db, flatId, tahsin, e({ type: 'deposit', amount: 1000, date: '2026-09-04', memberId: ids.Tahsin }));
    const after = await toConfirm(db, flatId, ids.Zarif, true);
    expect(after.find(x => x.amount === 1000)?.paidTo).toBeNull();                // held by the current collector: no label
    expect((await handoverHistory(db, flatId))[0]).toMatchObject({ status: 'overridden', from: 'Nafis', to: 'Zarif', amount: null });
  });

  it('a waiting payout also shows who actually paid it, after a handover', async () => {
    const { flatId, ids } = await flat();
    const nafis = { memberId: ids.Nafis, role: 'manager' as const };
    expect(await addEntry(db, flatId, nafis, e({ type: 'payout', amount: 20000, date: '2026-09-05', memberId: ids.Zarif }))).toBe('ok');
    expect(await overrideCollector(db, flatId, ids.Tahsin, 'phone lost', 'app team: Fahim')).toBe('ok');
    const [w] = await toConfirm(db, flatId, ids.Zarif, false);
    expect(w.paidTo).toBe('Nafis');
  });

  it('a re-sent identical move-out date leaves the counter and a waiting offer alone', async () => {
    const { flatId, ids, v } = await flat();
    const nafis = { memberId: ids.Nafis, role: 'manager' as const };
    expect(await setLeaving(db, flatId, ids.Nafis, ids.Zarif, '2026-12-31', '2026-09-10')).toBe('ok');
    expect(await offerHandover(db, flatId, nafis, ids.Tahsin, 0, '2026-09-10')).toBe('ok');
    const v0 = await v();
    expect(await setLeaving(db, flatId, ids.Nafis, ids.Zarif, '2026-12-31', '2026-09-10')).toBe('ok');   // a stale page re-sends it
    expect(await v()).toBe(v0);
    expect(await acceptHandover(db, flatId, ids.Tahsin, (await currentOffer(db, flatId))!.id)).toBe('ok');
  });

  it('a failure inside override rolls back status, roles and counter together', async () => {
    const { flatId, ids, v, collector } = await flat();
    const nafis = { memberId: ids.Nafis, role: 'manager' as const };
    expect(await offerHandover(db, flatId, nafis, ids.Tahsin, 0, '2026-09-10')).toBe('ok');
    const before = await v();
    await db(`create function test_sabotage() returns trigger language plpgsql as $$ begin if new.role = 'manager' and old.role = 'member' then new.role := 'member'; end if; return new; end $$`);
    await db(`create trigger test_sabotage before update on members for each row execute function test_sabotage()`);
    try {
      await expect(overrideCollector(db, flatId, ids.Zarif, 'phone lost', 'app team')).rejects.toThrow('handover invariant broken');
      const rows = await db<{ status: string }>(`select status from handovers where flat_id = $1`, [flatId]);
      expect([rows.map(r => r.status), await collector(), await v()]).toEqual([['offered'], [ids.Nafis], before]);
    } finally {
      await db(`drop trigger test_sabotage on members`);
      await db(`drop function test_sabotage()`);
    }
  });

  it('override leaves waiting entries alone: still pending, same holder', async () => {
    const { flatId, ids } = await flat();
    const tahsin = { memberId: ids.Tahsin, role: 'member' as const };
    await addEntry(db, flatId, tahsin, e({ type: 'deposit', amount: 50000, date: '2026-09-03', memberId: ids.Tahsin }));
    expect(await overrideCollector(db, flatId, ids.Zarif, 'phone lost', 'app team')).toBe('ok');
    const rows = await db<{ status: string; h: string }>(`select status, held_by as h from ledger where flat_id = $1`, [flatId]);
    expect(rows).toEqual([{ status: 'pending', h: ids.Nafis }]);
  });

  it('loadMonth never relabels a deposit after a handover: it still shows the collector who actually held it', async () => {
    const { flatId, ids } = await flat();
    const nafis = { memberId: ids.Nafis, role: 'manager' as const };
    expect(await addEntry(db, flatId, nafis, e({ type: 'deposit', amount: 50000, date: '2026-09-03', memberId: ids.Tahsin }))).toBe('ok');
    expect(await offerHandover(db, flatId, nafis, ids.Tahsin, 50000, '2026-09-10')).toBe('ok');
    expect(await acceptHandover(db, flatId, ids.Tahsin, (await currentOffer(db, flatId))!.id)).toBe('ok');
    const mo = await loadMonth(db, flatId, '2026-09-01', '2026-09-10');
    expect(mo.entries.find(x => x.type === 'deposit')?.heldBy).toBe(ids.Nafis);
  });

  it('removing and putting back a deposit keeps who held it', async () => {
    const { flatId, ids } = await flat();
    const tahsin = { memberId: ids.Tahsin, role: 'member' as const };
    await addEntry(db, flatId, tahsin, e({ type: 'deposit', amount: 50000, date: '2026-09-03', memberId: ids.Tahsin }));
    const [{ id }] = await db<{ id: string }>(`select id from ledger where flat_id = $1`, [flatId]);
    expect(await overrideCollector(db, flatId, ids.Zarif, 'phone lost', 'app team')).toBe('ok');
    expect(await removeEntry(db, flatId, tahsin, id, '2026-09-10')).toBe(true);
    expect(await putBack(db, flatId, ids.Tahsin, id, '2026-09-10')).toBe(true);
    expect((await db<{ h: string }>(`select held_by as h from ledger where id = $1`, [id]))[0].h).toBe(ids.Nafis);   // not Zarif, the collector now
  });
});
