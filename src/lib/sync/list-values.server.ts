import { conflictPreference } from './preference.server';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type Database } from '$lib/server/db';
import {
  lists,
  listItems,
  providerConnections,
  providerInstances,
  syncListValues,
  systemSettings,
  media,
} from '$lib/server/db/schema';
import { decideSync, sameValue } from './values.server';
import { enqueueInTransaction } from './changes.server';
import { assertJobLease } from '$lib/server/queue/execution';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type ListValue = { name: string; description: string; items: string[]; deleted?: boolean };
/** Provider list comparisons cover only kinds Trakt can represent. */
export function projectProviderList(value: ListValue, supported: ReadonlySet<string>): ListValue {
  return {...value,items:value.items.filter(id=>supported.has(id))};
}

/** Replace supported slots while preserving every unsupported local member and
 * its order relative to the other unsupported members. */
export function mergeProviderListItems(current: string[], remote: string[], supported: ReadonlySet<string>) {
  const pending = [...new Set(remote.filter(id=>supported.has(id)))];
  let next = 0;
  const merged = current.flatMap(id=>supported.has(id) ? next<pending.length ? [pending[next++]] : [] : [id]);
  return [...merged,...pending.slice(next)];
}

async function supportedListItems(tx: Transaction, ids: string[]) {
  const unique = [...new Set(ids)], supported = new Set<string>();
  for (let start=0; start<unique.length; start+=1000) {
    const rows = await tx.select({id:media.id}).from(media)
      .where(and(inArray(media.id,unique.slice(start,start+1000)),inArray(media.kind,['movie','show','season','episode'])));
    for (const row of rows) supported.add(row.id);
  }
  return supported;
}

export async function projectProviderListInTransaction(tx: Transaction, value: ListValue) {
  return projectProviderList(value,await supportedListItems(tx,value.items));
}

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
  const current = await tx.select({id:listItems.mediaId}).from(listItems)
    .where(eq(listItems.listId,listId)).orderBy(asc(listItems.position));
  const supported = await supportedListItems(tx,[...current.map(row=>row.id),...value.items]);
  const merged = mergeProviderListItems(current.map(row=>row.id),value.items,supported);
  await tx
    .update(lists)
    .set({ name: value.name, description: value.description, updatedAt: new Date() })
    .where(eq(lists.id, listId));
  await tx.delete(listItems).where(eq(listItems.listId, listId));
  const unique = [...new Set(merged)];
  // Keep one atomic replacement while bounding PostgreSQL statement size for
  // large imported lists. Positions remain relative to the complete snapshot.
  for(let start=0;start<unique.length;start+=1000)
    await tx
      .insert(listItems)
      .values(unique.slice(start,start+1000).map((mediaId, position) => ({ listId, mediaId, position:start+position })));
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
  initial = false,
  options: { accountGeneration?:string; initialSnapshot?:Pick<ListValue,'name'|'description'>; onReconciled?:(tx:Transaction,decision:'agree'|'local'|'remote'|'conflict')=>Promise<void> } = {}
) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    const [connection] = await tx
      .select({ id: providerConnections.id, accountGeneration:providerConnections.accountGeneration,status:providerConnections.status })
      .from(providerConnections)
      .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId))).for('update');
    if (!connection) throw new Error('Connection does not belong to this account.');
    await assertJobLease(tx,true);
    if(options.accountGeneration&&(connection.accountGeneration!==options.accountGeneration||connection.status!=='connected'))throw new Error('The connected account changed before list reconciliation.');
    const fullLocal = await localListValue(tx, userId, listId);
    const [saved] = await tx
      .select()
      .from(syncListValues)
      .where(and(eq(syncListValues.connectionId, connectionId), eq(syncListValues.listId, listId)));
    const supported = await supportedListItems(tx,[...fullLocal.items,...remote.items,
      ...((saved?.remote as ListValue | undefined)?.items ?? []),...((saved?.agreed as ListValue | null)?.items ?? [])]);
    const local = projectProviderList(fullLocal,supported);
    remote = projectProviderList(remote,supported);
    const previous = saved ? {...saved,remote:projectProviderList(saved.remote as ListValue,supported),
      agreed:saved.agreed ? projectProviderList(saved.agreed as ListValue,supported) : null} : undefined;
    const untouchedInitial=initial&&(!options.initialSnapshot||(!local.items.length&&local.name===options.initialSnapshot.name&&local.description===options.initialSnapshot.description));
    let decision:'agree'|'local'|'remote'|'conflict' = remote.deleted
      ? previous?.agreed?.deleted && !local.items.length ? 'agree' : 'conflict'
      : untouchedInitial && !previous
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
    await options.onReconciled?.(tx,decision);
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
  const local = await localListValue(tx,userId,entry.listId);
  const supported = await supportedListItems(tx,[...local.items,...((entry.remote as ListValue).items)]);
  const winning = projectProviderList(remoteWins ? entry.remote as ListValue : local,supported);
  if (winning.deleted) {
    await exportLists(tx, userId, entry.listId, undefined, true);
    if (local.items.every(id=>supported.has(id))) {
      await tx.delete(lists).where(eq(lists.id, entry.listId));
    } else {
      // Deleting the provider's projection cannot delete unrelated Coast works.
      await applyListValue(tx,entry.listId,{...local,items:[]});
      await tx.update(providerConnections).set({settings:sql`jsonb_set(${providerConnections.settings},'{exportedLists}',coalesce(${providerConnections.settings}->'exportedLists','{}')-${entry.listId},true)`})
        .where(eq(providerConnections.userId,userId));
      await tx.update(lists).set({externalId:null}).where(eq(lists.id,entry.listId));
      await tx.update(syncListValues).set({conflict:false,agreed:winning,updatedAt:new Date()}).where(eq(syncListValues.listId,entry.listId));
    }
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
  value: ListValue,
  accountGeneration?: string
) {
  await getDb().transaction(async tx => {
    const [connection] = await tx.select().from(providerConnections).where(eq(providerConnections.id,connectionId));
    if(!connection)throw new Error('Connection not found.');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${connection.userId},0))`);
    const [current]=await tx.select().from(providerConnections).where(eq(providerConnections.id,connectionId)).for('update');
    if(!current || accountGeneration && (current.accountGeneration!==accountGeneration || current.status!=='connected'))
      throw new Error('The connected account changed before list acknowledgement.');
    await assertJobLease(tx,true);
    const fullLocal=await localListValue(tx,connection.userId,listId);
    const supported=await supportedListItems(tx,[...fullLocal.items,...value.items]);
    const local=projectProviderList(fullLocal,supported);
    value=projectProviderList(value,supported);
    await tx.insert(syncListValues).values({connectionId,listId,remote:value,agreed:value}).onConflictDoUpdate({
      target:[syncListValues.connectionId,syncListValues.listId],
      set:{remote:value,agreed:value,...(sameValue(local,value)?{conflict:false}:{}),updatedAt:new Date()},
    });
  });
}
