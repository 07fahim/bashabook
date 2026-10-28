// App team only, pilot: make someone collector when the collector can't hand over (lost phone, gone).
// Procedure first (docs): a direct request from the flat, verified with more than one flatmate where possible.
// Usage (dry run, changes nothing):
//   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/override-collector.mts <join code> "<new collector's name>" "<reason>" "<your name>"
// Add --apply at the end to do it. The database host is printed first: check it is the one you mean.
import { db } from '../lib/db';
import { overrideCollector } from '../lib/handover';

const args = process.argv.slice(2), apply = args.at(-1) === '--apply';
const [code, name, reason, admin] = apply ? args.slice(0, -1) : args;
if (!code || !name || !reason?.trim() || !admin?.trim()) { console.log('usage: <join code> "<name>" "<reason>" "<your name>" [--apply]'); process.exit(1); }

{ const u = new URL(process.env.DATABASE_URL ?? ''); console.log(`database: ${u.hostname.split('.')[0]} ${u.username}`); }
const [f] = await db<{ id: string; name: string }>(`select id, name from flats where join_code = $1`, [code.toUpperCase()]);
const [m] = f ? await db<{ id: string }>(`select id from members where flat_id = $1 and name = $2 and left_on is null`, [f.id, name]) : [];
if (!f || !m) { console.log('no such flat or person living there'); process.exit(1); }
const [cur] = await db<{ name: string }>(`select name from members where flat_id = $1 and role = 'manager'`, [f.id]);
console.log(`flat: ${f.name}, collector now: ${cur?.name ?? 'none'}, new collector: ${name}`);
if (!apply) { console.log('dry run: nothing changed. Add --apply to make the change.'); process.exit(0); }
const r = await overrideCollector(db, f.id, m.id, reason, admin);
console.log(r);
process.exit(r === 'ok' ? 0 : 1);
