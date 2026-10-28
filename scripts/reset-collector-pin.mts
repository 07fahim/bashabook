// App team only, pilot: the collector forgot their PIN. Follow ops/collector-pin-recovery.md first: verify who is asking.
// Sets a one-time PIN for the collector living there now (anyone else is refused), signs out every phone, and writes
// "PIN reset by the BashaBook team" in the flat's history. Never changes the role, money or meals.
// Usage (dry run, changes nothing):
//   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/reset-collector-pin.mts <join code> "<collector name>" "<reason>" "<your name>"
// Add --apply at the end to reset. The one-time PIN is printed once: tell it on a call, never as a chat message.
import { randomInt } from 'node:crypto';
import { resetPin } from '../lib/auth';
import { db } from '../lib/db';

const args = process.argv.slice(2), apply = args.at(-1) === '--apply';
const [code, name, reason, admin] = apply ? args.slice(0, -1) : args;
if (!code || !name || !reason?.trim() || !admin?.trim()) { console.log('usage: <join code> "<collector name>" "<reason>" "<your name>" [--apply]'); process.exit(1); }

{ const u = new URL(process.env.DATABASE_URL ?? ''); console.log(`database: ${u.hostname.split('.')[0]} ${u.username}`); }
const [f] = await db<{ id: string; name: string }>(`select id, name from flats where join_code = $1`, [code.toUpperCase()]);
if (!f) { console.log('no flat with that join code'); process.exit(1); }
const [c] = await db<{ id: string; name: string; sessions: number; locked: boolean }>(
  `select m.id, m.name, (select count(*)::int from sessions s where s.member_id = m.id and s.expires_at > now()) as sessions,
     coalesce(m.locked_until > now(), false) as locked
   from members m where m.flat_id = $1 and m.role = 'manager'
     and (m.left_on is null or m.left_on >= (now() at time zone 'Asia/Dhaka')::date)`, [f.id]);
console.log(`flat: ${f.name} · collector now: ${c?.name ?? 'none'}`);
// the name must match exactly: a mistyped or different name never resets anyone
if (!c || c.name !== name) { console.log(`refused: "${name}" is not the collector living in this flat now`); process.exit(1); }
const versions = () => db<{ month: string; version: number }>(`select month::text, version from months where flat_id = $1 order by month`, [f.id]);
const before = JSON.stringify(await versions());
console.log(`signed in on ${c.sessions} phone(s)${c.locked ? ', locked out by wrong tries' : ''}`);
// numbers saved in the app, to call back on: never a number the person asking gives you
const people = await db<{ name: string; phone: string | null }>(
  `select name, phone from members where flat_id = $1 and (left_on is null or left_on >= (now() at time zone 'Asia/Dhaka')::date)
   order by role = 'manager' desc, name`, [f.id]);
console.log('saved numbers:\n' + people.map(p => `  ${p.name}: ${p.phone ?? 'none saved'}`).join('\n'));
// a handover offer the collector didn't make survives a PIN reset: the procedure says what to do
const [offer] = await db<{ to: string; at: string }>(
  `select m.name as to, h.created_at::text as at from handovers h join members m on m.flat_id = h.flat_id and m.id = h.to_member
   where h.flat_id = $1 and h.status = 'offered'`, [f.id]);
if (offer) console.log(`WARNING: a handover to ${offer.to} is waiting (offered ${offer.at}). Ask the collector if they made it.`);
if (!apply) { console.log('dry run: nothing changed. Add --apply to reset.'); process.exit(0); }

const pin = String(randomInt(10000)).padStart(4, '0');
if (!(await resetPin(db, f.id, c.id, pin, { admin, reason }))) { console.log('reset refused: nothing changed'); process.exit(1); }
const same = JSON.stringify(await versions()) === before;
console.log(`done. One-time PIN for ${c.name}: ${pin}`);
console.log(`every phone signed out; at the next sign-in ${c.name} must choose a new PIN`);
console.log(`money and meals unchanged (month versions): ${same ? 'yes' : 'NO, check now'}`);
process.exit(same ? 0 : 1);
