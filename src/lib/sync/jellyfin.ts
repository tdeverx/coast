import {
  reconcileProviderValue,
  acknowledgeProviderValue,
  localSyncValue,
  sameValue,
} from '$lib/sync/values';
import { importJellyfinPlayback } from '$lib/sync/jellyfin-playback';
import { artworkKeys } from '$lib/artwork';
import * as v from 'valibot';
import { and, eq, isNull, ne, or, sql, desc } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
  availability,
  providerItems,
  syncCheckpoints,
  seasons,
  providerConnections,
  trackingState,
  outboxActions,
} from '$lib/server/db/schema';
import { notify } from '$lib/server/notifications';
import { getJellyfin } from '$lib/providers/jellyfin/connection.server';
import { ingestMetadata } from '$lib/catalogue/service';
import type { AvailableItem } from '$lib/providers/contracts';

export async function libraryScanProgress(userId: string, connectionId: string) {
  const { connection } = await getJellyfin(userId, connectionId);
  const [job] = await getDb()
    .select()
    .from(outboxActions)
    .where(
      and(
        eq(outboxActions.userId, userId),
        eq(outboxActions.connectionId, connectionId),
        eq(outboxActions.kind, 'jellyfin.scan')
      )
    )
    .orderBy(desc(outboxActions.createdAt))
    .limit(1);
  if (!job) return null;
  const parsed = v.safeParse(
    v.object({
      processed: v.number(),
      total: v.nullable(v.number()),
      startedAt: v.string(),
      phase: v.picklist(['scanning', 'reconciling', 'complete']),
    }),
    connection.settings.libraryScan
  );
  const current =
    parsed.success && new Date(parsed.output.startedAt) >= job.createdAt ? parsed.output : null;
  const [checkpoint] = current
    ? []
    : await getDb()
        .select()
        .from(syncCheckpoints)
        .where(
          and(
            eq(syncCheckpoints.connectionId, connectionId),
            eq(
              syncCheckpoints.kind,
              job.payload.full === false ? 'jellyfin-recent' : 'jellyfin-full'
            )
          )
        )
        .limit(1);
  const checkpointCount =
    checkpoint && checkpoint.updatedAt >= job.createdAt ? Number(checkpoint.cursor ?? 0) : 0;
  return {
    state: job.state,
    processed:
      current?.processed ?? (Number.isSafeInteger(checkpointCount) ? checkpointCount : 0),
    total: current?.total ?? null,
    phase: current?.phase ?? 'scanning',
    error: job.lastError,
    attempts: job.attempts,
  };
}

