import { requireFeature, requireFeatureInTransaction } from '$lib/server/features';
import { presentationPreferences } from '$lib/catalogue/overrides/presentation.server';
import type { MusicItem } from './model';
import { and,eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { trackingState, musicArtistPreferences,musicProgress } from '$lib/server/db/schema';
import { trackWithExports } from '$lib/sync/changes.server';
import { observeMusicAccess, observeMusicLibraryAccess, persistMusic } from './persistence.server';
import * as v from 'valibot';
import { getJellyfin } from '$lib/providers/jellyfin/connection.server';
import { jellyfinMusicIdSchema, musicBrowseSchema } from '$lib/providers/jellyfin/music.server';

export async function musicLibrary(userId: string, connectionId: string, input: unknown = {},signal?:AbortSignal) {
  const options = v.parse(musicBrowseSchema, input);
  await requireFeature(userId,'music');
  const { adapter, connection, instance } = await getJellyfin(userId, connectionId);
  const page=await adapter.musicLibrary(connection.externalUserId!, options,undefined,signal);
  signal?.throwIfAborted();
  const items=await observeMusicLibraryAccess(userId,connectionId,instance.id,connection.accountGeneration,page.items,signal);
  return {connectionId:connection.id,...page,items:await personaliseMusicItems(userId,items)};
}

export async function musicDetails(userId: string, connectionId: string, id: string,signal?:AbortSignal) {
  v.parse(jellyfinMusicIdSchema, id);
  await requireFeature(userId,'music');
  const { adapter, connection, instance } = await getJellyfin(userId, connectionId);
  const item=await observeMusicAccess(userId,connectionId,instance.id,await adapter.musicItem(connection.externalUserId!,id,signal),connection.accountGeneration,signal);
  if(item.workId){const [state]=await getDb().select().from(trackingState).where(and(eq(trackingState.userId,userId),eq(trackingState.mediaId,item.workId)));item.favourite=state?.favourite??false;
    const [progress]=await getDb().select().from(musicProgress).where(and(eq(musicProgress.userId,userId),eq(musicProgress.trackId,item.workId)));item.positionSeconds=progress?.positionSeconds??0;item.playCount=progress?.playCount??0;}
  if(item.artistId){const [preference]=await getDb().select().from(musicArtistPreferences).where(and(eq(musicArtistPreferences.userId,userId),eq(musicArtistPreferences.artistId,item.artistId)));if(preference)item.favourite=preference.favourite;}
  return {connectionId:connection.id,item:(await personaliseMusicItems(userId,[item]))[0]};
}

export async function setMusicFavourite(
  userId: string,
  connectionId: string,
  id: string,
  input: unknown
) {
  v.parse(jellyfinMusicIdSchema, id);
  await requireFeature(userId,'music');
  const { favourite } = v.parse(v.object({ favourite: v.boolean() }), input);
  const { adapter, connection, instance } = await getJellyfin(userId, connectionId);
  const item=await persistMusic(instance.id,await adapter.musicItem(connection.externalUserId!,id));
  if(item.workId) await trackWithExports(userId,{mediaId:item.workId,action:'favourite',value:favourite});
  else {
    await getDb().transaction(async tx=>{await requireFeatureInTransaction(tx,userId,'music');await tx.insert(musicArtistPreferences).values({userId,artistId:item.artistId!,favourite}).onConflictDoUpdate({target:[musicArtistPreferences.userId,musicArtistPreferences.artistId],set:{favourite}});});
    await requireFeature(userId,'music');
    await adapter.setMusicFavourite(connection.externalUserId!,id,favourite);
  }
  return { favourite };
}

/** Persist provider observations first; personal display preferences never flow back into metadata. */
export async function personaliseMusicItems(viewerId: string | null, items: MusicItem[]) {
  const preferences = await presentationPreferences(viewerId, items.flatMap(item => item.workId ? [item.workId] : []));
  return items.map(item => {
    const preference = item.workId ? preferences.get(item.workId) : undefined;
    return preference ? { ...item, title: preference.title ?? item.title, artworkUrl: preference.posterPath ?? item.artworkUrl,
      backdropUrl: preference.backdropPath ?? item.backdropUrl } : item;
  });
}
