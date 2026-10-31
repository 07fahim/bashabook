import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { pushToday } from './meal-push';
import { noCooking, saveMeal } from './meals-db';
import { todayMsg, type TodayKind } from './notify-text';
import type { Msg } from './push';

const TODAY = '2026-10-09';
const spy = () => {
  const calls: { ids: string[]; msg: Msg }[] = [];
  const send = async (_db: unknown, ids: string[], msg: Msg) => { calls.push({ ids, msg }); return { sent: ids.length, gone: 0, failed: 0 }; };
  return { calls, send: send as never };
};

async function flat() {
  await migrate();
  const f = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin', 'Zarif', 'Rafi', 'Fahim'], today: '2026-10-01', lang: 'en' });
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id])) as Record<'Nafis' | 'Tahsin' | 'Zarif' | 'Rafi' | 'Fahim', string>;
  await db(`update members set pin_hash = 'x' where flat_id = $1 and name <> 'Rafi'`, [f.flatId]);   // Rafi never claimed his name
  return { flatId: f.flatId, ids };
}

describe('today’s meal pushes', { timeout: 30000 }, () => {
  it('reach everyone else living here who claimed and eats with the flat, and the collector even cooking for themselves', async () => {
    const { flatId, ids } = await flat();
    await db(`update members set in_meals = false where id = any($1::uuid[])`, [[ids.Zarif, ids.Nafis]]);   // Nafis is the collector
    await db(`update members set left_on = '2026-10-08' where id = $1`, [ids.Fahim]);                       // moved out yesterday
    const s = spy();
    await pushToday(db, flatId, ids.Tahsin, TODAY, 'off', { meals: ['l'] }, s.send);
    expect(s.calls.map(c => c.ids)).toEqual([[ids.Nafis]]);   // not Tahsin (acted), Zarif (own cooking), Rafi (unclaimed), Fahim (left)
    expect(s.calls[0].msg).toMatchObject({ title: 'Tahsin is skipping lunch today', url: '/en/home', tag: `meal:${ids.Tahsin}:${TODAY}:l` });
  });

  it('the body is today’s plates for the cook, each person in their own language', async () => {
    const { flatId, ids } = await flat();
    await saveMeal(db, flatId, ids.Tahsin, { memberId: ids.Tahsin, date: TODAY, meal: 'l', count: 0, guests: 0 }, true);
    await noCooking(db, flatId, ids.Nafis, TODAY, TODAY, ['d'], TODAY);
    await db(`update members set language = 'bn' where id = $1`, [ids.Zarif]);
    const s = spy();
    await pushToday(db, flatId, ids.Tahsin, TODAY, 'off', { meals: ['l'] }, s.send);
    const to = (id: string) => s.calls.find(c => c.ids[0] === id)!.msg;
    expect(to(ids.Nafis).body).toBe('Today’s plates: Breakfast 5 · Lunch 4 · Dinner No cooking');
    expect(to(ids.Zarif)).toMatchObject({ title: 'Tahsin আজ দুপুরে খাবে না', body: 'আজকের প্লেট: সকাল 5 · দুপুর 4 · রাত রান্না বন্ধ', url: '/bn/home' });
  });

  it('names both people for someone else’s meal; away, no cooking and cooking again read right', async () => {
    const { flatId, ids } = await flat();
    const s = spy();
    await pushToday(db, flatId, ids.Nafis, TODAY, 'other', { who: ids.Tahsin, meals: ['l'] }, s.send);
    expect(s.calls.map(c => c.ids[0])).toContain(ids.Tahsin);                     // the person whose meal changed is told too
    expect(s.calls[0].msg.title).toBe('Nafis changed Tahsin’s lunch today');
    await pushToday(db, flatId, ids.Tahsin, TODAY, 'away', { meals: [] }, s.send);
    expect(s.calls.at(-1)!.msg).toMatchObject({ title: 'Tahsin is away from today', tag: `away:${ids.Tahsin}:${TODAY}:` });
    await pushToday(db, flatId, ids.Nafis, TODAY, 'noCook', { meals: ['l', 'd'] }, s.send);
    expect(s.calls.at(-1)!.msg.title).toBe('No cooking today: lunch, dinner');
    await pushToday(db, flatId, ids.Nafis, TODAY, 'cookAgain', { meals: ['d'] }, s.send);
    expect(s.calls.at(-1)!.msg.title).toBe('Cooking again today: dinner');
    for (const c of s.calls) expect(`${c.msg.title} ${c.msg.body}`).not.toMatch(/৳|ম্যানেজার|manager|মেস|mess/i);
  });

  it('never throws, so the change it follows is never undone', async () => {
    await migrate();
    await expect(pushToday(db, randomUUID(), randomUUID(), TODAY, 'on', { meals: ['b'] }, spy().send)).resolves.toBeUndefined();
    const down = (async () => { throw new Error('database down'); }) as never;
    await expect(pushToday(down, randomUUID(), randomUUID(), TODAY, 'on', { meals: ['b'] }, spy().send)).resolves.toBeUndefined();
  });

  it('no cooking has its own tag, so it never replaces the collector’s own meal notice; it expires at Dhaka midnight', async () => {
    const { flatId, ids } = await flat();
    const s = spy();
    await pushToday(db, flatId, ids.Nafis, TODAY, 'noCook', { meals: ['d'] }, s.send);
    expect(s.calls[0].msg.tag).toBe(`cook:${TODAY}:d`);
    expect(s.calls[0].msg.ttl).toBe(60);   // a past day: the shortest life
  });

  it('every kind has a filled title in both languages, never money or a role word', () => {
    const kinds: TodayKind[] = ['on', 'off', 'guestsAdd', 'guestsGone', 'other', 'changed', 'away', 'noCook', 'cookAgain'];
    for (const lang of ['en', 'bn'] as const) for (const k of kinds) {
      const m = todayMsg(lang, k, { actor: 'Nafis', name: 'Tahsin', meals: ['l'] }, { b: 5, l: 4, d: 'off' });
      expect(m.title).not.toMatch(/[{}]|৳|ম্যানেজার|manager|মেস|mess/i);
      expect(m.title.length).toBeGreaterThan(5);
    }
  });
});
