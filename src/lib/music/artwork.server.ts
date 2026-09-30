import * as v from 'valibot';
import { getJellyfin } from '$lib/providers/jellyfin/connection.server';
import { jellyfinMusicIdSchema } from '$lib/providers/jellyfin/music.server';
import { instanceFetchConfig } from '$lib/providers/instances.server';
import { decryptCredential } from '$lib/server/security/credentials';
import { secureProviderFetch } from '$lib/server/security/provider-fetch';
import { jellyfinAuthorization } from '$lib/providers/jellyfin/adapter.server';

export async function streamMusicArtwork(
  userId: string,
  connectionId: string,
  id: string,
  request: Request
) {
  v.parse(jellyfinMusicIdSchema, id);
  const { adapter, connection, instance } = await getJellyfin(userId, connectionId);
  // Verify music type and access through this account before fetching artwork.
  await adapter.musicItem(connection.externalUserId!, id);
  const credentials = JSON.parse(await decryptCredential(connection.credentials!)) as {
    accessToken: string;
  };
  const response = await secureProviderFetch(
    await instanceFetchConfig(instance),
    `/Items/${encodeURIComponent(id)}/Images/Primary/0?format=Webp&maxWidth=780&quality=85`,
    {
      headers: {
        Authorization: jellyfinAuthorization(userId, credentials.accessToken),
      },
      signal: request.signal,
    },
    { maxBytes: 10 * 1024 * 1024 }
  );
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
    await response.body?.cancel();
    return new Response('Image unavailable.', { status: 404 });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.length < 12 ||
    String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' ||
    String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP'
  )
    return new Response('Image unavailable.', { status: 404 });
  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
