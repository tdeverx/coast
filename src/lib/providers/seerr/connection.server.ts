import * as v from 'valibot';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '$lib/server/db';
import { providerConnections, providerInstances, users } from '$lib/server/db/schema';
import { decryptCredential } from '$lib/server/security/credentials';
import { getConfig } from '$lib/server/config';
import { SeerrAdapter } from '$lib/providers/seerr/adapter.server';
import { getInstance, instanceTransport } from '$lib/providers/instances.server';
import { saveConnection } from '$lib/providers/connections.server';
import { PermanentActionError } from '$lib/server/queue';
import { assertJobLease } from '$lib/server/queue/execution';

type Tx=Parameters<Parameters<Database['transaction']>[0]>[0];
export type SeerrAccountScope={userId:string;instanceId:string;connectionId:string;accountGeneration:string;externalUserId:string;
  linkedInstanceId:string;linkedConnectionId:string;linkedGeneration:string;linkedExternalUserId:string};
/** Pin both the request identity and its verified linked Jellyfin account before personal writes. */
export async function assertSeerrAccount(tx:Tx,scope:SeerrAccountScope) {
  const [connection]=await tx.select().from(providerConnections).where(eq(providerConnections.id,scope.connectionId)).for('update');
  const [linked]=await tx.select().from(providerConnections).where(eq(providerConnections.id,scope.linkedConnectionId)).for('update');
  const [instance]=await tx.select().from(providerInstances).where(eq(providerInstances.id,scope.instanceId)).for('update');
  const [mediaInstance]=await tx.select().from(providerInstances).where(eq(providerInstances.id,scope.linkedInstanceId)).for('update');
  const [user]=await tx.select().from(users).where(eq(users.id,scope.userId)).for('update');
  if(!connection||connection.userId!==scope.userId||connection.instanceId!==scope.instanceId||connection.status!=='connected'||
    connection.accountGeneration!==scope.accountGeneration||connection.externalUserId!==scope.externalUserId||
    !linked||linked.userId!==scope.userId||linked.instanceId!==scope.linkedInstanceId||linked.status!=='connected'||
    linked.accountGeneration!==scope.linkedGeneration||linked.externalUserId!==scope.linkedExternalUserId||
    !instance?.enabled||instance.linkedMediaInstanceId!==scope.linkedInstanceId||!mediaInstance?.enabled||!user||user.disabled)
    throw new PermanentActionError('The connected request account changed. Run the task for the current account.');
  await assertJobLease(tx,true);
  return connection;
}

export async function getSeerr(userId: string, instanceId: string,expected?:{connectionId:string;accountGeneration:string}) {
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
  // A queued task must never establish or remap a replacement account while resolving its identity.
  if(expected&&(!existing||existing.id!==expected.connectionId||existing.accountGeneration!==expected.accountGeneration))
    throw new PermanentActionError('The connected request account changed. Run the task for the current account.');
  const saved = existing
    ? existing
    : await saveConnection(
        userId,
        instance.id,
        String(mapped.id),
        mapped.username || mapped.displayName || 'Seerr',
        {},
        {}
      );
  const [connection]=await getDb().select().from(providerConnections).where(eq(providerConnections.id,saved.id));
  if(!connection||expected&&(connection.id!==expected.connectionId||connection.accountGeneration!==expected.accountGeneration))
    throw new PermanentActionError('The connected request account changed.');
  const scope:SeerrAccountScope={userId,instanceId:instance.id,connectionId:connection.id,accountGeneration:connection.accountGeneration,
    externalUserId:String(mapped.id),linkedInstanceId:instance.linkedMediaInstanceId,linkedConnectionId:jellyfin.id,
    linkedGeneration:jellyfin.accountGeneration,linkedExternalUserId:jellyfin.externalUserId};
  await getDb().transaction(async tx=>{
    await assertSeerrAccount(tx,scope);
    await tx
    .update(providerConnections)
    .set({
      settings: sql`${providerConnections.settings} || jsonb_build_object('seerrPermissions',${account.permissions}::integer,'seerrVerifiedAt',${new Date().toISOString()}::text)`,
    })
    .where(eq(providerConnections.id, connection.id));
  });
  return {
    adapter,
    instance,
    connection,
    account,
    scope,
    linkedJellyfinUserId: jellyfin.externalUserId,
  };
}
