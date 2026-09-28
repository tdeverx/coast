import { conflictPreference } from '$lib/sync/preference';
import { providerSchedule, providerScheduleSchema } from './schedule';
import * as v from 'valibot';
import { and, eq, sql, inArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
  users,
  providerInstances,
  providerConnections,
  availability,
  mediaRequests,
  media,
  externalIds,
  outboxActions,
  syncValues,
  syncCheckpoints,
} from '$lib/server/db/schema';
import {
  createProviderTransport,
  type ProviderFetchConfig,
} from '$lib/server/security/provider-fetch';
import { encryptCredential, decryptCredential } from '$lib/server/security/credentials';
import { getConfig } from '$lib/server/config';
import {
  enqueueAction,
  registerActionHandler,
  PermanentActionError,
  type ActionHandler,
} from '$lib/server/queue';
import { JellyfinAdapter } from './jellyfin/adapter.server';
import { TraktAdapter } from './trakt/adapter.server';
import {
  SeerrAdapter,
  groupDestination,
  seerrAllows,
  SeerrPermission,
} from './seerr/adapter.server';
import {
  ProviderActionError,
  defaultSyncPreferences,
  type DiscoverKind,
  type SyncPreferences,
} from './contracts';
import { resolveNotification, notify } from '$lib/server/notifications';
import { trackInTransaction } from '$lib/core/tracking/service';

