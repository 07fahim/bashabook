import { describe, it, expect } from 'vitest';
import { checkMsg, closeMsg, depositMsg, fixAskMsg, fixedMsg, gaveAskMsg, handoverMsg, mealMsg, payoutMsg, rejectedMsg } from './notify-text';

describe('reminder texts', () => {
  it('fill names, times and months, English digits, right pages, nothing sensitive', () => {
    expect(mealMsg('bn', '22:00:00')).toEqual({ title: 'কালকের মিল আজ 10:00 pm-এ লক হবে', body: 'যেমন খান তেমনই থাকবে? বদলাতে হলে এখনই বদলান।', url: '/bn/meals' });
    expect(mealMsg('en', '19:30').title).toBe('Tomorrow’s meals lock at 7:30 pm');
    expect(depositMsg('bn', 'Nafis').title).toBe('Nafis বলছে টাকা দিয়েছে');
    expect(payoutMsg('en', 'Tahsin')).toEqual({ title: 'Tahsin says: I paid you', body: 'Confirm it if you got it.', url: '/en/money' });
    expect(handoverMsg('en', 'Zarif').url).toBe('/en/home');
    expect(closeMsg('en', '2026-09-01', 0).title).toBe('September is ready to close');
    expect(closeMsg('bn', '2026-09-01', 3)).toEqual({ title: 'September: 3টা কনফার্ম, চেক বা বিল দেওয়া বাকি', body: 'টাকার পেজে দেখুন কী কী বাকি।', url: '/bn/money' });
    expect(closeMsg('en', '2026-09-01', 2)).toEqual({ title: 'September: 2 still to confirm, check or pay', body: 'See what still waits on Money.', url: '/en/money' });
    for (const m of [mealMsg('bn', '22:00'), depositMsg('bn', 'X'), closeMsg('en', '2026-09-01', 2)]) expect(`${m.title} ${m.body}`).not.toMatch(/৳|\d{4,}|ম্যানেজার|manager|মেস|mess/i);
  });

  it('check texts: who asks, never the amount or the reason; the count; the entry’s page', () => {
    expect(fixAskMsg('en', 'Nafis', 'bazar', 'abc')).toEqual({ title: 'Nafis asks you to fix a bazar entry', body: 'Open the app to see why.', url: '/en/money/bazar/abc' });
    expect(fixAskMsg('bn', 'Nafis', 'bazar', 'abc').title).toBe('Nafis আপনাকে বাজারের হিসাব ঠিক করতে বলেছে');
    expect(fixedMsg('bn', 'Tahsin', 'bill', 'abc')).toEqual({ title: 'Tahsin বিল ঠিক করেছে', body: 'আবার চেক করুন।', url: '/bn/money/bazar/abc' });
    // the existing rule: no amount in any push (it shows on a locked screen)
    for (const m of [fixAskMsg('en', 'X', 'bazar', 'a'), fixAskMsg('bn', 'X', 'bazar', 'a'), fixedMsg('bn', 'X', 'bill', 'a'), fixedMsg('en', 'X', 'bazar', 'a'), checkMsg('en', 3), checkMsg('bn', 3), checkMsg('bn', 1)]) expect(`${m.title} ${m.body}`).not.toMatch(/৳|\d{4,}|ম্যানেজার|manager|মেস|mess/i);
    expect(fixedMsg('en', 'Tahsin', 'bazar', 'abc').title).toBe('Tahsin fixed a bazar entry');
    expect(checkMsg('bn', 1).title).toBe('1টা বাজারের হিসাব বা বিল চেকের অপেক্ষায়');
    expect(checkMsg('en', 1).title).toBe('1 bazar or bill waits for your check');
    expect(checkMsg('en', 3)).toEqual({ title: '3 bazars and bills wait for your check', body: 'See Money.', url: '/en/money' });
    expect(checkMsg('bn', 2).title).toBe('2টা বাজারের হিসাব ও বিল চেকের অপেক্ষায়');
  });
  it('money between two people: who wrote it or who said not right; never the amount or a reason', () => {
    expect(gaveAskMsg('en', 'Nafis')).toEqual({ title: 'Nafis wrote that you gave money', body: 'Check it and confirm.', url: '/en/money' });
    expect(gaveAskMsg('bn', 'Nafis')).toEqual({ title: 'Nafis লিখেছে আপনি টাকা দিয়েছেন', body: 'দেখে কনফার্ম করুন।', url: '/bn/money' });
    expect(rejectedMsg('en', 'Tahsin')).toEqual({ title: 'Tahsin says an entry isn’t right', body: 'Talk it over and write it again if needed.', url: '/en/money' });
    expect(rejectedMsg('bn', 'Tahsin')).toEqual({ title: 'Tahsin বলছে একটা লেনদেন ঠিক না', body: 'কথা বলে দরকার হলে আবার লিখুন।', url: '/bn/money' });
    for (const m of [gaveAskMsg('en', 'X'), gaveAskMsg('bn', 'X'), rejectedMsg('en', 'X'), rejectedMsg('bn', 'X')]) expect(`${m.title} ${m.body}`).not.toMatch(/৳|\d{4,}|ম্যানেজার|manager|মেস|mess/i);
  });
});
