import postgres from 'postgres';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing in .env.local');
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: 'require', onnotice: () => {} });   // see lib/db.ts
const dir = join(__dirname, 'migrations');

async function main() {
  await sql`create table if not exists migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql<{ name: string }[]>`select name from migrations`).map(r => r.name));
  for (const name of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    await sql.begin(async tx => {
      await tx.unsafe(readFileSync(join(dir, name), 'utf8'));
      await tx`insert into migrations (name) values (${name})`;
    });
    console.log('applied', name);
  }
}

main().finally(() => sql.end());
