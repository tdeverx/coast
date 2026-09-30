import { and,eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { trackingState, musicArtists, musicArtistPreferences,musicProgress } from '$lib/server/db/schema';
import { trackWithExports } from '$lib/sync/changes';
import { observeMusicAccess, persistMusic } from './persistence.server';
import * as v from 'valibot';
import { getJellyfin } from '$lib/providers/jellyfin/connection.server';
import { jellyfinMusicIdSchema, musicBrowseSchema } from '$lib/providers/jellyfin/music.server';

export async function musicLibrary(userId: string, connectionId: string, input: unknown = {}) {
  const options = v.parse(musicBrowseSchema, input);
  const { adapter, connection, instance } = await getJellyfin(userId, connectionId);
  const page=await adapter.musicLibrary(connection.externalUserId!, options);
  const items=[];for(const item of page.items) items.push(await observeMusicAccess(userId,connectionId,instance.id,item));
  return {connectionId:connection.id,...page,items};
}

export async function musicDetails(userId: string, connectionId: string, id: string) {
  v.parse(jellyfinMusicIdSchema, id);
  const { adapter, connection, instance } = await getJellyfin(userId, connectionId);
  const item=await observeMusicAccess(userId,connectionId,instance.id,await adapter.musicItem(connection.externalUserId!,id));
  if(item.workId){const [state]=await getDb().select().from(trackingState).where(and(eq(trackingState.userId,userId),eq(trackingState.mediaId,item.workId)));item.favourite=state?.favourite??false;
    const [progress]=await getDb().select().from(musicProgress).where(and(eq(musicProgress.userId,userId),eq(musicProgress.trackId,item.workId)));item.positionSeconds=progress?.positionSeconds??0;item.playCount=progress?.playCount??0;}
  if(item.artistId){const [preference]=await getDb().select().from(musicArtistPreferences).where(and(eq(musicArtistPreferences.userId,userId),eq(musicArtistPreferences.artistId,item.artistId)));if(preference)item.favourite=preference.favourite;}
  return {connectionId:connection.id,item};
}

export async function setMusicFavourite(
  userId: string,
  connectionId: string,
  id: string,
  input: unknown
) {
  v.parse(jellyfinMusicIdSchema, id);
  const { favourite } = v.parse(v.object({ favourite: v.boolean() }), input);
  const { adapter, connection, instance } = await getJellyfin(userId, connectionId);
  const item=await persistMusic(instance.id,await adapter.musicItem(connection.externalUserId!,id));
  if(item.workId) await trackWithExports(userId,{mediaId:item.workId,action:'favourite',value:favourite});
  else {
    const [artist]=await getDb().select().from(musicArtists).where(and(eq(musicArtists.instanceId,instance.id),eq(musicArtists.externalId,id)));
    await getDb().insert(musicArtistPreferences).values({userId,artistId:artist.id,favourite}).onConflictDoUpdate({target:[musicArtistPreferences.userId,musicArtistPreferences.artistId],set:{favourite}});
    await adapter.setMusicFavourite(connection.externalUserId!,id,favourite);
  }
  return { favourite };
}
