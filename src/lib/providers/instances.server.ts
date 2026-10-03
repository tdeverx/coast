import {
  IgdbAdapter,
  IGDB_BASE_URL,
  igdbCredentialsSchema,
} from '$lib/providers/igdb/adapter.server';
import { STEAM_BASE_URL } from './steam/adapter.server';
import { AppError } from '$lib/server/security/errors';
import { providerSchedule } from '$lib/providers/schedule';
import * as v from 'valibot';
import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { users, providerInstances, providerConnections } from '$lib/server/db/schema';
import {
  createProviderTransport,
  type ProviderFetchConfig,
} from '$lib/server/security/provider-fetch';
import { encryptCredential, decryptCredential } from '$lib/server/security/credentials';
import { requireExperimentalFeatures } from '$lib/server/experimental';
import { getConfig } from '$lib/server/config';
import { JellyfinAdapter } from '$lib/providers/jellyfin/adapter.server';

const uuid = v.pipe(v.string(), v.uuid());

const providerSchema = v.picklist(['tmdb', 'jellyfin', 'trakt', 'seerr', 'igdb', 'steam']);

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

export async function requireProviderAdmin(userId: string) {
  const [user] = await getDb().select().from(users).where(eq(users.id, userId));
  if (user?.role !== 'admin' || user.disabled) throw new Error('Administrator access is required.');
}

export async function configureInstance(adminId: string, input: unknown) {
  await requireProviderAdmin(adminId);
  const data = v.parse(configureSchema, input);
  const config = await getConfig();
  if (['igdb','steam'].includes(data.provider)) requireExperimentalFeatures(config);
  const baseUrl =
    data.provider === 'tmdb'
      ? 'https://api.themoviedb.org'
      : data.provider === 'igdb'
        ? IGDB_BASE_URL
        : data.provider === 'steam' ? STEAM_BASE_URL : data.provider === 'trakt'
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
    !['tmdb', 'trakt', 'igdb', 'steam'].includes(data.provider) &&
    config.serverAllowlist.length &&
    !config.serverAllowlist.some(
      (entry) => entry === new URL(baseUrl).hostname || entry === baseUrl.replace(/\/$/, '')
    )
  )
    throw new Error('This service is outside the administrator server allowlist.');
  const transport = createProviderTransport({
    baseUrl,
    provider: data.provider,
    approved: true,
    allowPrivateNetwork: data.allowPrivateNetwork,
    allowedPorts: config.allowedProviderPorts,
  });
  let serverIdentity: string | undefined = data.provider === 'steam' ? 'steam' : undefined;
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
  if (data.provider === 'steam') {
    const key = secret.apiKey ?? (previous?.credentials ? JSON.parse(await decryptCredential(previous.credentials)).apiKey : undefined);
    if (typeof key !== 'string' || !/^[a-f0-9]{32}$/i.test(key)) throw new AppError(400,'Steam requires a 32-character Web API key.');
    for(const name of Object.keys(secret))if(name!=='apiKey')delete secret[name];
  }
  if (data.provider === 'igdb') {
    const parsed = v.safeParse(igdbCredentialsSchema, secret);
    if (!parsed.success)
      throw new AppError(400, 'IGDB requires a Twitch client ID and client secret.');
    await new IgdbAdapter(parsed.output).verify();
    // IGDB uses an app token acquired server-side; save only its application credentials.
    for (const key of Object.keys(secret))
      if (!['clientId', 'clientSecret'].includes(key)) delete secret[key];
  }
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
  if (includeDisabled) await requireProviderAdmin(userId);
  const config = await getConfig();
  const instances = await getDb()
    .select()
    .from(providerInstances)
    .where(includeDisabled ? undefined : eq(providerInstances.enabled, true));
  const connections = await getDb()
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.userId, userId));
  const accounts = includeDisabled ? await getDb()
    .select({ id: providerConnections.id, instanceId: providerConnections.instanceId, username: users.username })
    .from(providerConnections).innerJoin(users, eq(users.id, providerConnections.userId))
    .where(and(eq(providerConnections.status, 'connected'), eq(users.disabled, false)))
    .orderBy(providerConnections.createdAt, providerConnections.id) : [];
  return instances
    .filter((instance) => config.experimentalFeatures || !['igdb','steam'].includes(instance.provider))
    .map((instance) => {
      const connection = connections.find((connection) => connection.instanceId === instance.id);
      return {
        connectedAccounts: accounts.filter(row => row.instanceId === instance.id).length,
        accounts: accounts.filter(row => row.instanceId === instance.id).map(({ id, username }) => ({ id, username })),
        libraryScan: includeDisabled ? instance.settings.libraryScan : undefined,
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
              accountGeneration: connection.accountGeneration,
              username: connection.username,
              status: connection.status,
              settings: {
                sync: connection.settings.sync,
                importOwned: connection.settings.importOwned,
                importPlaytime: connection.settings.importPlaytime,
                importAchievements: connection.settings.importAchievements,
                reconcileTracking: connection.settings.reconcileTracking,
                collectionProjection: connection.settings.collectionProjection,
                collectionProjectionVersion: connection.settings.collectionProjectionVersion,
                importPlayback: instance.provider === 'jellyfin' && connection.settings.importPlayback !== false,
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
  if (['igdb','steam'].includes(instance.provider)) requireExperimentalFeatures(config);
  const fixed = ['tmdb', 'trakt', 'igdb', 'steam'].includes(instance.provider);
  if (
    fixed &&
    instance.baseUrl !==
      (instance.provider === 'tmdb'
        ? 'https://api.themoviedb.org'
        : instance.provider === 'igdb'
          ? IGDB_BASE_URL
          : instance.provider === 'steam' ? STEAM_BASE_URL : 'https://api.trakt.tv')
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
    provider: instance.provider,
    approved: instance.settings.approved === true,
    allowPrivateNetwork: instance.settings.allowPrivateNetwork === true,
    allowedPorts: fixed ? [443] : config.allowedProviderPorts,
  };
}

export function instanceTransport(instance: typeof providerInstances.$inferSelect) {
  return async (path: string, init?: RequestInit) =>
    createProviderTransport(await instanceFetchConfig(instance))(path, init);
}
