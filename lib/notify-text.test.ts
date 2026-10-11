import { describe, it, expect } from 'vitest';
import { closeMsg, depositMsg, handoverMsg, mealMsg, payoutMsg } from './notify-text';

describe('reminder texts', () => {
  it('fill names, times and months, English digits, right pages, nothing sensitive', () => {
    expect(mealMsg('bn', '22:00:00')).toEqual({ title: 'কালকের মিল আজ 10:00 pm-এ লক হবে', body: 'যেমন খান তেমনই থাকবে? বদলাতে হলে এখনই বদলান।', url: '/bn/meals' });
    expect(mealMsg('en', '19:30').title).toBe('Tomorrow’s meals lock at 7:30 pm');
    expect(depositMsg('bn', 'Nafis').title).toBe('Nafis বলছে টাকা দিয়েছে');
    expect(payoutMsg('en', 'Tahsin')).toEqual({ title: 'Tahsin says: I paid you', body: 'Confirm it if you got it.', url: '/en/money' });
    expect(handoverMsg('en', 'Zarif').url).toBe('/en/home');
    expect(closeMsg('en', '2026-09-01', 0).title).toBe('September is ready to close');
    expect(closeMsg('bn', '2026-09-01', 3)).toEqual({ title: 'September: 3টা কনফার্ম বাকি', body: 'টাকার পেজে দেখুন কার কনফার্ম বাকি।', url: '/bn/money' });
    for (const m of [mealMsg('bn', '22:00'), depositMsg('bn', 'X'), closeMsg('en', '2026-09-01', 2)]) expect(`${m.title} ${m.body}`).not.toMatch(/৳|\d{4,}|ম্যানেজার|manager|মেস|mess/i);
  });
});
