// Real-Postgres race for clearing a lock, on the Neon test copy only (refuses any other host). 20 clears at once by two
// flatmates on a pool of 10 connections must clear once (one history row, count 20); clears mixed with wrong tries must end
// at 20 or 21 with one row. The flat it makes is deleted at the end.
// node --env-file=.env.branch node_modules/tsx/dist/cli.mjs scripts/race-clear-lock.mts
import postgres from 'postgres';
import { clearLock, createFlat, flatByCode, login } from '../lib/auth';
import type { Db } from '../lib/db';
import { deleteFlat } from '../lib/delete-flat';

const url = process.env.DATABASE_URL ?? '';
if (!new URL(url).hostname.startsWith('ep-calm-shape-')) throw new Error('not the test copy; refusing');
const sql = postgres(url, { max: 10, prepare: false, onnotice: () => {} });
const db: Db = (t, p = []) => sql.unsafe(t, p as never[]) as never;

async function main() {
  const { flatId } = await createFlat(db, { flatName: 'Race clear lock', name: 'Nafis', pin: '1234', others: ['Tahsin', 'Zarif'], today: '2026-10-12', lang: 'en' });
  const [{ join_code: code }] = await db<{ join_code: string }>(`select join_code from flats where id = $1`, [flatId]);
  const members = (await flatByCode(db, code))!.members;
  const tahsin = members.find(m => m.name === 'Tahsin')!.id, zarif = members.find(m => m.name === 'Zarif')!.id;
  await login(db, code, tahsin, '5678', null);
  await login(db, code, zarif, '9999', null);
  const state = async () => (await db<{ n: number; lock: string | null; rows: number }>(
    `select failed_pin_count as n, locked_until::text as lock, (select count(*)::int from audit_log where entity_id = m.id::text and after ? 'lockCleared') as rows from members m where id = $1`, [tahsin]))[0];
  const lock = async () => { await db(`update members set failed_pin_count = 25, locked_until = 'infinity' where id = $1`, [tahsin]); await db(`delete from audit_log where entity_id = $1 and after ? 'lockCleared'`, [tahsin]); };
  let failed = 0;
  const check = (label: string, ok: boolean, detail: unknown) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${JSON.stringify(detail)}`); };
  for (let round = 1; round <= 5; round++) {
    await lock();
    const r = await Promise.all(Array.from({ length: 20 }, (_, i) => clearLock(db, flatId, tahsin, i % 2 ? zarif : members.find(m => m.name === 'Nafis')!.id)));
    const s = await state();
    check(`round ${round}: 20 clears at once clear once`, r.filter(Boolean).length === 1 && s.n === 20 && s.lock === null && s.rows === 1, { ok: r.filter(Boolean).length, ...s });
  }
  for (let round = 1; round <= 5; round++) {
    await lock();
    const r = await Promise.all([
      ...Array.from({ length: 10 }, () => clearLock(db, flatId, tahsin, zarif)),
      ...Array.from({ length: 10 }, () => login(db, code, tahsin, '0000', null).then(x => 'error' in x ? x.error : 'in')),
    ]);
    const s = await state();
    const wrong = r.filter(x => x === 'wrongPin').length;
    check(`round ${round}: 10 clears and 10 wrong tries at once: one clear, count 20 + the wrong tries that got through (+1 if the 5th locked again), never past 25`,
      r.filter(x => x === true).length === 1 && s.rows === 1 && s.n === 20 + wrong + (s.lock === 'infinity' ? 1 : 0) && s.n <= 25, { ...s, wrong, seen: r.filter(x => typeof x === 'string') });
  }
  await deleteFlat(db, flatId);
  console.log(failed ? `${failed} FAILED` : 'all passed', '· flat deleted');
  process.exitCode = failed ? 1 : 0;
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => sql.end());
