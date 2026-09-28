import { customType } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Bun SQL serializes JSONB parameters and decodes JSONB results itself. Pass native
 * values through once; Drizzle's generic JSON.stringify codec would store JSON strings.
 * This is the database driver contract, including intentionally scalar JSON values.
 */
export const jsonb = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => 'jsonb',
  // Bun binds booleans/numbers as their native PostgreSQL scalar type, requiring
  // an explicit JSON conversion; objects, arrays and strings use its JSON codec.
  toDriver: (value) =>
    typeof value === 'boolean' || typeof value === 'number' ? sql`to_jsonb(${value})` : value,
  fromDriver: (value) => value,
});
