import type { Meal } from '@/lib/meals';
import type { Notice } from '@/lib/notices';
import { todayTitle, type TodayKind } from '../../lib/notify-text';   // relative: tests import this file without the @ alias
import type { Dict, Locale } from './dictionaries';
import { fmtDay, fmtMonth, fmtTaka } from './format';

/** One line per notice and the screen it leads to; null for a row this version has no words for. */
export function noticeLine(n: Notice, t: Dict, lang: Locale, today: string): [string, string] | null {
  const x = t.notices, d = n.detail ?? {};
  const name = n.meal ? t.meals.names[n.meal as 'b' | 'l' | 'd'] : '', meal = lang === 'en' ? name.toLowerCase() : name;   // mid-sentence
  const date = n.date ? fmtDay(n.date, lang) : '';
  const fill = (s: string) => s.replace('{name}', n.actor ?? '').replace('{amount}', fmtTaka(n.amount ?? 0)).replace('{meal}', meal).replace('{date}', date).replace('{month}', n.month ? fmtMonth(n.month) : '');
  switch (n.kind) {
    case 'paid': return [fill(d.gave ? x.paidFor : d.type === 'deposit' ? x.paidDeposit : x.paidPayout), `/${lang}/home`];
    case 'handover': return [fill(x.handover), `/${lang}/home`];
    case 'handoverDone': return [fill(d.status === 'accepted' ? x.accepted : x.declined), `/${lang}/money`];
    case 'rejected': return [fill(x.rejected), `/${lang}/money`];
    case 'closeMonth': return [fill(x.closeMonth), `/${lang}/money?m=${n.month!.slice(0, 7)}`];
    case 'meal': {
      // the week index is days from today, 7 per week, as the Meals page counts
      const week = Math.floor((Date.parse(n.date!) - Date.parse(today)) / 864e5 / 7);
      return [fill(d.guestsChanged ? x.guests : Number(d.own) > 0 ? x.mealOn : x.mealOff), `/${lang}/meals${week ? `?week=${week}` : ''}`];
    }
    // someone else's change to today's meals: the push's own words, to the plates on Home
    case 'today': return [todayTitle(lang, d.k as TodayKind, { actor: n.actor ?? '', name: String(d.who ?? ''), meals: String(d.meals ?? '').split(',').filter(Boolean) as Meal[] }), `/${lang}/home`];
    case 'account': {
      const home = `/${lang}/home`;
      if ('pinReset' in d) return [fill(n.actor ? x.pinReset : x.pinResetTeam), home];
      if ('lockCleared' in d) return [fill(x.lockCleared), home];
      if ('rename' in d) return [fill(x.rename), home];
      if ('back' in d) return [fill(x.back), home];
      if ('left' in d) return [typeof d.left === 'string' ? fill(x.leaving.replace('{date}', fmtDay(d.left, lang))) : fill(x.stays), home];
      return null;
    }
  }
}
