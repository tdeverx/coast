import { context } from '$lib/server/diagnostics';
import { correlationId } from '$lib/diagnostics';
import { conflictPreference } from '$lib/sync/preference';
import * as v from 'valibot';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '$lib/server/db';
import {
  providerInstances,
  providerConnections,
  mediaRequests,
  media,
  externalIds,
  outboxActions,
  syncValues,
} from '$lib/server/db/schema';
import { getConfig } from '$lib/server/config';
import { enqueueAction } from '$lib/server/queue';
import {
  SeerrAdapter,
  groupDestination,
  seerrAllows,
  SeerrPermission,
} from '$lib/providers/seerr/adapter.server';
import { ProviderActionError, type DiscoverKind } from '$lib/providers/contracts';
import { notify } from '$lib/server/notifications';
import { trackInTransaction } from '$lib/core/tracking/service';
import { getInstance, instanceFetchConfig } from '$lib/providers/instances.server';
import { connectionFor } from '$lib/providers/connections.server';
import { getSeerr, assertSeerrAccount } from '$lib/providers/seerr/connection.server';
import { ProviderHttpError } from '$lib/server/security/provider-fetch';

const uuid = v.pipe(v.string(), v.uuid());

type RequestOption = ReturnType<typeof groupDestination>[number] & {
  instanceId: string;
  connectionId: string;
  permissions: number;
  externalUserId: number;
  seasons: Awaited<ReturnType<SeerrAdapter['details']>>['seasons'];
  existing: Awaited<ReturnType<SeerrAdapter['details']>>['mediaInfo'];
  variants: { standard: RequestVariant | null; fourK: RequestVariant | null };
};

type RequestVariant = {
  serverId: number;
  requestable: boolean;
  seasons: { number: number; requested: boolean; mine: boolean; available: boolean }[];
};

type RequestCache = {
  at: number;
  linkedInstanceId: string;
  linkedUserId: string;
  options: RequestOption[];
};

