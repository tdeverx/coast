import {
  IgdbAdapter,
  IGDB_BASE_URL,
  igdbCredentialsSchema,
} from '#lib/providers/igdb/adapter.server.js';
import { STEAM_BASE_URL } from './steam/adapter.server';
import { AppError } from '#lib/server/security/errors.js';
import { providerSchedule } from '#lib/providers/schedule.js';
import * as v from 'valibot';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { users, providerInstances, providerConnections } from '#lib/server/db/schema.js';
import {
  createProviderTransport,
  ProviderHttpError,
  type ProviderFetchConfig,
  validateProviderUrl,
} from '#lib/server/security/provider-fetch.js';
import { encryptCredential, decryptCredential } from '#lib/server/security/credentials.js';
import { getFeatureConfig } from '#lib/server/features.js';
import { getConfig } from '#lib/server/config.js';
import { JellyfinAdapter } from '#lib/providers/jellyfin/adapter.server.js';
import { COMIC_VINE_BASE_URL, ComicVineAdapter, comicVineCredentialsSchema } from './comic-vine/adapter.server';
import { authenticatedTmdbTransport } from './tmdb/connection.server';

const uuid = v.pipe(v.string(), v.uuid());

const providerSchema = v.picklist(['tmdb', 'jellyfin', 'trakt', 'seerr', 'igdb', 'steam', 'comic-vine']);

const configureSchema = v.object({
  id: v.optional(uuid),
  provider: providerSchema,
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  baseUrl: v.optional(v.pipe(v.string(), v.url())),
  lanUrl: v.optional(v.union([v.literal(''), v.pipe(v.string(), v.url())])),
  linkedMediaInstanceId: v.optional(uuid),
  allowPrivateNetwork: v.optional(v.boolean(), false),
  apiKey: v.optional(v.string()),
  removeJellyfinKey: v.optional(v.boolean(),false),
  subtitleAuthority: v.optional(v.picklist(['viewer','server'])),
  accessToken: v.optional(v.string()),
  clientId: v.optional(v.string()),
  clientSecret: v.optional(v.string()),
});

export async function requireProviderAdmin(userId: string) {
  const [user] = await getDb().select({ role: users.role, disabled: users.disabled }).from(users).where(eq(users.id, userId));
  if (user?.role !== 'admin' || user.disabled) throw new Error('Administrator access is required.');
}