const uuid = v.pipe(v.string(), v.uuid());
const providerSchema = v.picklist(['tmdb', 'jellyfin', 'trakt', 'seerr']);
const configureSchema = v.object({
  id: v.optional(uuid),
  provider: providerSchema,
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  baseUrl: v.optional(v.pipe(v.string(), v.url())),
  linkedMediaInstanceId: v.optional(uuid),
  allowPrivateNetwork: v.optional(v.boolean(), false),
  apiKey: v.optional(v.string()),
  accessToken: v.optional(v.string()),
  clientId: v.optional(v.string()),
  clientSecret: v.optional(v.string()),
});
async function administrator(userId: string) {
  const [user] = await getDb().select().from(users).where(eq(users.id, userId));
  if (user?.role !== 'admin' || user.disabled) throw new Error('Administrator access is required.');
}
export async function configureInstance(adminId: string, input: unknown) {
  await administrator(adminId);
  const data = v.parse(configureSchema, input);
  const config = await getConfig();
  const baseUrl =
    data.provider === 'tmdb'
      ? 'https://api.themoviedb.org'
      : data.provider === 'trakt'
        ? 'https://api.trakt.tv'
        : data.baseUrl;
  if (!baseUrl) throw new Error('The server URL is required.');
  const [previous] = data.id
    ? await getDb().select().from(providerInstances).where(eq(providerInstances.id, data.id))
    : [];
  if (data.id && !previous) throw new Error('This integration does not exist.');
  if (previous) {
    if (previous.provider !== data.provider)
      throw new Error('A provider instance cannot change provider type.');
    if (previous.baseUrl !== baseUrl.replace(/\/$/, ''))
      throw new Error(
        'Create a new instance when changing a service URL, then reconnect its accounts.'
      );
  }
  if (
    !['tmdb', 'trakt'].includes(data.provider) &&
    config.serverAllowlist.length &&
    !config.serverAllowlist.some(
      (entry) => entry === new URL(baseUrl).hostname || entry === baseUrl.replace(/\/$/, '')
    )
  )
    throw new Error('This service is outside the administrator server allowlist.');
  const transport = createProviderTransport({
    baseUrl,
    approved: true,
    allowPrivateNetwork: data.allowPrivateNetwork,
    allowedPorts: config.allowedProviderPorts,
  });
  let serverIdentity: string | undefined;
  if (data.provider === 'jellyfin')
    serverIdentity = (
      await new JellyfinAdapter(transport, 'coast-verify').identity(
        previous?.serverIdentity || undefined
      )
    ).id;
  if (data.provider === 'seerr') {
    if (!data.linkedMediaInstanceId) throw new Error('Associate Seerr with its Jellyfin instance.');
    const [linked] = await getDb()
      .select()
      .from(providerInstances)
      .where(
        and(
          eq(providerInstances.id, data.linkedMediaInstanceId),
          eq(providerInstances.provider, 'jellyfin')
        )
      );
    if (!linked) throw new Error('The selected Jellyfin instance does not exist.');
  }
  const secret = {
    ...(previous?.credentials ? JSON.parse(await decryptCredential(previous.credentials)) : {}),
    ...Object.fromEntries(
      Object.entries({
        apiKey: data.apiKey,
        accessToken: data.accessToken,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
      }).filter(([, value]) => !!value)
    ),
  };
  const values = {
    provider: data.provider,
    name: data.name,
    baseUrl: baseUrl.replace(/\/$/, ''),
    serverIdentity,
    linkedMediaInstanceId: data.linkedMediaInstanceId,
    settings: {
      ...previous?.settings,
      approved: true,
      allowPrivateNetwork: data.allowPrivateNetwork,
      allowedPorts: config.allowedProviderPorts,
    },
    ...(Object.keys(secret).length
      ? { credentials: await encryptCredential(JSON.stringify(secret)) }
      : {}),
  };
  const [row] = data.id
    ? await getDb()
        .update(providerInstances)
        .set(values)
        .where(eq(providerInstances.id, data.id))
        .returning()
    : await getDb().insert(providerInstances).values(values).returning();
  if (!row) throw new Error('The provider instance does not exist.');
  return { id: row.id, name: row.name, provider: row.provider, baseUrl: row.baseUrl };
}
export async function listProviders(userId: string, includeDisabled = false) {
  if (includeDisabled) await administrator(userId);
  const instances = await getDb()
    .select()
    .from(providerInstances)
    .where(includeDisabled ? undefined : eq(providerInstances.enabled, true));
  const connections = await getDb()
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.userId, userId));
  const counts = includeDisabled
    ? await getDb()
        .select({ instanceId: providerConnections.instanceId, count: sql<number>`count(*)::int` })
        .from(providerConnections)
        .innerJoin(users, eq(users.id, providerConnections.userId))
        .where(and(eq(providerConnections.status, 'connected'), eq(users.disabled, false)))
        .groupBy(providerConnections.instanceId)
    : [];
  return instances.map((instance) => {
    const connection = connections.find((connection) => connection.instanceId === instance.id);
    return {
      connectedAccounts: counts.find((row) => row.instanceId === instance.id)?.count ?? 0,
      id: instance.id,
      provider: instance.provider,
      name: instance.name,
      baseUrl: instance.baseUrl,
      enabled: instance.enabled,
      schedule: providerSchedule(instance.provider, instance.settings.schedule),
      allowPrivateNetwork: instance.settings.allowPrivateNetwork === true,
      linkedMediaInstanceId: instance.linkedMediaInstanceId,
      configured: !!instance.credentials || instance.provider === 'jellyfin',
      connection: connection
        ? {
            id: connection.id,
            username: connection.username,
            status: connection.status,
            settings: {
              sync: connection.settings.sync,
              importPlayback: connection.settings.importPlayback === true,
            },
            updatedAt: connection.updatedAt,
          }
        : null,
    };
  });
}
export async function getInstance(instanceId: string, provider?: string) {
  const [instance] = await getDb()
    .select()
    .from(providerInstances)
    .where(and(eq(providerInstances.id, instanceId), eq(providerInstances.enabled, true)));
  if (!instance || (provider && instance.provider !== provider))
    throw new Error('This integration is unavailable.');
  return instance;
}
export async function instanceFetchConfig(
  instance: typeof providerInstances.$inferSelect
): Promise<ProviderFetchConfig> {
  const config = await getConfig();
  const fixed = instance.provider === 'tmdb' || instance.provider === 'trakt';
  if (
    fixed &&
    instance.baseUrl !==
      (instance.provider === 'tmdb' ? 'https://api.themoviedb.org' : 'https://api.trakt.tv')
  )
    throw new Error('This global provider URL is not allowed.');
  const host = new URL(instance.baseUrl).hostname;
  if (
    !fixed &&
    config.serverAllowlist.length &&
    !config.serverAllowlist.some((entry) => entry === host || entry === instance.baseUrl)
  )
    throw new Error('This service is outside the administrator server allowlist.');
  return {
    baseUrl: instance.baseUrl,
    approved: instance.settings.approved === true,
    allowPrivateNetwork: instance.settings.allowPrivateNetwork === true,
    allowedPorts: fixed ? [443] : config.allowedProviderPorts,
  };
}
export function instanceTransport(instance: typeof providerInstances.$inferSelect) {
  return async (path: string, init?: RequestInit) =>
    createProviderTransport(await instanceFetchConfig(instance))(path, init);
}

