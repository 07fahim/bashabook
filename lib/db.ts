import postgres from 'postgres';

/** Runs one parameterised query and returns its rows. Tests pass a PGlite one. */
export type Db = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

// prepare: false keeps it working through a transaction pooler (Supabase's, Neon's).
// ssl: 'require' encrypts the connection whatever the URL says (it also overrides a stricter sslmode in the URL): postgres.js
// defaults to plain text, and Supabase's pooler string has no sslmode. Encrypted but the server is not verified, as with Neon
// before; pin Supabase's CA certificate for verify-full.
// connect_timeout: a database that can't be reached fails in 10 s (default 30): a faster error page.
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: 'require', onnotice: () => {}, connect_timeout: 10 });
// A query that hangs after connecting is cut off at 8 s (error 57014 → the error page) instead of running until Vercel kills
// the function. Neon's pooler refuses statement_timeout as a connection setting (Supavisor not probed), so each query runs in its own transaction
// with `set local`, pipelined: one extra round trip (about a millisecond inside the region), and the pooled session is left
// as it was. Probed on the test copy 2026-10-12.
const run = async (text: string, params: unknown[]) =>
  (await sql.begin(t => [t.unsafe('set local statement_timeout = 8000'), t.unsafe(text, params as never[])]))[1] as never;
// Two errors where nothing was written, so running again is safe:
// - a deadlock (40P01): Postgres rolls one side's statement back whole and every app write is one statement; writers lock
//   month rows in varying orders, so a rare one can't be ruled out by lock order alone. Once more.
// - a reset on BEGIN (ECONNRESET): a pooled connection that died unnoticed (a Wi-Fi drop, a frozen serverless instance) fails
//   before anything ran; each try retires one dead connection (the pool holds 10). Up to 10 more.
// Never again on a reset at any later step (set local, the statement, COMMIT) or CONNECTION_CLOSED: the write may have landed.
export const withRetry = (go: typeof run): Db => async (text, params = []) => {
  for (let resets = 0, deadlocked = false; ;) {
    try { return await go(text, params); }
    catch (e) {
      const { code, query } = e as { code?: string; query?: string };
      if (code === 'ECONNRESET' && query?.startsWith('begin') && resets < 10) resets++;
      else if (code === '40P01' && !deadlocked) deadlocked = true;
      else throw e;
    }
  }
};
export const db = withRetry(run);
