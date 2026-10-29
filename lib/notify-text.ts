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
/** Needs correction, to whoever added it: who asks; the reason and amount stay in the app. */
export const fixAskMsg = (lang: Locale, name: string, type: 'bazar' | 'bill', id: string): Msg =>
  ({ title: fill(t(lang).fixAskTitle, { name, what: t(lang).what[type] }), body: t(lang).fixAskBody, url: `/${lang}/money/bazar/${id}` });
/** Fix it saved, to whoever sent it back. */
export const fixedMsg = (lang: Locale, name: string, type: 'bazar' | 'bill', id: string): Msg =>
  ({ title: fill(t(lang).fixedTitle, { name, what: t(lang).what[type] }), body: t(lang).fixedBody, url: `/${lang}/money/bazar/${id}` });
/** The 21:00 reminder: how many bazars and bills wait for this person's check. */
export const checkMsg = (lang: Locale, n: number): Msg =>
  ({ title: fill(n === 1 ? t(lang).checkOneTitle : t(lang).checkTitle, { n: String(n) }), body: t(lang).checkBody, url: `/${lang}/money` });
