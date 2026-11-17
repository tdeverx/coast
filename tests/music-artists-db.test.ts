import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { getConfig } from '../src/lib/server/config';
import { persistMusic, observeMusicAccess, logMusic } from '../src/lib/music/persistence.server';
import { hydrateMusicItems } from '../src/lib/music/presentation.server';
import { musicDetailData } from '../src/lib/music/detail.server';
import { musicChildren } from '../src/lib/music/details.server';
import { musicWorkCredits } from '../src/lib/music/credits.server';
import { musicArtistTrackChoices, musicHistory } from '../src/lib/music/history.server';
import { artistMusicQueue, musicQueue, savedMusicQueue, savedMusicQueuePage } from '../src/lib/music/queue.server';
import { rate } from '../src/lib/core/ratings/service.server';
import { trackWithExports } from '../src/lib/sync/changes.server';
import { createList, getList, addListItem } from '../src/lib/core/lists/service.server';
import { setUpNext } from '../src/lib/core/lists/up-next.server';
import { workActionData, workCards } from '../src/lib/collection/query.server';
import type { MusicItem } from '../src/lib/music/model';

const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const [owner, other, firstInstance, secondInstance, connection] = Array.from({length:5},()=>crypto.randomUUID());
const ids = new Set<string>();
const artistItem = (externalId = crypto.randomUUID(), mbid?: string): MusicItem => ({
  id: externalId, kind:'artist', title:'Shared name', artists:[], albumArtists:[], artistNames:[], genres:['Ambient'],
  overview:'Artist metadata', externalIds:mbid?{musicbrainzartist:mbid}:{}, primaryImageTag:'artist-art',
});
const keep = <T extends MusicItem>(item:T) => { if(item.workId)ids.add(item.workId); return item; };
beforeAll(async()=>{
  if(process.env.COAST_DB_TEST!=='1')return;
  const db=getDb(), config=await getConfig();
  await db.insert(s.systemSettings).values({key:'coast',value:{...config,experimentalMusic:true}}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...config,experimentalMusic:true}}});
  await db.insert(s.users).values([{id:owner,username:'artists-'+owner},{id:other,username:'artists-'+other}]);
  await db.insert(s.providerInstances).values([firstInstance,secondInstance].map(id=>({id,provider:'jellyfin' as const,name:id,baseUrl:'https://fixture.invalid'})));
  await db.insert(s.providerConnections).values({id:connection,userId:owner,instanceId:firstInstance});
});
afterAll(async()=>{
  if(process.env.COAST_DB_TEST!=='1')return;
  const db=getDb();
  await db.delete(s.users).where(inArray(s.users.id,[owner,other]));
  await db.delete(s.providerInstances).where(inArray(s.providerInstances.id,[firstInstance,secondInstance]));
  if(ids.size)await db.delete(s.works).where(inArray(s.works.id,[...ids]));
});

run('populated artist migration preserves source aliases and durable favourites without name merging',async()=>{
  const legacy=crypto.randomUUID(), second=crypto.randomUUID(), rollback=new Error('rollback migration fixture');
  const migration=await Bun.file(new URL('../drizzle/0075_canonical_music_artists.sql',import.meta.url)).text();
  await expect(getDb().transaction(async tx=>{
    await tx.execute(sql`alter table music_credits drop constraint music_credits_artist_id_works_id_fk`);
    await tx.execute(sql`alter table music_credits add constraint music_credits_artist_id_music_artists_id_fk foreign key(artist_id) references music_artists(id) on delete cascade`);
    await tx.execute(sql`alter table music_artists drop column work_id cascade`);
    await tx.execute(sql`drop index music_credits_artist_work_idx`);
    await tx.execute(sql`create table music_artist_preferences(user_id uuid not null references users(id),artist_id uuid not null references music_artists(id),favourite boolean not null,primary key(user_id,artist_id))`);
    await tx.execute(sql`insert into music_artists(id,instance_id,external_id,name) values(${legacy},${firstInstance},${legacy},'Same name'),(${second},${secondInstance},${second},'Same name')`);
    await tx.execute(sql`insert into music_artist_preferences values(${owner},${legacy},true)`);
    for(const statement of migration.split('--> statement-breakpoint'))if(statement.trim())await tx.execute(sql.raw(statement));
    const aliases=await tx.select().from(s.musicArtists).orderBy(s.musicArtists.id);
    expect(aliases).toHaveLength(2);expect(new Set(aliases.map(alias=>alias.workId)).size).toBe(2);
    expect(aliases.find(alias=>alias.id===legacy)?.workId).toBe(legacy);
    expect((await tx.select().from(s.trackingState).where(and(eq(s.trackingState.userId,owner),eq(s.trackingState.mediaId,legacy))))[0].favourite).toBe(true);
    expect(await tx.select().from(s.trackingEvents).where(and(eq(s.trackingEvents.userId,owner),eq(s.trackingEvents.mediaId,legacy)))).toHaveLength(1);
    expect((await tx.select().from(s.providerItems).where(eq(s.providerItems.mediaId,legacy)))[0]).toMatchObject({instanceId:firstInstance,externalId:legacy,kind:'artist'});
    throw rollback;
  })).rejects.toBe(rollback);
});

