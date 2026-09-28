import type { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './schema';

let client: SQL | undefined;
let database: ReturnType<typeof createDatabase> | undefined;
function createDatabase(sql: SQL) {
  return drizzle({ client: sql, schema });
}

/** Lazy construction keeps SvelteKit build/prerender independent of a running database. */
export function getSql(): SQL {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url)
      throw new Error(
        'DATABASE_URL is required. Start PostgreSQL and configure Coast before serving requests.'
      );
    client = new Bun.SQL(url, { max: 10, idleTimeout: 30, connectionTimeout: 10 });
  }
  return client;
}
export function getDb() {
  return (database ??= createDatabase(getSql()));
}
export type Database = ReturnType<typeof getDb>;
export async function closeDb() {
  if (client) await client.close();
  client = undefined;
  database = undefined;
}
