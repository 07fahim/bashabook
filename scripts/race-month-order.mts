// Real-Postgres deadlock storm for the month triggers (009/014), Neon test copy only. Writers that lock several open months:
// away days across a month boundary lock them in date order (one month_touch per row); usual meals, rooms and weights fire
// touch_open_months / touch_flat_months, which before 014 locked them in heap order. No deadlock retry here: every 40P01 counts.
import postgres from 'postgres';
import { createFlat } from '../lib/auth';
import type { Db } from '../lib/db';
import { setAway, cancelAway, setDefaults, updateSettings } from '../lib/meals-db';
import { addRoom, openMonth, setRent } from '../lib/money-db';

const url = process.env.DATABASE_URL ?? '';
if (new URL(url).username !== 'postgres.wgvoshlmhauxcymwdwjt') throw new Error('not the Supabase test project; refusing');   // the pooler host is shared with production
const sql = postgres(url, { max: 12, prepare: false, ssl: 'require', onnotice: () => {} });
const db: Db = (t, p = []) => sql.unsafe(t, p as never[]) as never;

const [{ today }] = await db<{ today: string }>(`select ((now() at time zone 'Asia/Dhaka')::date)::text as today`);
const addMonths = (m: string, k: number) => { const d = new Date(`${m}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + k); return d.toISOString().slice(0, 10); };
const thisMonth = `${today.slice(0, 7)}-01`, next = addMonths(thisMonth, 1), after = addMonths(thisMonth, 2);
const lastOfThis = addMonths(next, 0).replace(/-01$/, '-01');   // the 1st of next month
const edge = (d: string, k: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const from = edge(lastOfThis, -2), to = edge(addMonths(next, 1), 1);   // away spans this month, next month and the one after

const f = await createFlat(db, { flatName: 'Race months', name: 'Nafis', pin: String(1000 + Math.floor(Math.random() * 9000)), others: ['Tahsin', 'Zarif', 'Fahim'], today, lang: 'en' });
const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
const nafis = { memberId: ids.Nafis, role: 'manager' as const };
for (const m of [thisMonth, next, after]) await openMonth(db, f.flatId, m);
const room = (await addRoom(db, f.flatId, nafis, 'Big', 300000)) as string;

const ROUNDS = Number(process.env.ROUNDS ?? 40);
let deadlocks = 0, other = 0;
const note = (e: unknown) => { if ((e as { code?: string }).code === '40P01') deadlocks++; else { other++; console.log(String(e).slice(0, 120)); } };
for (let i = 0; i < ROUNDS; i++) {
  await Promise.all([
    setAway(db, f.flatId, ids.Tahsin, from, to).catch(note),
    setDefaults(db, f.flatId, ids.Zarif, { b: i % 2 === 0, l: true, d: true }, thisMonth, today, null).catch(note),
    setRent(db, f.flatId, nafis, room, 300000 + i).catch(note),
    updateSettings(db, f.flatId, ids.Nafis, { cutoff: '22:00', weights: { b: 50 + (i % 2), l: 100, d: 100 } }, `${today}T10:00`).catch(note),
    setAway(db, f.flatId, ids.Fahim, from, to).catch(note),
  ]);
  await Promise.all([cancelAway(db, f.flatId, ids.Tahsin, from, to).catch(note), cancelAway(db, f.flatId, ids.Fahim, from, to).catch(note)]);
}
console.log(`${ROUNDS} rounds, 5 writers over 3 open months: ${deadlocks} deadlocks, ${other} other errors`);
await sql.end();
process.exit(0);