export async function requestOptions(userId: string, mediaId: string) {
  if (!(await getConfig()).enableRequests) return [];
  const [item] = await getDb().select().from(media).where(eq(media.id, mediaId));
  const [mapping] = await getDb()
    .select()
    .from(externalIds)
    .where(and(eq(externalIds.mediaId, mediaId), eq(externalIds.provider, 'tmdb')));
  if (!item || !mapping || !['movie', 'show'].includes(item.kind)) return [];
  const instances = await getDb()
    .select()
    .from(providerInstances)
    .where(and(eq(providerInstances.provider, 'seerr'), eq(providerInstances.enabled, true)));
  const options: RequestOption[] = [];
  for (const instance of instances)
    try {
      const { adapter, account, connection, linkedJellyfinUserId } = await getSeerr(
          userId,
          instance.id
        ),
        kind = item.kind as DiscoverKind;
      const [servers, details, local] = await Promise.all([
        adapter.servers(kind),
        adapter.details(kind, Number(mapping.externalId)),
        getDb()
          .select()
          .from(mediaRequests)
          .where(
            and(
              eq(mediaRequests.mediaId, mediaId),
              eq(mediaRequests.instanceId, instance.id),
              sql`${mediaRequests.state} in ('pending','approved','available')`
            )
          ),
      ]);
      const destinations = groupDestination(
        instance.id,
        instance.name,
        servers,
        account.permissions,
        kind
      );
      const verified: RequestOption[] = [];
      for (const destination of destinations) {
        const variant = (is4k: boolean, serverId: number | undefined) => {
          if (serverId === undefined || (is4k && !destination.can4k)) return null;
          const requested = (details.mediaInfo?.requests || []).filter(
            (r) =>
              r.status !== 3 &&
              r.is4k === is4k &&
              (r.serverId == null || r.serverId === serverId)
          );
          const pending = local.filter((r) => r.is4k === is4k && r.serverId === serverId);
          const seasons = details.seasons
            .filter((s) => s.episodeCount > 0)
            .map((s) => {
              const remote = requested.filter((r) =>
                r.seasons.some(
                  (season) => season.seasonNumber === s.seasonNumber && season.status !== 3
                )
              );
              const localScope = pending.filter((r) => r.seasons.includes(s.seasonNumber));
              return {
                number: s.seasonNumber,
                requested: remote.length > 0 || localScope.length > 0,
                mine:
                  remote.some((r) => r.requestedBy?.id === account.id) ||
                  localScope.some((r) => r.userId === userId),
                available: !!details.mediaInfo?.seasons.some(
                  (n) =>
                    n.seasonNumber === s.seasonNumber && (is4k ? n.status4k : n.status) === 5
                ),
              };
            });
          const requestable =
            kind === 'show'
              ? seasons.some((s) => !s.requested && !s.available)
              : !requested.length &&
                !pending.length &&
                (is4k ? details.mediaInfo?.status4k : details.mediaInfo?.status) !== 5;
          return { serverId, requestable, seasons };
        };
        const standard = variant(false, destination.standardServerId),
          fourK = variant(true, destination.fourKServerId);
        if (!standard?.requestable && !fourK?.requestable) continue;
        verified.push({
          ...destination,
          instanceId: instance.id,
          connectionId: connection.id,
          permissions: account.permissions,
          externalUserId: account.id,
          seasons: details.seasons,
          existing: details.mediaInfo,
          variants: { standard, fourK },
        });
      }
      options.push(...verified);
      const [saved] = await getDb()
        .select()
        .from(providerConnections)
        .where(eq(providerConnections.id, connection.id));
      const cache = Object.fromEntries(
        Object.entries(
          (saved.settings.requestOptionsCache as Record<string, RequestCache>) || {}
        )
          .filter(([id, entry]) => id !== mediaId && Date.now() - entry.at < 30 * 60000)
          .slice(-19)
      );
      cache[mediaId] = {
        at: Date.now(),
        linkedInstanceId: instance.linkedMediaInstanceId!,
        linkedUserId: linkedJellyfinUserId,
        options: verified,
      };
      await getDb()
        .update(providerConnections)
        .set({
          settings: sql`${providerConnections.settings} || ${{ requestOptionsCache: cache }}::jsonb`,
        })
        .where(eq(providerConnections.id, connection.id));
    } catch (error) {
      // A recently verified dialog can still create durable work during an outage. Dispatch always rechecks it.
      const status = (error as { status?: number }).status;
      if (
        error instanceof ProviderActionError ||
        error instanceof v.ValiError ||
        (status !== undefined && status !== 429 && status < 500)
      )
        continue;
      try {
        await instanceFetchConfig(instance);
        const [connection] = await getDb()
          .select()
          .from(providerConnections)
          .where(
            and(
              eq(providerConnections.userId, userId),
              eq(providerConnections.instanceId, instance.id),
              eq(providerConnections.status, 'connected')
            )
          );
        const cached = (
          connection?.settings.requestOptionsCache as Record<string, RequestCache> | undefined
        )?.[mediaId];
        if (
          !cached ||
          Date.now() - cached.at > 30 * 60000 ||
          cached.linkedInstanceId !== instance.linkedMediaInstanceId
        )
          continue;
        await getInstance(cached.linkedInstanceId, 'jellyfin');
        const [linked] = await getDb()
          .select()
          .from(providerConnections)
          .where(
            and(
              eq(providerConnections.userId, userId),
              eq(providerConnections.instanceId, cached.linkedInstanceId),
              eq(providerConnections.status, 'connected'),
              eq(providerConnections.externalUserId, cached.linkedUserId)
            )
          );
        if (linked) options.push(...cached.options);
      } catch {
        /* Revoked policy or a missing verified account cannot use cached capabilities. */
      }
    }
  return options;
}

