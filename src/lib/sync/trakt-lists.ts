import { context } from '$lib/server/diagnostics';
import { correlationId } from '$lib/diagnostics';
import { reconcileProviderList, acknowledgeProviderList } from '$lib/sync/list-values';
import * as v from 'valibot';
import { and, eq, sql, asc } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
  media,
  lists,
  listItems,
  providerConnections,
  outboxActions,
  syncListValues,
} from '$lib/server/db/schema';
import { enqueueAction, PermanentActionError } from '$lib/server/queue';
import { getTrakt } from '$lib/providers/trakt/connection.server';
import type { SyncPreferences } from '$lib/providers/contracts';
import type { TraktAdapter } from '$lib/providers/trakt/adapter.server';
import {
  traktEntry,
  type TraktKind,
  type TraktIds,
  traktPlurals,
  exportIdentity,
} from '$lib/sync/trakt-identity';
import { resolveTrakt } from '$lib/catalogue/trakt-identity.server';

export async function queueTraktListChange(userId: string, listId: string) {
  const [list] = await getDb()
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)));
  if (!list) throw new Error('List not found.');
  if (list.playlist) return;
  const connections = await getDb()
    .select()
    .from(providerConnections)
    .where(
      and(eq(providerConnections.userId, userId), eq(providerConnections.status, 'connected'))
    );
  for (const connection of connections)
    if ((connection.settings.sync as Record<string, boolean> | undefined)?.lists)
      await enqueueAction({
        userId,
        connectionId: connection.id,
        kind: 'trakt.list-export',
        payload: { listId },
        compactionKey: `trakt-list:${listId}`,
      });
}

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
  if (remoteId)
    await context.adapter.updateList(
      remoteId,
      list.name,
      [list.description, `Coast reference: ${list.id}`].filter(Boolean).join('\n\n')
    );
  await exportTraktListToAdapter(userId, connectionId, input, context);
  const items = await getDb()
    .select()
    .from(listItems)
    .where(eq(listItems.listId, listId))
    .orderBy(asc(listItems.position));
  await acknowledgeProviderList(connectionId, listId, {
    name: list.name,
    description: list.description ?? '',
    items: items.map((item) => item.mediaId),
  });
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
  const [list] = await getDb()
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)));
  if (!list || list.playlist) return;
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
    await getDb()
      .update(providerConnections)
      .set({
        settings: sql`jsonb_set(${providerConnections.settings},'{exportedLists}',coalesce(${providerConnections.settings}->'exportedLists','{}'::jsonb)||jsonb_build_object(${list.id}::text,${remoteId}::text),true)`,
      })
      .where(eq(providerConnections.id, connectionId));
  }
  const local = await getDb()
    .select({ item: media, position: listItems.position })
    .from(listItems)
    .innerJoin(media, eq(media.id, listItems.mediaId))
    .where(eq(listItems.listId, listId))
    .orderBy(asc(listItems.position));
  const payload: Record<(typeof traktPlurals)[TraktKind], { ids: TraktIds }[]> = {
    movies: [],
    shows: [],
    seasons: [],
    episodes: [],
  };
  const desired: { kind: TraktKind; ids: TraktIds }[] = [];
  for (const row of local) {
    if (row.item.kind === 'collection') continue;
    const category = traktPlurals[row.item.kind];
    const ids = await exportIdentity(row.item.id, row.item.kind);
    if (row.item.kind === 'season' && !Object.keys(ids).length)
      throw new PermanentActionError('This season has no identity Trakt can match.');
    if (Object.keys(ids).length) {
      payload[category].push({ ids });
      desired.push({ kind: row.item.kind, ids });
    }
  }
  await adapter.writeList(remoteId, payload);
  const remote = await adapter.listItems(remoteId);
  const matches = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    ['trakt', 'tmdb', 'tvdb', 'imdb'].some(
      (key) => a[key] != null && b[key] != null && String(a[key]) === String(b[key])
    );
  const removed = {
    movies: [] as { ids: Record<string, unknown> }[],
    shows: [] as { ids: Record<string, unknown> }[],
    seasons: [] as { ids: Record<string, unknown> }[],
    episodes: [] as { ids: Record<string, unknown> }[],
  };
  for (const record of remote) {
    const entry = traktEntry(record);
    if (
      !entry ||
      desired.some(
        (wanted) => wanted.kind === entry.kind && matches(wanted.ids, entry.item.ids)
      )
    )
      continue;
    removed[traktPlurals[entry.kind]].push({
      ids: entry.item.ids,
    });
  }
  if (Object.values(removed).some((items) => items.length))
    await adapter.writeList(remoteId, removed, true);
  const rank = desired
    .map(
      (wanted) =>
        remote.find((record) => {
          const entry = traktEntry(record);
          return entry && wanted.kind === entry.kind && matches(wanted.ids, entry.item.ids);
        })?.id
    )
    .filter((id): id is number => id !== undefined);
  if (rank.length) await adapter.reorderList(remoteId, rank);
}

export async function deleteListWithExports(userId: string, listId: string) {
  return getDb().transaction(async (tx) => {
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
