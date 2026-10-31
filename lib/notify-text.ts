import { getDictionary, type Locale } from '../app/[lang]/dictionaries';
import { fmtMonth } from '../app/[lang]/format';
import { MEALS, type Meal } from './meals';
import type { Msg } from './push';

const t = (lang: Locale) => getDictionary(lang).push;
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const monthName = (month: string) => fmtMonth(month).split(' ')[0];

/** Every kind of change to today's meals that tells the flat (lib/meal-push). */
export type TodayKind = 'on' | 'off' | 'guestsAdd' | 'guestsGone' | 'other' | 'changed' | 'away' | 'back' | 'noCook' | 'cookAgain';
/** A change to today's meals: who changed what in the title, today's plates in the body to pass to the cook (no money). */
export const todayMsg = (lang: Locale, kind: TodayKind, v: { actor: string; name: string; meals: Meal[] }, p: Record<Meal, number | 'off'>): Msg => {
  const x = t(lang), m = getDictionary(lang).meals;
  return {
    title: fill(x.today[kind], { actor: v.actor, name: v.name, meal: v.meals.map(y => x.mealNames[y]).join(', ') }),
    body: fill(x.todayBody, { plates: MEALS.map(y => `${m.names[y]} ${p[y] === 'off' ? m.noCook : p[y]}`).join(' · ') }),
    url: `/${lang}/home`,
  };
};
export const depositMsg = (lang: Locale, name: string): Msg =>
  ({ title: fill(t(lang).depositTitle, { name }), body: t(lang).depositBody, url: `/${lang}/money` });
export const payoutMsg = (lang: Locale, name: string): Msg =>
  ({ title: fill(t(lang).payoutTitle, { name }), body: t(lang).payoutBody, url: `/${lang}/money` });
/** Money received written by the collector, to the giver: who wrote it; the amount stays in the app. */
export const gaveAskMsg = (lang: Locale, name: string): Msg =>
  ({ title: fill(t(lang).gaveAskTitle, { name }), body: t(lang).gaveAskBody, url: `/${lang}/money` });
/** That's not right, to whoever wrote the entry: who said it; no amount, no reason. */
export const rejectedMsg = (lang: Locale, name: string): Msg =>
  ({ title: fill(t(lang).rejectedTitle, { name }), body: t(lang).rejectedBody, url: `/${lang}/money` });
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
/** Trust feature 2: bazars and bills with no check for 2 days, to everyone else living here. */
export const lateMsg = (lang: Locale, n: number): Msg =>
  ({ title: fill(n === 1 ? t(lang).lateOneTitle : t(lang).lateTitle, { n: String(n) }), body: t(lang).lateBody, url: `/${lang}/money` });
/** Trust feature 1: a month closed, to each other person who lived in it: did you see the cash? No amount. */
export const cashAskMsg = (lang: Locale, name: string, month: string): Msg =>
  ({ title: fill(t(lang).cashAskTitle, { month: monthName(month), name }), body: t(lang).cashAskBody, url: `/${lang}/money?m=${month.slice(0, 7)}` });