export async function requestMedia(userId: string, input: unknown) {
  const data = v.parse(
    v.object({
      mediaId: uuid,
      instanceId: uuid,
      is4k: v.optional(v.boolean(), false),
      seasons: v.optional(v.array(v.pipe(v.number(), v.integer(), v.minValue(0))), []),
      addToWatchlist: v.optional(v.boolean(), true),
    }),
    input
  );
  const duplicate = async () => {
    const existing = await getDb()
      .select()
      .from(mediaRequests)
      .where(
        and(
          eq(mediaRequests.userId, userId),
          eq(mediaRequests.mediaId, data.mediaId),
          eq(mediaRequests.instanceId, data.instanceId),
          eq(mediaRequests.is4k, data.is4k),
          sql`${mediaRequests.state} in ('pending','approved','available')`
        )
      );
    return existing.find((r) =>
      data.seasons.length
        ? data.seasons.every((n) => r.seasons.includes(n))
        : r.seasons.length === 0
    );
  };
  const prior = await duplicate();
  if (prior) return prior;
  const options = await requestOptions(userId, data.mediaId),
    destination = options.find((x) => x.instanceId === data.instanceId);
  if (!destination || (data.is4k && !destination.can4k)) {
    const existing = await duplicate();
    if (existing) return existing;
    throw new Error('This destination is not available for your account.');
  }
  const { connection } = await connectionFor(userId, destination.connectionId, 'seerr'),
    serverId = data.is4k ? destination.fourKServerId : destination.standardServerId;
  if (serverId === undefined) throw new Error('This quality variant is not configured.');
  const [item] = await getDb().select().from(media).where(eq(media.id, data.mediaId));
  const requested = [...new Set(data.seasons)].sort((a, b) => a - b);
  if (
    item.kind === 'show' &&
    (!requested.length ||
      requested.some(
        (n) => !destination.seasons.some((s) => s.seasonNumber === n && s.episodeCount > 0)
      ))
  )
    throw new Error('Choose at least one valid season.');
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`request:${data.mediaId}:${data.instanceId}:${serverId}:${data.is4k}`},0))`
    );
    const existing = await tx
      .select()
      .from(mediaRequests)
      .where(
        and(
          eq(mediaRequests.mediaId, data.mediaId),
          eq(mediaRequests.instanceId, data.instanceId),
          eq(mediaRequests.serverId, serverId),
          eq(mediaRequests.is4k, data.is4k),
          sql`${mediaRequests.state} in ('pending','approved','available')`
        )
      );
    const remote = (destination.existing?.requests || []).filter(
      (r) =>
        r.status !== 3 &&
        r.is4k === data.is4k &&
        (r.serverId == null || r.serverId === serverId)
    );
    const taken = new Set([
      ...existing.flatMap((r) => r.seasons),
      ...remote.flatMap((r) =>
        r.seasons.filter((s) => s.status !== 3).map((s) => s.seasonNumber)
      ),
      ...(destination.existing?.seasons || [])
        .filter((s) => (data.is4k ? s.status4k : s.status) === 5)
        .map((s) => s.seasonNumber),
    ]);
    const remaining = requested.filter((n) => !taken.has(n));
    if (
      !existing.length &&
      ((item.kind === 'movie' &&
        (remote.length ||
          (data.is4k ? destination.existing?.status4k : destination.existing?.status) === 5)) ||
        (item.kind === 'show' && !remaining.length))
    )
      throw new Error('This version or season selection is already available or requested.');
    if (existing.length && (item.kind === 'movie' || !remaining.length)) {
      const mine = existing.find((r) => r.userId === userId);
      if (mine) return mine;
      throw new Error('This version or season selection has already been requested.');
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${userId}:${connection.id}`},0))`
    );
    const [request] = await tx
      .insert(mediaRequests)
      .values({
        userId,
        mediaId: data.mediaId,
        instanceId: data.instanceId,
        is4k: data.is4k,
        seasons: remaining,
        serverId,
        state: 'pending',
      })
      .returning();
    await tx.insert(outboxActions).values({
      correlationId: correlationId(context.getStore()),
      userId,
      connectionId: connection.id,
      kind: 'seerr.request',
      payload: { requestId: request.id },
      createdAt: sql`clock_timestamp()`,
    });
    if (data.addToWatchlist)
      await trackInTransaction(tx, userId, {
        mediaId: data.mediaId,
        action: 'watchlist',
        value: true,
      });
    return request;
  });
}

export async function refreshRequests(userId: string, instanceId: string,expected?:{connectionId:string;accountGeneration:string}) {
  const { adapter, connection,account,scope } = await getSeerr(userId, instanceId,expected);
  type Tx=Parameters<Parameters<Database['transaction']>[0]>[0];
  const guarded=<T>(work:(tx:Tx)=>Promise<T>)=>getDb().transaction(async tx=>{await assertSeerrAccount(tx,scope);return work(tx);});
  const { importTmdb } = await import('$lib/catalogue/service');
  const seen = new Set<string>();
  for (let offset = 0; ; offset += 100) {
    await guarded(async()=>{});
    const page = await adapter.requests(offset,false,account);
    await guarded(async()=>{});
    for (const remote of page.results) {
      seen.add(String(remote.id));
      const [local] = await getDb()
        .select()
        .from(mediaRequests)
        .where(
          and(
            eq(mediaRequests.userId, userId),
            eq(mediaRequests.instanceId, instanceId),
            eq(mediaRequests.externalId, String(remote.id))
          )
        )
        .limit(1);
      const available = (remote.is4k ? remote.media?.status4k : remote.media?.status) === 5;
      const state = available
        ? 'available'
        : remote.status === 2
          ? 'approved'
          : remote.status === 3
            ? 'declined'
            : 'pending';
      if (local) {
        if (local.state !== state) {
          await guarded(tx=>tx
            .update(mediaRequests)
            .set({ state, updatedAt: new Date() })
            .where(eq(mediaRequests.id, local.id)));
          await notify({
            userId,
            kind: 'request',
            title:
              state === 'available' ? 'Your requested title is available' : `Request ${state}`,
            sourceKey: `seerr:${instanceId}:${remote.id}:${state}`,
            data:{actorId:userId,subjectId:local.id,workId:local.mediaId,destination:'/requests'},
          });
        }
        continue;
      }
      if (!remote.media?.tmdbId) continue;
      const kind = remote.type === 'tv' || remote.media.mediaType === 'tv' ? 'show' : 'movie';
      const item = await importTmdb(kind, String(remote.media.tmdbId), {
        includeEpisodes: false,
      });
      await guarded(async tx=>{
        const [existing]=await tx.select({id:mediaRequests.id}).from(mediaRequests).where(and(eq(mediaRequests.userId,userId),eq(mediaRequests.instanceId,instanceId),eq(mediaRequests.externalId,String(remote.id)))).limit(1);
        if(existing)return;
        await tx.insert(mediaRequests)
        .values({
          userId,
          instanceId,
          mediaId: item.id,
          externalId: String(remote.id),
          serverId: remote.serverId,
          is4k: remote.is4k,
          seasons: remote.seasons.map((s) => s.seasonNumber),
          state,
        });
      });
    }
    if (page.results.length < 100) break;
    if (offset >= 100000)
      throw new Error('Seerr request sync exceeded the supported page bound.');
  }
  // Confirm missing requests individually: a truncated/filtered list must never imply cancellation.
  const known = await getDb()
    .select()
    .from(mediaRequests)
    .where(and(eq(mediaRequests.userId, userId), eq(mediaRequests.instanceId, instanceId)));
  for (const request of known) {
    if (!request.externalId || seen.has(request.externalId) || request.state === 'cancelled')
      continue;
    try {
      await guarded(async()=>{});
      await adapter.requestDetails(Number(request.externalId));
    } catch (error) {
      if (!(error instanceof ProviderHttpError)||error.status !== 404) throw error;
      await guarded(tx=>tx
        .update(mediaRequests)
        .set({ state: 'cancelled', updatedAt: new Date() })
        .where(eq(mediaRequests.id, request.id)));
    }
  }
  const pending = await getDb()
    .select()
    .from(syncValues)
    .where(
      and(
        eq(syncValues.connectionId, connection.id),
        eq(syncValues.conflict, true),
        sql`${syncValues.category} like 'request:%'`
      )
    );
  const preference = await guarded((tx) =>
    conflictPreference(tx, userId, connection.id)
  );
  for (const entry of pending) {
    const [request] = await getDb()
      .select()
      .from(mediaRequests)
      .where(
        and(
          eq(mediaRequests.id, entry.category.slice('request:'.length)),
          eq(mediaRequests.userId, userId)
        )
      );
    if (!request) continue;
    await guarded(tx=>tx
      .update(syncValues)
      .set({ remote: { value: request.state }, updatedAt: new Date() })
      .where(eq(syncValues.id, entry.id)));
    if (preference !== 'manual') {
      const { resolveConflict } = await import('$lib/sync/conflicts');
      await guarded(tx=>resolveConflict(userId, entry.id, preference === 'remote' ? 'accepted' : 'ignored',tx));
    }
  }
  await guarded(tx=>tx
    .update(providerConnections)
    .set({
      settings: sql`jsonb_set(${providerConnections.settings}, '{requestsVerifiedAt}', ${JSON.stringify(new Date().toISOString())}::jsonb, true)`,
    })
    .where(eq(providerConnections.id, connection.id)));
}

export async function manageRequest(
  userId: string,
  requestId: string,
  action: 'cancel' | 'approve' | 'decline'
) {
  const [request] = await getDb()
    .select()
    .from(mediaRequests)
    .where(eq(mediaRequests.id, requestId));
  if (!request) throw new Error('Request not found.');
  if (!request.externalId) {
    if (request.userId !== userId || action !== 'cancel')
      throw new Error('This request cannot be changed.');
    await getDb().transaction(async (tx) => {
      const cancelled = await tx
        .update(outboxActions)
        .set({ state: 'cancelled', updatedAt: new Date() })
        .where(
          and(
            eq(outboxActions.userId, userId),
            eq(outboxActions.kind, 'seerr.request'),
            sql`${outboxActions.state} in ('pending','failed')`,
            sql`${outboxActions.payload}->>'requestId' = ${requestId}`
          )
        )
        .returning();
      if (!cancelled.length)
        throw new Error(
          'This request is being sent. Wait for its status to update before cancelling.'
        );
      await tx
        .update(mediaRequests)
        .set({ state: 'cancelled', updatedAt: new Date() })
        .where(eq(mediaRequests.id, requestId));
    });
    return;
  }
  const [connection] = await getDb()
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.userId, userId),
        eq(providerConnections.instanceId, request.instanceId),
        eq(providerConnections.status, 'connected')
      )
    );
  if (!connection) throw new Error('Connect your linked account before changing requests.');
  const manager = seerrAllows(
    Number(connection.settings.seerrPermissions) || 0,
    SeerrPermission.MANAGE_REQUESTS
  );
  if (
    action === 'cancel'
      ? !manager && (request.userId !== userId || request.state !== 'pending')
      : !manager
  )
    throw new Error('You do not have permission to change this request.');
  await enqueueAction({
    userId,
    connectionId: connection.id,
    kind: 'seerr.manage',
    payload: { requestId, action, expectedState: request.state },
  });
}
