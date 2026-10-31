import type { Locale } from '../app/[lang]/dictionaries';
import type { Db } from './db';
import { headcount, MEALS, plates, type Meal } from './meals';
import { loadMeals } from './meals-db';
import { todayMsg, type TodayKind } from './notify-text';
import { sendPush } from './push';

/** A change to today's meals, sent after the response: one push to each other person living here today who claimed their
 *  name and eats with the flat, and to the collector even when cooking for themselves (they tell the cook). `who` is the
 *  person whose meal changed when it isn't the actor's own. The title says who changed what; the body is today's plates.
 *  One tag per person, day and meal (per person and day for away; per day and meals for no cooking), so a quick correction
 *  replaces the earlier
 *  notification instead of buzzing again. Best effort: never throws, so the change it follows always stands. */
export async function pushToday(db: Db, flatId: string, actor: string, today: string, kind: TodayKind, v: { who?: string; meals: Meal[] }, send = sendPush) {
  try {
    const { flat, members, changes, noCook } = await loadMeals(db, flatId, today, today);
    const hc = headcount(members, changes, today);
    const p = Object.fromEntries(MEALS.map(x => [x, plates(hc, noCook, today, x)])) as Record<Meal, number | 'off'>;
    const name = (id: string) => members.find(x => x.id === id)?.name ?? '';
    const who = v.who ?? actor;
    const tag = kind === 'noCook' || kind === 'cookAgain' ? `cook:${today}:${v.meals.join('')}`
      : `${kind === 'away' ? 'away' : 'meal'}:${who}:${today}:${v.meals.join('')}`;
    // kept only until Dhaka midnight: a phone that was off overnight never shows yesterday's "today"
    const ttl = Math.max(60, Math.round((Date.parse(`${today}T00:00:00+06:00`) + 864e5 - Date.now()) / 1000));
    const people = await db<{ id: string; lang: Locale | null }>(
      `select id, language as lang from members where flat_id = $1 and id <> $2 and pin_hash is not null and (in_meals or role = 'manager')
         and joined_on <= $3::text::date and (left_on is null or left_on >= $3::text::date)`, [flatId, actor, today]);
    await Promise.all(people.map(x => send(db, [x.id], { ...todayMsg(x.lang ?? flat.lang, kind, { actor: name(actor), name: name(who), meals: v.meals }, p), tag, ttl })));
  } catch (e) { console.warn('push failed', String(e)); }
}
