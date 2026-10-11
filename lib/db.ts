import postgres from 'postgres';

/** Runs one parameterised query and returns its rows. Tests pass a PGlite one. */
export type Db = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

// prepare: false keeps it working through Neon's pooled connection string.
// connect_timeout: a database that can't be reached fails in 10 s (default 30), so the error page comes before the function times out.
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, onnotice: () => {}, connect_timeout: 10 });
// Postgres cancels one side of a deadlock (40P01) and rolls its statement back whole; every app write is one statement,
// so running it once more is safe. Writers lock month rows in varying orders, so a rare deadlock can't be ruled out
// by lock order alone; this covers it.
export const db: Db = async (text, params = []) => {
  try { return await sql.unsafe(text, params as never[]) as never; }
  catch (e) {
    if ((e as { code?: string }).code !== '40P01') throw e;
    return await sql.unsafe(text, params as never[]) as never;
  }
};
