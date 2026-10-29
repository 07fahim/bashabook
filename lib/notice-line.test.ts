import { describe, it, expect } from 'vitest';
import { noticeLine } from '../app/[lang]/notice-line';
import { getDictionary } from '../app/[lang]/dictionaries';
import type { Notice } from './notices';

// The words on the bell page, from the rows the query returns (review of 2026-10-15: own-plate change with guests booked,
// a last day taken back, a team PIN reset, an unknown account row).
const t = getDictionary('en'), today = '2026-10-15';
const n = (p: Partial<Notice>): Notice => ({ at: '2026-10-15 10:00:00+00', kind: 'meal', actor: 'Nafis', amount: null, date: null, meal: null, month: null, detail: null, pending: false, ...p });

describe('noticeLine', () => {
  it('a plate switched off while guests stay says the plate, not the guests', () => {
    expect(noticeLine(n({ date: '2026-10-16', meal: 'd', detail: { own: 0, guestsChanged: false } }), t, 'en', today)).toEqual(['Nafis turned your Dinner off for Fri, 16 October', '/en/meals']);
    expect(noticeLine(n({ date: '2026-10-25', meal: 'b', detail: { own: 1, guestsChanged: false } }), t, 'en', today)![0]).toBe('Nafis turned your Breakfast on for Sun, 25 October');
    expect(noticeLine(n({ date: '2026-10-25', meal: 'b', detail: { own: 1, guestsChanged: false } }), t, 'en', today)![1]).toBe('/en/meals?week=1');
    expect(noticeLine(n({ date: '2026-10-16', meal: 'l', detail: { own: 1, guestsChanged: true } }), t, 'en', today)![0]).toBe('Nafis changed your guests for Fri, 16 October Lunch');
  });

  it('a last day set, taken back, and the other account rows', () => {
    const acc = (detail: Record<string, unknown>, actor: string | null = 'Nafis') => noticeLine(n({ kind: 'account', actor, detail }), t, 'en', today)?.[0];
    expect(acc({ left: '2026-10-20' })).toBe('Nafis set your last day: Tue, 20 October');
    expect(acc({ left: null })).toBe('Nafis took back your last day');
    expect(acc({ pinReset: true })).toBe('Nafis reset your PIN');
    expect(acc({ pinReset: true, admin: 'fahim', reason: 'phone check' }, null)).toBe('The BashaBook team reset your PIN');
    expect(acc({ lockCleared: true })).toBe('Nafis cleared your lock');
    expect(acc({ rename: ['Tahsin', 'Tahsin Ahmed'] })).toBe('Nafis fixed your name');
    expect(acc({ back: ['2026-10-21', '2026-10-25'] })).toBe('Nafis brought you back');
    expect(acc({ somethingNew: true })).toBeUndefined();   // a row this version has no words for is skipped, never mislabelled
  });

  it('money and month rows', () => {
    expect(noticeLine(n({ kind: 'paid', actor: 'Tahsin', amount: 30000, detail: { type: 'deposit' }, pending: true }), t, 'en', today)).toEqual(['Tahsin says they paid the flat money ৳300', '/en/home']);
    expect(noticeLine(n({ kind: 'paid', actor: 'Nafis', amount: 20000, detail: { type: 'payout' } }), t, 'en', today)![0]).toBe('Nafis says they gave you ৳200');
    expect(noticeLine(n({ kind: 'paid', actor: 'Nafis', amount: 20000, detail: { type: 'deposit', gave: true } }), t, 'en', today)).toEqual(['Nafis wrote that you gave ৳200', '/en/home']);
    expect(noticeLine(n({ kind: 'paid', actor: 'Nafis', amount: 20000, detail: { type: 'deposit', gave: true } }), getDictionary('bn'), 'bn', today)).toEqual(['Nafis লিখেছে আপনি ৳200 দিয়েছেন', '/bn/home']);
    expect(noticeLine(n({ kind: 'handover', amount: 250000 }), t, 'en', today)![0]).toBe('Nafis wants to hand you the flat money, ৳2,500');
    expect(noticeLine(n({ kind: 'handoverDone', actor: 'Tahsin', detail: { status: 'declined' } }), t, 'en', today)![0]).toBe('Tahsin said no to the handover');
    expect(noticeLine(n({ kind: 'closeMonth', actor: null, month: '2026-09-01' }), t, 'en', today)).toEqual(['September 2026 is ready to close', '/en/money?m=2026-09']);
  });
});
