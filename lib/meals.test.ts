import { describe, it, expect, vi } from 'vitest';
import { addDays, firstWeek, isDate, mealDecision, daysOfMonth, weightedMeals, daysPresent, headcount, nowDhaka, ownPlate, plates, todayDhaka, type MealMember, type MealChange } from './meals';

const all = { b: true, l: true, d: true };
const members: MealMember[] = [
  { id: 'A', joinedOn: '2026-01-01', leftOn: null, defaults: all },
  { id: 'D', joinedOn: '2026-10-11', leftOn: null, defaults: { b: false, l: true, d: true } },
];
const W = { b: 50, l: 100, d: 100 };

describe('meals', () => {
  it('knows month lengths', () => {
    expect(daysOfMonth('2026-10-01')).toHaveLength(31);
    expect(daysOfMonth('2028-02-01')).toHaveLength(29);
  });

  it('weights defaults, changes and guests; respects join date', () => {
    const changes: MealChange[] = [
      { memberId: 'A', date: '2026-10-05', meal: 'l', count: 0 },   // lunch off: -100
      { memberId: 'A', date: '2026-10-06', meal: 'd', count: 3 },   // 2 guests: +200
    ];
    const w = weightedMeals(members, changes, '2026-10-01', W);
    expect(w.get('A')).toBe(31 * 250 - 100 + 200);   // 7850
    expect(w.get('D')).toBe(21 * 200);                // joined day 11: 4200
    expect(daysPresent(members, '2026-10-01').get('D')).toBe(21);
  });

  it('tells my own plate apart from my guests', () => {
    const changes: MealChange[] = [
      { memberId: 'A', date: '2026-10-12', meal: 'd', count: 2, guests: 2 },   // off, two guests
      { memberId: 'A', date: '2026-10-12', meal: 'l', count: 3, guests: 2 },   // eating, two guests
    ];
    expect(ownPlate(members[0], changes, '2026-10-12', 'd')).toBe(0);
    expect(ownPlate(members[0], changes, '2026-10-12', 'l')).toBe(1);
    expect(ownPlate(members[0], changes, '2026-10-12', 'b')).toBe(1);   // no change: the usual
    expect(ownPlate(members[1], changes, '2026-10-05', 'l')).toBe(0);   // not here yet
  });

  it('counts plates for the cook', () => {
    const changes: MealChange[] = [{ memberId: 'A', date: '2026-10-12', meal: 'd', count: 2 }];
    expect(headcount(members, changes, '2026-10-12')).toEqual({ b: 1, l: 2, d: 3 });
    expect(headcount(members, [], '2026-10-10')).toEqual({ b: 1, l: 1, d: 1 });   // D not joined yet
  });
});

describe('meal rules', () => {
  it('later days are open, today is a same-day change, past days are closed; there is no lock time', () => {
    expect(mealDecision('2026-10-10', '2026-10-09')).toBe('open');
    expect(mealDecision('2026-11-30', '2026-10-09')).toBe('open');
    expect(mealDecision('2026-10-09', '2026-10-09')).toBe('late');
    expect(mealDecision('2026-10-08', '2026-10-09')).toBe('closed');
    expect(mealDecision('2026-12-31', '2027-01-01')).toBe('closed');   // across a year end
  });

  it('adds days across month and year ends and checks dates', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(isDate('2026-10-09')).toBe(true);
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('2026-13-01')).toBe(false);
    expect(isDate('9 Oct')).toBe(false);
  });
});

describe('first week', () => {
  it('goes back only to the week that holds the first move-in day', () => {
    expect(firstWeek('2026-10-10', '2026-10-10')).toBe(0);    // started today: no earlier week
    expect(firstWeek('2026-10-10', '2026-10-04')).toBe(-1);   // 6 days ago: last week (3 to 9 October) holds it
    expect(firstWeek('2026-10-10', '2026-10-03')).toBe(-1);   // the first day of last week
    expect(firstWeek('2026-10-10', '2026-10-02')).toBe(-2);
    expect(firstWeek('2026-10-10', '2026-12-01')).toBe(0);    // someone moving in later never pushes this week out
  });
});

