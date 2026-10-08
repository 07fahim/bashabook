import type { Locale } from './dictionaries';

/** 'Fri, 10 October' or 'শুক্র, 10 October': weekday in the page language, English digits and month. */
export function fmtDay(date: string, lang: Locale) {
  const d = new Date(`${date}T00:00:00Z`);
  const weekday = d.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { weekday: 'short', timeZone: 'UTC' });
  return `${weekday}, ${d.getUTCDate()} ${d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })}`;
}

/** '22:00' or '22:00:00' → '10:00 pm'. */
export function fmtTime(time: string) {
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** A moment in Dhaka time: 'Sat, 10 October, 11:15 pm'. */
export function fmtWhen(at: Date | string, lang: Locale) {
  const d = new Date(new Date(at).getTime() + 6 * 3600_000).toISOString();
  return `${fmtDay(d.slice(0, 10), lang)}, ${fmtTime(d.slice(11, 16))}`;
}
