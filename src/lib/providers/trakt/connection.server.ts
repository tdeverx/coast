import * as v from 'valibot';
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { providerInstances, providerConnections, users } from '#lib/server/db/schema.js';
import { encryptCredential, decryptCredential } from '#lib/server/security/credentials.js';
import { getConfig } from '#lib/server/config.js';
import { TraktAdapter } from '#lib/providers/trakt/adapter.server.js';
import type { SyncPreferences } from '#lib/providers/contracts.js';
import { getInstance, instanceTransport, instanceFetchConfig } from '#lib/providers/instances.server.js';
import { createProviderTransport, ProviderHttpError } from '#lib/server/security/provider-fetch.js';
import { initialTraktSync, traktAllows, traktPreferences, traktSyncSchema, type TraktDirection, type TraktFeature } from './access';
import { cancelDisabledTraktJobs, traktFeatureAllowed } from './access.server';
import { connectionFor, saveConnection, upgradeTraktIdentity } from '#lib/providers/connections.server.js';
import { PermanentActionError } from '#lib/server/queue/index.js';
import { jobExecution, JobYield } from '#lib/server/queue/execution.js';
import { AppError } from '#lib/server/security/errors.js';

const savedTokenSchema=v.object({access_token:v.string(),refresh_token:v.string(),created_at:v.number(),expires_in:v.number()});
const tokenNeedsRefresh=(token:v.InferOutput<typeof savedTokenSchema>)=>(token.created_at+token.expires_in)*1000<Date.now()+60000;

/** Upgrade the merged slug identity only after the authenticated account proves it. */
export async function verifyTraktIdentity(connection:typeof providerConnections.$inferSelect,profile:{id:string;slug?:string}){
  if(!connection.settings.traktIdentityPending)return connection;
  if(profile.id!==connection.externalUserId&&profile.slug!==connection.externalUserId)
    throw new Error('Reconnect Trakt to verify the current account.');
  return getDb().transaction(async tx=>{
    const [current]=await tx.select().from(providerConnections).where(eq(providerConnections.id,connection.id)).for('update');
    if(!current||current.accountGeneration!==connection.accountGeneration||current.externalUserId!==connection.externalUserId)
      throw new Error('The connected account changed.');
    return upgradeTraktIdentity(tx, current, profile.id);
  });
}

async function traktApp(instance: typeof providerInstances.$inferSelect) {
  if (!(await getConfig()).enableTrakt)
    throw new Error('Trakt is disabled by the administrator.');
  if (!instance.credentials)
    throw new Error('Trakt application credentials are not configured.');
  return v.parse(
    v.object({ clientId: v.string(), clientSecret: v.string() }),
    JSON.parse(await decryptCredential(instance.credentials))
  );
}

/** Public catalogue reads never use a member's access token or trigger personal sync. */
export async function getTraktCommunity(instanceId?: string) {
  if (!(await getConfig()).enableTrakt) return null;
  const [instance] = await getDb()
    .select()
    .from(providerInstances)
    .where(and(eq(providerInstances.provider, 'trakt'), eq(providerInstances.enabled, true),
      instanceId ? eq(providerInstances.id,instanceId) : undefined))
    .orderBy(providerInstances.id)
    .limit(1);
  if (!instance?.credentials) return null;
  const app = await traktApp(instance);
  return {
    instanceId: instance.id,
    cacheScope: `${instance.id}:${createHash('sha256').update(instance.credentials).digest('hex')}`,
    adapter: new TraktAdapter(instanceTransport(instance), app.clientId, app.clientSecret),
  };
}

const challengeSchema = v.object({
  challengeId: v.pipe(v.string(), v.uuid()),
  deviceCode: v.string(),
  deviceExpires: v.number(),
  interval: v.number(),
  nextPoll: v.number(),
  sync: traktSyncSchema,
  tokens: v.optional(savedTokenSchema),
});
const challengeChanged = () => new AppError(409, 'This Trakt linking request was replaced or cancelled. Start again.');

