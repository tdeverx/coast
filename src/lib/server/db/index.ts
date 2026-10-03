import type { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './schema';

// SSR module reloads do not reliably expose import.meta.hot. Keep the pool in
// process state, while each module generation rebuilds its schema-aware ORM.
const poolKey = Symbol.for('coast.database.pool');
const pools = globalThis as typeof globalThis & { [poolKey]: SQL | undefined };
let database: ReturnType<typeof createDatabase> | undefined;
function createDatabase(sql: SQL) {
  return drizzle({ client: sql, schema });
}

/** Lazy construction keeps SvelteKit build/prerender independent of a running database. */
export function getSql(): SQL {
  if (!pools[poolKey]) {
    const url = process.env.DATABASE_URL;
    if (!url)
      throw new Error(
        'DATABASE_URL is required. Start PostgreSQL and configure Coast before serving requests.'
      );
    // Interactive shelves use many small correlated reads; JIT compilation can take
    // seconds before returning a few cards and exhaust the test container's memory.
    pools[poolKey] = new Bun.SQL(url, { max: 10, idleTimeout: 30, connectionTimeout: 10, connection: { jit: 'off' } });
  }
  return pools[poolKey];
}
export function getDb() {
  return (database ??= createDatabase(getSql()));
}
export type Database = ReturnType<typeof getDb>;
export async function closeDb() {
  const client=pools[poolKey];
  pools[poolKey] = undefined;
  if (client) await client.close();
  database = undefined;
}