export async function configureInstance(adminId: string, input: unknown, signal?: AbortSignal) {
  await requireProviderAdmin(adminId);
  const data = v.parse(configureSchema, input);
  const config = await getConfig();
  const baseUrl =
    data.provider === 'comic-vine' ? COMIC_VINE_BASE_URL : data.provider === 'tmdb'
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
  if (data.lanUrl && data.provider !== 'jellyfin')
    throw new Error('A LAN URL is only available for Jellyfin.');
  const lanInput = data.provider === 'jellyfin'
    ? (data.lanUrl === undefined ? previous?.settings.lanUrl : data.lanUrl) : undefined;
  if (lanInput != null && typeof lanInput !== 'string') throw new Error('Enter a valid LAN URL.');
  const lanUrl = typeof lanInput === 'string' ? lanInput : undefined;
  if (lanUrl && !data.allowPrivateNetwork)
    throw new Error('Approve private network access to use the Jellyfin LAN URL.');
  if (previous) {
    if (previous.provider !== data.provider)
      throw new Error('A provider instance cannot change provider type.');
    if (previous.baseUrl !== baseUrl.replace(/\/$/, ''))
      throw new Error(
        'Create a new instance when changing a service URL, then reconnect its accounts.'
      );
  }
  for (const url of [baseUrl, ...(lanUrl ? [lanUrl] : [])]) {
    if (config.serverAllowlist.length && !['tmdb','trakt','igdb','steam','comic-vine'].includes(data.provider) &&
      !config.serverAllowlist.some(entry => entry === new URL(url).hostname || entry === url.replace(/\/$/, '')))
      throw new Error('This service is outside the administrator server allowlist.');
    if (data.provider === 'jellyfin')
      validateProviderUrl({baseUrl:url, approved:true, allowPrivateNetwork:data.allowPrivateNetwork, allowedPorts:config.allowedProviderPorts});
  }
  const transport = createProviderTransport({
    // An existing pinned public identity can verify its LAN alias directly.
    baseUrl: data.provider === 'jellyfin' && lanUrl && previous?.serverIdentity ? lanUrl : baseUrl,
    provider: data.provider,
    approved: true,
    allowPrivateNetwork: data.allowPrivateNetwork,
    allowedPorts: data.provider === 'tmdb' ? [443] : config.allowedProviderPorts,
  });
  let serverIdentity: string | undefined = data.provider === 'steam' ? 'steam' : undefined;
  if (data.provider === 'jellyfin')
    serverIdentity = (
      await new JellyfinAdapter(transport, 'coast-verify').identity(
        previous?.serverIdentity || undefined
      )
    ).id;
  if (lanUrl && !previous?.serverIdentity)
    await new JellyfinAdapter(createProviderTransport({
      baseUrl:lanUrl, provider:'jellyfin', approved:true,
      allowPrivateNetwork:data.allowPrivateNetwork, allowedPorts:config.allowedProviderPorts,
    }), 'coast-verify').identity(serverIdentity);
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
  const previousSecret=previous?.credentials ? JSON.parse(await decryptCredential(previous.credentials)) : {};
  const secret = {
    ...previousSecret,
    ...Object.fromEntries(
      Object.entries({
        apiKey: data.apiKey,
        accessToken: data.accessToken,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
      }).filter(([, value]) => !!value)
    ),
  };
  if (data.provider === 'tmdb') {
    if (data.apiKey) delete secret.accessToken;
    else if (data.accessToken) delete secret.apiKey;
    if (!(typeof secret.apiKey === 'string' && secret.apiKey.trim()) &&
        !(typeof secret.accessToken === 'string' && secret.accessToken.trim()))
      throw new AppError(400,'Enter your TMDB API key or read access token.');
    if (data.apiKey || data.accessToken) {
      const request = authenticatedTmdbTransport(transport, secret);
      try {
        v.parse(v.object({images:v.object({secure_base_url:v.string()})}), await request('/3/configuration', { signal }));
      } catch (cause) {
        signal?.throwIfAborted();
        if (cause instanceof ProviderHttpError && [401,403].includes(cause.status))
          throw new AppError(403,'TMDB rejected these API credentials. Check the key or read access token.');
        throw new AppError(503,'Coast could not verify the TMDB connection. Try again in a moment.');
      }
      signal?.throwIfAborted();
    }
  }
  let managementKeyGeneration = previous?.settings.managementKeyGeneration;
  const subtitleAuthority = data.subtitleAuthority ?? previous?.settings.subtitleAuthority ?? 'viewer';
  if (data.provider === 'jellyfin') {
    const oldKey = previousSecret.apiKey;
    if (data.removeJellyfinKey) {
      delete secret.apiKey;
      managementKeyGeneration = undefined;
    } else if (data.apiKey) {
      if (!/^[a-zA-Z0-9_-]{16,256}$/.test(data.apiKey))
        throw new AppError(400,'Enter a valid Jellyfin server API key.');
      try {
        await new JellyfinAdapter(transport,'coast-management',data.apiKey).verifyManagementKey();
      } catch (cause) {
        if (cause instanceof ProviderHttpError && [401,403].includes(cause.status))
          throw new AppError(403,'Jellyfin rejected this key. Create a server API key in Jellyfin Dashboard → API Keys.');
        throw cause;
      }
      if (data.apiKey !== oldKey || !managementKeyGeneration) managementKeyGeneration = crypto.randomUUID();
    }
    if (subtitleAuthority==='server' && !managementKeyGeneration && !data.removeJellyfinKey)
      throw new AppError(400,'Save a Jellyfin server API key to enable delegated subtitle searches.');
  }
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
  if (data.provider === 'comic-vine') {
    const parsed = v.safeParse(comicVineCredentialsSchema, secret);
    if (!parsed.success) throw new AppError(400, 'Comic Vine requires an API key.');
    await new ComicVineAdapter(parsed.output.apiKey, transport).verify();
    for (const key of Object.keys(secret)) if (key !== 'apiKey') delete secret[key];
  }
  const values = {
    // Metadata services keep their credentials server-side, without user links.
    provider: data.provider,
    name: data.name,
    baseUrl: baseUrl.replace(/\/$/, ''),
    serverIdentity,
    linkedMediaInstanceId: data.linkedMediaInstanceId,
    settings: {
      ...previous?.settings,
      approved: true,
      ...(data.provider === 'jellyfin' ? {lanUrl:lanUrl ? lanUrl.replace(/\/$/, '') : null,
        managementKeyGeneration,subtitleAuthority:data.removeJellyfinKey?'viewer':subtitleAuthority} : {}),
      allowPrivateNetwork: data.allowPrivateNetwork,
      allowedPorts: config.allowedProviderPorts,
    },
    ...(Object.keys(secret).length
      ? { credentials: await encryptCredential(JSON.stringify(secret)) }
      : data.removeJellyfinKey && data.provider==='jellyfin' ? {credentials:null} : {}),
  };
  const row = await getDb().transaction(async tx => {
    if (data.provider === 'seerr' && data.linkedMediaInstanceId) {
      // Hold the linked row until the reference is visible to deletion.
      const [linked] = await tx.select({ id: providerInstances.id }).from(providerInstances)
        .where(and(eq(providerInstances.id, data.linkedMediaInstanceId), eq(providerInstances.provider, 'jellyfin')))
        .for('share');
      if (!linked) throw new AppError(409, 'The selected Jellyfin instance no longer exists.');
    }
    const [saved] = data.id
    ? await tx
        .update(providerInstances)
        .set(values)
        .where(and(eq(providerInstances.id,data.id),data.provider==='jellyfin'
          ? sql`${providerInstances.credentials} is not distinct from ${previous?.credentials??null}`:undefined))
        .returning()
    : await tx.insert(providerInstances).values(values).returning();
    return saved;
  });
  if (!row) throw new AppError(409,'The integration changed. Reload before saving again.');
  return { id: row.id, name: row.name, provider: row.provider, baseUrl: row.baseUrl };
}

