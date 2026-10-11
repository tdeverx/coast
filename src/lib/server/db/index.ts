import type { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './schema';

// SSR module reloads do not reliably expose import.meta.hot. Keep the pool in
// process state, while each module generation rebuilds its schema-aware ORM.
const poolKey = Symbol.for('coast.database.pool');
const pools = globalThis as typeof globalThis & { [poolKey]: SQL | undefined };
// The standalone OCI migration copy contains only this db directory. Look up
// optional application telemetry without importing application-only modules.
const evidenceKey = Symbol.for('coast.runtime.evidence');
const evidence = globalThis as typeof globalThis & {[evidenceKey]?: {connection: (error: unknown, closed?: boolean) => void}};
// Shared with startup without importing application-only modules into the
// standalone migration copy. Active jobs must not recreate a closing pool.
const shutdownKey = Symbol.for('coast.platform.shutdown');
const lifecycle = globalThis as typeof globalThis & {[shutdownKey]?: {started: boolean}};
function assertRunning() {
  if (lifecycle[shutdownKey]?.started) throw new Error('Coast is stopping.');
}
let database: ReturnType<typeof createDatabase> | undefined;
function createDatabase(sql: SQL) {
  return drizzle({ client: sql, schema });
}

/** Lazy construction keeps SvelteKit build/prerender independent of a running database. */
export function getSql(): SQL {
  assertRunning();
  if (!pools[poolKey]) {
    const url = process.env.DATABASE_URL;
    if (!url)
      throw new Error(
        'DATABASE_URL is required. Start PostgreSQL and configure Coast before serving requests.'
      );
    // Interactive shelves use many small correlated reads; JIT compilation can take
    // seconds before returning a few cards and exhaust the test container's memory.
    // Job workers reserve sessions for advisory locks while provider calls wait.
    // Bun's idle timer also closes reserved sessions, losing those locks and
    // raising ERR_POSTGRES_IDLE_TIMEOUT. Keep this bounded pool open until closeDb.
    pools[poolKey] = new Bun.SQL(url, { max: 10, idleTimeout: 0, connectionTimeout: 10, connection: { jit: 'off' },
      onconnect: error => evidence[evidenceKey]?.connection(error), onclose: error => evidence[evidenceKey]?.connection(error, true) });
  }
  return pools[poolKey];
}
export function getDb() {
  assertRunning();
  return (database ??= createDatabase(getSql()));
}
export type Database = ReturnType<typeof getDb>;
export async function closeDb(options?: {timeout?: number}) {
  const client=pools[poolKey];
  pools[poolKey] = undefined;
  if (client) await client.close(options);
  database = undefined;
}
