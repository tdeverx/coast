import { expect, test } from 'bun:test';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import * as schema from '../src/lib/server/db/schema';

test('the latest migration snapshot matches the declared schema without regenerating applied objects', async () => {
  const journal = await Bun.file('drizzle/meta/_journal.json').json();
  const prefix = journal.entries.at(-1).tag.split('_')[0];
  const previous = await Bun.file(`drizzle/meta/${prefix}_snapshot.json`).json();
  expect(await generateMigration(previous, generateDrizzleJson(schema, previous.id))).toEqual([]);
});
