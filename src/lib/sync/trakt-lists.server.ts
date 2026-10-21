import { context } from '#lib/server/diagnostics/index.js';
import { correlationId } from '#lib/diagnostics.js';
import { reconcileProviderList, acknowledgeProviderList } from '#lib/sync/list-values.server.js';
import * as v from 'valibot';
import { and, eq, sql, asc } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import {
  media,
  lists,
  listItems,
  providerConnections,
  outboxActions,
  syncListValues,
} from '#lib/server/db/schema.js';
import { PermanentActionError } from '#lib/server/queue/index.js';
import { getTrakt } from '#lib/providers/trakt/connection.server.js';
import type { SyncPreferences } from '#lib/providers/contracts.js';
import type { TraktAdapter } from '#lib/providers/trakt/adapter.server.js';
import {
  traktEntry,
  type TraktKind,
  type TraktIds,
  traktPlurals,
  exportIdentities,
} from '#lib/sync/trakt-identity.server.js';
import { resolveTrakt } from '#lib/catalogue/trakt-identity.server.js';
import { matchTraktList } from './trakt-list-matching';

export async function executeTraktListExport(
  userId: string,
  connectionId: string,
  input: Record<string, unknown>
) {
  const { listId } = v.parse(v.object({ listId: v.pipe(v.string(), v.uuid()) }), input);
  const context = await getTrakt(userId, connectionId);
  if (!context.sync.lists) return;
  const [list] = await getDb()
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)));
  if (!list || list.playlist) return;
  const [pending] = await getDb()
    .select()
    .from(syncListValues)
    .where(
      and(
        eq(syncListValues.connectionId, connectionId),
        eq(syncListValues.listId, listId),
        eq(syncListValues.conflict, true)
      )
    );
  if (pending) return;
  const remoteId =
    (list.sourceConnectionId === connectionId ? list.externalId : null) ||
    (context.connection.settings.exportedLists as Record<string, string>)?.[listId];
  if (remoteId) {
    const remote = (await context.adapter.lists()).find(
      (entry) => String(entry.ids.trakt) === remoteId
    );
    const members: string[] = [];
    if (remote)
      for (const record of await context.adapter.listItems(remoteId)) {
        const item = await resolveTrakt(record);
        if (item) members.push(item.id);
      }
    const decision = await reconcileProviderList(userId, connectionId, listId, {
      name: remote?.name ?? list.name,
      description: (remote?.description ?? '')
        .split('\n')
        .filter((line) => !line.startsWith('Coast reference: '))
        .join('\n')
        .trim(),
      items: members,
      ...(!remote ? { deleted: true } : {}),
    });
    if (decision === 'conflict' || decision === 'remote') return;
  }
  const sent = await exportTraktListToAdapter(userId, connectionId, input, context);
  if (sent) await acknowledgeProviderList(connectionId, listId, sent, context.connection.accountGeneration);
}