run('canonical artists merge only verified MusicBrainz identities and retain their source aliases',async()=>{
  const mbid=crypto.randomUUID(), sourceA=artistItem(undefined,mbid), sourceB=artistItem(undefined,mbid);
  const [first,second]=await Promise.all([persistMusic(firstInstance,sourceA),persistMusic(secondInstance,sourceB)]);
  keep(first);keep(second);
  expect(first.workId).toBe(second.workId);expect(first.artistId).not.toBe(second.artistId);
  await expect(persistMusic(firstInstance,{...sourceA,externalIds:{musicbrainzartist:crypto.randomUUID()}})).rejects.toMatchObject({status:409});
  const sameName=keep(await persistMusic(secondInstance,artistItem()));
  expect(sameName.workId).not.toBe(first.workId);
  const track=keep(await persistMusic(firstInstance,{...artistItem(),kind:'track',title:'Same-name credits'}));
  await getDb().insert(s.musicCredits).values([first.workId!,sameName.workId!].map(artistId=>({workId:track.workId!,artistId,role:'artist'})));
  expect((await musicWorkCredits([track.workId!],null)).get(track.workId!)!.artists).toHaveLength(2);
  const invalid=keep(await persistMusic(secondInstance,artistItem(undefined,'invalid')));
  expect(invalid.workId).not.toBe(first.workId);
  const known=keep(await persistMusic(firstInstance,artistItem()));
  await trackWithExports(owner,{mediaId:known.workId!,action:'favourite',value:true});
  const retained=await persistMusic(firstInstance,{...known,externalIds:{musicbrainzartist:mbid}});
  expect(retained.workId).toBe(known.workId!);
  await expect(persistMusic(firstInstance,{...known,externalIds:{musicbrainzartist:crypto.randomUUID()}})).rejects.toMatchObject({status:409});
  expect((await workActionData(owner,known.workId!)).reasons.some(reason=>reason.relationship==='favourite')).toBe(true);
  const [mapping]=await getDb().select().from(s.providerItems).where(eq(s.providerItems.id,first.providerItemId!));
  expect(mapping.mediaId).toBe(first.workId!);expect(mapping.kind).toBe('artist');
  expect(mapping.snapshot).not.toHaveProperty('workId');expect(mapping.snapshot).not.toHaveProperty('artistId');
});

