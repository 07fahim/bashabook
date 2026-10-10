import postgres from 'postgres';

/** Runs one parameterised query and returns its rows. Tests pass a PGlite one. */
export type Db = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

// prepare: false keeps it working through Neon's pooled connection string.
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, onnotice: () => {} });
export const db: Db = (text, params = []) => sql.unsafe(text, params as never[]) as never;
