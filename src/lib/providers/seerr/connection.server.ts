import * as v from 'valibot';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { providerConnections } from '$lib/server/db/schema';
import { decryptCredential } from '$lib/server/security/credentials';
import { getConfig } from '$lib/server/config';
import { SeerrAdapter } from '$lib/providers/seerr/adapter.server';
import { getInstance, instanceTransport } from '$lib/providers/instances.server';
import { saveConnection } from '$lib/providers/connections.server';

export async function getSeerr(userId: string, instanceId: string) {
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
  const connection = existing
    ? { id: existing.id, username: existing.username, status: existing.status }
    : await saveConnection(
        userId,
        instance.id,
        String(mapped.id),
        mapped.username || mapped.displayName || 'Seerr',
        {},
        {}
      );
  await getDb()
    .update(providerConnections)
    .set({
      settings: sql`${providerConnections.settings} || jsonb_build_object('seerrPermissions',${account.permissions}::integer,'seerrVerifiedAt',${new Date().toISOString()}::text)`,
    })
    .where(eq(providerConnections.id, connection.id));
  return {
    adapter,
    instance,
    connection,
    account,
    linkedJellyfinUserId: jellyfin.externalUserId,
  };
}
