import { and, eq } from 'drizzle-orm';
import { type Database } from '$lib/server/db';
import { users, providerConnections, providerInstances } from '$lib/server/db/schema';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Only a fresh observation from the preferred account can supply its winning value. */
export function preferredConflictSide(preference: string | undefined, connectionId: string) {
  if (preference === 'coast') return 'local';
  if (preference === connectionId) return 'remote';
  return 'manual';
}

export async function conflictPreference(tx: Transaction, userId: string, connectionId: string) {
  const [user] = await tx
    .select({ settings: users.settings })
    .from(users)
    .where(eq(users.id, userId));
  const side = preferredConflictSide(user?.settings.syncConflictWinner, connectionId);
  if (side !== 'remote') return side;
  const [connection] = await tx
    .select({ id: providerConnections.id })
    .from(providerConnections)
    .innerJoin(providerInstances, eq(providerInstances.id, providerConnections.instanceId))
    .where(
      and(
        eq(providerConnections.id, connectionId),
        eq(providerConnections.userId, userId),
        eq(providerConnections.status, 'connected'),
        eq(providerInstances.enabled, true)
      )
    );
  return connection ? 'remote' : 'manual';
}
