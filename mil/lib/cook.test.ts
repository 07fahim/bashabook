import { describe, it, expect } from 'vitest';
import { cookLinks, cookText, countChanges, normalizePhone } from './cook';

describe('cook contact', () => {
  it('reads a Bangladeshi mobile number however it is typed', () => {
    expect(normalizePhone('01712345678')).toBe('01712345678');
    expect(normalizePhone('+880 1712-345678')).toBe('01712345678');
    expect(normalizePhone('৮৮০১৭১২৩৪৫৬৭৮')).toBe('01712345678');   // Bangla keyboard digits
    expect(normalizePhone('0171234567')).toBeNull();     // one digit short
    expect(normalizePhone('01212345678')).toBeNull();    // no operator starts 012
    expect(normalizePhone('')).toBeNull();
  });

  it('writes the count in English letters and digits, leaving out a Bangla flat name', () => {
    const hc = { b: 6, l: 8, d: 9 };
    expect(cookText('Flat 4B', '2026-10-10', hc)).toBe('Flat 4B - Kal Sat 10 Oct: Sokal 6, Dupur 8, Rat 9');
    expect(cookText('ধানমন্ডি বাসা', '2026-10-10', hc)).toBe('Kal Sat 10 Oct: Sokal 6, Dupur 8, Rat 9');
  });

  it('builds call, SMS and WhatsApp links', () => {
    const l = cookLinks('01712345678', 'Kal: Rat 9');
    expect(l.call).toBe('tel:01712345678');
    expect(l.sms).toBe('sms:01712345678?&body=Kal%3A%20Rat%209');
    expect(l.whatsapp).toBe('https://wa.me/8801712345678?text=Kal%3A%20Rat%209');
  });

  it('lists the meals whose count moved', () => {
    expect(countChanges({ b: 6, l: 8, d: 9 }, { b: 6, l: 8, d: 9 })).toEqual([]);
    expect(countChanges({ b: 6, l: 8, d: 9 }, { b: 5, l: 8, d: 10 })).toEqual([{ meal: 'b', from: 6, to: 5 }, { meal: 'd', from: 9, to: 10 }]);
  });
});
