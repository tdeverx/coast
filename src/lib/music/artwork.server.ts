import { requireFeature } from '#lib/server/features.js';
import { serverArtwork } from '#lib/providers/server-artwork.server.js';
import * as v from 'valibot';
import { getJellyfin } from '#lib/providers/jellyfin/connection.server.js';
import { jellyfinMusicIdSchema } from '#lib/providers/jellyfin/music.server.js';
import { instanceFetchConfig } from '#lib/providers/instances.server.js';
import { decryptCredential } from '#lib/server/security/credentials.js';
import { secureProviderFetch } from '#lib/server/security/provider-fetch.js';
import { jellyfinAuthorization } from '#lib/providers/jellyfin/adapter.server.js';

export async function streamMusicArtwork(
  userId: string,
  connectionId: string,
  id: string,
  request: Request
) {
  request.signal.throwIfAborted();
  v.parse(jellyfinMusicIdSchema, id);
  await requireFeature(userId,'music');
  const { adapter, connection, instance } = await getJellyfin(userId, connectionId);
  // Verify music type and access through this account before fetching artwork.
  await adapter.musicItem(connection.externalUserId!, id,request.signal);
  request.signal.throwIfAborted();
  const credentials = JSON.parse(await decryptCredential(connection.credentials!)) as {
    accessToken: string;
  };
  return serverArtwork([instance.id,instance.serverIdentity??'',instance.baseUrl,connection.id,String(connection.accountGeneration),id,'Primary','780',String(Math.floor(Date.now()/3600000))],async signal=>secureProviderFetch(
    await instanceFetchConfig(instance),
    `/Items/${encodeURIComponent(id)}/Images/Primary/0?format=Webp&maxWidth=780&quality=85`,
    {
      headers: {
        Authorization: jellyfinAuthorization(userId, credentials.accessToken),
      },
      signal,
    },
    { maxBytes: 10 * 1024 * 1024 }
  ),request.signal);
}