export async function connectionFor(userId: string, connectionId: string, provider?: string) {
  const [connection] = await getDb()
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.id, connectionId),
        eq(providerConnections.userId, userId),
        eq(providerConnections.status, 'connected')
      )
    );
  if (!connection) throw new Error('Connect your account in Settings to continue.');
  return { connection, instance: await getInstance(connection.instanceId, provider) };
}
async function saveConnection(
  userId: string,
  instanceId: string,
  externalUserId: string,
  username: string,
  credentials: Record<string, unknown>,
  settings: Record<string, unknown> = {}
) {
  const secret = await encryptCredential(JSON.stringify(credentials));
  const [connection] = await getDb()
    .insert(providerConnections)
    .values({
      userId,
      instanceId,
      externalUserId,
      username,
      credentials: secret,
      settings,
      status: 'connected',
    })
    .onConflictDoUpdate({
      target: [providerConnections.userId, providerConnections.instanceId],
      set: {
        externalUserId,
        username,
        credentials: secret,
        settings,
        status: 'connected',
        updatedAt: new Date(),
      },
    })
    .returning();
  return { id: connection.id, username: connection.username, status: connection.status };
}
export async function connectJellyfin(
  userId: string,
  input: { instanceId: string; username: string; password: string }
) {
  const instance = await getInstance(v.parse(uuid, input.instanceId), 'jellyfin');
  const account = await new JellyfinAdapter(instanceTransport(instance), userId).authenticate(
    input.username,
    input.password,
    instance.serverIdentity || undefined
  );
  const connection = await saveConnection(userId, instance.id, account.id, account.username, {
    accessToken: account.accessToken,
  });
  await enqueueAction({
    userId,
    connectionId: connection.id,
    kind: 'jellyfin.scan',
    payload: { full: true },
    compactionKey: 'jellyfin-scan',
  });
  return connection;
}
export async function getJellyfin(userId: string, connectionId: string) {
  const context = await connectionFor(userId, connectionId, 'jellyfin');
  if (!context.connection.credentials || !context.connection.externalUserId)
    throw new Error('Reconnect Jellyfin to continue.');
  const credentials = v.parse(
    v.object({ accessToken: v.string() }),
    JSON.parse(await decryptCredential(context.connection.credentials))
  );
  return {
    ...context,
    adapter: new JellyfinAdapter(
      instanceTransport(context.instance),
      userId,
      credentials.accessToken
    ),
  };
}
export async function disconnectProvider(userId: string, connectionId: string) {
  await connectionFor(userId, connectionId);
  const cancelled = await getDb().transaction(async (tx) => {
    await tx
      .update(providerConnections)
      .set({ status: 'disconnected', credentials: null, updatedAt: new Date() })
      .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)));
    await tx
      .update(availability)
      .set({ state: 'unavailable' })
      .where(and(eq(availability.connectionId, connectionId), eq(availability.userId, userId)));
    return tx
      .update(outboxActions)
      .set({ state: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(outboxActions.connectionId, connectionId),
          sql`${outboxActions.state} in ('pending','failed')`
        )
      )
      .returning({ id: outboxActions.id });
  });
  for (const action of cancelled) await resolveNotification(userId, `outbox:${action.id}`);
}
async function traktApp(instance: typeof providerInstances.$inferSelect) {
  if (!(await getConfig()).enableTrakt) throw new Error('Trakt is disabled by the administrator.');
  if (!instance.credentials) throw new Error('Trakt application credentials are not configured.');
  return v.parse(
    v.object({ clientId: v.string(), clientSecret: v.string() }),
    JSON.parse(await decryptCredential(instance.credentials))
  );
}
/** Public catalogue reads never use a member's access token or trigger personal sync. */
export async function getTraktCommunity() {
  if (!(await getConfig()).enableTrakt) return null;
  const [instance] = await getDb()
    .select()
    .from(providerInstances)
    .where(and(eq(providerInstances.provider, 'trakt'), eq(providerInstances.enabled, true)))
    .orderBy(providerInstances.id)
    .limit(1);
  if (!instance?.credentials) return null;
  const app = await traktApp(instance);
  return {
    instanceId: instance.id,
    adapter: new TraktAdapter(instanceTransport(instance), app.clientId, app.clientSecret),
  };
}
export async function startTraktDevice(userId: string, instanceId: string) {
  const instance = await getInstance(instanceId, 'trakt'),
    app = await traktApp(instance);
  const device = await new TraktAdapter(
    instanceTransport(instance),
    app.clientId,
    app.clientSecret
  ).startDevice();
  const existing = await getDb()
    .select()
    .from(providerConnections)
    .where(
      and(eq(providerConnections.userId, userId), eq(providerConnections.instanceId, instanceId))
    )
    .limit(1);
  if (existing[0]?.status === 'connected')
    throw new Error('Disconnect the current Trakt account before linking another.');
  const credentials = await encryptCredential(
    JSON.stringify({
      deviceCode: device.device_code,
      deviceExpires: Date.now() + device.expires_in * 1000,
      interval: device.interval,
      nextPoll: Date.now() + device.interval * 1000,
    })
  );
  await getDb()
    .insert(providerConnections)
    .values({
      userId,
      instanceId,
      credentials,
      status: 'disconnected',
      settings: { sync: defaultSyncPreferences },
    })
    .onConflictDoUpdate({
      target: [providerConnections.userId, providerConnections.instanceId],
      set: { credentials, status: 'disconnected', updatedAt: new Date() },
    });
  return {
    userCode: device.user_code,
    verificationUrl: device.verification_url,
    expiresIn: device.expires_in,
    interval: device.interval,
  };
}
export async function finishTraktDevice(userId: string, instanceId: string) {
  const instance = await getInstance(instanceId, 'trakt'),
    app = await traktApp(instance);
  const [connection] = await getDb()
    .select()
    .from(providerConnections)
    .where(
      and(eq(providerConnections.userId, userId), eq(providerConnections.instanceId, instanceId))
    );
  if (!connection?.credentials || connection.status === 'connected')
    throw new Error('Start Trakt account linking first.');
  const pending = v.parse(
    v.object({
      deviceCode: v.string(),
      deviceExpires: v.number(),
      interval: v.number(),
      nextPoll: v.number(),
    }),
    JSON.parse(await decryptCredential(connection.credentials))
  );
  if (Date.now() > pending.deviceExpires)
    throw new Error('The Trakt code has expired. Start again.');
  if (Date.now() < pending.nextPoll) return { pending: true };
  pending.nextPoll = Date.now() + pending.interval * 1000;
  await getDb()
    .update(providerConnections)
    .set({ credentials: await encryptCredential(JSON.stringify(pending)) })
    .where(eq(providerConnections.id, connection.id));
  try {
    const tokens = await new TraktAdapter(
      instanceTransport(instance),
      app.clientId,
      app.clientSecret
    ).finishDevice(pending.deviceCode);
    const profile = await new TraktAdapter(
      instanceTransport(instance),
      app.clientId,
      app.clientSecret,
      tokens.access_token
    ).profile();
    return {
      pending: false,
      connection: await saveConnection(userId, instanceId, profile.id, profile.username, tokens, {
        sync: defaultSyncPreferences,
      }),
    };
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 400 || status === 429) return { pending: true };
    throw error;
  }
}
export async function getTrakt(userId: string, connectionId: string) {
  const context = await connectionFor(userId, connectionId, 'trakt'),
    app = await traktApp(context.instance);
  if (!context.connection.credentials) throw new Error('Reconnect Trakt to continue.');
  const token = await getDb().transaction(async (tx) => {
    // Refresh tokens may rotate: concurrent API/worker requests must consume only the latest token.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`trakt-refresh:${connectionId}`},0))`
    );
    const [current] = await tx
      .select()
      .from(providerConnections)
      .where(
        and(
          eq(providerConnections.id, connectionId),
          eq(providerConnections.userId, userId),
          eq(providerConnections.status, 'connected')
        )
      );
    if (!current?.credentials) throw new Error('Reconnect Trakt to continue.');
    let saved = v.parse(
      v.object({
        access_token: v.string(),
        refresh_token: v.string(),
        created_at: v.number(),
        expires_in: v.number(),
      }),
      JSON.parse(await decryptCredential(current.credentials))
    );
    if ((saved.created_at + saved.expires_in) * 1000 < Date.now() + 60000) {
      saved = await new TraktAdapter(
        instanceTransport(context.instance),
        app.clientId,
        app.clientSecret
      ).refresh(saved.refresh_token);
      await tx
        .update(providerConnections)
        .set({ credentials: await encryptCredential(JSON.stringify(saved)), updatedAt: new Date() })
        .where(
          and(eq(providerConnections.id, connectionId), eq(providerConnections.status, 'connected'))
        );
    }
    return saved;
  });
  return {
    ...context,
    adapter: new TraktAdapter(
      instanceTransport(context.instance),
      app.clientId,
      app.clientSecret,
      token.access_token
    ),
    sync: {
      ...defaultSyncPreferences,
      ...(context.connection.settings.sync as Partial<SyncPreferences>),
    },
  };
}
export async function updateProviderSchedule(adminId: string, instanceId: string, input: unknown) {
  await administrator(adminId);
  const instance = await getInstance(instanceId);
  if (!['jellyfin', 'seerr', 'trakt'].includes(instance.provider))
    throw new Error('This integration has no scheduled jobs.');
  const schedule = v.parse(providerScheduleSchema, input);
  await getDb()
    .update(providerInstances)
    .set({
      settings: sql`jsonb_set(${providerInstances.settings},'{schedule}',${schedule}::jsonb,true)`,
    })
    .where(eq(providerInstances.id, instanceId));
  return schedule;
}
export async function runProviderJob(adminId: string, instanceId: string) {
  await administrator(adminId);
  const instance = await getInstance(instanceId);
  if (!['jellyfin', 'seerr', 'trakt'].includes(instance.provider))
    throw new Error('This integration has no scheduled jobs.');
  return scheduleProviderMaintenance({ instanceId, force: true });
}
export async function updateJellyfinPlaybackImport(
  userId: string,
  connectionId: string,
  input: unknown
) {
  await connectionFor(userId, connectionId, 'jellyfin');
  const { enabled } = v.parse(v.object({ enabled: v.boolean() }), input);
  await getDb()
    .update(providerConnections)
    .set({
      settings: sql`${providerConnections.settings} || jsonb_build_object('importPlayback', ${enabled}::boolean)`,
      updatedAt: new Date(),
    })
    .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)));
  return { enabled };
}
export async function updateSyncPreferences(userId: string, connectionId: string, input: unknown) {
  await connectionFor(userId, connectionId, 'trakt');
  const sync = v.parse(
    v.object({
      history: v.boolean(),
      progress: v.boolean(),
      collection: v.boolean(),
      ratings: v.boolean(),
      watchlist: v.boolean(),
      lists: v.boolean(),
      scrobble: v.boolean(),
    }),
    input
  ) as SyncPreferences;
  const [connection] = await getDb()
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.id, connectionId));
  await getDb()
    .update(providerConnections)
    .set({ settings: { ...connection.settings, sync }, updatedAt: new Date() })
    .where(eq(providerConnections.id, connectionId));
  return sync;
}
export async function getSeerr(userId: string, instanceId: string) {
  if (!(await getConfig()).enableRequests)
    throw new Error('Requests are disabled by the administrator.');
  const instance = await getInstance(instanceId, 'seerr');
  if (!instance.credentials || !instance.linkedMediaInstanceId)
    throw new Error('Seerr is not configured.');
  const credentials = v.parse(
    v.object({ apiKey: v.string() }),
    JSON.parse(await decryptCredential(instance.credentials))
  );
  // Only a verified linked Jellyfin account can establish the Seerr identity. Never accept an arbitrary Seerr user ID.
  const [jellyfin] = await getDb()
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.userId, userId),
        eq(providerConnections.instanceId, instance.linkedMediaInstanceId),
        eq(providerConnections.status, 'connected')
      )
    );
  if (!jellyfin?.externalUserId)
    throw new Error('Connect the associated Jellyfin account before making requests.');
  const admin = new SeerrAdapter(instanceTransport(instance), credentials.apiKey);
  const mapped = await admin.jellyfinUser(jellyfin.externalUserId);
  const adapter = new SeerrAdapter(instanceTransport(instance), credentials.apiKey, mapped.id);
  const account = await adapter.user();
  if (account.id !== mapped.id)
    throw new Error('Seerr did not preserve the linked account identity.');
  const [existing] = await getDb()
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.userId, userId),
        eq(providerConnections.instanceId, instance.id),
        eq(providerConnections.status, 'connected'),
        eq(providerConnections.externalUserId, String(mapped.id))
      )
    );
  const connection = existing
    ? { id: existing.id, username: existing.username, status: existing.status }
    : await saveConnection(
        userId,
        instance.id,
        String(mapped.id),
        mapped.username || mapped.displayName || 'Seerr',
        {},
        {}
      );
  await getDb()
    .update(providerConnections)
    .set({
      settings: sql`${providerConnections.settings} || jsonb_build_object('seerrPermissions',${account.permissions}::integer,'seerrVerifiedAt',${new Date().toISOString()}::text)`,
    })
    .where(eq(providerConnections.id, connection.id));
  return { adapter, instance, connection, account, linkedJellyfinUserId: jellyfin.externalUserId };
}
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
              r.status !== 3 && r.is4k === is4k && (r.serverId == null || r.serverId === serverId)
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
                  (n) => n.seasonNumber === s.seasonNumber && (is4k ? n.status4k : n.status) === 5
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
        Object.entries((saved.settings.requestOptionsCache as Record<string, RequestCache>) || {})
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
        r.status !== 3 && r.is4k === data.is4k && (r.serverId == null || r.serverId === serverId)
    );
    const taken = new Set([
      ...existing.flatMap((r) => r.seasons),
      ...remote.flatMap((r) => r.seasons.filter((s) => s.status !== 3).map((s) => s.seasonNumber)),
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
export async function refreshRequests(userId: string, instanceId: string) {
  const { adapter, connection } = await getSeerr(userId, instanceId);
  const { importTmdb } = await import('$lib/catalogue/service');
  const seen = new Set<string>();
  for (let offset = 0; ; offset += 100) {
    const page = await adapter.requests(offset);
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
          await getDb()
            .update(mediaRequests)
            .set({ state, updatedAt: new Date() })
            .where(eq(mediaRequests.id, local.id));
          await notify({
            userId,
            kind: 'request',
            title: state === 'available' ? 'Your requested title is available' : `Request ${state}`,
            sourceKey: `seerr:${instanceId}:${remote.id}:${state}`,
          });
        }
        continue;
      }
      if (!remote.media?.tmdbId) continue;
      const kind = remote.type === 'tv' || remote.media.mediaType === 'tv' ? 'show' : 'movie';
      const item = await importTmdb(kind, String(remote.media.tmdbId), { includeEpisodes: false });
      await getDb()
        .insert(mediaRequests)
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
    }
    if (page.results.length < 100) break;
    if (offset >= 100000) throw new Error('Seerr request sync exceeded the supported page bound.');
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
      await adapter.requestDetails(Number(request.externalId));
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
      await getDb()
        .update(mediaRequests)
        .set({ state: 'cancelled', updatedAt: new Date() })
        .where(eq(mediaRequests.id, request.id));
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
  const preference = await getDb().transaction((tx) =>
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
    await getDb()
      .update(syncValues)
      .set({ remote: { value: request.state }, updatedAt: new Date() })
      .where(eq(syncValues.id, entry.id));
    if (preference !== 'manual') {
      const { resolveConflict } = await import('$lib/sync/conflicts');
      await resolveConflict(userId, entry.id, preference === 'remote' ? 'accepted' : 'ignored');
    }
  }
  await getDb()
    .update(providerConnections)
    .set({
      settings: sql`jsonb_set(${providerConnections.settings}, '{requestsVerifiedAt}', ${JSON.stringify(new Date().toISOString())}::jsonb, true)`,
    })
    .where(eq(providerConnections.id, connection.id));
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

let maintenanceTimer: ReturnType<typeof setInterval> | undefined;
export function registerProviderActions(options: { maintenance?: boolean } = {}) {
  const register = (kind: string, handler: ActionHandler) =>
    registerActionHandler(kind, async (action) => {
      try {
        await handler(action);
      } catch (error) {
        if (error instanceof ProviderActionError) throw new PermanentActionError(error.message);
        throw error;
      }
    });
  if (options.maintenance !== false && !maintenanceTimer) {
    maintenanceTimer = setInterval(() => {
      void scheduleProviderMaintenance().catch(() => {});
    }, 60000);
    maintenanceTimer.unref();
    process.once('SIGTERM', stopProviderMaintenance);
    process.once('SIGINT', stopProviderMaintenance);
    void scheduleProviderMaintenance().catch(() => {});
  }
  register('seerr.manage', async (action) => {
    const data = v.parse(
      v.object({
        requestId: uuid,
        action: v.picklist(['cancel', 'approve', 'decline']),
        resolved: v.optional(v.boolean(), false),
        expectedState: v.optional(v.string()),
      }),
      action.payload
    );
    const [request] = await getDb()
      .select()
      .from(mediaRequests)
      .where(eq(mediaRequests.id, data.requestId));
    if (!request?.externalId) return;
    const { adapter, connection } = await getSeerr(action.userId, request.instanceId);
    const desired =
      data.action === 'cancel' ? 'cancelled' : data.action === 'approve' ? 'approved' : 'declined';
    if (!data.resolved) {
      let remoteState: typeof mediaRequests.$inferSelect.state;
      try {
        const remote = await adapter.requestDetails(Number(request.externalId));
        remoteState =
          (remote.is4k ? remote.media?.status4k : remote.media?.status) === 5
            ? 'available'
            : remote.status === 2
              ? 'approved'
              : remote.status === 3
                ? 'declined'
                : 'pending';
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
        remoteState = 'cancelled';
      }
      if (remoteState !== (data.expectedState ?? request.state) && remoteState !== desired) {
        const preference = await getDb().transaction((tx) =>
          conflictPreference(tx, action.userId, connection.id)
        );
        if (preference === 'remote') {
          await getDb()
            .update(mediaRequests)
            .set({ state: remoteState, updatedAt: new Date() })
            .where(eq(mediaRequests.id, request.id));
          await getDb()
            .update(syncValues)
            .set({
              conflict: false,
              agreed: { value: remoteState },
              remote: { value: remoteState },
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(syncValues.connectionId, connection.id),
                eq(syncValues.category, `request:${request.id}`)
              )
            );
          return;
        }
        if (preference === 'manual') {
          const values = {
            remote: { value: remoteState },
            agreed: { value: desired },
            conflict: true,
            updatedAt: new Date(),
          };
          await getDb()
            .insert(syncValues)
            .values({
              connectionId: connection.id,
              mediaId: request.mediaId,
              category: `request:${request.id}`,
              ...values,
            })
            .onConflictDoUpdate({
              target: [syncValues.connectionId, syncValues.mediaId, syncValues.category],
              set: values,
            });
          return;
        }
      }
    }
    await adapter.manage(Number(request.externalId), data.action);
    await getDb()
      .update(syncValues)
      .set({
        conflict: false,
        agreed: { value: desired },
        remote: { value: desired },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(syncValues.connectionId, connection.id),
          eq(syncValues.category, `request:${request.id}`)
        )
      );
    await getDb()
      .update(mediaRequests)
      .set({
        state:
          data.action === 'cancel'
            ? 'cancelled'
            : data.action === 'approve'
              ? 'approved'
              : 'declined',
        updatedAt: new Date(),
      })
      .where(eq(mediaRequests.id, request.id));
  });
  register('trakt.list-delete', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Trakt connection is unavailable.');
    const { adapter, sync } = await getTrakt(action.userId, action.connectionId);
    if (sync.lists) {
      let externalId =
        typeof action.payload.externalId === 'string' ? action.payload.externalId : undefined;
      if (!externalId && typeof action.payload.listId === 'string') {
        const reference = `Coast reference: ${action.payload.listId}`;
        externalId = (await adapter.lists())
          .find((list) => list.description?.split('\n').includes(reference))
          ?.ids.trakt.toString();
      }
      if (externalId) await adapter.deleteList(externalId);
    }
  });
  register('trakt.progress', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Trakt connection is unavailable.');
    const { executeProgressExport } = await import('$lib/sync/service');
    await executeProgressExport(action.userId, action.connectionId, action.payload);
  });
  register('seerr.sync', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Seerr connection is unavailable.');
    const { instance } = await connectionFor(action.userId, action.connectionId, 'seerr');
    await refreshRequests(action.userId, instance.id);
  });
  register('history.remove', async (action) => {
    if (!action.connectionId) throw new PermanentActionError('The connection is unavailable.');
    const { executeHistoryRemoval } = await import('$lib/sync/history-removal');
    await executeHistoryRemoval(action.userId, action.connectionId, action.payload);
  });
  register('jellyfin.user-state', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Jellyfin connection is unavailable.');
    const { executeJellyfinUserState } = await import('$lib/sync/service');
    await executeJellyfinUserState(action.userId, action.connectionId, action.payload);
  });
  register('jellyfin.scrobble', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The playback connection is unavailable.');
    const { executeJellyfinScrobble } = await import('$lib/sync/service');
    await executeJellyfinScrobble(action.userId, action.connectionId, action.payload);
  });
  register('trakt.scrobble', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Trakt connection is unavailable.');
    const { executeLiveScrobble } = await import('$lib/sync/service');
    await executeLiveScrobble(action.userId, action.connectionId, action.payload);
  });
  register('jellyfin.scan', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Jellyfin connection is unavailable.');
    const { scanJellyfin } = await import('$lib/sync/service');
    await scanJellyfin(action.userId, action.connectionId, action.payload.full !== false);
  });
  register('trakt.import', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Trakt connection is unavailable.');
    const { importTrakt } = await import('$lib/sync/service');
    await importTrakt(action.userId, action.connectionId);
  });
  register('trakt.list-export', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Trakt connection is unavailable.');
    const { executeTraktListExport } = await import('$lib/sync/service');
    await executeTraktListExport(action.userId, action.connectionId, action.payload);
  });
  register('trakt.export', async (action) => {
    if (!action.connectionId)
      throw new PermanentActionError('The Trakt connection is unavailable.');
    const { executeTraktExport } = await import('$lib/sync/service');
    await executeTraktExport(action.userId, action.connectionId, action.payload);
  });
  register('seerr.request', async (action) => {
    const requestId = v.parse(uuid, action.payload.requestId);
    const [request] = await getDb()
      .select()
      .from(mediaRequests)
      .where(and(eq(mediaRequests.id, requestId), eq(mediaRequests.userId, action.userId)));
    if (!request || request.state === 'cancelled') return;
    const [mapping] = await getDb()
      .select()
      .from(externalIds)
      .where(and(eq(externalIds.mediaId, request.mediaId), eq(externalIds.provider, 'tmdb')));
    if (!mapping || !['movie', 'show'].includes(mapping.mediaKind))
      throw new PermanentActionError('A TMDB movie or show identity is required to request media.');
    const { adapter } = await getSeerr(action.userId, request.instanceId);
    const external = await adapter.create({
      kind: mapping.mediaKind as DiscoverKind,
      tmdbId: Number(mapping.externalId),
      is4k: request.is4k,
      seasons: request.seasons,
      serverId: request.serverId ?? undefined,
    });
    await getDb()
      .update(mediaRequests)
      .set({
        externalId: String(external.id),
        state: external.status === 2 ? 'approved' : external.status === 3 ? 'declined' : 'pending',
        updatedAt: new Date(),
      })
      .where(eq(mediaRequests.id, request.id));
  });
}

