import { serverArtwork } from './server-artwork.server';
import { fallbackArtwork } from './tmdb/fallback.server';
import { artworkTypes, isArtworkType } from '$lib/artwork';
import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { availability, providerItems } from '$lib/server/db/schema';
import { getJellyfin } from './jellyfin/connection.server';
import { instanceFetchConfig } from './instances.server';
import { jellyfinAuthorization } from './jellyfin/adapter.server';
import { decryptCredential } from '$lib/server/security/credentials';
import { secureProviderFetch } from '$lib/server/security/provider-fetch';

/** Relay authorized Jellyfin artwork; use TMDB when the source image is missing. */
export async function streamArtwork(
  userId: string,
  instanceId: string,
  itemId: string,
  type: string,
  request: Request
) {
  if (!isArtworkType(type) || !/^[-\w]{1,100}$/.test(itemId))
    return new Response('Image not found.', { status: 404 });
  const [record] = await getDb()
    .select({ connectionId: availability.connectionId, mediaId: providerItems.mediaId })
    .from(availability)
    .innerJoin(providerItems, eq(providerItems.id, availability.providerItemId))
    .where(
      and(
        eq(availability.userId, userId),
        eq(providerItems.instanceId, instanceId),
        eq(providerItems.externalId, itemId),
        eq(availability.state, 'available')
      )
    )
    .limit(1);
  if (!record) return new Response('Image unavailable.', { status: 404 });
  const { connection, instance } = await getJellyfin(userId, record.connectionId);
  const params = new URL(request.url).searchParams;
  const tag = params.get('tag') || '';
  const index = params.get('index') || '0';
  if (!/^\d{1,5}$/.test(index)) return new Response('Invalid image index.', { status: 400 });
  if (tag.length > 100) return new Response('Invalid image.', { status: 400 });
  const credentials = JSON.parse(await decryptCredential(connection.credentials!)) as {
    accessToken: string;
  };
  const query = new URLSearchParams({
    format: 'Webp',
    maxWidth: ['backdrop', 'banner', 'thumb', 'screenshot', 'chapter', 'menu'].includes(type)
      ? '1920'
      : '780',
    quality: '85',
    ...(tag ? { tag } : {}),
  });
  const unavailable = () =>
    record.mediaId
      ? fallbackArtwork(record.mediaId, type)
      : new Response('Image unavailable.', { status: 404 });
  let response: Response;
  try {
    response = await serverArtwork([instance.id,instance.serverIdentity??'',instance.baseUrl,connection.id,String(connection.accountGeneration),itemId,type,index,query.toString(),tag || String(Math.floor(Date.now()/3600000))],async()=>secureProviderFetch(
      await instanceFetchConfig(instance),
      `/Items/${encodeURIComponent(itemId)}/Images/${artworkTypes[type].jellyfin}/${Number(index)}?${query}`,
      {
        headers: { Authorization: jellyfinAuthorization(userId, credentials.accessToken) },
        signal: request.signal,
      },
      { maxBytes: 10 * 1024 * 1024 }
    ));
  } catch (error) {
    if (request.signal.aborted) throw error;
    return unavailable();
  }
  return response.ok ? response : unavailable();
}
