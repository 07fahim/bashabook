import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { addMember, bringBack, createFlat, setLeaving } from './auth';
import { editFrom } from './meals';
import { noCooking, saveMeal } from './meals-db';
import { foodSplit } from './money';
import { addEntry, addRoom, confirmEntry, LEDGER_COLUMNS, loadMonth, openMonth, putBack, removeEntry, setRent, setRoom, stopRepeat, toConfirm, type NewEntry } from './money-db';

const OCT = '2026-10-01', TODAY = '2026-10-09';
const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>): NewEntry =>
  ({ date: '2026-10-05', note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });

async function flat() {
  await migrate();
  const f = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin', 'Zarif'], today: OCT, lang: 'bn' });
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
  const nafis = { memberId: ids.Nafis, role: 'manager' as const };
  const as = (name: string) => ({ memberId: ids[name], role: 'member' as const });
  const month = () => loadMonth(db, f.flatId, OCT, TODAY);
  return { flatId: f.flatId, ids, nafis, as, month };
}

describe('money storage', { timeout: 30000 }, () => {
  it('with guests and an odd bazar, every food share and its own/guest split add up exactly', async () => {
    const { flatId, ids, nafis, month } = await flat();
    await saveMeal(db, flatId, ids.Tahsin, { memberId: ids.Tahsin, date: '2026-10-08', meal: 'd', count: 3, guests: 2 }, false);
    await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 100001 }));
    const { result, meals, guestMeals } = await month();
    expect(result.perMember.reduce((a, m) => a + m.foodCost, 0)).toBe(100001);
    for (const m of result.perMember) {
      const x = foodSplit(m.foodCost, meals.get(m.id) ?? 0, guestMeals.get(m.id) ?? 0);
      expect(x.own + x.guests).toBe(m.foodCost);
    }
  });

  it('meals count up to today; a guest plate is charged once to the host and shown apart', async () => {
    const { flatId, ids, month } = await flat();
    await saveMeal(db, flatId, ids.Tahsin, { memberId: ids.Tahsin, date: '2026-10-08', meal: 'd', count: 3, guests: 2 }, false);
    const { meals, guestMeals, members, result, first } = await month();
    expect(meals.get(ids.Nafis)).toBe(9 * 250);            // 1 to 9 October, breakfast counts half
    expect(meals.get(ids.Tahsin)).toBe(9 * 250 + 200);     // two guest dinners on top
    expect(guestMeals.get(ids.Tahsin)).toBe(200);
    expect(members.map(m => m.name)).toEqual(['Nafis', 'Tahsin', 'Zarif']);
    expect(result.invariantOk).toBe(true);
    expect(first).toBe(OCT);
  });
  it('shopper gets ৳3,000, spends ৳2,450, hands back ৳550: flat money is what the collector holds', async () => {
    const { flatId, ids, nafis, as, month } = await flat();
    expect(await addEntry(db, flatId, as('Zarif'), e({ type: 'deposit', amount: 1000000, memberId: ids.Zarif }))).toBe('ok');
    expect(await addEntry(db, flatId, nafis, e({ type: 'payout', amount: 300000, memberId: ids.Tahsin, note: 'for bazar' }))).toBe('ok');
    expect((await month()).result.fund).toBe(0);   // both wait for a tap
    const [dep] = await toConfirm(db, flatId, ids.Nafis, true);
    const [pay] = await toConfirm(db, flatId, ids.Tahsin, false);
    expect(await confirmEntry(db, flatId, as('Tahsin'), dep.id)).toBe(false);   // only the collector confirms deposits
    expect(await confirmEntry(db, flatId, nafis, pay.id)).toBe(false);          // only the receiver confirms a handover
    expect(await confirmEntry(db, flatId, nafis, dep.id)).toBe(true);
    expect(await confirmEntry(db, flatId, as('Tahsin'), pay.id)).toBe(true);
    await addEntry(db, flatId, as('Tahsin'), e({ type: 'bazar', amount: 245000, paidBy: ids.Tahsin }));
    await addEntry(db, flatId, nafis, e({ type: 'deposit', amount: 55000, memberId: ids.Tahsin, note: 'change' }));
    const { result } = await month();
    expect(result.invariantOk).toBe(true);
    expect(result.fund).toBe(1000000 - 245000);
    const t = result.perMember.find(m => m.id === ids.Tahsin)!;
    expect(t.paidIn - t.payouts).toBe(0);   // the advance, the shop and the change cancel out
    expect(result.perMember.reduce((a, m) => a + m.foodCost, 0)).toBe(245000);   // the bazar counts once
    // equal meals: ৳2,450 → 816.67, 816.67, 816.66 (largest remainder, ties to the first name)
    const bal = new Map(result.perMember.map(m => [m.id, m.balance]));
    expect([bal.get(ids.Nafis), bal.get(ids.Tahsin), bal.get(ids.Zarif)]).toEqual([-81667, -81667, 1000000 - 81666]);
  });

  it('a shopper who spends ৳500 of their own beyond a ৳3,000 advance is owed exactly that', async () => {
    const { flatId, ids, nafis, as, month } = await flat();
    await addEntry(db, flatId, nafis, e({ type: 'deposit', amount: 1000000, memberId: ids.Zarif }));
    await addEntry(db, flatId, nafis, e({ type: 'payout', amount: 300000, memberId: ids.Tahsin }));
    const [pay] = await toConfirm(db, flatId, ids.Tahsin, false);
    await confirmEntry(db, flatId, as('Tahsin'), pay.id);
    await addEntry(db, flatId, as('Tahsin'), e({ type: 'bazar', amount: 350000, paidBy: ids.Tahsin }));
    const { result } = await month();
    expect(result.invariantOk).toBe(true);
    expect(result.fund).toBe(700000);                                   // ৳10,000 in, ৳3,000 handed over
    const bal = new Map(result.perMember.map(m => [m.id, m.balance]));
    // food ৳3,500 → 1166.67, 1166.67, 1166.66; Tahsin is ৳500 up before his food share
    expect([bal.get(ids.Nafis), bal.get(ids.Tahsin), bal.get(ids.Zarif)]).toEqual([-116667, 50000 - 116667, 1000000 - 116666]);
  });

  it('someone who joins mid-month shares an everyone bill by days here', async () => {
    const { flatId, ids, nafis, month } = await flat();
    await addMember(db, flatId, 'Rafi', '2026-10-17');                  // 15 of 31 days
    await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 108000, note: 'Electricity', split: 'equal' }));
    const { result, members } = await month();
    const rafi = members.find(m => m.name === 'Rafi')!.id;
    const share = new Map(result.perMember.map(m => [m.id, m.billShare]));
    expect([share.get(ids.Nafis), share.get(ids.Tahsin), share.get(ids.Zarif), share.get(rafi)]).toEqual([31000, 31000, 31000, 15000]);
  });

  it('members deposit only for themselves and never hand out flat money', async () => {
    const { flatId, ids, as } = await flat();
    expect(await addEntry(db, flatId, as('Tahsin'), e({ type: 'deposit', amount: 100, memberId: ids.Zarif }))).toBe('bad');
    expect(await addEntry(db, flatId, as('Tahsin'), e({ type: 'payout', amount: 100, memberId: ids.Tahsin }))).toBe('bad');
    expect(await addEntry(db, flatId, as('Tahsin'), e({ type: 'bazar', amount: 100, paidBy: 'not-a-member' }))).toBe('bad');
    expect(await addEntry(db, flatId, as('Tahsin'), e({ type: 'bill', amount: 100, split: 'selected', selected: [] }))).toBe('bad');
  });

  it('a one-off bill for everyone living here leaves out someone who moves in later', async () => {
    const { flatId, ids, nafis, month } = await flat();
    await addMember(db, flatId, 'Rafi', '2026-10-07');
    expect(await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 30000, note: 'Fan repair', split: 'here' }))).toBe('ok');
    const { entries, result } = await month();
    expect([...entries[0].selected].sort()).toEqual([ids.Nafis, ids.Tahsin, ids.Zarif].sort());
    expect(result.perMember.map(m => m.billShare).sort()).toEqual([0, 10000, 10000, 10000]);
  });

  it('rent by room waits until everyone has a room, then follows the rents', async () => {
    const { flatId, ids, nafis, as, month } = await flat();
    const rent = e({ type: 'bill', amount: 2000000, note: 'Rent', split: 'room' });
    expect(await addEntry(db, flatId, nafis, rent)).toBe('rooms');
    expect(await addRoom(db, flatId, as('Tahsin'), 'Mine', 100)).toBeNull();   // rooms are the collector's
    const master = (await addRoom(db, flatId, nafis, 'Master', 1200000))!, small = (await addRoom(db, flatId, nafis, 'Small', 800000))!;
    await setRoom(db, flatId, nafis, ids.Nafis, master);
    await setRoom(db, flatId, nafis, ids.Tahsin, master);
    expect(await addEntry(db, flatId, nafis, rent)).toBe('rooms');   // Zarif has no room, Small is empty
    await setRoom(db, flatId, nafis, ids.Zarif, master);
    expect(await addEntry(db, flatId, nafis, rent)).toBe('rooms');   // everyone has a room, but Small's rent has nobody to pay it
    await setRoom(db, flatId, nafis, ids.Zarif, small);
    expect(await addEntry(db, flatId, nafis, rent)).toBe('ok');
    const share = new Map((await month()).result.perMember.map(m => [m.id, m.billShare]));
    expect([share.get(ids.Nafis), share.get(ids.Tahsin), share.get(ids.Zarif)]).toEqual([600000, 600000, 800000]);
  });

  it('only whoever added an entry or the collector removes it, and the removal stays visible', async () => {
    const { flatId, ids, as, nafis, month } = await flat();
    await addEntry(db, flatId, as('Tahsin'), e({ type: 'bazar', amount: 50000, paidBy: ids.Tahsin }));
    await addEntry(db, flatId, nafis, e({ type: 'deposit', amount: 20000, memberId: ids.Nafis }));
    await addEntry(db, flatId, as('Zarif'), e({ type: 'deposit', amount: 30000, memberId: ids.Zarif }));
    const { entries } = await month();
    const bazar = entries.find(x => x.type === 'bazar')!.id, zarifDep = entries.find(x => x.memberId === ids.Zarif)!.id;
    expect(await removeEntry(db, flatId, as('Zarif'), bazar, TODAY)).toBe(false);
    await confirmEntry(db, flatId, nafis, zarifDep);
    expect(await removeEntry(db, flatId, as('Zarif'), zarifDep, TODAY)).toBe(false);   // the cash is with the collector now
    expect(await removeEntry(db, flatId, nafis, bazar, TODAY)).toBe(true);
    const after = await month();
    expect(after.entries.map(x => x.type)).toEqual(['deposit', 'deposit']);
    expect(after.removed.map(r => [r.by, r.type, r.amount])).toEqual([['Nafis', 'bazar', 50000]]);
  });

  it('room and monthly-bill writes say false when nothing changed, and refuse bad rents', async () => {
    const { flatId, ids, nafis } = await flat();
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect(await addRoom(db, flatId, nafis, 'Master', -5)).toBeNull();
    expect(await addRoom(db, flatId, nafis, 'Master', 1.5)).toBeNull();
    const room = (await addRoom(db, flatId, nafis, 'Master', 1200000))!;
    expect(await setRent(db, flatId, nafis, room, -1)).toBe(false);
    expect(await setRent(db, flatId, nafis, ghost, 100)).toBe(false);            // no such room
    expect(await setRoom(db, flatId, nafis, ghost, room)).toBe(false);           // no such member
    expect(await setRoom(db, flatId, nafis, ids.Tahsin, ghost)).toBe(false);     // no such room
    expect(await setRoom(db, flatId, nafis, ids.Tahsin, room)).toBe(true);
    expect(await stopRepeat(db, flatId, nafis, ghost)).toBe(false);
  });

  it('a removed bill keeps everything in its record, the picked people too', async () => {
    const { flatId, ids, nafis, month } = await flat();
    await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 20000, note: 'Laundry', split: 'selected', selected: [ids.Tahsin, ids.Zarif] }));
    const id = (await month()).entries[0].id;
    await removeEntry(db, flatId, nafis, id, TODAY);
    const [rec] = await db<{ b: Record<string, unknown> }>(`select before as b from audit_log where entity = 'ledger' and entity_id = $1 and after->>'removed' = 'true'`, [id]);
    expect(rec.b).toMatchObject({ amount_poisha: 20000, split: 'selected', note: 'Laundry', date: '2026-10-05', created_by: ids.Nafis, paid_by_member_id: null });
    expect([...(rec.b.selected as string[])].sort()).toEqual([ids.Tahsin, ids.Zarif].sort());
  });

  it('a monthly bill is copied once into each new month, from flat money', async () => {
    const { flatId, ids, nafis, as } = await flat();
    expect(await addEntry(db, flatId, as('Tahsin'), e({ type: 'bill', amount: 100, note: 'Mine', split: 'equal', repeat: true }))).toBe('bad');   // the collector's
    await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 120000, note: 'Wi-Fi', split: 'here', repeat: true }));   // becomes "by days" when repeated
    await openMonth(db, flatId, '2026-11-01');
    const nov = await loadMonth(db, flatId, '2026-11-01', '2026-11-03');   // opens November again: no second copy
    expect(nov.entries.map(x => [x.note, x.amount, x.paidBy, x.split])).toEqual([['Wi-Fi', 120000, null, 'equal']]);
    // added by the collector, whoever opens the page first, so no flatmate can remove the flat's bill
    expect(nov.entries[0].createdBy).toBe(ids.Nafis);
    expect(await removeEntry(db, flatId, as('Tahsin'), nov.entries[0].id, TODAY)).toBe(false);
  });

  it('a monthly bill for some people drops whoever left, and skips the bill if nobody is left', async () => {
    const { flatId, ids, nafis } = await flat();
    await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 50000, note: 'AC', split: 'selected', selected: [ids.Tahsin, ids.Zarif], repeat: true }));
    await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 30000, note: 'Gym', split: 'selected', selected: [ids.Zarif], repeat: true }));
    await db(`update members set left_on = '2026-10-31' where id = $1`, [ids.Zarif]);
    const nov = await loadMonth(db, flatId, '2026-11-01', '2026-11-03');
    expect(nov.entries.map(x => [x.note, x.selected])).toEqual([['AC', [ids.Tahsin]]]);
  });

  it('a bill and its repeat are saved together or not at all', async () => {
    const { flatId, nafis, month } = await flat();
    await db(`create or replace function boom2() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`);
    await db(`create trigger boom2 before insert on bill_templates for each row execute function boom2()`);
    await expect(addEntry(db, flatId, nafis, e({ type: 'bill', amount: 120000, note: 'Wi-Fi', split: 'equal', repeat: true }))).rejects.toThrow(/boom/);
    await db(`drop trigger boom2 on bill_templates`);
    expect((await month()).entries).toEqual([]);                                     // no bill without its repeat
    expect(await db(`select 1 from bill_templates where flat_id = $1`, [flatId])).toEqual([]);
  });

  it('opening a month is all or nothing: a failure leaves no month, and the retry copies every bill once', async () => {
    const { flatId, nafis } = await flat();
    await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 120000, note: 'Wi-Fi', split: 'equal', repeat: true }));
    await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 2000000, note: 'Rent', split: 'equal', repeat: true }));
    // make the second bill's insert fail once
    await db(`create or replace function boom() returns trigger language plpgsql as $$ begin
      if new.note = 'Rent' then raise exception 'boom'; end if; return new; end $$`);
    await db(`create trigger boom before insert on ledger for each row execute function boom()`);
    await expect(openMonth(db, flatId, '2026-12-01')).rejects.toThrow(/boom/);
    expect(await db(`select 1 from months where flat_id = $1 and month = '2026-12-01'`, [flatId])).toEqual([]);
    await db(`drop trigger boom on ledger`);
    await openMonth(db, flatId, '2026-12-01');
    await openMonth(db, flatId, '2026-12-01');
    const dec = await loadMonth(db, flatId, '2026-12-01', '2026-12-02');
    expect(dec.entries.map(x => x.note).sort()).toEqual(['Rent', 'Wi-Fi']);
  });

  it('bring back: the gap days are no meals, so the meal rate stays; bills count those days as living here', async () => {
    const { flatId, ids, nafis } = await flat();
    expect(await setLeaving(db, flatId, ids.Nafis, ids.Zarif, '2026-10-08', '2026-10-08')).toBe('ok');
    await noCooking(db, flatId, ids.Nafis, '2026-10-10', '2026-10-10', ['b', 'l', 'd'], '2026-10-09');
    await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 100000 }));
    await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 93000, note: 'Rent', split: 'equal' }));
    const at12 = () => loadMonth(db, flatId, OCT, '2026-10-12');
    const before = await at12();
    expect(await bringBack(db, flatId, ids.Nafis, ids.Zarif, '2026-10-12', editFrom('2026-10-12'))).toBe('ok');
    const after = await at12();
    expect(after.meals.get(ids.Zarif)).toBe(8 * 250);             // 1 to 8 October only: 9 to 12 are saved as no meals
    expect(after.result.mealRate).toBe(before.result.mealRate);
    const share = (m: typeof after, id: string) => m.result.perMember.find(p => p.id === id)!.billShare;
    expect(share(before, ids.Zarif)).toBe(10628);                  // 8 of 70 days lived here (31 + 31 + 8)
    expect(share(after, ids.Zarif)).toBe(share(after, ids.Nafis)); // back for the whole month: rent for the gap days too
    expect(after.result.lines.some(l => l.memberId === ids.Zarif && l.amount === share(after, ids.Zarif))).toBe(true);   // shown by name in the breakdown
  });

  it('paying back someone who moved out counts at once: they can no longer sign in to confirm', async () => {
    const { flatId, ids, nafis, month } = await flat();
    await db(`update members set left_on = '2026-10-08' where id = $1`, [ids.Zarif]);   // before today, so gone
    expect(await addEntry(db, flatId, nafis, e({ type: 'payout', amount: 120000, memberId: ids.Zarif, date: '2026-10-09' }))).toBe('ok');
    expect(await addEntry(db, flatId, nafis, e({ type: 'payout', amount: 50000, memberId: ids.Tahsin }))).toBe('ok');
    const { entries } = await month();
    expect(entries.map(x => [x.memberId, x.status]).sort()).toEqual([[ids.Tahsin, 'pending'], [ids.Zarif, 'ok']].sort());
  });

  it('stopping a monthly bill is written to the history', async () => {
    const { flatId, nafis } = await flat();
    await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 120000, note: 'Wi-Fi', split: 'equal', repeat: true }));
    const [t] = await db<{ id: string }>(`select id from bill_templates where flat_id = $1`, [flatId]);
    expect(await stopRepeat(db, flatId, nafis, t.id)).toBe(true);
    const [h] = await db<{ name: string }>(`select before->>'name' as name from audit_log where entity = 'bill_templates' and entity_id = $1`, [t.id]);
    expect(h.name).toBe('Wi-Fi');
  });
  it('who paid the shop must live here that day; money to and from someone who left still works', async () => {
    const { flatId, ids, nafis } = await flat();
    await db(`update members set left_on = '2026-10-08' where id = $1`, [ids.Zarif]);
    expect(await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 50000, paidBy: ids.Zarif, date: '2026-10-09' }))).toBe('gone');
    expect(await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 50000, note: 'Gas', split: 'equal', paidBy: ids.Zarif, date: '2026-10-09' }))).toBe('gone');
    expect(await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 50000, paidBy: ids.Zarif, date: '2026-10-08' }))).toBe('ok');   // his last day
    expect(await addEntry(db, flatId, nafis, e({ type: 'deposit', amount: 120000, memberId: ids.Zarif, date: '2026-10-12' }))).toBe('ok');   // he pays what he owes
    expect(await addEntry(db, flatId, nafis, e({ type: 'payout', amount: 10000, memberId: ids.Zarif, date: '2026-10-12' }))).toBe('ok');    // paid back
    await addMember(db, flatId, 'Rafi', '2026-10-15');
    const rafi = (await db<{ id: string }>(`select id from members where flat_id = $1 and name = 'Rafi'`, [flatId]))[0].id;
    expect(await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 50000, paidBy: rafi, date: '2026-10-05' }))).toBe('gone');   // not here yet
  });
  it('put back restores the exact entry, its people and status, and the balances', async () => {
    const { flatId, ids, nafis, as, month } = await flat();
    await addEntry(db, flatId, as('Zarif'), e({ type: 'deposit', amount: 300000, memberId: ids.Zarif, note: 'TRX9' }));
    await confirmEntry(db, flatId, nafis, (await toConfirm(db, flatId, ids.Nafis, true))[0].id);
    await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 20000, note: 'Laundry', split: 'selected', selected: [ids.Tahsin, ids.Zarif] }));
    const before = await month();
    const rows = await db<{ j: unknown }>(`select to_jsonb(l) as j from ledger l order by id`);
    for (const x of before.entries) expect(await removeEntry(db, flatId, nafis, x.id, TODAY)).toBe(true);
    expect((await month()).removed.map(r => r.type).sort()).toEqual(['bill', 'deposit']);
    for (const x of before.entries) expect(await putBack(db, flatId, ids.Nafis, x.id, TODAY)).toBe(true);
    const after = await month();
    expect(await db<{ j: unknown }>(`select to_jsonb(l) as j from ledger l order by id`)).toEqual(rows);   // byte for byte, confirmed status too
    expect(after.entries.find(x => x.type === 'bill')!.selected.sort()).toEqual([ids.Tahsin, ids.Zarif].sort());
    expect(after.result.perMember).toEqual(before.result.perMember);
    expect(after.removed).toEqual([]);
  });

  it('two put backs at once: the entry once, one history row, counted once', async () => {
    const { flatId, ids, nafis, month } = await flat();
    await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 90000 }));
    const id = (await month()).entries[0].id;
    await removeEntry(db, flatId, nafis, id, TODAY);
    const r = await Promise.all([putBack(db, flatId, ids.Nafis, id, TODAY), putBack(db, flatId, ids.Nafis, id, TODAY)]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(await db(`select 1 from ledger where id = $1`, [id])).toHaveLength(1);
    expect(await db(`select 1 from audit_log where entity_id = $1 and after->>'putBack' = 'true'`, [id])).toHaveLength(1);
    expect((await month()).result.perMember.reduce((a, m) => a + m.foodCost, 0)).toBe(90000);
    expect(await putBack(db, flatId, ids.Nafis, id, TODAY)).toBe(false);   // already back: nothing written
  });

  it('two removes at once write one history row', async () => {
    const { flatId, nafis, month } = await flat();
    await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 90000 }));
    const id = (await month()).entries[0].id;
    const r = await Promise.all([removeEntry(db, flatId, nafis, id, TODAY), removeEntry(db, flatId, nafis, id, TODAY)]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(await db(`select 1 from audit_log where entity_id = $1 and after->>'removed' = 'true'`, [id])).toHaveLength(1);
  });

  it('only the latest remover or the current collector puts back', async () => {
    const { flatId, ids, nafis, as, month } = await flat();
    await addEntry(db, flatId, as('Tahsin'), e({ type: 'bazar', amount: 50000, paidBy: ids.Tahsin }));
    const id = (await month()).entries[0].id;
    await removeEntry(db, flatId, as('Tahsin'), id, TODAY);
    expect(await putBack(db, flatId, ids.Zarif, id, TODAY)).toBe(false);    // not his removal, not the collector
    expect(await putBack(db, flatId, ids.Tahsin, id, TODAY)).toBe(true);    // his own removal
    await removeEntry(db, flatId, nafis, id, TODAY);
    expect(await putBack(db, flatId, ids.Tahsin, id, TODAY)).toBe(false);   // the latest removal is Nafis's
    // the collector role moves to Zarif while the entry is removed: the new collector may, Nafis (now a member, not the remover) may not
    await addEntry(db, flatId, as('Tahsin'), e({ type: 'bazar', amount: 1000, paidBy: ids.Tahsin }));
    const id2 = (await month()).entries.find(x => x.amount === 1000)!.id;
    await removeEntry(db, flatId, as('Tahsin'), id2, TODAY);
    await db(`update members set role = 'member' where id = $1`, [ids.Nafis]);
    await db(`update members set role = 'manager' where id = $1`, [ids.Zarif]);
    expect(await putBack(db, flatId, ids.Nafis, id2, TODAY)).toBe(false);
    expect(await putBack(db, flatId, ids.Zarif, id2, TODAY)).toBe(true);
  });

  it('put back only in the open current month for whoever made the removal (the collector gets the wider window instead)', async () => {
    const { flatId, ids, as } = await flat();
    await addEntry(db, flatId, as('Tahsin'), e({ type: 'bazar', amount: 50000, paidBy: ids.Tahsin }));
    const [{ id }] = await db<{ id: string }>(`select id from ledger where flat_id = $1 and paid_by_member_id = $2`, [flatId, ids.Tahsin]);
    await removeEntry(db, flatId, as('Tahsin'), id, TODAY);
    expect(await putBack(db, flatId, ids.Tahsin, id, '2026-11-01')).toBe(false);   // next month: October is past
    await db(`update months set status = 'closed' where flat_id = $1 and month = '2026-10-01'`, [flatId]);
    expect(await putBack(db, flatId, ids.Tahsin, id, '2026-10-20')).toBe(false);   // closed before the month ended
    await db(`update months set status = 'open' where flat_id = $1 and month = '2026-10-01'`, [flatId]);
    expect(await putBack(db, flatId, ids.Tahsin, id, '2026-10-31')).toBe(true);    // last day, open
  });

  it('put back keeps entries added in between, refuses a broken record, and is all or nothing', async () => {
    const { flatId, ids, nafis, month } = await flat();
    await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 20000, note: 'Laundry', split: 'selected', selected: [ids.Tahsin] }));
    const id = (await month()).entries[0].id;
    await removeEntry(db, flatId, nafis, id, TODAY);
    await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 70000 }));
    // a split insert that fails rolls back the entry and its history
    await db(`create or replace function boom3() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`);
    await db(`create trigger boom3 before insert on bill_split_members for each row execute function boom3()`);
    await expect(putBack(db, flatId, ids.Nafis, id, TODAY)).rejects.toThrow(/boom/);
    await db(`drop trigger boom3 on bill_split_members`);
    expect(await db(`select 1 from ledger where id = $1`, [id])).toEqual([]);
    expect(await db(`select 1 from audit_log where entity_id = $1 and after->>'putBack' = 'true'`, [id])).toEqual([]);
    // a record missing a column is refused, never filled in
    await db(`update audit_log set before = before - 'created_by' where entity_id = $1`, [id]);
    expect(await putBack(db, flatId, ids.Nafis, id, TODAY)).toBe(false);
    expect((await month()).entries.map(x => x.amount)).toEqual([70000]);   // the bazar added in between is untouched
  });

  it('put back checks every ledger column: the list matches the table', async () => {
    await migrate();
    const cols = await db<{ c: string }>(`select column_name as c from information_schema.columns where table_name = 'ledger' order by ordinal_position`);
    expect(cols.map(r => r.c).join(',')).toBe(LEDGER_COLUMNS);
  });

  it('meal counts on screen are the engine numbers: they add up, guests inside, own never negative', async () => {
    const { flatId, ids, nafis, month } = await flat();
    await saveMeal(db, flatId, ids.Tahsin, { memberId: ids.Tahsin, date: '2026-10-08', meal: 'd', count: 3, guests: 2 }, false);
    await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 300001 }));
    const { meals, guestMeals, result } = await month();
    const total = [...meals.values()].reduce((a, b) => a + b, 0);
    expect(result.mealRate).toBe(Math.round((300001 * 100) / total));
    for (const [id, m] of meals) {
      const g = guestMeals.get(id) ?? 0;
      expect(m - g).toBeGreaterThanOrEqual(0);
    }
    expect([...guestMeals.values()].reduce((a, b) => a + b, 0)).toBe(200);   // two guest dinners, weight 1
    expect(total).toBe(3 * 9 * 250 + 200);
  });

  it('the collector removes and puts back a settled entry from an earlier still-open month; forbidden once it closes; a non-collector still can\'t', async () => {
    const { flatId, ids, nafis, as } = await flat();
    await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 40000, date: '2026-09-20', note: 'September' }));
    const sep = (await db<{ id: string }>(`select id from ledger where flat_id = $1 and note = 'September'`, [flatId]))[0].id;
    const version = async () => (await db<{ v: number }>(`select version as v from months where flat_id = $1 and month = '2026-09-01'`, [flatId]))[0].v;
    expect(await removeEntry(db, flatId, as('Tahsin'), sep, TODAY)).toBe(false);   // non-collector: this month only, still
    const v0 = await version();
    expect(await removeEntry(db, flatId, nafis, sep, TODAY)).toBe(true);          // collector: an earlier open month too
    expect(await db(`select 1 from ledger where id = $1`, [sep])).toEqual([]);
    expect(await db(`select 1 from audit_log where entity_id = $1 and after->>'removed' = 'true'`, [sep])).toHaveLength(1);
    expect(await version()).toBeGreaterThan(v0);
    expect(await putBack(db, flatId, ids.Nafis, sep, TODAY)).toBe(true);          // same window, puts it back
    expect(await db(`select 1 from ledger where id = $1`, [sep])).toHaveLength(1);
    expect(await removeEntry(db, flatId, nafis, sep, TODAY)).toBe(true);          // remove it again, so there's something to try to undo once closed
    await db(`update months set status = 'closed' where flat_id = $1 and month = '2026-09-01'`, [flatId]);
    expect(await putBack(db, flatId, ids.Nafis, sep, TODAY)).toBe(false);         // closed: forbidden, even for the collector
    expect(await db(`select 1 from ledger where id = $1`, [sep])).toEqual([]);
    expect(await removeEntry(db, flatId, nafis, sep, TODAY)).toBe(false);         // and a fresh removal is refused too
  });

  it('a pending entry still goes from any month, but only for whoever sent it or the collector', async () => {
    const { flatId, ids, as } = await flat();
    await openMonth(db, flatId, '2026-09-01');
    await addEntry(db, flatId, as('Tahsin'), e({ type: 'deposit', amount: 10000, memberId: ids.Tahsin, note: 'Tahsin September' }));
    await db(`update ledger set date = '2026-09-20', month = '2026-09-01' where flat_id = $1 and note = 'Tahsin September'`, [flatId]);   // as if sent last month
    const mine = (await db<{ id: string; status: string }>(`select id, status from ledger where flat_id = $1 and note = 'Tahsin September'`, [flatId]))[0];
    expect(mine.status).toBe('pending');
    expect(await removeEntry(db, flatId, as('Zarif'), mine.id, TODAY)).toBe(false);
    expect(await removeEntry(db, flatId, as('Tahsin'), mine.id, TODAY)).toBe(true);
  });
});
