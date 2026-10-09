import type { Meal } from './meals';

/** A Bangladeshi mobile number as typed ('+880 1712-345678', Bangla digits) → '01712345678', else null. */
export function normalizePhone(v: string): string | null {
  const d = v.replace(/[০-৯]/g, c => String('০১২৩৪৫৬৭৮৯'.indexOf(c))).replace(/[\s\-()+]/g, '');
  return /^(?:88)?(01[3-9]\d{8})$/.exec(d)?.[1] ?? null;
}

/** The count for the cook in English letters and digits, which every phone shows ('Kal' = tomorrow).
 *  A flat name in Bangla script is left out: a basic phone may show it as boxes. */
export function cookText(flatName: string, date: string, hc: Record<Meal, number>) {
  const day = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
  const name = /^[\x20-\x7E]+$/.test(flatName) ? `${flatName} - ` : '';
  return `${name}Kal ${day}: Sokal ${hc.b}, Dupur ${hc.l}, Rat ${hc.d}`;
}

/** Links that open the phone's own dialler, SMS app or WhatsApp; the app sends nothing itself. */
export const cookLinks = (phone: string, text: string) => ({
  call: `tel:${phone}`,
  sms: `sms:${phone}?&body=${encodeURIComponent(text)}`,   // '?&' works on Android and iPhone
  whatsapp: `https://wa.me/88${phone}?text=${encodeURIComponent(text)}`,
});

/** Meals whose plate count differs between two counts, in day order. */
export const countChanges = (before: Record<Meal, number>, now: Record<Meal, number>) =>
  (['b', 'l', 'd'] as Meal[]).filter(m => before[m] !== now[m]).map(m => ({ meal: m, from: before[m], to: now[m] }));
