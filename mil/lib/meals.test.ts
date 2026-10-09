import { describe, it, expect } from 'vitest';
import { addDays, countChanges, isDate, mealDecision, daysOfMonth, weightedMeals, daysPresent, headcount, isLocked, type MealMember, type MealChange } from './meals';

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

  it('counts plates for the cook', () => {
    const changes: MealChange[] = [{ memberId: 'A', date: '2026-10-12', meal: 'd', count: 2 }];
    expect(headcount(members, changes, '2026-10-12')).toEqual({ b: 1, l: 2, d: 3 });
    expect(headcount(members, [], '2026-10-10')).toEqual({ b: 1, l: 1, d: 1 });   // D not joined yet
  });

  it('locks tomorrow at the cutoff, across month and year ends', () => {
    expect(isLocked('2026-10-10', '2026-10-09T21:59', '22:00')).toBe(false);
    expect(isLocked('2026-10-10', '2026-10-09T22:00', '22:00')).toBe(true);
    expect(isLocked('2026-10-10', '2026-10-09T22:00', '22:00:00')).toBe(true);   // Postgres time format
    expect(isLocked('2026-10-09', '2026-10-09T08:00', '22:00')).toBe(true);
    expect(isLocked('2026-10-11', '2026-10-09T23:00', '22:00')).toBe(false);
    expect(isLocked('2027-01-01', '2026-12-31T22:00', '22:00')).toBe(true);
  });
});

describe('meal rules', () => {
  it('opens before the cutoff, then late; today and past days are closed', () => {
    expect(mealDecision('2026-10-10', '2026-10-09T21:59', '22:00')).toBe('open');
    expect(mealDecision('2026-10-10', '2026-10-09T22:00', '22:00')).toBe('late');
    expect(mealDecision('2026-10-10', '2026-10-09T22:00', '22:00:00')).toBe('late');
    expect(mealDecision('2026-10-09', '2026-10-09T08:00', '22:00')).toBe('closed');   // today is locked for members
    expect(mealDecision('2026-10-08', '2026-10-09T08:00', '22:00')).toBe('closed');
    expect(mealDecision('2026-10-11', '2026-10-09T23:00', '22:00')).toBe('open');
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

describe('count changes', () => {
  it('lists the meals whose count moved', () => {
    expect(countChanges({ b: 6, l: 8, d: 9 }, { b: 6, l: 8, d: 9 })).toEqual([]);
    expect(countChanges({ b: 6, l: 8, d: 9 }, { b: 5, l: 8, d: 10 })).toEqual([{ meal: 'b', from: 6, to: 5 }, { meal: 'd', from: 9, to: 10 }]);
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
});


describe('meals so far', () => {
  it('counts only up to the given day', () => {
    const m = { id: 'A', joinedOn: '2026-10-01', leftOn: null, defaults: { b: true, l: true, d: true } };
    const w = { b: 50, l: 100, d: 100 };
    expect(weightedMeals([m], [], '2026-10-01', w).get('A')).toBe(31 * 250);
    expect(weightedMeals([m], [], '2026-10-01', w, '2026-10-09').get('A')).toBe(9 * 250);
  });
});
