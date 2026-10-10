import postgres from 'postgres';

/** Runs one parameterised query and returns its rows. Tests pass a PGlite one. */
export type Db = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

// prepare: false keeps it working through Neon's pooled connection string.
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, onnotice: () => {} });
// Postgres cancels one side of a deadlock (40P01) and rolls its statement back whole; every app write is one statement,
// so running it once more is safe. Seen on real Postgres: a move-out against the same person's usual meals (both lock
// the person's row and the open months, in opposite orders).
export const db: Db = async (text, params = []) => {
  try { return await sql.unsafe(text, params as never[]) as never; }
  catch (e) {
    if ((e as { code?: string }).code !== '40P01') throw e;
    return await sql.unsafe(text, params as never[]) as never;
  }
};
