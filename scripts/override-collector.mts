// App team only, pilot: make someone collector when the collector can't hand over (lost phone, gone).
// Procedure first (docs): a direct request from the flat, verified with more than one flatmate where possible.
// Usage: npx tsx --env-file=.env.local scripts/override-collector.mts <join code> <new collector's name> "<reason>" "<your name>"
import { db } from '../lib/db';
import { overrideCollector } from '../lib/handover';

const [code, name, reason, admin] = process.argv.slice(2);
if (!code || !name || !reason || !admin) { console.log('usage: <join code> <name> "<reason>" "<your name>"'); process.exit(1); }
const [f] = await db<{ id: string }>(`select id from flats where join_code = $1`, [code.toUpperCase()]);
const [m] = f ? await db<{ id: string }>(`select id from members where flat_id = $1 and name = $2 and left_on is null`, [f.id, name]) : [];
if (!f || !m) { console.log('no such flat or person living there'); process.exit(1); }
console.log(await overrideCollector(db, f.id, m.id, reason, admin));
process.exit(0);
