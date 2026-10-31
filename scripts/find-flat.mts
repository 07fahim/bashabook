// App team only: someone lost their flat code. Follow ops/collector-pin-recovery.md (Lost flat code) first: verify who is
// asking before telling a code. Read-only: finds flats by part of the flat's name and, if given, part of the collector's.
// Usage:
//   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/find-flat.mts "<flat name part>" ["<collector name part>"]
import { db } from '../lib/db';

const [flat, collector] = process.argv.slice(2);
if (!flat?.trim()) { console.log('usage: "<flat name part>" ["<collector name part>"]'); process.exit(1); }
{ const u = new URL(process.env.DATABASE_URL ?? ''); console.log(`database: ${u.hostname.split('.')[0]} ${u.username}`); }
// typed text is matched literally: % and _ are not wildcards
const like = (s: string) => `%${s.trim().replace(/[\\%_]/g, c => `\\${c}`)}%`;
const rows = await db<{ name: string; code: string; created: string; collector: string | null; phone: string | null; people: number }>(
  `select f.name, f.join_code as code, f.created_at::date::text as created, c.name as collector, c.phone,
     (select count(*)::int from members m where m.flat_id = f.id and m.joined_on <= (now() at time zone 'Asia/Dhaka')::date
        and (m.left_on is null or m.left_on >= (now() at time zone 'Asia/Dhaka')::date)) as people
   from flats f
   left join members c on c.flat_id = f.id and c.role = 'manager'
     and (c.left_on is null or c.left_on >= (now() at time zone 'Asia/Dhaka')::date)
   where f.name ilike $1 and ($2::text is null or c.name ilike $2)
   order by f.created_at desc limit 20`, [like(flat), collector?.trim() ? like(collector) : null]);
if (!rows.length) console.log('no flat matches');
for (const r of rows) console.log(`${r.name} · code ${r.code} · collector ${r.collector ?? 'none'} · saved number ${r.phone ?? 'none'} · ${r.people} living there · started ${r.created}`);
process.exit(0);