/** Resume at committed page boundaries; removal only occurs after a successful full traversal. */
export async function scanJellyfin(
  userId: string,
  connectionId: string,
  full = true,
  onStage?: (stage: string) => void
) {
  onStage?.('connection');
  const { adapter, connection, instance } = await getJellyfin(userId, connectionId);
  onStage?.('identity');
  await adapter.identity(instance.serverIdentity || undefined);
  onStage?.('checkpoint-read');
  const db = getDb(),
    kind = full ? 'jellyfin-full' : 'jellyfin-recent';
  const [checkpoint] = await db
    .select()
    .from(syncCheckpoints)
    .where(and(eq(syncCheckpoints.connectionId, connectionId), eq(syncCheckpoints.kind, kind)));
  const scanId =
    checkpoint?.cursor && checkpoint.scanId ? checkpoint.scanId : crypto.randomUUID();
  let offset = checkpoint?.cursor ? Number(checkpoint.cursor) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0) offset = 0;
  const since =
    !full && connection.settings.importPlayback !== true && checkpoint?.completedAt
      ? new Date(checkpoint.completedAt.getTime() - 60000).toISOString()
      : undefined;
  const startedAt = new Date().toISOString();
  async function report(processed: number, total: number | null, phase = 'scanning') {
    const progress = { processed, total, phase, startedAt };
    await db
      .update(providerConnections)
      .set({
        settings: sql`jsonb_set(${providerConnections.settings}, '{libraryScan}', ${progress}::jsonb, true)`,
      })
      .where(
        and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId))
      );
  }
  await report(offset, null);
  const visited = new Map<string, string>();
  let importPlayback = connection.settings.importPlayback === true;
  const importItem = async (
    item: AvailableItem,
    ancestry = new Set<string>()
  ): Promise<string> => {
    if (visited.has(item.id)) return visited.get(item.id)!;
    if (ancestry.has(item.id)) throw new Error('Jellyfin returned a cyclic media hierarchy.');
    ancestry.add(item.id);
    let showId: string | undefined, seasonId: string | undefined;
    if (item.kind === 'episode' || item.kind === 'season') {
      if (!item.showId) throw new Error('Jellyfin returned an item without its show identity.');
      const [parent] = await db
        .select()
        .from(providerItems)
        .where(
          and(
            eq(providerItems.instanceId, instance.id),
            eq(providerItems.externalId, item.showId)
          )
        )
        .limit(1);
      showId =
        parent?.mediaId ||
        (await importItem(
          await adapter.item(connection.externalUserId!, item.showId),
          ancestry
        ));
      if (item.kind === 'episode') {
        const [existing] = await db
          .select()
          .from(seasons)
          .where(
            and(eq(seasons.showId, showId), eq(seasons.seasonNumber, item.seasonNumber ?? 0))
          );
        if (existing) seasonId = existing.mediaId;
        else if (item.parentId)
          seasonId = await importItem(
            await adapter.item(connection.externalUserId!, item.parentId),
            ancestry
          );
      }
    }
    item.metadata.artwork = Object.fromEntries(
      artworkKeys.flatMap((type) => {
        const image = item.artwork?.[type];
        return image
          ? [
              [
                type,
                `/api/v1/artwork/${instance.id}/${encodeURIComponent(item.id)}/${type}?tag=${encodeURIComponent(image.tag)}&index=${image.index}`,
              ],
            ]
          : [];
      })
    );
    item.metadata.posterPath = item.metadata.artwork.primary;
    item.metadata.backdropPath = item.metadata.artwork.backdrop;
    const saved = await ingestMetadata(item.metadata, {
      instanceId: instance.id,
      showId,
      seasonId,
      isolateConflictingProviderIds: true,
    });
    visited.set(item.id, saved.id);
    const [providerItem] = await db
      .insert(providerItems)
      .values({
        instanceId: instance.id,
        externalId: item.id,
        kind: item.kind,
        mediaId: saved.id,
        snapshot: { ...item.metadata },
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [providerItems.instanceId, providerItems.externalId],
        set: { mediaId: saved.id, snapshot: { ...item.metadata }, lastSeenAt: new Date() },
      })
      .returning();
    const [wasAvailable] = await db
      .select({ id: availability.id })
      .from(availability)
      .where(
        and(
          eq(availability.userId, userId),
          eq(availability.mediaId, saved.id),
          eq(availability.state, 'available')
        )
      )
      .limit(1);
    const sources = item.sources.length
      ? item.sources
      : [
          {
            id: 'default',
            name: 'Original',
            container: undefined,
            bitrate: undefined,
            durationSeconds: item.metadata.runtimeMinutes
              ? item.metadata.runtimeMinutes * 60
              : undefined,
            streams: [],
            raw: {},
          },
        ];
    for (const source of sources) {
      const video = source.streams.find((s) => s.type === 'Video'),
        audio = source.streams.find((s) => s.type === 'Audio');
      const data = {
        userId,
        connectionId,
        providerItemId: providerItem.id,
        mediaId: saved.id,
        sourceId: source.id,
        edition: source.name,
        container: source.container,
        videoCodec: video?.codec,
        audioCodec: audio?.codec,
        bitrate: source.bitrate,
        width: video?.width,
        height: video?.height,
        durationSeconds: source.durationSeconds,
        source: { ...source.raw },
        state: 'available' as const,
        verifiedAt: new Date(),
        scanId,
      };
      await db
        .insert(availability)
        .values(data)
        .onConflictDoUpdate({
          target: [
            availability.userId,
            availability.connectionId,
            availability.providerItemId,
            availability.sourceId,
          ],
          set: data,
        });
    }
    if (!wasAvailable) {
      const [state] = await db
        .select()
        .from(trackingState)
        .where(and(eq(trackingState.userId, userId), eq(trackingState.mediaId, saved.id)));
      if (state?.watchlist)
        await notify({
          userId,
          kind: 'availability',
          title: `${saved.title} is available`,
          body: 'A title on your watchlist is now in your library.',
          sourceKey: `available:${saved.id}`,
        });
    }
    if (importPlayback) await importJellyfinPlayback(userId, connectionId, saved.id, item);
    return saved.id;
  };
  let count = 0;
  for (;;) {
    onStage?.('library-page');
    const [current] = await db
      .select({ settings: providerConnections.settings })
      .from(providerConnections)
      .where(eq(providerConnections.id, connectionId));
    importPlayback = current?.settings.importPlayback === true;
    const page = await adapter.library(
      connection.externalUserId!,
      offset,
      importPlayback ? undefined : since
    );
    await report(offset, page.total);
    onStage?.('item-import');
    for (const [index, item] of page.items.entries()) {
      await importItem(item);
      count++;
      if ((index + 1) % 25 === 0 || index === page.items.length - 1)
        await report(offset + index + 1, page.total);
    }
    onStage?.('checkpoint-write');
    await db
      .insert(syncCheckpoints)
      .values({
        connectionId,
        kind,
        cursor: page.nextOffset === null ? null : String(page.nextOffset),
        scanId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [syncCheckpoints.connectionId, syncCheckpoints.kind],
        set: {
          cursor: page.nextOffset === null ? null : String(page.nextOffset),
          scanId,
          updatedAt: new Date(),
        },
      });
    if (page.nextOffset === null) {
      await report(offset + page.items.length, page.total, 'reconciling');
      break;
    }
    offset = page.nextOffset;
  }
  onStage?.('reconcile');
  await db.transaction(async (tx) => {
    if (full)
      await tx
        .update(availability)
        .set({ state: 'unavailable', verifiedAt: new Date() })
        .where(
          and(
            eq(availability.userId, userId),
            eq(availability.connectionId, connectionId),
            or(ne(availability.scanId, scanId), isNull(availability.scanId))
          )
        );
    await tx
      .update(syncCheckpoints)
      .set({ cursor: null, scanId: null, completedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(syncCheckpoints.connectionId, connectionId), eq(syncCheckpoints.kind, kind))
      );
  });
  onStage?.('complete');
  await db
    .update(providerConnections)
    .set({
      settings: sql`jsonb_set(${providerConnections.settings}, '{libraryScan,phase}', '"complete"'::jsonb, true)`,
    })
    .where(eq(providerConnections.id, connectionId));
  return { count, full };
}

