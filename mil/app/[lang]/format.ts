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
