import * as v from 'valibot';
import { AppError } from '#lib/server/security/errors.js';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import {
  providerConnections,
  providerInstances,
  userIdentities,
  availability,
  outboxActions,
  syncCheckpoints,
} from '#lib/server/db/schema.js';
import { encryptCredential } from '#lib/server/security/credentials.js';
import { getInstance } from '#lib/providers/instances.server.js';
import { jellyfinItemKey } from './jellyfin/paging';
import { maintenanceKinds } from '#lib/providers/tasks.js';

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
  if (!connection) throw new AppError(404, 'Connect your account in Settings to continue.', 'not_found');
  return { connection, instance: await getInstance(connection.instanceId, provider) };
}

export async function saveConnection(
  userId: string,
  instanceId: string,
  externalUserId: string,
  username: string,
  credentials: Record<string, unknown>,
  settings: Record<string, unknown> = {},
  jellyfinIdentity = false
) {
  const secret = await encryptCredential(JSON.stringify(credentials));
  const connection = await getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(73001602)`);
    const [lane]=await tx.select({id:providerConnections.id}).from(providerConnections).where(and(eq(providerConnections.userId,userId),eq(providerConnections.instanceId,instanceId)));
    if(lane) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`queue-lane:${userId}:${lane.id}`},0))`);
    const [previous] = await tx.select({ externalUserId: providerConnections.externalUserId, id: providerConnections.id })
      .from(providerConnections).where(and(eq(providerConnections.userId, userId), eq(providerConnections.instanceId, instanceId)));
    if (jellyfinIdentity) {
      const key=jellyfinItemKey(externalUserId);
      const [scope]=await tx.execute<{remote_id:string|null; instance_id:string|null; restricted:boolean}>(sql`
        select p.remote_id,coalesce(p.authority_instance_id,admin.instance_id) as instance_id,coalesce(u.access_defaults->>'libraryOnly'='true',false) as restricted
        from users u left join onboarding_provisioning p on p.user_id=u.id
        left join provider_connections admin on admin.id=p.connection_id and admin.account_generation=p.account_generation
        where u.id=${userId} and not u.disabled and coalesce(u.membership_expires_at>now(),true)`);
      if (!scope) throw new AppError(403,'Your account is unavailable.');
      if (scope.restricted && (scope.instance_id!==instanceId || (!scope.remote_id||jellyfinItemKey(scope.remote_id)!==key)))
        throw new AppError(403,'This account can only connect to its assigned Jellyfin user.');
      const used=await tx.execute(sql`select id from provider_connections where instance_id=${instanceId} and user_id<>${userId} and status<>'disconnected' and replace(lower(external_user_id),'-','')=${key} limit 1`);
      if (used.length) throw new AppError(409,'That Jellyfin account is already connected to a Coast account.');
      await tx.delete(userIdentities).where(and(eq(userIdentities.userId,userId),eq(userIdentities.instanceId,instanceId),sql`${userIdentities.externalUserId}<>${key}`));
      const bound=await tx.insert(userIdentities).values({userId,instanceId,externalUserId:key}).onConflictDoUpdate({
        target:[userIdentities.instanceId,userIdentities.externalUserId],set:{userId},setWhere:eq(userIdentities.userId,userId),
      }).returning({userId:userIdentities.userId});
      if (!bound.length) throw new AppError(409,'That Jellyfin identity already belongs to another Coast account.');
    }
    const previousId = previous?.externalUserId ?? null;
    const sameAccount = previousId !== null && (previousId === externalUserId
      || jellyfinIdentity && jellyfinItemKey(previousId) === jellyfinItemKey(externalUserId));
    // Keep the stored spelling for the same Jellyfin account so the connection
    // trigger preserves its generation and existing availability.
    const storedUserId = sameAccount ? previousId : externalUserId;
    if (previous && !sameAccount) {
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
        externalUserId:storedUserId,
        username,
        credentials: secret,
        settings,
        status: 'connected',
      })
      .onConflictDoUpdate({
        target: [providerConnections.userId, providerConnections.instanceId],
        set: {
          externalUserId:storedUserId,
          username,
          credentials: secret,
          settings: sameAccount ? sql`(${providerConnections.settings} || ${settings}::jsonb) - 'collectionSourceExcluded' - 'sourceChangePreview'` : settings,
          status: 'connected',
          updatedAt: new Date(),
        },
      })
      .returning();
    // A verified reconnect supersedes failed reads, while outbound intent keeps its order.
    const superseded=await tx.update(outboxActions).set({state:'cancelled',lastError:'Superseded by a verified account reconnect.',updatedAt:new Date()})
      .where(and(eq(outboxActions.connectionId,connection.id),eq(outboxActions.accountGeneration,connection.accountGeneration),eq(outboxActions.state,'failed'),sql`${outboxActions.kind} in (${sql.join(maintenanceKinds.map(kind=>sql`${kind}`),sql`,`)})`)).returning({id:outboxActions.id});
    for(const action of superseded)await tx.execute(sql`delete from notifications where user_id=${userId} and source_key=${`outbox:${action.id}`}`);
    if(!jellyfinIdentity) await tx
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
