import * as v from 'valibot';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { providerInstances, providerConnections, syncAccounts } from '$lib/server/db/schema';
import { encryptCredential, decryptCredential } from '$lib/server/security/credentials';
import { getConfig } from '$lib/server/config';
import { TraktAdapter } from '$lib/providers/trakt/adapter.server';
import { defaultSyncPreferences, type SyncPreferences } from '$lib/providers/contracts';
import { getInstance, instanceTransport } from '$lib/providers/instances.server';
import { connectionFor, saveConnection } from '$lib/providers/connections.server';

/** Upgrade the merged slug identity only after the authenticated account proves it. */
export async function verifyTraktIdentity(connection:typeof providerConnections.$inferSelect,profile:{id:string;slug?:string}){
  if(!connection.settings.traktIdentityPending)return connection;
  if(profile.id!==connection.externalUserId&&profile.slug!==connection.externalUserId)
    throw new Error('Reconnect Trakt to verify the current account.');
  return getDb().transaction(async tx=>{
    const [current]=await tx.select().from(providerConnections).where(eq(providerConnections.id,connection.id)).for('update');
    if(!current||current.accountGeneration!==connection.accountGeneration||current.externalUserId!==connection.externalUserId)
      throw new Error('The connected account changed.');
    const settings={...current.settings};delete settings.traktIdentityPending;
    const [account]=await tx.select().from(syncAccounts).where(and(eq(syncAccounts.id,current.syncAccountId!),eq(syncAccounts.provider,'trakt'))).for('update');
    if(!account)throw new Error('Reconnect Trakt to verify the current account.');
    // Updating the durable account first lets the connection trigger distinguish
    // this verified identity correction from switching to another provider account.
    await tx.update(syncAccounts).set({externalUserId:profile.id,settings,verifiedAt:new Date()}).where(eq(syncAccounts.id,account.id));
    const [verified]=await tx.update(providerConnections).set({externalUserId:profile.id,settings,updatedAt:new Date()}).where(eq(providerConnections.id,current.id)).returning();
    return verified;
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
      and(
        eq(providerConnections.userId, userId),
        eq(providerConnections.instanceId, instanceId)
      )
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
      and(
        eq(providerConnections.userId, userId),
        eq(providerConnections.instanceId, instanceId)
      )
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
    const verified=connection.settings.traktIdentityPending && (profile.id===connection.externalUserId||profile.slug===connection.externalUserId)
      ? await verifyTraktIdentity(connection,profile) : connection;
    return {
      pending: false,
      connection: await saveConnection(
        userId,
        instanceId,
        profile.id,
        profile.username,
        tokens,
        {
          sync: verified.externalUserId === profile.id ? verified.settings.sync ?? defaultSyncPreferences : defaultSyncPreferences,
        }
      ),
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
    if (!current?.credentials || current.accountGeneration !== context.connection.accountGeneration) throw new Error('Reconnect Trakt to continue.');
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
        .set({
          credentials: await encryptCredential(JSON.stringify(saved)),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(providerConnections.id, connectionId),
            eq(providerConnections.status, 'connected')
          )
        );
    }
    return saved;
  });
  const adapter=new TraktAdapter(instanceTransport(context.instance),app.clientId,app.clientSecret,token.access_token);
  const connection=context.connection.settings.traktIdentityPending
    ? await verifyTraktIdentity(context.connection,await adapter.profile()) : context.connection;
  return {
    ...context,
    connection,
    adapter,
    sync: {
      ...defaultSyncPreferences,
      ...(connection.settings.sync as Partial<SyncPreferences>),
    },
  };
}

export async function updateSyncPreferences(
  userId: string,
  connectionId: string,
  input: unknown
) {
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
