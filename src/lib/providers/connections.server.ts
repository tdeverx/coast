import * as v from 'valibot';
import { AppError } from '$lib/server/security/errors';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
  providerConnections,
  providerInstances,
  userIdentities,
  availability,
  outboxActions,
  syncCheckpoints,
} from '$lib/server/db/schema';
import { encryptCredential } from '$lib/server/security/credentials';
import { getInstance } from '$lib/providers/instances.server';
import { maintenanceKinds } from '$lib/providers/tasks';

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

export async function saveConnection(
  userId: string,
  instanceId: string,
  externalUserId: string,
  username: string,
  credentials: Record<string, unknown>,
  settings: Record<string, unknown> = {}
) {
  const secret = await encryptCredential(JSON.stringify(credentials));
  const connection = await getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(73001602)`);
    const [lane]=await tx.select({id:providerConnections.id}).from(providerConnections).where(and(eq(providerConnections.userId,userId),eq(providerConnections.instanceId,instanceId)));
    if(lane) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`queue-lane:${userId}:${lane.id}`},0))`);
    const [previous] = await tx.select({ externalUserId: providerConnections.externalUserId, id: providerConnections.id })
      .from(providerConnections).where(and(eq(providerConnections.userId, userId), eq(providerConnections.instanceId, instanceId)));
    if (previous && previous.externalUserId !== externalUserId) {
      await tx.delete(syncCheckpoints).where(eq(syncCheckpoints.connectionId, previous.id));
      await tx.update(availability).set({ state: 'unknown' }).where(eq(availability.connectionId, previous.id));
      await tx.update(outboxActions).set({ state: 'cancelled', updatedAt: new Date() })
        .where(and(eq(outboxActions.connectionId, previous.id), sql`${outboxActions.state} in ('pending','failed')`));
    }
    const [connection] = await tx
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
          settings: previous?.externalUserId === externalUserId ? sql`(${providerConnections.settings} || ${settings}::jsonb) - 'collectionSourceExcluded' - 'sourceChangePreview'` : settings,
          status: 'connected',
          updatedAt: new Date(),
        },
      })
      .returning();
    // A verified reconnect supersedes failed reads, while outbound intent keeps its order.
    const superseded=await tx.update(outboxActions).set({state:'cancelled',lastError:'Superseded by a verified account reconnect.',updatedAt:new Date()})
      .where(and(eq(outboxActions.connectionId,connection.id),eq(outboxActions.accountGeneration,connection.accountGeneration),eq(outboxActions.state,'failed'),sql`${outboxActions.kind} in (${sql.join(maintenanceKinds.map(kind=>sql`${kind}`),sql`,`)})`)).returning({id:outboxActions.id});
    for(const action of superseded)await tx.execute(sql`delete from notifications where user_id=${userId} and source_key=${`outbox:${action.id}`}`);
    await tx
      .delete(userIdentities)
      .where(
        and(
          eq(userIdentities.userId, userId),
          eq(userIdentities.instanceId, instanceId),
          sql`${userIdentities.externalUserId} <> ${externalUserId}`
        )
      );
    return connection;
  });
  return { id: connection.id, username: connection.username, status: connection.status };
}

export async function updateLiveRead(userId:string,connectionId:string,input:unknown){
 const {enabled}=v.parse(v.object({enabled:v.boolean()}),input);
 const [row]=await getDb().select({provider:providerInstances.provider}).from(providerConnections).innerJoin(providerInstances,eq(providerInstances.id,providerConnections.instanceId)).where(and(eq(providerConnections.id,connectionId),eq(providerConnections.userId,userId)));
 if(!row || !['jellyfin','steam'].includes(row.provider))throw new AppError(404,'Connection not found.');
 const {connection}=await connectionFor(userId,connectionId,row.provider as 'jellyfin'|'steam');
 await getDb().update(providerConnections).set({settings:sql`${providerConnections.settings} || jsonb_build_object('liveRead',${enabled}::boolean)`,updatedAt:new Date()}).where(and(eq(providerConnections.id,connectionId),eq(providerConnections.accountGeneration,connection.accountGeneration!)));
 return {enabled};
}
