import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(__dirname, 'migrations');
const db = new PGlite();   // booted once: startup takes seconds
let ready: Promise<void> | undefined;
const migrate = () => ready ??= (async () => {
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) await db.exec(readFileSync(join(dir, f), 'utf8'));
})();

/** Two new flats per test, so tests never share rows. */
async function freshDb() {
  await migrate();
  const id = async (q: string, p: unknown[] = []) => (await db.query<{ id: string }>(q, p)).rows[0].id;
  const flat = await id(`insert into flats (name, join_code) values ('x', gen_random_uuid()) returning id`);
  const other = await id(`insert into flats (name, join_code) values ('y', gen_random_uuid()) returning id`);
  const mgr = await id(`insert into members (flat_id, name, joined_on, role) values ($1, 'a', '2026-10-01', 'manager') returning id`, [flat]);
  const stranger = await id(`insert into members (flat_id, name, joined_on) values ($1, 'z', '2026-10-01') returning id`, [other]);
  await db.query(`insert into months (flat_id, month) values ($1, '2026-10-01')`, [flat]);
  return { db, flat, mgr, stranger };
}

describe('schema', { timeout: 30000 }, () => {
  it('allows only one manager per flat', async () => {
    const { db, flat } = await freshDb();
    await expect(db.query(`insert into members (flat_id, name, joined_on, role) values ($1, 'b', '2026-10-01', 'manager')`, [flat])).rejects.toThrow(/one_manager_per_flat/);
  });

  it('requires a split on bills and rejects duplicate TrxIDs', async () => {
    const { db, flat, mgr } = await freshDb();
    await expect(db.query(`insert into ledger (flat_id, month, type, amount_poisha, date, created_by) values ($1, '2026-10-01', 'bill', 100, '2026-10-02', $2)`, [flat, mgr])).rejects.toThrow(/check constraint/);
    const dep = `insert into ledger (flat_id, month, type, amount_poisha, member_id, date, trxid, created_by) values ($1, '2026-10-01', 'deposit', 100, $2, '2026-10-02', 'ABC12345', $2)`;
    await db.query(dep, [flat, mgr]);
    await expect(db.query(dep, [flat, mgr])).rejects.toThrow(/duplicate key/);
  });

  it('rejects ledger rows outside their month or for a missing month', async () => {
    const { db, flat, mgr } = await freshDb();
    await expect(db.query(`insert into ledger (flat_id, month, type, amount_poisha, paid_by_member_id, date, created_by) values ($1, '2026-10-01', 'bazar', 100, $2, '2026-11-02', $2)`, [flat, mgr])).rejects.toThrow(/check constraint/);
    await expect(db.query(`insert into ledger (flat_id, month, type, amount_poisha, paid_by_member_id, date, created_by) values ($1, '2026-11-01', 'bazar', 100, $2, '2026-11-02', $2)`, [flat, mgr])).rejects.toThrow(/foreign key/);
  });

  it('rejects references to another flat', async () => {
    const { db, flat, mgr, stranger } = await freshDb();
    await expect(db.query(`insert into ledger (flat_id, month, type, amount_poisha, paid_by_member_id, date, created_by) values ($1, '2026-10-01', 'bazar', 100, $2, '2026-10-02', $3)`, [flat, stranger, mgr])).rejects.toThrow(/foreign key/);
    await expect(db.query(`insert into duties (flat_id, date, member_id) values ($1, '2026-10-02', $2)`, [flat, stranger])).rejects.toThrow(/foreign key/);
    await expect(db.query(`insert into meal_changes (flat_id, member_id, date, meal, count) values ($1, $2, '2026-10-02', 'l', 0)`, [flat, stranger])).rejects.toThrow(/foreign key/);
  });
});