export async function startTraktDevice(userId: string, instanceId: string, input: unknown = initialTraktSync()) {
  const sync = v.parse(traktSyncSchema, input);
  const instance = await getInstance(instanceId, 'trakt'), app = await traktApp(instance);
  const db = getDb();
  const key = and(eq(providerConnections.userId, userId), eq(providerConnections.instanceId, instanceId));
  const [previous] = await db.select({ id: providerConnections.id, status: providerConnections.status,
    credential: providerConnections.credentials }).from(providerConnections).where(key);
  if (previous?.status === 'connected') throw new AppError(409, 'Disconnect the current Trakt account before linking another.');
  const device = await new TraktAdapter(instanceTransport(instance), app.clientId, app.clientSecret).startDevice();
  const challengeId = crypto.randomUUID(), now = Date.now();
  const credentials = await encryptCredential(JSON.stringify({
    challengeId, deviceCode: device.device_code, deviceExpires: now + device.expires_in * 1000,
    interval: device.interval, nextPoll: now + device.interval * 1000, sync,
  }));
  const written = previous
    ? await db.update(providerConnections).set({ credentials, status: 'disconnected', updatedAt: new Date() })
      .where(and(eq(providerConnections.id, previous.id), eq(providerConnections.status, previous.status),
        sql`${providerConnections.credentials} is not distinct from ${previous.credential}`)).returning({ id: providerConnections.id })
    : await db.insert(providerConnections).values({ userId, instanceId, credentials, status: 'disconnected' })
      .onConflictDoNothing({ target: [providerConnections.userId, providerConnections.instanceId] }).returning({ id: providerConnections.id });
  if (!written.length) throw challengeChanged();
  return { challengeId, userCode: device.user_code, verificationUrl: device.verification_url,
    expiresIn: device.expires_in, interval: device.interval };
}

export async function finishTraktDevice(userId: string, instanceId: string, challengeId: string) {
  const instance = await getInstance(instanceId, 'trakt'), app = await traktApp(instance);
  // The claim outlasts the bounded HTTP operation. A crashed poll can be retried
  // without holding a database connection while Trakt or its network queue waits.
  const pollTimeoutMs = 30_000, claimMs = pollTimeoutMs + 15_000;
  const transport = instanceTransport(instance, AbortSignal.timeout(pollTimeoutMs));
  const db = getDb();
  const [connection] = await db.select({ id: providerConnections.id, credentials: providerConnections.credentials })
    .from(providerConnections).where(and(eq(providerConnections.userId, userId), eq(providerConnections.instanceId, instanceId),
      eq(providerConnections.status, 'disconnected')));
  if (!connection?.credentials) throw challengeChanged();
  const decoded = v.safeParse(challengeSchema, JSON.parse(await decryptCredential(connection.credentials)));
  if (!decoded.success || decoded.output.challengeId !== challengeId) throw challengeChanged();
  const challenge = decoded.output;
  let expectedCredential = connection.credentials;
  const savePending = async (clear = false) => {
    const credentials = clear ? null : await encryptCredential(JSON.stringify(challenge));
    const rows = await db.update(providerConnections).set({ credentials, updatedAt: new Date() })
      .where(and(eq(providerConnections.id, connection.id), eq(providerConnections.status, 'disconnected'),
        eq(providerConnections.credentials, expectedCredential))).returning({ id: providerConnections.id });
    if (rows.length && credentials) expectedCredential = credentials;
    return rows.length > 0;
  };
  if (Date.now() >= challenge.deviceExpires) {
    if (!await savePending(true)) throw challengeChanged();
    throw new AppError(410, 'The Trakt code expired. Start linking again.');
  }
  if (Date.now() < challenge.nextPoll) return { pending: true as const };
  challenge.nextPoll = Date.now() + claimMs;
  if (!await savePending()) return { pending: true as const };
  if (!challenge.tokens) {
    try {
      challenge.tokens = await new TraktAdapter(transport, app.clientId, app.clientSecret).finishDevice(challenge.deviceCode);
    } catch (error) {
      if (error instanceof ProviderHttpError) {
        if (error.status === 400 || error.status === 429) {
          if (error.status === 429) challenge.interval += 5;
          challenge.nextPoll = Date.now() + Math.max(challenge.interval, error.retryAfterSeconds ?? 0) * 1000;
          if (!await savePending()) throw challengeChanged();
          return { pending: true as const };
        }
        const terminal: Record<number, string> = {
          404: 'The Trakt code is invalid.', 409: 'This Trakt code has already been used.',
          410: 'The Trakt code expired.', 418: 'Trakt linking was declined.',
        };
        if (terminal[error.status]) {
          if (!await savePending(true)) throw challengeChanged();
          throw new AppError(400, terminal[error.status] + ' Start linking again.');
        }
      }
      challenge.nextPoll = Date.now() + challenge.interval * 1000;
      if (!await savePending()) throw challengeChanged();
      throw error;
    }
    // The exchange consumes the code. Save its tokens before verifying identity in case of an outage.
    if (!await savePending()) throw challengeChanged();
  }
  let profile;
  try {
    profile = await new TraktAdapter(transport, app.clientId, app.clientSecret, challenge.tokens.access_token).profile();
  } catch (error) {
    challenge.nextPoll = Date.now() + challenge.interval * 1000;
    if (!await savePending()) throw challengeChanged();
    throw error;
  }
  const saved = await saveConnection(userId, instanceId, profile.id, profile.username, challenge.tokens,
    { traktSync: challenge.sync },
    { expectedCredential, slug: profile.slug, sync: challenge.sync });
  return { pending: false as const, connection: saved };
}

