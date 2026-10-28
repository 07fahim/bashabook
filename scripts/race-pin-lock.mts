// Real-Postgres race for the PIN lock, on the Neon test copy only (refuses any other host). 40 wrong tries at once from a
// pool of 10 connections must stop at exactly 25 (one permanent lock, one history row), and from 0 at exactly 5 (one timed
// lock). The flat it makes is deleted at the end.
// node --env-file=.env.branch node_modules/tsx/dist/cli.mjs scripts/race-pin-lock.mts
import postgres from 'postgres';
import { createFlat, flatByCode, login } from '../lib/auth';
import type { Db } from '../lib/db';
import { deleteFlat } from '../lib/delete-flat';

const url = process.env.DATABASE_URL ?? '';
if (new URL(url).username !== 'postgres.wgvoshlmhauxcymwdwjt') throw new Error('not the Supabase test project; refusing');   // the pooler host is shared with production
const sql = postgres(url, { max: 10, prepare: false, ssl: 'require', onnotice: () => {} });
const db: Db = (t, p = []) => sql.unsafe(t, p as never[]) as never;

async function main() {
  const { flatId } = await createFlat(db, { flatName: 'Race PIN lock', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-10-12', lang: 'en' });
  const [{ join_code: code }] = await db<{ join_code: string }>(`select join_code from flats where id = $1`, [flatId]);
  const tahsin = (await flatByCode(db, code))!.members.find(m => m.name === 'Tahsin')!.id;
  await login(db, code, tahsin, '5678', null);   // claims the name
  const state = async () => (await db<{ n: number; lock: string | null; rows: number }>(
    `select failed_pin_count as n, locked_until::text as lock, (select count(*)::int from audit_log where entity_id = m.id::text and after ? 'locked') as rows from members m where id = $1`, [tahsin]))[0];
  let failed = 0;
  const check = (label: string, ok: boolean, detail: unknown) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${JSON.stringify(detail)}`); };
  for (let round = 1; round <= 10; round++) {
    await db(`update members set failed_pin_count = 20, locked_until = null where id = $1`, [tahsin]);
    await db(`delete from audit_log where entity_id = $1 and after ? 'locked'`, [tahsin]);
    const t0 = Date.now();
    const seen: Record<string, number> = {};
    for (const r of await Promise.all(Array.from({ length: 40 }, () => login(db, code, tahsin, '0000', null)))) {
      const k = 'error' in r ? r.error + (r.left ? ':' + r.left : '') : 'in';
      seen[k] = (seen[k] ?? 0) + 1;
    }
    const s = await state();
    check(`round ${round}: 40 at once from 20 stop at 25, locked for good, one history row (${Date.now() - t0} ms)`,
      s.n === 25 && s.lock === 'infinity' && s.rows === 1 && seen['wrongPin:4'] === 1 && seen['wrongPin:1'] === 1 && seen.lockedForGood === 36, { ...s, seen });
  }
  await db(`update members set failed_pin_count = 0, locked_until = null where id = $1`, [tahsin]);
  const seen: Record<string, number> = {};
  for (const r of await Promise.all(Array.from({ length: 40 }, () => login(db, code, tahsin, '0000', null)))) {
    const k = 'error' in r ? r.error : 'in';
    seen[k] = (seen[k] ?? 0) + 1;
  }
  const s = await state();
  check('40 at once from 0 stop at 5 with a timed lock', s.n === 5 && s.lock !== null && s.lock !== 'infinity' && seen.wrongPin === 4 && seen.locked === 36, { ...s, seen });
  await deleteFlat(db, flatId);
  console.log(failed ? `${failed} FAILED` : 'all passed', '· flat deleted');
  process.exitCode = failed ? 1 : 0;
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => sql.end());
