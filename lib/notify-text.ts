import { getDictionary, type Locale } from '../app/[lang]/dictionaries';
import { fmtMonth, fmtTime } from '../app/[lang]/format';
import type { Msg } from './push';

const t = (lang: Locale) => getDictionary(lang).push;
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const monthName = (month: string) => fmtMonth(month).split(' ')[0];

export const mealMsg = (lang: Locale, cutoff: string): Msg =>
  ({ title: fill(t(lang).mealTitle, { time: fmtTime(cutoff.slice(0, 5)) }), body: t(lang).mealBody, url: `/${lang}/meals` });
export const depositMsg = (lang: Locale, name: string): Msg =>
  ({ title: fill(t(lang).depositTitle, { name }), body: t(lang).depositBody, url: `/${lang}/money` });
export const payoutMsg = (lang: Locale, name: string): Msg =>
  ({ title: fill(t(lang).payoutTitle, { name }), body: t(lang).payoutBody, url: `/${lang}/money` });
export const handoverMsg = (lang: Locale, name: string): Msg =>
  ({ title: fill(t(lang).handoverTitle, { name }), body: t(lang).handoverBody, url: `/${lang}/home` });
export const closeMsg = (lang: Locale, month: string, pending: number): Msg => pending > 0
  ? { title: fill(t(lang).closeWaitTitle, { month: monthName(month), n: String(pending) }), body: t(lang).closeWaitBody, url: `/${lang}/money` }
  : { title: fill(t(lang).closeTitle, { month: monthName(month) }), body: t(lang).closeBody, url: `/${lang}/manage` };
