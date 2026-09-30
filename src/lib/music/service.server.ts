import * as v from 'valibot';
import { getJellyfin } from '$lib/providers/jellyfin/connection.server';
import { jellyfinMusicIdSchema, musicBrowseSchema } from '$lib/providers/jellyfin/music.server';

export async function musicLibrary(userId: string, connectionId: string, input: unknown = {}) {
  const options = v.parse(musicBrowseSchema, input);
  const { adapter, connection } = await getJellyfin(userId, connectionId);
  return {
    connectionId: connection.id,
    ...(await adapter.musicLibrary(connection.externalUserId!, options)),
  };
}

export async function musicDetails(userId: string, connectionId: string, id: string) {
  v.parse(jellyfinMusicIdSchema, id);
  const { adapter, connection } = await getJellyfin(userId, connectionId);
  return {
    connectionId: connection.id,
    item: await adapter.musicItem(connection.externalUserId!, id),
  };
}

export async function setMusicFavourite(
  userId: string,
  connectionId: string,
  id: string,
  input: unknown
) {
  v.parse(jellyfinMusicIdSchema, id);
  const { favourite } = v.parse(v.object({ favourite: v.boolean() }), input);
  const { adapter, connection } = await getJellyfin(userId, connectionId);
  await adapter.setMusicFavourite(connection.externalUserId!, id, favourite);
  return { favourite };
}
