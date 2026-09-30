import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { providerConnections, availability, outboxActions } from '$lib/server/db/schema';
import { encryptCredential } from '$lib/server/security/credentials';
import { resolveNotification } from '$lib/server/notifications';
import { getInstance } from '$lib/providers/instances.server';

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

export async function disconnectProvider(userId: string, connectionId: string) {
  await connectionFor(userId, connectionId);
  const cancelled = await getDb().transaction(async (tx) => {
    await tx
      .update(providerConnections)
      .set({ status: 'disconnected', credentials: null, updatedAt: new Date() })
      .where(
        and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId))
      );
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
