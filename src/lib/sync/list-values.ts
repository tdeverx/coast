import { conflictPreference } from './preference';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '$lib/server/db';
import {
  lists,
  listItems,
  providerConnections,
  providerInstances,
  syncListValues,
  systemSettings,
} from '$lib/server/db/schema';
import { decideSync, sameValue } from './values';
import { enqueueInTransaction } from './changes';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type ListValue = { name: string; description: string; items: string[]; deleted?: boolean };
export async function localListValue(
  tx: Transaction,
  userId: string,
  listId: string
): Promise<ListValue> {
  const [list] = await tx
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)));
  if (!list) throw new Error('List not found.');
  const items = await tx
    .select()
    .from(listItems)
    .where(eq(listItems.listId, listId))
    .orderBy(asc(listItems.position));
  return {
    name: list.name,
    description: list.description ?? '',
    items: items.map((item) => item.mediaId),
  };
}
async function applyListValue(tx: Transaction, listId: string, value: ListValue) {
  await tx
    .update(lists)
    .set({ name: value.name, description: value.description, updatedAt: new Date() })
    .where(eq(lists.id, listId));
  await tx.delete(listItems).where(eq(listItems.listId, listId));
  const unique = [...new Set(value.items)];
  if (unique.length)
    await tx
      .insert(listItems)
      .values(unique.map((mediaId, position) => ({ listId, mediaId, position })));
}
async function exportLists(
  tx: Transaction,
  userId: string,
  listId: string,
  except?: string,
  deleted = false
) {
  const [config] = await tx.select().from(systemSettings).where(eq(systemSettings.key, 'coast'));
  if ((config?.value as { enableTrakt?: boolean } | undefined)?.enableTrakt === false) return;
  const connections = await tx
    .select({ connection: providerConnections })
    .from(providerConnections)
    .innerJoin(providerInstances, eq(providerInstances.id, providerConnections.instanceId))
    .where(
      and(
        eq(providerConnections.userId, userId),
        eq(providerConnections.status, 'connected'),
        eq(providerInstances.provider, 'trakt'),
        eq(providerInstances.enabled, true)
      )
    )
    .orderBy(asc(providerConnections.id));
  const [list] = await tx.select().from(lists).where(eq(lists.id, listId));
  for (const { connection } of connections) {
    if (connection.id === except || !(connection.settings.sync as Record<string, boolean>)?.lists)
      continue;
    const externalId =
      list.sourceConnectionId === connection.id
        ? list.externalId
        : (connection.settings.exportedLists as Record<string, string>)?.[listId];
    await enqueueInTransaction(tx, {
      userId,
      connectionId: connection.id,
      kind: deleted ? 'trakt.list-delete' : 'trakt.list-export',
      payload: { listId, ...(externalId ? { externalId } : {}) },
      compactionKey: `trakt-list:${listId}`,
    });
  }
}
export async function reconcileProviderList(
  userId: string,
  connectionId: string,
  listId: string,
  remote: ListValue,
  initial = false
) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    const [connection] = await tx
      .select({ id: providerConnections.id })
      .from(providerConnections)
      .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)));
    if (!connection) throw new Error('Connection does not belong to this account.');
    const local = await localListValue(tx, userId, listId);
    const [previous] = await tx
      .select()
      .from(syncListValues)
      .where(and(eq(syncListValues.connectionId, connectionId), eq(syncListValues.listId, listId)));
    let decision = remote.deleted
      ? 'conflict'
      : initial && !previous
        ? 'remote'
        : decideSync(local, remote, previous);
    const preference = await conflictPreference(tx, userId, connectionId);
    const [pending] = await tx
      .select({ id: syncListValues.id })
      .from(syncListValues)
      .where(and(eq(syncListValues.listId, listId), eq(syncListValues.conflict, true)))
      .limit(1);
    const automatic = (decision === 'conflict' || !!pending) && preference !== 'manual';
    if (!automatic && decision === 'remote') {
      await applyListValue(tx, listId, remote);
      await exportLists(tx, userId, listId, connectionId);
    }
    const agreed =
      decision === 'remote' || decision === 'agree' ? remote : (previous?.agreed ?? null);
    await tx
      .insert(syncListValues)
      .values({ connectionId, listId, remote, agreed, conflict: decision === 'conflict' })
      .onConflictDoUpdate({
        target: [syncListValues.connectionId, syncListValues.listId],
        set: { remote, agreed, conflict: decision === 'conflict', updatedAt: new Date() },
      });
    if (automatic) {
      const [entry] = await tx
        .update(syncListValues)
        .set({ conflict: true })
        .where(
          and(eq(syncListValues.connectionId, connectionId), eq(syncListValues.listId, listId))
        )
        .returning();
      await resolveListConflict(tx, userId, entry, preference === 'remote');
      decision = preference;
    }
    return decision;
  });
}
export async function resolveListConflict(
  tx: Transaction,
  userId: string,
  entry: typeof syncListValues.$inferSelect,
  remoteWins: boolean
) {
  if (!entry.conflict) return;
  const winning = remoteWins
    ? (entry.remote as ListValue)
    : await localListValue(tx, userId, entry.listId);
  if (winning.deleted) {
    await exportLists(tx, userId, entry.listId, undefined, true);
    await tx.delete(lists).where(eq(lists.id, entry.listId));
    return;
  }
  await applyListValue(tx, entry.listId, winning);
  // If Coast wins against a deleted remote list, recreate it on the next export.
  if (entry.remote.deleted) {
    await tx
      .update(providerConnections)
      .set({
        settings: sql`jsonb_set(${providerConnections.settings}, '{exportedLists}', coalesce(${providerConnections.settings}->'exportedLists','{}') - ${entry.listId}, true)`,
      })
      .where(eq(providerConnections.id, entry.connectionId));
    await tx
      .update(lists)
      .set({ externalId: null })
      .where(and(eq(lists.id, entry.listId), eq(lists.sourceConnectionId, entry.connectionId)));
  }
  await tx
    .update(syncListValues)
    .set({ conflict: false, agreed: winning, updatedAt: new Date() })
    .where(eq(syncListValues.listId, entry.listId));
  await exportLists(tx, userId, entry.listId);
}
export async function acknowledgeProviderList(
  connectionId: string,
  listId: string,
  value: ListValue
) {
  await getDb().transaction(async tx => {
    const [connection] = await tx.select().from(providerConnections).where(eq(providerConnections.id,connectionId));
    if(!connection)throw new Error('Connection not found.');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${connection.userId},0))`);
    const local=await localListValue(tx,connection.userId,listId);
    await tx.insert(syncListValues).values({connectionId,listId,remote:value,agreed:value}).onConflictDoUpdate({
      target:[syncListValues.connectionId,syncListValues.listId],
      set:{remote:value,agreed:value,...(sameValue(local,value)?{conflict:false}:{}),updatedAt:new Date()},
    });
  });
}
