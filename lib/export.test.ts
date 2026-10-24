import { describe, it, expect } from 'vitest';
import { csv, monthCsv } from './export';

describe('csv', () => {
  it('quotes a cell with a comma, a quote or a line break, and nothing else', () => {
    expect(csv([['a', 'b,c', 'say "hi"', 'two\nlines', 5]])).toBe('a,"b,c","say ""hi""","two\nlines",5');
  });

  it('defuses a cell that a spreadsheet would read as a formula; negative amounts stay numbers', () => {
    expect(csv([['=1+1', '+5', '@a', '-x', '-10.00', 'a=b', '=a,b']])).toBe("'=1+1,'+5,'@a,'-x,-10.00,a=b,\"'=a,b\"");
  });
});

describe('monthCsv', () => {
  it('entries first, then each person, amounts in taka with two decimals, Bangla kept, a BOM for Excel', () => {
    const head = { date: 'Date', type: 'Type', note: 'Note', amount: 'Amount', paidBy: 'Paid by', who: 'Who', name: 'Name', meals: 'Meals', food: 'Food', bills: 'Bills', paidIn: 'Paid in', earlier: 'Earlier', advances: 'Advances', corrections: 'Corrections', line: 'Line' };
    const out = monthCsv(head,
      [{ date: '2026-09-05', type: 'bazar', note: 'চাল, ডাল', amount: 123450, paidBy: 'Nafis', who: '' }, { date: '2026-09-01', type: 'deposit', note: null, amount: 500000, paidBy: '', who: 'Tahsin' }],
      [{ name: 'Tahsin', meals: 4550, food: 61725, bills: 40000, paidIn: 500000, earlier: -1000, advances: 0, corrections: 0, line: 397275 }]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out.slice(1).split('\n')).toEqual([
      'Date,Type,Note,Amount,Paid by,Who',
      '2026-09-05,bazar,"চাল, ডাল",1234.50,Nafis,',
      '2026-09-01,deposit,,5000.00,,Tahsin',
      '',
      'Name,Meals,Food,Bills,Paid in,Earlier,Advances,Corrections,Line',
      'Tahsin,45.5,617.25,400.00,5000.00,-10.00,0.00,0.00,3972.75',
    ]);
  });
});