/** The public entrypoint supplies the authenticated account; fixtures use the same reconciliation. */
export async function exportTraktListToAdapter(
  userId: string,
  connectionId: string,
  input: Record<string, unknown>,
  {
    adapter,
    sync,
    connection,
  }: {
    adapter: TraktAdapter;
    sync: SyncPreferences;
    connection: typeof providerConnections.$inferSelect;
  }
) {
  const { listId } = v.parse(v.object({ listId: v.pipe(v.string(), v.uuid()) }), input);
  if (connection.id !== connectionId || connection.userId !== userId)
    throw new PermanentActionError('The Trakt connection does not belong to this account.');
  if (!sync.lists) return;
  // Capture metadata and ordered membership together. Network requests must
  // never acknowledge a later local edit as if it had been transmitted.
  const snapshot = await getDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
    const [list] = await tx.select().from(lists)
      .where(and(eq(lists.id,listId),eq(lists.userId,userId))).for('update');
    if (!list || list.playlist) return null;
    const local = await tx.select({ item: media, position: listItems.position }).from(listItems)
      .innerJoin(media,eq(media.id,listItems.mediaId)).where(eq(listItems.listId,listId))
      .orderBy(asc(listItems.position));
    return { list, local };
  });
  if (!snapshot) return;
  const { list, local } = snapshot;
  const marker = `Coast reference: ${list.id}`;
  let remoteId =
    (list.source === 'trakt' && list.sourceConnectionId === connectionId
      ? list.externalId
      : null) ||
    (connection.settings.exportedLists as Record<string, string> | undefined)?.[list.id];
  if (!remoteId) {
    const existing = (await adapter.lists()).find((remote) =>
      remote.description?.split('\n').includes(marker)
    );
    remoteId = existing
      ? String(existing.ids.trakt)
      : String(
          (
            await adapter.createList(
              list.name,
              [list.description, marker].filter(Boolean).join('\n\n')
            )
          ).ids.trakt
        );
    if (existing) await adapter.updateList(remoteId,list.name,[list.description,marker].filter(Boolean).join('\n\n'));
    await getDb()
      .update(providerConnections)
      .set({
        settings: sql`jsonb_set(${providerConnections.settings},'{exportedLists}',coalesce(${providerConnections.settings}->'exportedLists','{}'::jsonb)||jsonb_build_object(${list.id}::text,${remoteId}::text),true)`,
      })
      .where(eq(providerConnections.id, connectionId));
  }
  else await adapter.updateList(remoteId,list.name,[list.description,marker].filter(Boolean).join('\n\n'));
  const payload: Record<(typeof traktPlurals)[TraktKind], { ids: TraktIds }[]> = {
    movies: [],
    shows: [],
    seasons: [],
    episodes: [],
  };
  const desired: { kind: TraktKind; ids: TraktIds }[] = [];
  const exportable=local.flatMap(({item})=>item.kind==='collection'?[]:[{id:item.id,kind:item.kind}]);
  const identities=await exportIdentities(exportable.map(item=>({mediaId:item.id,kind:item.kind})));
  for (const [index, item] of exportable.entries()) {
    const category = traktPlurals[item.kind];
    const ids = identities[index];
    if (!Object.keys(ids).length)
      throw new PermanentActionError('This list contains a title with no identity Trakt can match.');
    if (Object.keys(ids).length) {
      payload[category].push({ ids });
      desired.push({ kind: item.kind, ids });
    }
  }
  await adapter.writeList(remoteId, payload);
  const remote = await adapter.listItems(remoteId);
  const matched = matchTraktList(desired, remote.flatMap(record => {
    const entry = traktEntry(record);
    return entry ? [{ kind: entry.kind, ids: entry.item.ids, rankId: record.id }] : [];
  }));
  const removed = {
    movies: [] as { ids: Record<string, unknown> }[],
    shows: [] as { ids: Record<string, unknown> }[],
    seasons: [] as { ids: Record<string, unknown> }[],
    episodes: [] as { ids: Record<string, unknown> }[],
  };
  for (const entry of matched.removed) {
    removed[traktPlurals[entry.kind]].push({
      ids: entry.ids,
    });
  }
  if (Object.values(removed).some((items) => items.length))
    await adapter.writeList(remoteId, removed, true);
  const rank = matched.matches
    .map(entry => entry?.rankId)
    .filter((id): id is number => id !== undefined);
  if (rank.length !== desired.length) throw new PermanentActionError('Trakt did not retain every exported list item. Review the title identities before retrying.');
  if (rank.length) await adapter.reorderList(remoteId, rank);
  return {name:list.name,description:list.description ?? '',items:local.filter(row=>row.item.kind!=='collection').map(row=>row.item.id)};
}

export async function deleteListWithExports(userId: string, listId: string) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
    const [list] = await tx
      .select()
      .from(lists)
      .where(
        and(
          eq(lists.userId, userId),
          eq(lists.id, v.parse(v.pipe(v.string(), v.uuid()), listId))
        )
      );
    if (!list) throw new Error('List not found.');
    if (list.playlist) {
      await tx.delete(lists).where(eq(lists.id, list.id));
      return { deleted: true };
    }
    const connections = await tx
      .select()
      .from(providerConnections)
      .where(
        and(eq(providerConnections.userId, userId), eq(providerConnections.status, 'connected'))
      )
      .orderBy(asc(providerConnections.id));
    for (const connection of connections) {
      if (!(connection.settings.sync as Record<string, boolean> | undefined)?.lists) continue;
      const externalId =
        list.source === 'trakt' && list.sourceConnectionId === connection.id
          ? list.externalId
          : (connection.settings.exportedLists as Record<string, string> | undefined)?.[
              list.id
            ];
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${userId}:${connection.id}`},0))`
      );
      await tx
        .update(outboxActions)
        .set({ state: 'cancelled', updatedAt: new Date() })
        .where(
          and(
            eq(outboxActions.connectionId, connection.id),
            eq(outboxActions.kind, 'trakt.list-export'),
            eq(outboxActions.state, 'pending'),
            sql`${outboxActions.payload}->>'listId'=${list.id}`
          )
        );
      // A running create can finish after local deletion; the tombstone resolves its stable marker at dispatch.
      await tx.insert(outboxActions).values({
        correlationId: correlationId(context.getStore()),
        userId,
        connectionId: connection.id,
        kind: 'trakt.list-delete',
        payload: { listId: list.id, ...(externalId ? { externalId } : {}) },
        createdAt: sql`clock_timestamp()`,
      });
    }
    await tx.delete(lists).where(eq(lists.id, list.id));
    return { deleted: true };
  });
}