export function stopProviderMaintenance() {
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = undefined;
  }
}

/** Idempotent maintenance scheduling; durable work remains in the PostgreSQL outbox. */
/** One integration schedule covers every connected account. Queue lanes keep credentials and retries isolated. */
export async function scheduleProviderMaintenance(
  options: { instanceId?: string; force?: boolean } = {}
) {
  return getDb().transaction(async (tx) => {
    // Prevent overlapping timer/manual runs across processes without waiting or duplicating work.
    const [lock] = await tx.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended('provider-maintenance',0)) as acquired`
    );
    if (!lock.acquired) return { queued: 0, active: 0, connections: 0, busy: true };
    const config = await getConfig();
    const rows = await tx
      .select({ connection: providerConnections, instance: providerInstances })
      .from(providerConnections)
      .innerJoin(providerInstances, eq(providerInstances.id, providerConnections.instanceId))
      .innerJoin(users, eq(users.id, providerConnections.userId))
      .where(
        and(
          eq(providerConnections.status, 'connected'),
          eq(providerInstances.enabled, true),
          eq(users.disabled, false),
          options.instanceId ? eq(providerInstances.id, options.instanceId) : undefined,
          inArray(providerInstances.provider, ['jellyfin', 'trakt', 'seerr'])
        )
      );
    const eligible = rows.filter(
      ({ instance }) =>
        (instance.provider !== 'trakt' || config.enableTrakt) &&
        (instance.provider !== 'seerr' || config.enableRequests) &&
        (options.force || providerSchedule(instance.provider, instance.settings.schedule).enabled)
    );
    if (!eligible.length) return { queued: 0, active: 0, connections: 0, busy: false };
    const ids = eligible.map((row) => row.connection.id);
    const [jobs, checkpoints] = await Promise.all([
      tx
        .select({
          connectionId: outboxActions.connectionId,
          kind: outboxActions.kind,
          active: sql<boolean>`bool_or(${outboxActions.state} in ('pending','running','failed'))`,
          last: sql<Date | null>`max(${outboxActions.updatedAt}) filter(where ${outboxActions.state}='succeeded')`,
        })
        .from(outboxActions)
        .where(
          and(
            inArray(outboxActions.connectionId, ids),
            inArray(outboxActions.kind, ['jellyfin.scan', 'trakt.import', 'seerr.sync'])
          )
        )
        .groupBy(outboxActions.connectionId, outboxActions.kind),
      tx.select().from(syncCheckpoints).where(inArray(syncCheckpoints.connectionId, ids)),
    ]);
    const jobsByKey = new Map(jobs.map((job) => [`${job.connectionId}:${job.kind}`, job]));
    const checkpointByKey = new Map(
      checkpoints.map((point) => [
        `${point.connectionId}:${point.kind}`,
        point.completedAt?.getTime() ?? 0,
      ])
    );
    let queued = 0,
      active = 0;
    for (const { instance, connection } of eligible) {
      const schedule = providerSchedule(instance.provider, instance.settings.schedule);
      const kind =
        instance.provider === 'jellyfin'
          ? 'jellyfin.scan'
          : instance.provider === 'trakt'
            ? 'trakt.import'
            : 'seerr.sync';
      const job = jobsByKey.get(`${connection.id}:${kind}`);
      if (job?.active) {
        active++;
        continue;
      }
      const fullAt = checkpointByKey.get(`${connection.id}:jellyfin-full`) ?? 0;
      const recentAt = checkpointByKey.get(`${connection.id}:jellyfin-recent`) ?? 0;
      const full = !!options.force || Date.now() - fullAt > schedule.fullIntervalHours * 3600000;
      const checked = Date.parse(String(connection.settings.requestsVerifiedAt ?? '')) || 0;
      const last =
        instance.provider === 'jellyfin'
          ? Math.max(fullAt, recentAt)
          : instance.provider === 'seerr'
            ? checked
            : job?.last
              ? new Date(job.last).getTime()
              : 0;
      if (
        !options.force &&
        !(instance.provider === 'jellyfin' && full) &&
        Date.now() - last <= schedule.intervalMinutes * 60000
      )
        continue;
      await enqueueAction({
        userId: connection.userId,
        connectionId: connection.id,
        kind,
        payload: instance.provider === 'jellyfin' ? { full } : {},
        compactionKey: kind,
      });
      queued++;
    }
    return { queued, active, connections: eligible.length, busy: false };
  });
}
