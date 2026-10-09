import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { Db } from './db';
import { createFlat } from './auth';

const sql = (f: string) => readFileSync(join(__dirname, '../db/migrations', f), 'utf8');

describe('migration 004 (guests apart from the own plate)', { timeout: 30000 }, () => {
  it('keeps every existing total and splits old guest plates out', async () => {
    const pg = new PGlite();
    const db: Db = async (text, params) => (await pg.query(text, params)).rows as never;
    for (const f of ['001_init.sql', '002_in_meals.sql', '003_no_cook.sql']) await pg.exec(sql(f));
    const { flatId, memberId } = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: [], today: '2026-10-01', lang: 'bn' });
    const add = (date: string, count: number) =>
      db(`insert into meal_changes (flat_id, member_id, date, meal, count) values ($1, $2, $3, 'd', $4)`, [flatId, memberId, date, count]);
    await add('2026-10-02', 0);
    await add('2026-10-03', 1);
    await add('2026-10-04', 3);   // Nafis + 2 guests, saved before guests had their own column

    await pg.exec(sql('004_guests.sql'));

    const rows = await db<{ date: string; count: number; guests: number }>(
      `select date::text as date, count, guests from meal_changes order by date`);
    expect(rows).toEqual([
      { date: '2026-10-02', count: 0, guests: 0 },
      { date: '2026-10-03', count: 1, guests: 0 },
      { date: '2026-10-04', count: 3, guests: 2 },   // total unchanged, so every bill stays the same
    ]);
    // the own plate (count - guests) can only be 0 or 1, and guests never go below 0
    await expect(add('2026-10-05', 2)).rejects.toThrow();
    await expect(db(`update meal_changes set guests = -1 where date = '2026-10-02'`)).rejects.toThrow();
    await pg.close();
  });
});
