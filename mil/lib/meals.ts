export type Meal = 'b' | 'l' | 'd';
export const MEALS: Meal[] = ['b', 'l', 'd'];

export interface MealMember {
  id: string;
  joinedOn: string;          // 'YYYY-MM-DD'
  leftOn: string | null;     // last day in the flat, inclusive
  defaults: Record<Meal, boolean>;
}

/** A saved change. Changes waiting for approval live in change_requests, not here. */
export interface MealChange {
  memberId: string;
  date: string;
  meal: Meal;
  count: number;             // 0 off, 1 on, 2+ with guests
}

/** All dates of the month that starts on `month` ('YYYY-MM-01'). */
export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month.slice(0, 8)}${String(i + 1).padStart(2, '0')}`);
}

export function isPresent(m: MealMember, date: string): boolean {
  return date >= m.joinedOn && (m.leftOn === null || date <= m.leftOn);
}

const key = (memberId: string, date: string, meal: Meal) => `${memberId}|${date}|${meal}`;

export function indexChanges(changes: MealChange[]): Map<string, number> {
  return new Map(changes.map(c => [key(c.memberId, c.date, c.meal), c.count]));
}

export function mealCount(m: MealMember, idx: Map<string, number>, date: string, meal: Meal): number {
  if (!isPresent(m, date)) return 0;
  return idx.get(key(m.id, date, meal)) ?? (m.defaults[meal] ? 1 : 0);
}

/** Weighted meals per member for the month, in hundredths of a meal. Weights are hundredths too (b: 50 = 0.5). */
export function weightedMeals(members: MealMember[], changes: MealChange[], month: string, weights: Record<Meal, number>): Map<string, number> {
  const idx = indexChanges(changes);
  const days = daysOfMonth(month);
  return new Map(members.map(m => [m.id, days.reduce((sum, d) => sum + MEALS.reduce((s, meal) => s + mealCount(m, idx, d, meal) * weights[meal], 0), 0)]));
}

export function daysPresent(members: MealMember[], month: string): Map<string, number> {
  const days = daysOfMonth(month);
  return new Map(members.map(m => [m.id, days.filter(d => isPresent(m, d)).length]));
}

/** Plates per meal for one date, guests included, unweighted. */
export function headcount(members: MealMember[], changes: MealChange[], date: string): Record<Meal, number> {
  const idx = indexChanges(changes);
  const out: Record<Meal, number> = { b: 0, l: 0, d: 0 };
  for (const m of members) for (const meal of MEALS) out[meal] += mealCount(m, idx, date, meal);
  return out;
}

/** A date is locked if it is today or earlier, or it is tomorrow and the Dhaka clock has passed the cutoff.
 *  `nowDhaka` = 'YYYY-MM-DDTHH:MM' in Asia/Dhaka; `cutoff` = 'HH:MM' or 'HH:MM:SS' (Postgres time). */
export function isLocked(date: string, nowDhaka: string, cutoff: string): boolean {
  const [today, time] = nowDhaka.split('T');
  if (date <= today) return true;
  const t = new Date(`${today}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return date === t.toISOString().slice(0, 10) && time.slice(0, 5) >= cutoff.slice(0, 5);
}