export async function listProviders(userId: string, includeDisabled = false) {
  if (includeDisabled) await requireProviderAdmin(userId);
  const config = includeDisabled ? undefined : await getFeatureConfig(userId);
  const db = getDb();
  const [instances, connections, accounts] = await Promise.all([
    db.select({
      id: providerInstances.id,
      provider: providerInstances.provider,
      name: providerInstances.name,
      baseUrl: providerInstances.baseUrl,
      settings: providerInstances.settings,
      enabled: providerInstances.enabled,
      linkedMediaInstanceId: providerInstances.linkedMediaInstanceId,
      hasCredentials: sql<boolean>`coalesce(${providerInstances.credentials}, '') <> ''`,
    }).from(providerInstances).where(includeDisabled ? undefined : eq(providerInstances.enabled, true)),
    db.select({
      id: providerConnections.id,
      instanceId: providerConnections.instanceId,
      accountGeneration: providerConnections.accountGeneration,
      username: providerConnections.username,
      status: providerConnections.status,
      settings: providerConnections.settings,
      updatedAt: providerConnections.updatedAt,
    }).from(providerConnections).where(eq(providerConnections.userId, userId)),
    includeDisabled ? db.select({
      id: providerConnections.id, instanceId: providerConnections.instanceId, username: users.username, role: users.role,
    }).from(providerConnections).innerJoin(users, eq(users.id, providerConnections.userId))
      .where(and(eq(providerConnections.status, 'connected'), eq(users.disabled, false)))
      .orderBy(providerConnections.createdAt, providerConnections.id) : [],
  ]);
  const connectionByInstance = new Map(connections.map(connection => [connection.instanceId, connection]));
  const accountsByInstance = new Map<string, Omit<(typeof accounts)[number], 'instanceId'>[]>();
  for (const { instanceId, ...account } of accounts) {
    const linked = accountsByInstance.get(instanceId);
    if (linked) linked.push(account);
    else accountsByInstance.set(instanceId, [account]);
  }
  return instances
    .filter((instance) => (!config || config.experimentalGaming) || !['igdb','steam'].includes(instance.provider))
    .filter((instance) => (!config || config.experimentalComics) || instance.provider !== 'comic-vine')
    .map((instance) => {
      const connection = connectionByInstance.get(instance.id);
      const linkedAccounts = accountsByInstance.get(instance.id) ?? [];
      return {
        connectedAccounts: linkedAccounts.length,
        accounts: linkedAccounts,
        libraryScan: includeDisabled ? instance.settings.libraryScan : undefined,
        companion: includeDisabled && instance.provider==='jellyfin' ? instance.settings.companion : undefined,
        id: instance.id,
        provider: instance.provider,
        name: instance.name,
        baseUrl: instance.baseUrl,
        ...(includeDisabled && instance.provider === 'jellyfin' ? {
          lanUrl:typeof instance.settings.lanUrl === 'string' ? instance.settings.lanUrl : null,
          managementKeyConfigured:!!instance.settings.managementKeyGeneration && instance.hasCredentials,
          subtitleAuthority:instance.settings.subtitleAuthority==='server'?'server' as const:'viewer' as const
        } : {}),
        enabled: instance.enabled,
        schedule: providerSchedule(instance.provider, instance.settings.schedule),
        allowPrivateNetwork: instance.settings.allowPrivateNetwork === true,
        linkedMediaInstanceId: instance.linkedMediaInstanceId,
        configured: instance.hasCredentials || instance.provider === 'jellyfin',
        connection: connection
          ? {
              id: connection.id,
              accountGeneration: connection.accountGeneration,
              username: connection.username,
              status: connection.status,
              settings: {
                liveRead: connection.settings.liveRead,
                sync: connection.settings.sync,
                ...(instance.provider === 'trakt' ? { traktAccess: connection.settings.traktAccess, traktSync: connection.settings.traktSync } : {}),
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

/** Server transport only. Public provider identity and browser-facing URLs stay unchanged. */
export function instanceServerUrl(instance: Pick<typeof providerInstances.$inferSelect, 'provider' | 'baseUrl' | 'settings'>) {
  return instance.provider === 'jellyfin' && typeof instance.settings.lanUrl === 'string' && instance.settings.lanUrl
    ? instance.settings.lanUrl : instance.baseUrl;
}

export async function instanceFetchConfig(
  instance: typeof providerInstances.$inferSelect
): Promise<ProviderFetchConfig> {
  const config = await getConfig();
  const fixed = ['tmdb', 'trakt', 'igdb', 'steam', 'comic-vine'].includes(instance.provider);
  if (
    fixed &&
    instance.baseUrl !==
      (instance.provider === 'comic-vine' ? COMIC_VINE_BASE_URL : instance.provider === 'tmdb'
        ? 'https://api.themoviedb.org'
        : instance.provider === 'igdb'
          ? IGDB_BASE_URL
          : instance.provider === 'steam' ? STEAM_BASE_URL : 'https://api.trakt.tv')
  )
    throw new Error('This global provider URL is not allowed.');
  const baseUrl = instanceServerUrl(instance);
  if (baseUrl !== instance.baseUrl && instance.settings.allowPrivateNetwork !== true)
    throw new Error('Approve private network access to use the Jellyfin LAN URL.');
  if (
    !fixed &&
    config.serverAllowlist.length &&
    ![instance.baseUrl, baseUrl].every(url => config.serverAllowlist.some(entry => entry === new URL(url).hostname || entry === url))
  )
    throw new Error('This service is outside the administrator server allowlist.');
  return {
    baseUrl,
    provider: instance.provider,
    approved: instance.settings.approved === true,
    allowPrivateNetwork: instance.settings.allowPrivateNetwork === true,
    allowedPorts: fixed ? [443] : config.allowedProviderPorts,
  };
}

export function instanceTransport(instance: typeof providerInstances.$inferSelect, signal?: AbortSignal) {
  return async (path: string, init?: RequestInit) => {
    signal?.throwIfAborted();
    const config = await instanceFetchConfig(instance);
    if (instance.provider === 'trakt' && ['/oauth/device/code', '/oauth/device/token', '/oauth/token'].includes(path)) {
      config.baseUrl = 'https://auth.trakt.tv';
      config.allowPrivateNetwork = false;
    }
    signal?.throwIfAborted();
    return createProviderTransport(config)(path, signal
      ? {...init,signal:init?.signal?AbortSignal.any([signal,init.signal]):signal}
      : init);
  };
}

/** A server key is only for explicit management calls after the caller authorizes its action. */
export async function jellyfinManagement(instance:typeof providerInstances.$inferSelect,signal?:AbortSignal) {
  const generation=instance.settings.managementKeyGeneration;
  if(instance.provider!=='jellyfin'||!instance.enabled||!instance.serverIdentity||!instance.credentials||typeof generation!=='string')
    throw new AppError(409,'Configure a Jellyfin server API key for this integration.','jellyfin_key_required');
  await new JellyfinAdapter(instanceTransport(instance,signal),'coast-management').identity(instance.serverIdentity,signal);
  const {apiKey}=v.parse(v.object({apiKey:v.string()}),JSON.parse(await decryptCredential(instance.credentials)));
  return {adapter:new JellyfinAdapter(instanceTransport(instance,signal),'coast-management',apiKey),instance,generation};
}
