import { MEALS, type Meal } from '../../lib/meals';
import type { Dict, Locale } from './dictionaries';

/** 'Fri, 10 October' or 'শুক্র, 10 October': weekday in the page language, English digits and month. */
export function fmtDay(date: string, lang: Locale) {
  const d = new Date(`${date}T00:00:00Z`);
  const weekday = d.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { weekday: 'short', timeZone: 'UTC' });
  return `${weekday}, ${d.getUTCDate()} ${d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })}`;
}

/** '9 – 15 October' or '27 November – 3 December' (no weekday, same in both languages). */
export function fmtRange(from: string, to: string) {
  const day = (x: string) => Number(x.slice(8, 10));
  const month = (x: string) => new Date(`${x}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  return month(from) === month(to) ? `${day(from)} – ${day(to)} ${month(to)}` : `${day(from)} ${month(from)} – ${day(to)} ${month(to)}`;
}

/** '22:00' or '22:00:00' → '10:00 pm'. */
export function fmtTime(time: string) {
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** The Dhaka date of a moment, 'YYYY-MM-DD'. */
export const dhakaDate = (at: Date | string) => new Date(new Date(at).getTime() + 6 * 3600_000).toISOString().slice(0, 10);

/** A moment in Dhaka time: 'Sat, 10 October, 11:15 pm'. */
export function fmtWhen(at: Date | string, lang: Locale) {
  const d = new Date(new Date(at).getTime() + 6 * 3600_000).toISOString();
  return `${fmtDay(d.slice(0, 10), lang)}, ${fmtTime(d.slice(11, 16))}`;
}

/** The count as a message anyone can send the cook from their own phone. */
export const countText = (flatName: string, m: Dict['meals'], date: string, hc: Record<Meal, number>, status: string, lang: Locale) =>
  `${flatName} · ${m.tomorrow}, ${fmtDay(date, lang)}\n${MEALS.map(x => `${m.names[x]} ${hc[x]}`).join(' · ')}\n${status}`;
