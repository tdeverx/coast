import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { getDb, closeDb } from '../src/lib/server/db';

try {
  await migrate(getDb(), { migrationsFolder: `${import.meta.dir}/../drizzle` });
  console.info('Coast database migrations completed.');
} catch (error) {
  console.error(
    'Coast database migration failed:',
    error instanceof Error ? error.message : 'Unknown database error'
  );
  process.exitCode = 1;
} finally {
  await closeDb();
}
