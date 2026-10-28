import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../lib/db';

const dir = join(__dirname, 'migrations');
export const pg = new PGlite({ extensions: { btree_gist } });   // booted once per test file: startup takes seconds
let ready: Promise<void> | undefined;
export const migrate = () => ready ??= (async () => {
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) await pg.exec(readFileSync(join(dir, f), 'utf8'));
})();
export const db: Db = async (text, params) => (await pg.query(text, params)).rows as never;

/** Every bazar and bill of a flat Verified, as the checkers would tap them before a close (migration 020). */
export const checkAll = (flatId: string) => db(`insert into entry_checks (flat_id, ledger_id, month, state)
  select flat_id, id, month, 'ok' from ledger where flat_id = $1 and type in ('bazar', 'bill') on conflict do nothing`, [flatId]);
