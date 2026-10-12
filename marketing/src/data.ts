import { getDictionary, type Locale } from '../../app/[lang]/dictionaries';

/** Synthetic flat for the film. No real people, PINs or records. */
export const TODAY = '2026-09-24';          // Thursday
export const TOMORROW = '2026-09-25';
export const MONTH = '2026-09-01';
export const CUTOFF = '21:00';
export const WEEK = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'];

const names = {
  en: { nafis: 'Nafis', tahsin: 'Tahsin', zarif: 'Zarif', rafi: 'Rafi', sakib: 'Sakib', imran: 'Imran', tanvir: 'Tanvir', hasan: 'Hasan', mahin: 'Mahin', flat: 'Flat 4B' },
  bn: { nafis: 'নাফিস', tahsin: 'তাহসিন', zarif: 'জারিফ', rafi: 'রাফি', sakib: 'সাকিব', imran: 'ইমরান', tanvir: 'তানভীর', hasan: 'হাসান', mahin: 'মাহিন', flat: 'ফ্ল্যাট 4B' },
};

export function dataFor(lang: Locale) {
  const t = getDictionary(lang), n = names[lang], x = t.money, m = t.meals;
  const bazar = lang === 'bn' ? 'বাজার' : 'Bazar', deposit = lang === 'bn' ? 'জমা' : 'Deposit';
  const sep = lang === 'bn' ? 'সেপ্টেম্বর' : 'September';
  return {
    t, n,
    khata: {
      title: lang === 'bn' ? 'সেপ্টেম্বরের হিসাব' : 'September ledger',
      rows: [
        ['2 Sep', `${bazar} · ${n.nafis}`, '2,450'],
        ['5 Sep', `${bazar} · ${n.tahsin}`, '1,980'],
        ['9 Sep', `${bazar} · ${n.zarif}`, '2,120'],
        ['11 Sep', `${deposit} · ${n.rafi}`, '3,000'],
      ] as [string, string, string][],
      totalBazar: '6,550', totalMeals: '206.5', rate: '31.72',
    },
    // breakdown rows exactly as app/[lang]/money/breakdown.ts shapes them
    breakdown: [
      { label: x.share, value: '−৳2,780.52', kind: 'head' as const },
      { label: `${x.myMeals} · ${x.mealsN.replace('{n}', '41')}`, value: '৳1,300.52', kind: 'sub' as const },
      { label: x.bills, value: '৳1,480.00', kind: 'sub' as const },
      { label: x.deposited, value: '+৳1,000.00' },
      { label: x.spent, value: '+৳2,450.00' },
      { label: x.balance, value: '৳669.48', kind: 'total' as const },
    ],
    balanceLine: x.getBack.replace('{t}', '৳669.48'),
    cash: { cash: 9212, bkash: 12000, nagad: 4000, bank: 2000 },   // 27,212.00, matches
    held: '৳27,212.00',
    settle: [
      x.takes.replace('{a}', n.nafis).replace('{t}', '৳669'),
      x.paysTo.replace('{a}', n.zarif).replace('{b}', n.tahsin).replace('{t}', '৳1,180'),
      x.paysTo.replace('{a}', n.rafi).replace('{b}', n.tahsin).replace('{t}', '৳310'),
      x.paysTo.replace('{a}', n.sakib).replace('{b}', n.nafis).replace('{t}', '৳110'),
    ],
    settleHead: lang === 'bn' ? `${sep}-এর হিসাব` : `${sep} accounts`,
    rateLine: `${x.mealRate} ৳31.72`,
    tabs: [m.tabs.home, m.tabs.meals, m.tabs.money, m.tabs.manage],
  };
}

export type Data = ReturnType<typeof dataFor>;