export async function getTrakt(userId: string, connectionId: string, direction: TraktDirection = 'import', feature?: TraktFeature) {
  const context = await connectionFor(userId, connectionId, 'trakt'),
    app = await traktApp(context.instance);
  const disabled = () => new PermanentActionError(`Trakt ${direction} is off for this connection.`);
  if (!traktAllows(context.connection.settings, direction, feature)) throw disabled();
  if (!context.connection.credentials) throw new Error('Reconnect Trakt to continue.');
  const initial=v.parse(savedTokenSchema,JSON.parse(await decryptCredential(context.connection.credentials)));
  // Valid tokens do not need a transaction or the rotating-refresh-token lock.
  const token = !tokenNeedsRefresh(initial)?initial:await getDb().transaction(async (tx) => {
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
    if (!current?.credentials || current.accountGeneration !== context.connection.accountGeneration) throw new Error('Reconnect Trakt to continue.');
    if (!traktAllows(current.settings, direction, feature)) throw disabled();
    let saved = v.parse(
      savedTokenSchema,
      JSON.parse(await decryptCredential(current.credentials))
    );
    if (tokenNeedsRefresh(saved)) {
      saved = await new TraktAdapter(
        instanceTransport(context.instance),
        app.clientId,
        app.clientSecret
      ).refresh(saved.refresh_token);
      await tx
        .update(providerConnections)
        .set({
          credentials: await encryptCredential(JSON.stringify(saved)),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(providerConnections.id, connectionId),
            eq(providerConnections.accountGeneration,context.connection.accountGeneration),
            eq(providerConnections.status, 'connected')
          )
        );
    }
    return saved;
  });
  const beforeDispatch = async () => {
    const job=jobExecution.getStore();
    const [active]=await getDb().select({
      allowed: traktFeatureAllowed(direction, feature),
      leased: job ? sql<boolean>`exists(select 1 from outbox_actions where id=${job.id}
        and state='running' and attempts=${job.attempts})` : sql<boolean>`true`,
    }).from(providerConnections)
      .innerJoin(providerInstances,eq(providerInstances.id,providerConnections.instanceId))
      .innerJoin(users,eq(users.id,providerConnections.userId))
      .where(and(eq(providerConnections.id,connectionId),eq(providerConnections.userId,userId),
        eq(providerConnections.accountGeneration,context.connection.accountGeneration),eq(providerConnections.status,'connected'),
        eq(providerInstances.enabled,true),eq(users.disabled,false)));
    if(!active||!(await getConfig()).enableTrakt)throw new PermanentActionError('The connected Trakt account changed or is disabled.');
    if (!active.leased) throw new JobYield();
    if (active.allowed !== true) throw disabled();
  };
  const adapter=new TraktAdapter(async(path,init)=>{
    if (init?.method && !['GET','HEAD'].includes(init.method.toUpperCase()) && direction !== 'export')
      throw new PermanentActionError('This Trakt operation requires export permission.');
    const config = await instanceFetchConfig(context.instance);
    return createProviderTransport({ ...config, beforeDispatch })(path,init);
  },app.clientId,app.clientSecret,token.access_token);
  const connection=context.connection.settings.traktIdentityPending
    ? await verifyTraktIdentity(context.connection,await adapter.profile()) : context.connection;
  const preferences = traktPreferences(connection.settings);
  const sync: SyncPreferences = direction === 'export' ? preferences.export : { ...preferences.import, scrobble: false };
  return { ...context, connection, adapter, sync };
}

export async function updateSyncPreferences(
  userId: string,
  connectionId: string,
  input: unknown
) {
  const {connection:expected}=await connectionFor(userId, connectionId, 'trakt');
  const { traktSync, accountGeneration } = v.parse(v.object({
    accountGeneration: v.pipe(v.string(), v.uuid()),
    traktSync: traktSyncSchema,
  }), input);
  await getDb().transaction(async tx=>{
    const [current]=await tx.select().from(providerConnections).where(and(eq(providerConnections.id,connectionId),eq(providerConnections.userId,userId))).for('update');
    if(!current||current.accountGeneration!==accountGeneration||current.accountGeneration!==expected.accountGeneration||current.status!=='connected')
      throw new AppError(409,'The connected account changed. Reload before saving preferences.');
    const [saved] = await tx.update(providerConnections).set({
      settings: sql`(${providerConnections.settings} - 'sync' - 'traktAccess' - 'liveRead') || ${{ traktSync }}::jsonb`,
      updatedAt: new Date(),
    }).where(eq(providerConnections.id,connectionId)).returning();
    await cancelDisabledTraktJobs(tx, saved, current.settings);
  });
  return { accountGeneration, traktSync };
}
