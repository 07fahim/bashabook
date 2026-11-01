// App team only: deletes one flat and everything in it, on the flat's request (ops/data-retention.md), or a test flat.
// Usage (dry run, prints what would go and changes nothing):
//   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/delete-flat.mts <join code> "<flat name>"
// Add --apply at the end to delete; on any database but TEST also --prod. The database is printed first: check it is the
// one you mean. The name must match exactly, so a code typed for the wrong flat deletes nothing.
import { db } from '../lib/db';
import { deleteFlat, flatRowCounts } from '../lib/delete-flat';

const args = process.argv.slice(2), apply = args.includes('--apply'), prod = args.includes('--prod');
const [code, name] = args.filter(a => !a.startsWith('--'));
if (!code || !name) { console.log('usage: <join code> "<flat name>" [--apply] [--prod]'); process.exit(1); }

// the pooler host is shared with production: only the username tells TEST apart
const u = new URL(process.env.DATABASE_URL ?? ''), host = u.hostname.split('.')[0], test = decodeURIComponent(u.username) === 'postgres.wgvoshlmhauxcymwdwjt';
console.log(`database: ${host} ${u.username} (${test ? 'TEST' : 'PRODUCTION'})`);
if (apply && !test && !prod) { console.log('refused: this is not TEST; add --prod to delete here'); process.exit(1); }
const [f] = await db<{ id: string; name: string; created: string }>(`select id, name, created_at::text as created from flats where join_code = $1`, [code.toUpperCase()]);
if (!f) { console.log('no flat with that join code'); process.exit(1); }
if (f.name !== name) { console.log(`refused: that code belongs to "${f.name}", not "${name}"`); process.exit(1); }
const people = await db<{ name: string }>(`select name from members where flat_id = $1 order by name`, [f.id]);
console.log(`flat: ${f.name} (since ${f.created.slice(0, 10)}) · people: ${people.map(p => p.name).join(', ')}`);
console.log('rows:', await flatRowCounts(db, f.id));
if (!apply) { console.log('dry run: nothing deleted. Add --apply to delete all of it.'); process.exit(0); }
console.log(await deleteFlat(db, f.id) ? `deleted ${f.name} (${code.toUpperCase()}) on ${host}, ${new Date().toISOString().slice(0, 16)}: paste this line in the ops log` : 'nothing deleted');
console.log('rows left:', await flatRowCounts(db, f.id));
process.exit(0);