describe('fmtRange', () => {
  it('shows one month once, or both months across a month end', async () => {
    const { fmtRange } = await import('../app/[lang]/format');
    expect(fmtRange('2026-10-16', '2026-10-22')).toBe('16 – 22 October');
    expect(fmtRange('2026-11-27', '2026-12-03')).toBe('27 November – 3 December');
  });

  it('money in whole taka with English digits', async () => {
    const { fmtMonth, fmtTaka } = await import('../app/[lang]/format');
    expect(fmtTaka(245049)).toBe('৳2,450');
    expect(fmtTaka(-38000)).toBe('৳380');
    expect(fmtTaka(150)).toBe('৳2');
    expect(fmtMonth('2026-10-01')).toBe('October 2026');
  });

  it('meal counts without trailing zeros, the meal rate to the poisha, and no rate before anyone ate', async () => {
    const { fmtMeals, fmtRate } = await import('../app/[lang]/format');
    expect([fmtMeals(2250), fmtMeals(2200), fmtMeals(2225), fmtMeals(0)]).toEqual(['22.5', '22', '22.25', '0']);
    expect([fmtRate(3172, 100), fmtRate(3170, 100), fmtRate(123456, 1), fmtRate(0, 0), fmtRate(0, 2500)]).toEqual(['৳31.72', '৳31.70', '৳1,234.56', '—', '—']);
  });

  it('exact taka shows poisha only when there are some', async () => {
    const { fmtExact } = await import('../app/[lang]/format');
    expect([fmtExact(85037), fmtExact(120000), fmtExact(-5), fmtExact(0)]).toEqual(['৳850.37', '৳1,200', '৳0.05', '৳0']);
  });

  it('fmtTaka2 always shows two decimals', async () => {
    const { fmtTaka2 } = await import('../app/[lang]/format');
    expect([fmtTaka2(2721200), fmtTaka2(50000), fmtTaka2(5), fmtTaka2(-50000), fmtTaka2(0)]).toEqual(['৳27,212.00', '৳500.00', '৳0.05', '−৳500.00', '৳0.00']);
  });
});


describe('meals so far', () => {
  it('counts only up to the given day', () => {
    const m = { id: 'A', joinedOn: '2026-10-01', leftOn: null, defaults: { b: true, l: true, d: true } };
    const w = { b: 50, l: 100, d: 100 };
    expect(weightedMeals([m], [], '2026-10-01', w).get('A')).toBe(31 * 250);
    expect(weightedMeals([m], [], '2026-10-01', w, '2026-10-09').get('A')).toBe(9 * 250);
  });
});

describe('the cook card', () => {
  it('today is the Dhaka day: it flips at Dhaka midnight, 18:00 UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T17:59:00Z'));
    expect([todayDhaka(), nowDhaka()]).toEqual(['2026-10-09', '2026-10-09T23:59']);
    vi.setSystemTime(new Date('2026-10-09T18:00:00Z'));
    expect([todayDhaka(), nowDhaka()]).toEqual(['2026-10-10', '2026-10-10T00:00']);
    vi.useRealTimers();
  });

  it('a meal blocked by no cooking says off; plates put on it anyway still count', () => {
    const noCook = [{ date: '2026-10-10', meal: 'l' }];
    expect(plates({ b: 9, l: 0, d: 9 }, noCook, '2026-10-10', 'l')).toBe('off');
    expect(plates({ b: 9, l: 2, d: 9 }, noCook, '2026-10-10', 'l')).toBe(2);
    expect(plates({ b: 9, l: 0, d: 9 }, noCook, '2026-10-11', 'l')).toBe(0);   // another day: a real zero
    expect(plates({ b: 0, l: 0, d: 9 }, noCook, '2026-10-10', 'b')).toBe(0);   // breakfast isn't blocked
  });

  it('Share says no cooking too, the same as the card', async () => {
    const { countText } = await import('../app/[lang]/format');
    const { getDictionary } = await import('../app/[lang]/dictionaries');
    const m = getDictionary('en').meals;
    expect(countText('Flat 4B', m, '2026-10-10', { b: 9, l: 0, d: 9 }, 'Final', 'en', [{ date: '2026-10-10', meal: 'l' }]))
      .toBe('Flat 4B · Tomorrow, Sat, 10 October\nBreakfast 9 · Lunch No cooking · Dinner 9\nFinal');
  });
});
