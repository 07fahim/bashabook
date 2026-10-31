// Real-Postgres races for email recovery, on the Supabase test project only. From a pool of 10 connections: 20 wrong codes
// at once count exactly 5 tries; 10 taps of Set my new PIN on one proven step at once set it once (one history row); 10 takes
// of one proven email check at once hand its payload out once. Rounds
// repeat to give the races a chance. The flat it makes is deleted at the end.
// node --env-file=.env.branch node_modules/tsx/dist/cli.mjs scripts/race-recover.mts
import postgres from 'postgres';
import { createFlat } from '../lib/auth';
import type { Db } from '../lib/db';
import { deleteFlat } from '../lib/delete-flat';
import { checkCode, recoverPin, startCheck, startRecovery, takeCheck, TRIES } from '../lib/recovery';

const url = process.env.DATABASE_URL ?? '';
if (decodeURIComponent(new URL(url).username) !== 'postgres.wgvoshlmhauxcymwdwjt') throw new Error('not the Supabase test project; refusing');   // the pooler host is shared with production
const sql = postgres(url, { max: 10, prepare: false, ssl: 'require', onnotice: () => {} });
const db: Db = (t, p = []) => sql.unsafe(t, p as never[]) as never;

async function main() {
  const email = `race.recover.${Date.now()}@test.bd`;
  const { flatId, memberId } = await createFlat(db, { flatName: 'Race recover', name: 'Nafis', pin: '4827', others: [], today: '2026-10-31', lang: 'en', email });
  let failed = 0;
  const check = (label: string, ok: boolean, detail: unknown) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${JSON.stringify(detail)}`); };
  try {
    // the rows are cleared between rounds, so the day backstop (PER_DAY codes per email) never gets in the way
    for (let round = 1; round <= 2; round++) {
      await db(`delete from recoveries where email = $1`, [email]);
      const a = (await startRecovery(db, email))!;
      const wrong = a.code === '00000000' ? '00000001' : '00000000';
      const seen: Record<string, number> = {};
      for (const r of await Promise.all(Array.from({ length: 20 }, () => checkCode(db, a.token, wrong, 'recover')))) {
        const k = typeof r === 'string' ? r : `wrong:${r.wrong}`;
        seen[k] = (seen[k] ?? 0) + 1;
      }
      const [{ tries }] = await db<{ tries: number }>(`select tries from recoveries where email = $1`, [email]);
      check(`round ${round}: 20 wrong codes at once count exactly ${TRIES} tries`, tries === TRIES && seen.expired === 20 - TRIES && [4, 3, 2, 1, 0].every(n => seen[`wrong:${n}`] === 1), { tries, seen });

      const b = (await startRecovery(db, email))!;
      check(`round ${round}: the right code proves the step`, (await checkCode(db, b.token, b.code, 'recover')) === 'ok', null);
      await db(`delete from audit_log where entity_id = $1 and after ? 'pinReset'`, [memberId]);
      const done = await Promise.all(Array.from({ length: 10 }, (_, i) => recoverPin(db, b.token, memberId, String(5927 + i))));
      const [{ rows }] = await db<{ rows: number }>(`select count(*)::int as rows from audit_log where entity_id = $1 and after ? 'pinReset'`, [memberId]);
      check(`round ${round}: 10 new PINs at once on one step: set once, one history row`, done.filter(Boolean).length === 1 && rows === 1, { set: done.filter(Boolean).length, rows });
      const c = (await startCheck(db, email, 'email', { memberId }))!;
      check(`round ${round}: the right code proves the email check`, (await checkCode(db, c.token, c.code, 'check')) === 'ok', null);
      const took = (await Promise.all(Array.from({ length: 10 }, () => takeCheck(db, c.token)))).filter(Boolean).length;
      check(`round ${round}: 10 takes of one proven check at once: handed out once`, took === 1, { took });
    }
  } finally {
    await db(`delete from recoveries where email = $1`, [email]);
    await deleteFlat(db, flatId);
  }
  console.log(failed ? `${failed} FAILED` : 'all passed', '· flat deleted');
  process.exitCode = failed ? 1 : 0;
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => sql.end());
