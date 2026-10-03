import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, getSql } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { deleteInstance } from '../src/lib/application/provider-sources.server';
import { previewSourceChange } from '../src/lib/collection/source-changes.server';
import { ingestMetadata } from '../src/lib/catalogue/service';

const enabled = process.env.COAST_DB_TEST === '1', run = enabled ? test : test.skip;
let adminId: string, userId: string;
beforeAll(async () => {
  if (!enabled) return;
  const [admin, user] = await getDb().insert(s.users).values([
    { username: `removal-admin-${crypto.randomUUID()}`, role: 'admin' },
    { username: `removal-user-${crypto.randomUUID()}` },
  ]).returning();
  adminId = admin.id; userId = user.id;
});
afterAll(closeDb);
async function fixture(provider: 'jellyfin' | 'tmdb' = 'jellyfin') {
  const [instance] = await getDb().insert(s.providerInstances).values({ provider, name: 'Removal fixture', baseUrl: 'https://fixture.invalid' }).returning();
  const [connection] = await getDb().insert(s.providerConnections).values({ userId, instanceId: instance.id, externalUserId: crypto.randomUUID() }).returning();
  return { instance, connection };
}
run('only administrators can delete integrations; unknown integrations return not found', async () => {
  const { instance } = await fixture();
  await expect(deleteInstance(userId, instance.id)).rejects.toThrow('Administrator');
  expect(await getDb().select().from(s.providerInstances).where(eq(s.providerInstances.id, instance.id))).toHaveLength(1);
  await expect(deleteInstance(adminId, crypto.randomUUID())).rejects.toThrow('Integration not found');
});
run('deletion cancels queued work and removes bindings without losing personal data or account evidence', async () => {
  const { instance, connection } = await fixture();
  const movie = await ingestMetadata({ provider: 'tmdb', externalId: crypto.randomUUID(), kind: 'movie', title: 'Retained movie' });
  const [item] = await getDb().insert(s.providerItems).values({ instanceId: instance.id, mediaId: movie.id, externalId: 'movie', kind: 'movie' }).returning();
  await getDb().insert(s.availability).values({ userId, connectionId: connection.id, providerItemId: item.id, mediaId: movie.id });
  await getDb().insert(s.trackingState).values({ userId, mediaId: movie.id, collected: true, watchlist: true });
  await getDb().insert(s.trackingEvents).values({ userId, mediaId: movie.id, action: 'watch' });
  await getDb().insert(s.userIdentities).values({ userId, instanceId: instance.id, externalUserId: connection.externalUserId! });
  const [list] = await getDb().insert(s.lists).values({ userId, name: 'Retained list', source: 'jellyfin', externalId: 'list', sourceConnectionId: connection.id, sourceAccountId: connection.syncAccountId }).returning();
  const actions = await getDb().insert(s.outboxActions).values([
    { userId, connectionId: connection.id, kind: 'jellyfin.sync', payload: {}, state: 'pending' },
    { userId, connectionId: connection.id, kind: 'jellyfin.favourite', payload: {}, state: 'failed' },
    { userId, connectionId: connection.id, kind: 'jellyfin.sync', payload: {}, state: 'succeeded' },
  ]).returning();
  await getDb().insert(s.notifications).values({ userId, kind: 'sync', title: 'Old failure', body: 'Fixture', sourceKey: `outbox:${actions[1].id}` });
  expect(await deleteInstance(adminId, instance.id)).toEqual({ deleted: true });
  expect(await getDb().select().from(s.providerConnections).where(eq(s.providerConnections.id, connection.id))).toHaveLength(0);
  expect(await getDb().select().from(s.providerItems).where(eq(s.providerItems.id, item.id))).toHaveLength(0);
  expect(await getDb().select().from(s.media).where(eq(s.media.id, movie.id))).toHaveLength(1);
  expect(await getDb().select().from(s.trackingEvents).where(eq(s.trackingEvents.mediaId, movie.id))).toHaveLength(1);
  expect((await getDb().select().from(s.trackingState).where(eq(s.trackingState.mediaId, movie.id)))[0]).toMatchObject({ collected: true, watchlist: true });
  expect((await getDb().select().from(s.syncAccounts).where(eq(s.syncAccounts.id, connection.syncAccountId!)))[0]).toMatchObject({ instanceId: null, externalUserId: connection.externalUserId });
  expect((await getDb().select().from(s.lists).where(eq(s.lists.id, list.id)))[0]).toMatchObject({ sourceConnectionId: null, sourceAccountId: connection.syncAccountId });
  for (const [index, action] of actions.entries()) expect((await getDb().select().from(s.outboxActions).where(eq(s.outboxActions.id, action.id)))[0]).toMatchObject({ connectionId: null, state: index === 2 ? 'succeeded' : 'cancelled' });
  expect(await getDb().select().from(s.notifications).where(eq(s.notifications.sourceKey, `outbox:${actions[1].id}`))).toHaveLength(0);
  expect(await getDb().select().from(s.notifications).where(eq(s.notifications.sourceKey, `collection-source-review:${userId}`))).toHaveLength(1);
});
run('linked services must be reassigned or deleted first', async () => {
  const { instance } = await fixture();
  const [linked] = await getDb().insert(s.providerInstances).values({ provider: 'seerr', name: 'Linked requests', baseUrl: 'https://fixture.invalid', linkedMediaInstanceId: instance.id }).returning();
  await expect(deleteInstance(adminId, instance.id)).rejects.toThrow('Linked requests');
  await deleteInstance(adminId, linked.id);
  await deleteInstance(adminId, instance.id);
});
run('running jobs block deletion; instance-only queued tasks are cancelled', async () => {
  const { instance } = await fixture('tmdb');
  const [action] = await getDb().insert(s.outboxActions).values({ userId, kind: 'tmdb.refresh', payload: { instanceId: instance.id }, state: 'running' }).returning();
  await expect(deleteInstance(adminId, instance.id)).rejects.toThrow('A job is using');
  await getDb().update(s.outboxActions).set({ state: 'pending' }).where(eq(s.outboxActions.id, action.id));
  await deleteInstance(adminId, instance.id);
  expect((await getDb().select().from(s.outboxActions).where(eq(s.outboxActions.id, action.id)))[0].state).toBe('cancelled');
});
run('a held worker lease blocks deletion even if its durable state has become stale', async () => {
  const { instance, connection } = await fixture();
  const reserved = await getSql().reserve();
  const key = `queue-lane:${userId}:${connection.id}`;
  try {
    await reserved`select pg_advisory_lock(hashtextextended(${key},0))`;
    await expect(deleteInstance(adminId, instance.id)).rejects.toThrow('A job is using');
  } finally {
    await reserved`select pg_advisory_unlock(hashtextextended(${key},0))`;
    reserved.release();
  }
  await deleteInstance(adminId, instance.id);
});
run('Jellyfin deletion requires a current Collection impact preview', async () => {
  const { instance } = await fixture();
  const [trakt] = await getDb().insert(s.providerInstances).values({ provider: 'trakt', name: 'Projection fixture', baseUrl: 'https://fixture.invalid' }).returning();
  await getDb().insert(s.providerConnections).values({ userId, instanceId: trakt.id, externalUserId: crypto.randomUUID(), settings: { collectionProjection: { enabled: true, source: 'server', availableOnly: false, scope: 'dynamic', sourceIds: [] } } });
  await expect(deleteInstance(adminId, instance.id)).rejects.toThrow('Preview the Collection impact');
  const preview = await previewSourceChange(adminId, instance.id, 'instance');
  expect(preview.accounts).toHaveLength(1);
  await deleteInstance(adminId, instance.id, preview.id);
});