run('credit-first source artists remain browsable when later verified identities agree without merging private choices',async()=>{
  const sources=[crypto.randomUUID(),crypto.randomUUID()],mbid=crypto.randomUUID(),artists:MusicItem[]=[],tracks:string[]=[];
  for(const [index,instanceId] of [firstInstance,secondInstance].entries()){
    const track=keep(await persistMusic(instanceId,{...artistItem(),kind:'track',title:`Credit-first ${index}`,artists:[{id:sources[index],name:'Shared artist'}]}));
    tracks.push(track.workId!);
    const artistId=(await musicWorkCredits([track.workId!],owner)).get(track.workId!)!.artists[0].id;
    ids.add(artistId);artists.push({...artistItem(sources[index]),workId:artistId});
    await rate(owner,{mediaId:artistId,value:index?4:2});
    await trackWithExports(owner,{mediaId:artistId,action:'favourite',value:!index});
  }
  const list=await createList(owner,{name:'Retained source artists',mediaId:artists[0].workId!});
  await addListItem(owner,list.id,artists[1].workId!);
  const first=await persistMusic(firstInstance,{...artists[0],externalIds:{musicbrainzartist:mbid}});
  const second=await persistMusic(secondInstance,{...artists[1],externalIds:{musicbrainzartist:mbid}});
  expect(first.workId).toBe(artists[0].workId!);expect(second.workId).toBe(artists[1].workId!);
  expect(first.workId).not.toBe(second.workId);
  expect((await musicDetailData(owner,first.workId!)).item.favourite).toBe(true);
  expect((await musicDetailData(owner,second.workId!)).item.favourite).toBe(false);
  expect((await workActionData(owner,first.workId!)).rating).toBe(2);
  expect((await workActionData(owner,second.workId!)).rating).toBe(4);
  expect((await getList(owner,list.id)).items.map(entry=>entry.item.id)).toEqual([first.workId!,second.workId!]);
  const credits=await musicWorkCredits(tracks,owner);
  expect(credits.get(tracks[0])!.artists.map(artist=>artist.id)).toEqual([first.workId!]);
  expect(credits.get(tracks[1])!.artists.map(artist=>artist.id)).toEqual([second.workId!]);
  await persistMusic(secondInstance,{...artists[1],externalIds:{}});
  await expect(persistMusic(secondInstance,{...artists[1],externalIds:{musicbrainzartist:crypto.randomUUID()}})).rejects.toMatchObject({status:409});
});

run('artist works reuse tracking, rating, lists and canonical cards while sources remain private',async()=>{
  const db=getDb(), source=artistItem(), artist=keep(await observeMusicAccess(owner,connection,firstInstance,source,
    (await db.select().from(s.providerConnections).where(eq(s.providerConnections.id,connection)))[0].accountGeneration));
  await rate(owner,{mediaId:artist.workId!,value:4});
  await trackWithExports(owner,{mediaId:artist.workId!,action:'watchlist',value:true});
  await trackWithExports(owner,{mediaId:artist.workId!,action:'favourite',value:true});
  const list=await createList(owner,{name:'Artists',mediaId:artist.workId!});
  expect((await getList(owner,list.id)).items[0].item.id).toBe(artist.workId!);
  expect(await workActionData(owner,artist.workId!)).toMatchObject({rating:4});
  expect(await workActionData(other,artist.workId!)).toMatchObject({rating:null});
  const [card]=await workCards(owner,owner,[artist.workId!]),[visitor]=await workCards(owner,other,[artist.workId!]);
  expect(card).toMatchObject({kind:'artist',workId:artist.workId,artistId:artist.artistId,href:`/music/work/${artist.workId}`});
  expect(card.poster).toContain(connection);expect(visitor.poster).toBeUndefined();expect(visitor).not.toHaveProperty('connectionId',connection);
  expect((await musicDetailData(owner,artist.workId!)).item).toMatchObject({kind:'artist',workId:artist.workId,artistId:artist.artistId,favourite:true});
  await expect(logMusic(owner,artist.workId!,{batchId:crypto.randomUUID()})).rejects.toThrow('Choose a track');
});

