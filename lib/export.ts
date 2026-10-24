/** A closed month as a CSV the collector can open in Excel: the entries, a blank line, then each person's lines. Poisha in,
 *  taka out with two decimals; meals in hundredths out as a plain number. A BOM up front so Excel reads the Bangla. */
export type CsvHead = Record<'date' | 'type' | 'note' | 'amount' | 'paidBy' | 'who' | 'name' | 'meals' | 'food' | 'bills' | 'paidIn' | 'earlier' | 'advances' | 'corrections' | 'line', string>;
export type CsvEntry = { date: string; type: string; note: string | null; amount: number; paidBy: string; who: string };
export type CsvPerson = { name: string; meals: number; food: number; bills: number; paidIn: number; earlier: number; advances: number; corrections: number; line: number };

// a leading = + @ or - (not a negative number) would run as a formula in a spreadsheet; the apostrophe marks text, as Excel does
const cell = (v: string | number) => { const s = String(v), t = /^[=+@]|^-(?!\d)/.test(s) ? `'${s}` : s; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export const csv = (rows: (string | number)[][]) => rows.map(r => r.map(cell).join(',')).join('\n');
const taka = (p: number) => (p / 100).toFixed(2);

export function monthCsv(h: CsvHead, entries: CsvEntry[], people: CsvPerson[]) {
  return '﻿' + csv([
    [h.date, h.type, h.note, h.amount, h.paidBy, h.who],
    ...entries.map(e => [e.date, e.type, e.note ?? '', taka(e.amount), e.paidBy, e.who]),
    [],
    [h.name, h.meals, h.food, h.bills, h.paidIn, h.earlier, h.advances, h.corrections, h.line],
    ...people.map(p => [p.name, p.meals / 100, taka(p.food), taka(p.bills), taka(p.paidIn), taka(p.earlier), taka(p.advances), taka(p.corrections), taka(p.line)]),
  ]);
}
