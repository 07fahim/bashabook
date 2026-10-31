// App team only: someone lost their flat code. Follow ops/collector-pin-recovery.md (Lost flat code) first: verify who is
// asking before telling a code. Read-only: finds flats by part of the flat's name and, if given, part of the collector's.
// Usage:
//   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/find-flat.mts "<flat name part>" ["<collector name part>"]
import { STAYING } from '../lib/auth';
import { db } from '../lib/db';

const [flat, collector] = process.argv.slice(2);
if (!flat?.trim()) { console.log('usage: "<flat name part>" ["<collector name part>"]'); process.exit(1); }
{ const u = new URL(process.env.DATABASE_URL ?? ''); console.log(`database: ${u.hostname.split('.')[0]} ${u.username}`); }
// typed text is matched literally: % and _ are not wildcards
const like = (s: string) => `%${s.trim().replace(/[\\%_]/g, c => `\\${c}`)}%`;
const rows = await db<{ id: string; name: string; code: string; created: string; collector: string | null; phone: string | null }>(
  `select f.id, f.name, f.join_code as code, f.created_at::date::text as created, c.name as collector, c.phone
   from flats f
   left join members c on c.flat_id = f.id and c.role = 'manager'
     and (c.left_on is null or c.left_on >= (now() at time zone 'Asia/Dhaka')::date)
   where f.name ilike $1 and ($2::text is null or c.name ilike $2)
   order by f.created_at desc limit 20`, [like(flat), collector?.trim() ? like(collector) : null]);
if (!rows.length) console.log('no flat matches');
for (const r of rows) {
  // the names the join page offers (STAYING, moving in later too), with saved numbers: call back one of these, never a number the person asking gives you
  const people = await db<{ name: string; role: string; phone: string | null; notJoined: boolean; movesIn: string | null }>(
    `select name, role, phone, pin_hash is null as "notJoined",
       case when joined_on > (now() at time zone 'Asia/Dhaka')::date then joined_on::text end as "movesIn"
     from members where flat_id = $1 and ${STAYING} order by name`, [r.id]);
  console.log(`${r.name} · code ${r.code} · collector ${r.collector ?? 'none'} · saved number ${r.phone ?? 'none'} · ${people.length} on the join page · started ${r.created}`);
  for (const p of people) console.log(`  ${p.name}${p.role === 'manager' ? ' (collector)' : ''}${p.notJoined ? ' (not joined yet)' : ''} · saved number ${p.phone ?? 'none'}${p.movesIn ? ` · moves in ${p.movesIn}` : ''}`);
}
process.exit(0);
