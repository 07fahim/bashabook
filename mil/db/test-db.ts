import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../lib/db';

const dir = join(__dirname, 'migrations');
export const pg = new PGlite();   // booted once per test file: startup takes seconds
let ready: Promise<void> | undefined;
export const migrate = () => ready ??= (async () => {
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) await pg.exec(readFileSync(join(dir, f), 'utf8'));
})();
export const db: Db = async (text, params) => (await pg.query(text, params)).rows as never;
