import * as v from 'valibot';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { providerConnections } from '$lib/server/db/schema';
import { decryptCredential } from '$lib/server/security/credentials';
import { enqueueAction } from '$lib/server/queue';
import { JellyfinAdapter } from '$lib/providers/jellyfin/adapter.server';
import { getInstance, instanceTransport } from '$lib/providers/instances.server';
import { connectionFor, saveConnection } from '$lib/providers/connections.server';

const uuid = v.pipe(v.string(), v.uuid());

export async function connectJellyfin(
  userId: string,
  input: { instanceId: string; username: string; password: string }
) {
  const instance = await getInstance(v.parse(uuid, input.instanceId), 'jellyfin');
  const account = await new JellyfinAdapter(instanceTransport(instance), userId).authenticate(
    input.username,
    input.password,
    instance.serverIdentity || undefined
  );
  const connection = await saveConnection(userId, instance.id, account.id, account.username, {
    accessToken: account.accessToken,
  });
  await enqueueAction({
    userId,
    connectionId: connection.id,
    kind: 'jellyfin.scan',
    payload: { full: true },
    compactionKey: 'jellyfin-scan',
  });
  return connection;
}

export async function getJellyfin(userId: string, connectionId: string) {
  const context = await connectionFor(userId, connectionId, 'jellyfin');
  if (!context.connection.credentials || !context.connection.externalUserId)
    throw new Error('Reconnect Jellyfin to continue.');
  const credentials = v.parse(
    v.object({ accessToken: v.string() }),
    JSON.parse(await decryptCredential(context.connection.credentials))
  );
  return {
    ...context,
    adapter: new JellyfinAdapter(
      instanceTransport(context.instance),
      userId,
      credentials.accessToken
    ),
  };
}

export async function updateJellyfinPlaybackImport(
  userId: string,
  connectionId: string,
  input: unknown
) {
  await connectionFor(userId, connectionId, 'jellyfin');
  const { enabled } = v.parse(v.object({ enabled: v.boolean() }), input);
  await getDb()
    .update(providerConnections)
    .set({
      settings: sql`${providerConnections.settings} || jsonb_build_object('importPlayback', ${enabled}::boolean)`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId))
    );
  return { enabled };
}