run('artist playback checks viewer access while queues and repeated playlist entries expand catalogue tracks once per entry',async()=>{
  const db=getDb(),source=artistItem(undefined,crypto.randomUUID()),artist=keep(await persistMusic(firstInstance,source));
  const alias=keep(await persistMusic(secondInstance,{...artistItem(),externalIds:source.externalIds}));
  expect(alias.workId).toBe(artist.workId);
  const [context]=await db.select().from(s.providerConnections).where(eq(s.providerConnections.id,connection));
  const tracks:MusicItem[]=[];
  for(const [index,title] of ['Third','Second','First'].entries()){
    const item:MusicItem={...artistItem(),kind:'track',title,releaseDate:`202${2-index}-01-01`,artists:[{id:source.id,name:source.title}],externalIds:{musicbrainztrack:crypto.randomUUID()}};
    tracks.push(keep(index<2?await observeMusicAccess(owner,connection,firstInstance,item,context.accountGeneration):await persistMusic(firstInstance,item)));
  }
  await persistMusic(secondInstance,{...tracks[0],id:crypto.randomUUID(),artists:[{id:alias.id,name:alias.title}],albumArtists:[{id:alias.id,name:alias.title}]});
  expect((await artistMusicQueue(owner,artist.workId!)).items.map(item=>item.id)).toEqual([tracks[1].workId!,tracks[0].workId!]);
  expect(await musicQueue(owner,artist.workId!)).toEqual(await artistMusicQueue(owner,artist.workId!));
  await expect(artistMusicQueue(other,artist.workId!)).rejects.toMatchObject({status:404});
  const ordered=[tracks[2].workId!,tracks[1].workId!,tracks[0].workId!];
  const playlist=await createList(owner,{name:'Repeated artists',playlist:true,mediaId:artist.workId!});
  await addListItem(owner,playlist.id,artist.workId!);await addListItem(owner,playlist.id,tracks[0].workId!);
  const expanded=await savedMusicQueue(owner,playlist.id);
  expect(expanded?.items.map(item=>item.id)).toEqual([...ordered,...ordered,tracks[0].workId!]);
  expect(expanded?.items.filter(item=>item.id===tracks[2].workId).every(item=>item.availability!=='available')).toBe(true);
  await expect(savedMusicQueue(other,playlist.id)).rejects.toMatchObject({status:404});
  await setUpNext(owner,{mediaId:artist.workId!,queued:true});await setUpNext(owner,{mediaId:tracks[0].workId!,queued:true});
  await db.update(s.upNext).set({addedAt:new Date('2020-01-01')}).where(eq(s.upNext.mediaId,artist.workId!));
  await db.update(s.upNext).set({addedAt:new Date('2021-01-01')}).where(eq(s.upNext.mediaId,tracks[0].workId!));
  expect((await savedMusicQueue(owner))?.items.map(item=>item.id)).toEqual([...ordered,tracks[0].workId!]);
  const picker=await savedMusicQueuePage(owner);
  expect(picker.total).toBe(3);expect(picker.items.map(item=>item.id)).toEqual(ordered);
  await db.update(s.providerConnections).set({status:'disconnected'}).where(eq(s.providerConnections.id,connection));
  await expect(artistMusicQueue(owner,artist.workId!)).rejects.toMatchObject({status:404});
  expect((await savedMusicQueue(owner,playlist.id))?.items.map(item=>item.id)).toEqual([...ordered,...ordered,tracks[0].workId!]);
  await db.update(s.providerConnections).set({status:'connected'}).where(eq(s.providerConnections.id,connection));
});

run('artist albums, track choices and listening history use canonical membership without playback access',async()=>{
  const db=getDb(),source=artistItem(),artist=keep(await persistMusic(firstInstance,source));
  const credits=[{id:source.id,name:source.title}],recording=crypto.randomUUID();
  const track=keep(await persistMusic(firstInstance,{...artistItem(),kind:'track',title:'Credited track',artists:credits,externalIds:{musicbrainztrack:recording}}));
  const album=keep(await persistMusic(firstInstance,{...artistItem(),kind:'album',title:'Credited album',albumArtists:credits,externalIds:{}}));
  expect((await musicChildren(owner,artist.workId!,new URL('http://coast'))).items.map(item=>item.workId)).toEqual([album.workId!]);
  expect((await musicArtistTrackChoices(other,artist.workId!)).items.map(item=>item.id)).toEqual([track.workId!]);
  await logMusic(owner,track.workId!,{batchId:crypto.randomUUID()});
  expect((await musicHistory(owner,artist.workId!)).items.map(item=>item.workId)).toEqual([track.workId!]);
  expect((await musicHistory(other,artist.workId!)).items).toEqual([]);
  await expect(artistMusicQueue(owner,artist.workId!)).rejects.toMatchObject({status:404});
  const [item]=await hydrateMusicItems(owner,[artist]);expect(item.available).toBe(false);
  await db.update(s.providerConnections).set({status:'disconnected'}).where(eq(s.providerConnections.id,connection));
  expect((await musicArtistTrackChoices(owner,artist.workId!)).items).toHaveLength(1);
  expect((await musicDetailData(owner,artist.workId!)).item.kind).toBe('artist');
  await db.update(s.providerConnections).set({status:'connected'}).where(eq(s.providerConnections.id,connection));
  await db.delete(s.providerInstances).where(eq(s.providerInstances.id,firstInstance));
  expect((await musicArtistTrackChoices(owner,artist.workId!)).items.map(item=>item.id)).toEqual([track.workId!]);
  expect((await musicHistory(owner,artist.workId!)).items).toHaveLength(1);
  expect((await musicDetailData(owner,artist.workId!)).item).toMatchObject({kind:'artist',workId:artist.workId,available:false});
});
