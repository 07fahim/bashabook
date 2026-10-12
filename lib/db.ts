import postgres from 'postgres';

/** Runs one parameterised query and returns its rows. Tests pass a PGlite one. */
export type Db = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

// prepare: false keeps it working through Neon's pooled connection string.
// connect_timeout: a database that can't be reached fails in 10 s (default 30): a faster error page.
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, onnotice: () => {}, connect_timeout: 10 });
// A query that hangs after connecting is cut off at 8 s (error 57014 → the error page) instead of running until Vercel kills
// the function. Neon's pooler refuses statement_timeout as a connection setting, so each query runs in its own transaction
// with `set local`, pipelined: one extra round trip (about a millisecond inside the region), and the pooled session is left
// as it was. Probed on the test copy 2026-10-12.
const run = async (text: string, params: unknown[]) =>
  (await sql.begin(t => [t.unsafe('set local statement_timeout = 8000'), t.unsafe(text, params as never[])]))[1] as never;
// Postgres cancels one side of a deadlock (40P01) and rolls its statement back whole; every app write is one statement,
// so running it once more is safe. Writers lock month rows in varying orders, so a rare deadlock can't be ruled out
// by lock order alone; this covers it.
export const db: Db = async (text, params = []) => {
  try { return await run(text, params); }
  catch (e) {
    if ((e as { code?: string }).code !== '40P01') throw e;
    return await run(text, params);
  }
};
