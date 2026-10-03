import { eq, and, sql, inArray, or } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { providerConnections, providerInstances, availability, outboxActions } from '$lib/server/db/schema';
import { connectionFor } from '$lib/providers/connections.server';
import { requireProviderAdmin } from '$lib/providers/instances.server';
import { resolveNotification } from '$lib/server/notifications';
import { AppError } from '$lib/server/security/errors';
import { validateSourceChange, markSourceChange, notifySourceChange, notifySourceChangeUsers } from '$lib/collection/source-changes.server';

export async function disconnectProvider(userId: string, connectionId: string,previewId?:string) {
  const {instance}=await connectionFor(userId, connectionId);
  if(instance.provider==='jellyfin')await validateSourceChange(userId,connectionId,'connection',previewId);
  const cancelled = await getDb().transaction(async (tx) => {
    if(instance.provider==='jellyfin')await markSourceChange(tx,[connectionId],true);
    await tx
      .update(providerConnections)
      .set({ status: 'disconnected', credentials: null, updatedAt: new Date() })
      .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)));
    await tx
      .update(availability)
      .set({ state: 'unknown' })
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
  if(instance.provider==='jellyfin')await notifySourceChange([connectionId]);
}

export async function setInstanceEnabled(adminId:string,instanceId:string,enabled:boolean,previewId?:string){
  await requireProviderAdmin(adminId);
  const [instance]=await getDb().select().from(providerInstances).where(eq(providerInstances.id,instanceId));
  if(!instance)throw new AppError(404,'Integration not found.');
  if(instance.provider==='jellyfin'&&!enabled)await validateSourceChange(adminId,instanceId,'instance',previewId);
  const sources=await getDb().select({id:providerConnections.id}).from(providerConnections).where(eq(providerConnections.instanceId,instanceId));
  await getDb().transaction(async tx=>{
    if(instance.provider==='jellyfin')await markSourceChange(tx,sources.map(s=>s.id),!enabled);
    await tx.update(providerInstances).set({enabled,settings:sql`${providerInstances.settings}-'sourceChangePreview'`}).where(eq(providerInstances.id,instanceId));
  });
  if(instance.provider==='jellyfin'&&!enabled)await notifySourceChange(sources.map(s=>s.id));
  return {enabled};
}

/** Remove service bindings, never the shared catalogue or personal tracking. */
export async function deleteInstance(adminId: string, instanceId: string, previewId?: string) {
  await requireProviderAdmin(adminId);
  const affectedUsers = await getDb().transaction(async (tx) => {
    // Coordinate with connection linking, scheduling and claims before removing credentials.
    const [locks] = await tx.execute<{ connections: boolean; maintenance: boolean; claims: boolean }>(sql`
      select pg_try_advisory_xact_lock(73001602) as connections,
        pg_try_advisory_xact_lock(hashtextextended('provider-maintenance',0)) as maintenance,
        pg_try_advisory_xact_lock(hashtextextended('queue-claim',0)) as claims
    `);
    if (!locks.connections || !locks.maintenance || !locks.claims)
      throw new AppError(409, 'Integration work is in progress. Try deleting again when it finishes.');
    const [instance] = await tx.select().from(providerInstances).where(eq(providerInstances.id, instanceId)).for('update');
    if (!instance) throw new AppError(404, 'Integration not found.');
    const [linked] = await tx.select({ name: providerInstances.name }).from(providerInstances)
      .where(eq(providerInstances.linkedMediaInstanceId, instanceId)).limit(1);
    if (linked) throw new AppError(409, `Update or delete the linked integration “${linked.name}” first.`);
    const sources = await tx.select({ id: providerConnections.id, userId: providerConnections.userId })
      .from(providerConnections).where(eq(providerConnections.instanceId, instanceId));
    for (const source of sources) {
      for (const key of [`${source.userId}:${source.id}`, `queue-lane:${source.userId}:${source.id}`, `queue-lane:${source.userId}:${source.id}:live`]) {
        const [lock] = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended(${key},0)) as acquired`);
        if (!lock.acquired) throw new AppError(409, 'A job is using this integration. Wait for it to finish before deleting.');
      }
    }
    const actions = or(
      sql`${outboxActions.payload}->>'instanceId' = ${instanceId}`,
      sources.length ? inArray(outboxActions.connectionId, sources.map(source => source.id)) : sql`false`
    );
    const [running] = await tx.select({ id: outboxActions.id }).from(outboxActions)
      .where(and(actions, eq(outboxActions.state, 'running'))).limit(1);
    if (running) throw new AppError(409, 'A job is using this integration. Wait for it to finish before deleting.');
    if (instance.provider === 'jellyfin') await validateSourceChange(adminId, instanceId, 'instance', previewId);
    const cancelled = await tx.update(outboxActions)
      .set({ state: 'cancelled', lastError: 'Integration deleted.', updatedAt: new Date() })
      .where(and(actions, inArray(outboxActions.state, ['pending', 'failed'])))
      .returning({ id: outboxActions.id, userId: outboxActions.userId });
    for (const action of cancelled) await tx.execute(sql`delete from notifications where user_id=${action.userId} and source_key=${`outbox:${action.id}`}`);
    await tx.delete(providerInstances).where(eq(providerInstances.id, instanceId));
    return instance.provider === 'jellyfin' ? sources.map(source => source.userId) : [];
  });
  await notifySourceChangeUsers(affectedUsers);
  return { deleted: true };
}
