export type Meal = 'b' | 'l' | 'd';
export const MEALS: Meal[] = ['b', 'l', 'd'];

export interface MealMember {
  id: string;
  joinedOn: string;          // 'YYYY-MM-DD'
  leftOn: string | null;     // last day in the flat, inclusive
  defaults: Record<Meal, boolean>;
}

/** A saved change. */
export interface MealChange {
  memberId: string;
  date: string;
  meal: Meal;
  count: number;             // total plates: my own (0 or 1) plus guests; the only number billing reads
  guests?: number;           // guest plates inside count
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

/** The member's own plate (0 or 1) for one meal: the saved count less its guests, else the usual. */
export function ownPlate(m: MealMember, changes: MealChange[], date: string, meal: Meal): number {
  if (!isPresent(m, date)) return 0;
  const c = changes.find(c => c.memberId === m.id && c.date === date && c.meal === meal);
  return c ? c.count - (c.guests ?? 0) : m.defaults[meal] ? 1 : 0;
}

/** Weighted meals per member for the month, in hundredths of a meal. Weights are hundredths too (b: 50 = 0.5).
 *  `upTo` stops the count at a day, for numbers so far. */
export function weightedMeals(members: MealMember[], changes: MealChange[], month: string, weights: Record<Meal, number>, upTo = '9999-12-31'): Map<string, number> {
  const idx = indexChanges(changes);
  const days = daysOfMonth(month).filter(d => d <= upTo);
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

/** The cook's number for one meal, or 'off' when no cooking blocks it. If someone still put plates on a blocked meal,
 *  the number shows as usual: the cook has to make them. */
export const plates = (hc: Record<Meal, number>, noCook: { date: string; meal: string }[], date: string, meal: Meal) =>
  hc[meal] === 0 && noCook.some(n => n.date === date && n.meal === meal) ? 'off' as const : hc[meal];

/** A date is locked if it is today or earlier, or it is tomorrow and the Dhaka clock has passed the cutoff.
 *  `nowDhaka` = 'YYYY-MM-DDTHH:MM' in Asia/Dhaka; `cutoff` = 'HH:MM' or 'HH:MM:SS' (Postgres time). */
export function isLocked(date: string, nowDhaka: string, cutoff: string): boolean {
  const [today, time] = nowDhaka.split('T');
  if (date <= today) return true;
  return date === addDays(today, 1) && time.slice(0, 5) >= cutoff.slice(0, 5);
}

export const addDays = (date: string, n: number) => {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** The earliest week (0 = the week starting today, -1 the one before) that still holds a day on or after `start`, the
 *  flat's first move-in: going back further would only show days before anyone lived here. */
export const firstWeek = (today: string, start: string) =>
  Math.min(0, Math.ceil((Date.parse(start) - Date.parse(today) - 6 * 864e5) / (7 * 864e5))) || 0;   // || 0: never -0

/** Dhaka clock as 'YYYY-MM-DDTHH:MM'. Dhaka is UTC+6 all year. */
export const nowDhaka = () => new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 16);
export const todayDhaka = () => nowDhaka().slice(0, 10);

export const isMeal = (v: unknown): v is Meal => v === 'b' || v === 'l' || v === 'd';
// years 2000 to 2099: Postgres rejects year 0000, and nothing in a flat's books is older than the app
export const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && addDays(v, 0) === v;

export type Decision = 'open' | 'late' | 'closed';

/** What a member's change to `date` becomes: saved, saved as late (tomorrow after the cutoff), or refused (today and before). */
export function mealDecision(date: string, now: string, cutoff: string): Decision {
  if (date <= now.slice(0, 10)) return 'closed';
  if (!isLocked(date, now, cutoff)) return 'open';
  return 'late';
}

/** First day the person who runs the flat can still fix: the 1st of last month. Plan 6 moves this to the open month. */
export const editFrom = (today: string) => `${addDays(`${today.slice(0, 8)}01`, -1).slice(0, 8)}01`;

/** Meals whose plate count differs between two counts, in day order. */
export const countChanges = (before: Record<Meal, number>, now: Record<Meal, number>) =>
  MEALS.filter(m => before[m] !== now[m]).map(m => ({ meal: m, from: before[m], to: now[m] }));
