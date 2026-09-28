import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { eq, inArray } from 'drizzle-orm';
import { closeDb, getDb, getSql } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite('native Bun SQL JSONB boundary', () => {
  const userId = crypto.randomUUID(),
    mediaId = crypto.randomUUID(),
    instanceId = crypto.randomUUID(),
    connectionId = crypto.randomUUID();
  const keys = Array.from({ length: 5 }, (_, index) => `jsonb-${userId}-${index}`);
  const previousDatabaseUrl = process.env.DATABASE_URL;
  beforeAll(async () => {
    await closeDb();
    process.env.DATABASE_URL = databaseUrl!;
    await migrate(getDb(), { migrationsFolder: `${import.meta.dir}/../drizzle` });
    await getDb()
      .insert(s.users)
      .values({
        id: userId,
        username: `jsonb-${userId}`,
        passwordHash: 'unused',
        settings: { fullWidth: false, region: 'US' },
      });
    await getDb()
      .insert(s.media)
      .values({ id: mediaId, kind: 'movie', title: 'JSONB boundary fixture' });
    await getDb()
      .insert(s.providerInstances)
      .values({
        id: instanceId,
        provider: 'jellyfin',
        name: 'JSONB fixture',
        baseUrl: 'https://example.test',
        settings: { enabled: false, limits: { bitrate: 5000 } },
      });
    await getDb()
      .insert(s.providerConnections)
      .values({
        id: connectionId,
        userId,
        instanceId,
        settings: { importHistory: true, categories: ['movies', 'shows'] },
      });
  });
  afterAll(async () => {
    await getDb().delete(s.systemSettings).where(inArray(s.systemSettings.key, keys));
    await getDb().delete(s.users).where(eq(s.users.id, userId));
    await getDb().delete(s.providerInstances).where(eq(s.providerInstances.id, instanceId));
    await getDb().delete(s.media).where(eq(s.media.id, mediaId));
    await closeDb();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });
  test('objects reach PostgreSQL as objects through insert, update and transaction paths', async () => {
    const raw = { nested: { score: 8.5 }, labels: ['one', 'two'], allowed: false };
    const payload = { mediaId, enabled: true, positions: [1, 2] };
    const [snapshot] = await getDb().transaction(async (tx) =>
      tx.insert(s.metadataSnapshots).values({ mediaId, provider: 'tmdb', raw }).returning()
    );
    const [action] = await getDb()
      .insert(s.outboxActions)
      .values({ userId, connectionId, kind: 'test.jsonb', payload })
      .returning();
    const [row] = await getSql()`select
      jsonb_typeof(u.settings) as user_type, u.settings ->> 'region' as region,
      jsonb_typeof(c.settings) as connection_type, c.settings ->> 'importHistory' as import_history,
      jsonb_typeof(p.settings) as instance_type,
      jsonb_typeof(m.raw) as snapshot_type, m.raw -> 'nested' ->> 'score' as score,
      jsonb_typeof(o.payload) as payload_type, o.payload ->> 'enabled' as enabled
      from users u join provider_connections c on c.user_id = u.id join provider_instances p on p.id = c.instance_id
      join metadata_snapshots m on m.id = ${snapshot.id} join outbox_actions o on o.id = ${action.id}
      where u.id = ${userId}`;
    expect(row).toMatchObject({
      user_type: 'object',
      region: 'US',
      connection_type: 'object',
      import_history: 'true',
      instance_type: 'object',
      snapshot_type: 'object',
      score: '8.5',
      payload_type: 'object',
      enabled: 'true',
    });
    expect(snapshot.raw).toEqual(raw);
    expect(action.payload).toEqual(payload);
    await getDb()
      .update(s.users)
      .set({ settings: { fullWidth: true, region: 'GB' } })
      .where(eq(s.users.id, userId));
    const [updated] =
      await getSql()`select jsonb_typeof(settings) as type, settings ->> 'region' as region from users where id = ${userId}`;
    expect(updated).toEqual({ type: 'object', region: 'GB' });
  });
  test('JSON scalars and arrays round-trip exactly without legacy string heuristics', async () => {
    const values = [
      { nested: ['a', 1, false] },
      ['a', 1, false],
      '{"literal":"string"}',
      true,
      4.5,
    ];
    const types = ['object', 'array', 'string', 'boolean', 'number'];
    for (const [index, value] of values.entries()) {
      await getDb().insert(s.systemSettings).values({ key: keys[index], value });
      const [native] =
        await getSql()`select value, jsonb_typeof(value) as type from system_settings where key = ${keys[index]}`;
      const [orm] = await getDb()
        .select()
        .from(s.systemSettings)
        .where(eq(s.systemSettings.key, keys[index]));
      expect(native.type).toBe(types[index]);
      expect(native.value).toEqual(value);
      expect(orm.value).toEqual(value);
    }
    const [job] = await getDb()
      .insert(s.jobs)
      .values({ userId, kind: 'test.jsonb-default' })
      .returning();
    const [defaults] =
      await getSql()`select jsonb_typeof(payload) as type from jobs where id = ${job.id}`;
    expect(defaults.type).toBe('object');
    expect(job.payload).toEqual({});
  });
});