export async function executeJellyfinUserState(
  userId: string,
  connectionId: string,
  input: Record<string, unknown>
) {
  const data = v.parse(
    v.object({
      mediaId: v.pipe(v.string(), v.uuid()),
      field: v.picklist(['watched', 'favourite', 'progress']),
      value: v.union([v.boolean(), v.pipe(v.number(), v.minValue(0))]),
      durationSeconds: v.optional(v.number()),
    }),
    input
  );
  const { adapter, connection } = await getJellyfin(userId, connectionId);
  const items = await getDb()
    .selectDistinct({ id: providerItems.externalId })
    .from(availability)
    .innerJoin(providerItems, eq(providerItems.id, availability.providerItemId))
    .where(
      and(
        eq(availability.userId, userId),
        eq(availability.connectionId, connectionId),
        eq(availability.mediaId, data.mediaId),
        eq(availability.state, 'available')
      )
    );
  const category = data.field === 'watched' ? 'history' : data.field;
  const desired =
    category === 'progress'
      ? { positionSeconds: Number(data.value), durationSeconds: data.durationSeconds ?? 0 }
      : { value: Boolean(data.value) };
  const current = await getDb().transaction((tx) =>
    localSyncValue(tx, userId, data.mediaId, category)
  );
  if (!sameValue(current, desired)) return;
  for (const item of items) {
    const remote = (await adapter.item(connection.externalUserId!, item.id)).userData;
    if (remote) {
      const decision = await reconcileProviderValue(
        userId,
        connectionId,
        data.mediaId,
        category,
        category === 'progress'
          ? {
              positionSeconds: Math.round(remote.positionSeconds * 1000) / 1000,
              durationSeconds: data.durationSeconds ?? 0,
            }
          : { value: data.field === 'watched' ? remote.played : (remote.favourite ?? false) },
        { source: 'jellyfin' }
      );
      if (decision === 'conflict' || decision === 'remote') return;
    }
    if (data.field === 'progress')
      await adapter.setProgress(connection.externalUserId!, item.id, Number(data.value));
    else
      await adapter.setUserState(
        connection.externalUserId!,
        item.id,
        data.field,
        Boolean(data.value)
      );
  }
  await acknowledgeProviderValue(userId, connectionId, data.mediaId, category, desired);
}

export async function executeJellyfinScrobble(
  userId: string,
  connectionId: string,
  input: Record<string, unknown>
) {
  const data = v.parse(
    v.object({
      sessionId: v.pipe(v.string(), v.uuid()),
      event: v.picklist(['start', 'progress', 'stop']),
      positionSeconds: v.pipe(v.number(), v.minValue(0)),
      paused: v.optional(v.boolean()),
    }),
    input
  );
  const { playbackSessions } = await import('$lib/server/db/schema');
  const [session] = await getDb()
    .select()
    .from(playbackSessions)
    .where(
      and(
        eq(playbackSessions.id, data.sessionId),
        eq(playbackSessions.userId, userId),
        eq(playbackSessions.connectionId, connectionId)
      )
    );
  if (!session) return;
  const [item] = await getDb()
    .select()
    .from(providerItems)
    .where(eq(providerItems.id, session.providerItemId));
  if (!item) return;
  const { adapter } = await getJellyfin(userId, connectionId);
  await adapter.scrobble(data.event, {
    itemId: item.externalId,
    sourceId: session.sourceId,
    playSessionId: session.providerSessionId || undefined,
    positionSeconds: data.positionSeconds,
    paused: data.paused,
    method: session.delivery === 'direct' ? 'DirectPlay' : 'Transcode',
  });
}
