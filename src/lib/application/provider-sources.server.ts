import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { providerConnections, providerInstances, availability, outboxActions } from '$lib/server/db/schema';
import { connectionFor } from '$lib/providers/connections.server';
import { requireProviderAdmin } from '$lib/providers/instances.server';
import { resolveNotification } from '$lib/server/notifications';
import { AppError } from '$lib/server/security/errors';
import { validateSourceChange, markSourceChange, notifySourceChange } from '$lib/collection/source-changes.server';

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
