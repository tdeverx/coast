import {beforeAll, expect, test} from 'bun:test';
import {and, eq, inArray} from 'drizzle-orm';
import {getDb, getSql} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {encryptCredential} from '../src/lib/server/security/credentials';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
import {bootstrapJellyfinUser, syncJellyfinUser, type JellyfinSyncContext} from '../src/lib/sync/jellyfin';
import {unchangedJellyfinPlayback, seedEmptyJellyfinPlayback, type JellyfinPlaybackObservation} from '../src/lib/sync/jellyfin-playback';
import {onboardingStatus} from '../src/lib/server/auth/onboarding';
import {enqueueAction, runQueueOnce, registerActionHandler} from '../src/lib/server/queue';
import {jobExecution,JobYield} from '../src/lib/server/queue/execution';
import {track} from '../src/lib/core/tracking/service';
import {persistMusic} from '../src/lib/music/persistence.server';

const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
run('a cancelled Jellyfin worker cannot revoke existing access or apply tracking',async()=>{
  const f=await fixture(1),id=crypto.randomUUID();
  await syncJellyfinUser(f.user.id,f.connection.id,undefined,f.context);
  const before=await getDb().select().from(s.availability).where(eq(s.availability.connectionId,f.connection.id));
  f.visible([]);
  await getDb().insert(s.outboxActions).values({id,userId:f.user.id,connectionId:f.connection.id,accountGeneration:f.connection.accountGeneration,kind:'jellyfin.sync',state:'cancelled',attempts:1,payload:{}});
  await expect(jobExecution.run({id,attempts:1,purpose:'manual',started:performance.now(),checkpoints:0},()=>syncJellyfinUser(f.user.id,f.connection.id,undefined,f.context))).rejects.toBeInstanceOf(JobYield);
  expect(await getDb().select().from(s.availability).where(eq(s.availability.connectionId,f.connection.id))).toEqual(before);
  expect(await getDb().select().from(s.trackingEvents).where(eq(s.trackingEvents.userId,f.user.id))).toHaveLength(0);
});
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  await getDb().insert(s.systemSettings).values({key: 'coast', value: {experimentalMusic: true, developerMode: true}})
    .onConflictDoUpdate({target: s.systemSettings.key, set: {value: {experimentalMusic: true, developerMode: true}}});
});
type RemoteItem = {Id: string; Type: string; Name: string; UserData: {Played: boolean; IsFavorite: boolean; PlaybackPositionTicks: number; PlayCount: number}; RunTimeTicks: number; MediaSources?: object[]};
async function fixture(count = 1) {
  const db = getDb(), tag = crypto.randomUUID();
  const [user] = await db.insert(s.users).values({username: `bootstrap-${tag}`}).returning();
  const [instance] = await db.insert(s.providerInstances).values({provider: 'jellyfin', name: tag, baseUrl: 'https://fixture.invalid', serverIdentity: tag}).returning();
  const [connection] = await db.insert(s.providerConnections).values({userId: user.id, instanceId: instance.id, externalUserId: tag, credentials: await encryptCredential(JSON.stringify({accessToken: 'synthetic'})), settings: {importPlayback: true}}).returning();
  const titles = Array.from({length: count}, (_, index) => ({id: crypto.randomUUID(), kind: 'movie' as const, title: `Shared title ${index}`, runtimeMinutes: 20}));
  await db.insert(s.media).values(titles); await db.insert(s.movies).values(titles.map(title => ({mediaId: title.id})));
  const mappings = titles.map(title => ({instanceId: instance.id, externalId: crypto.randomUUID().replaceAll('-', ''), kind: 'movie' as const, mediaId: title.id, snapshot: {sharedMetadata: true}}));
  await db.insert(s.providerItems).values(mappings);
  const items: RemoteItem[] = mappings.map((mapping, index) => ({Id: mapping.externalId, Type: 'Movie', Name: titles[index].title, RunTimeTicks: 12000000000, UserData: {Played: false, IsFavorite: false, PlaybackPositionTicks: 0, PlayCount: 0}}));
  let visible = items, music: Record<string, any>[] = [], failure: string | null = null;
  const requests: URL[] = [];
  const adapter = new JellyfinAdapter(async path => {
    const url = new URL(path, 'https://fixture.invalid'); requests.push(url);
    if (url.pathname === '/System/Info/Public') return {Id: tag, ServerName: 'Fixture', ProductName: 'Jellyfin Server', Version: '10.11.0'};
    if (url.pathname === '/Users/Me') return {Id: tag, ServerId: tag, Policy: {MaxParentalRating: 1}}; // Restricted/unsupported policy uses authenticated global traversal.
    if (url.pathname !== '/Items') throw new Error(`Unexpected metadata fetch: ${url.pathname}`);
    const filter = url.searchParams.get('filters');
    if (failure === filter && failure !== null) throw new Error('Fixture interruption');
    const kind = url.searchParams.get('includeItemTypes') ?? '';
    let rows: any[] = kind === 'MusicAlbum' ? music.filter(item => item.Type === 'MusicAlbum') : kind === 'Audio' ? music.filter(item => item.Type === 'Audio') : visible;
    rows = rows.filter(item => !filter || filter === 'IsPlayed' && item.UserData?.Played || filter === 'IsFavorite' && item.UserData?.IsFavorite || filter === 'IsResumable' && item.UserData?.PlaybackPositionTicks > 0);
    const offset = Number(url.searchParams.get('startIndex') ?? 0);
    return {Items: rows.slice(offset, offset + 100), StartIndex: offset, TotalRecordCount: rows.length};
  }, user.id, 'synthetic');
  const context: JellyfinSyncContext = {adapter, connection, instance};
  await getSql()`insert into user_onboarding(user_id,connection_id,account_generation,imports_started_at,requested_at) values(${user.id},${connection.id},${connection.accountGeneration},now(),now()-interval '1 second')`;
  return {user, instance, connection, context, titles, mappings, items, requests,
    visible: (rows: RemoteItem[]) => {visible = rows;}, music: (rows: Record<string, any>[]) => {music = rows;}, fail: (filter: string | null) => {failure = filter;}};
}

run('personal bootstrap opens onboarding without a full inventory and grants no unseen titles', async () => {
  const f = await fixture(130);
  f.items[0].UserData = {Played: true, IsFavorite: true, PlayCount: 2, PlaybackPositionTicks: 0};
  f.items[1].UserData.PlaybackPositionTicks = 150000000;
  f.visible(f.items.slice(0, 100)); // Remaining server catalogue is inaccessible to this account.
  expect((await onboardingStatus(f.user.id)).complete).toBe(false);
  await bootstrapJellyfinUser(f.user.id, f.connection.id, undefined, f.context);
  expect(f.requests.filter(url => url.pathname === '/Items').every(url => url.searchParams.has('filters'))).toBe(true);
  const states = await getDb().select().from(s.trackingState).where(eq(s.trackingState.userId, f.user.id));
  expect(states.find(row => row.mediaId === f.titles[0].id)).toMatchObject({watched: true, favourite: true, playCount: 2});
  expect(states.find(row => row.mediaId === f.titles[1].id)?.positionSeconds).toBe(15);
  const access = await getDb().select().from(s.availability).where(eq(s.availability.userId, f.user.id));
  expect(new Set(access.map(row => row.mediaId))).toEqual(new Set(f.titles.slice(0, 2).map(title => title.id)));
  expect((await onboardingStatus(f.user.id)).complete).toBe(true);
  expect(await getDb().select().from(s.syncCheckpoints).where(and(eq(s.syncCheckpoints.connectionId, f.connection.id), eq(s.syncCheckpoints.kind, 'jellyfin-user')))).toHaveLength(0);
  const before = f.requests.length;
  await bootstrapJellyfinUser(f.user.id, f.connection.id, undefined, f.context);
  expect(f.requests.length).toBe(before); // Background retries reuse the completed bootstrap.
  await syncJellyfinUser(f.user.id, f.connection.id, undefined, f.context);
  const allAccess = await getDb().select().from(s.availability).where(and(eq(s.availability.userId, f.user.id), eq(s.availability.state, 'available')));
  expect(new Set(allAccess.map(row => row.mediaId)).size).toBe(100);
  expect(allAccess.some(row => f.titles.slice(100).some(title => title.id === row.mediaId))).toBe(false);
});

run('targeted bootstrap resumes between filters without repeating committed history pages', async () => {
  const f = await fixture(101); f.items.forEach(item => {item.UserData.Played = true; item.UserData.PlayCount = 1;});
  f.fail('IsResumable');
  await expect(bootstrapJellyfinUser(f.user.id, f.connection.id, undefined, f.context)).rejects.toThrow('Fixture interruption');
  expect((await onboardingStatus(f.user.id)).complete).toBe(false);
  const historyCalls = f.requests.filter(url => url.searchParams.get('filters') === 'IsPlayed').length;
  expect(historyCalls).toBe(2);
  f.fail(null);
  await bootstrapJellyfinUser(f.user.id, f.connection.id, undefined, f.context);
  expect(f.requests.filter(url => url.searchParams.get('filters') === 'IsPlayed' && url.searchParams.get('includeItemTypes') === 'Movie,Series,Season,Episode')).toHaveLength(2);
  const watches = await getDb().select().from(s.trackingEvents).where(and(eq(s.trackingEvents.userId, f.user.id), eq(s.trackingEvents.action, 'watch')));
  expect(watches).toHaveLength(101);
  expect((await onboardingStatus(f.user.id)).complete).toBe(true);
});

run('music bootstrap imports played, resumable and favourite tracks without rewriting shared metadata', async () => {
  const f = await fixture();
  const album = {Id: crypto.randomUUID().replaceAll('-', ''), Type: 'MusicAlbum', Name: 'Shared album', UserData: {IsFavorite: true}};
  const track = {Id: crypto.randomUUID().replaceAll('-', ''), Type: 'Audio', AlbumId: album.Id, Name: 'Shared track', RunTimeTicks: 900000000, UserData: {Played: true, PlayCount: 2, IsFavorite: true, PlaybackPositionTicks: 20000000}};
  const savedAlbum = await persistMusic(f.instance.id, {id: album.Id, kind: 'album', title: album.Name, artists: [], albumArtists: [], artistNames: [], genres: [], externalIds: {}});
  const savedTrack = await persistMusic(f.instance.id, {id: track.Id, kind: 'track', title: track.Name, albumId: album.Id, artists: [], albumArtists: [], artistNames: [], genres: [], externalIds: {}});
  const [before] = await getDb().select().from(s.musicWorks).where(eq(s.musicWorks.id, savedTrack.workId!));
  f.music([album, track]);
  await bootstrapJellyfinUser(f.user.id, f.connection.id, undefined, f.context);
  const listens = await getDb().select().from(s.musicListens).where(eq(s.musicListens.userId, f.user.id));
  expect(listens).toHaveLength(2);
  const [progress] = await getDb().select().from(s.musicProgress).where(and(eq(s.musicProgress.userId, f.user.id), eq(s.musicProgress.trackId, savedTrack.workId!)));
  expect(progress).toMatchObject({playCount: 2, positionSeconds: 2});
  const [after] = await getDb().select().from(s.musicWorks).where(eq(s.musicWorks.id, savedTrack.workId!));
  expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
  expect(f.requests.filter(url => url.searchParams.get('includeItemTypes') === 'Audio').map(url => url.searchParams.get('filters'))).toEqual(['IsPlayed', 'IsResumable', 'IsFavorite']);
  expect(savedAlbum.workId).toBeDefined();
});

run('batch seeding does not bypass local intent, provider conflicts or account generation checks', async () => {
  const f = await fixture(3), db = getDb();
  await track(f.user.id, {mediaId: f.titles[1].id, action: 'favourite', value: true});
  await db.insert(s.syncValues).values({connectionId: f.connection.id, mediaId: f.titles[2].id, category: 'history', remote: {value: true}, agreed: null, conflict: true});
  const observations: JellyfinPlaybackObservation[] = f.titles.map(title => ({id: title.id, kind: 'movie', played: false, favourite: false, position: 0, playCount: 0, lastPlayedAt: null, duration: 1200}));
  expect(await seedEmptyJellyfinPlayback(f.user.id, f.connection.id, f.connection.accountGeneration, observations)).toEqual(new Set([f.titles[0].id]));
  expect(await db.select().from(s.trackingState).where(and(eq(s.trackingState.userId, f.user.id), eq(s.trackingState.mediaId, f.titles[0].id)))).toHaveLength(0);
  const [conflict] = await db.select().from(s.syncValues).where(and(eq(s.syncValues.connectionId, f.connection.id), eq(s.syncValues.mediaId, f.titles[2].id)));
  expect(conflict.conflict).toBe(true);
  await expect(seedEmptyJellyfinPlayback(f.user.id, f.connection.id, crypto.randomUUID(), observations)).rejects.toThrow('account changed');
});

run('joining accounts keep separate jobs and full availability yields the urgent worker after bootstrap', async () => {
  const f = await fixture(), db = getDb();
  await db.update(s.outboxActions).set({state: 'cancelled'}).where(inArray(s.outboxActions.state, ['pending', 'running']));
  const [other] = await db.insert(s.users).values({username: `second-${crypto.randomUUID()}`}).returning();
  const [connection] = await db.insert(s.providerConnections).values({userId: other.id, instanceId: f.instance.id, externalUserId: crypto.randomUUID(), credentials: 'synthetic'}).returning();
  const first = await enqueueAction({userId: f.user.id, connectionId: f.connection.id, kind: 'jellyfin.bootstrap', payload: {}});
  const second = await enqueueAction({userId: other.id, connectionId: connection.id, kind: 'jellyfin.bootstrap', payload: {}});
  expect(second).not.toBe(first);
  expect(await enqueueAction({userId: other.id, connectionId: connection.id, kind: 'jellyfin.bootstrap', payload: {}})).toBe(second);
  await bootstrapJellyfinUser(f.user.id, f.connection.id, undefined, f.context);
  await db.update(s.outboxActions).set({state: 'succeeded'}).where(inArray(s.outboxActions.id, [first, second]));
  await db.update(s.outboxActions).set({state: 'cancelled'}).where(eq(s.outboxActions.state, 'pending'));
  await db.update(s.outboxActions).set({state:'succeeded'}).where(eq(s.outboxActions.state,'running'));
  const full = await enqueueAction({userId: f.user.id, connectionId: f.connection.id, kind: 'jellyfin.sync', purpose: 'scheduled', payload: {}});
  registerActionHandler('jellyfin.sync', async () => {});
  await getSql()`update system_settings set value=jsonb_set(value,'{developerMode}','false'::jsonb) where key='coast'`;
  expect(await runQueueOnce(true)).toBe(false);
  expect((await db.select().from(s.outboxActions).where(eq(s.outboxActions.id, full)))[0].state).toBe('pending');
  expect(await runQueueOnce()).toBe(true);
});

run('unchanged batches skip only clean agreed values and retain local edits and duration changes',async()=>{
  const f=await fixture(2);
  const observations=f.titles.map(title=>({id:title.id,kind:'movie' as const,played:false,favourite:false,position:0,playCount:0,lastPlayedAt:null,duration:1200}));
  await seedEmptyJellyfinPlayback(f.user.id,f.connection.id,f.connection.accountGeneration,observations);
  expect(await unchangedJellyfinPlayback(f.user.id,f.connection.id,f.connection.accountGeneration,observations)).toEqual(new Set(f.titles.map(title=>title.id)));
  await track(f.user.id,{mediaId:f.titles[0].id,action:'favourite',value:true});
  expect(await unchangedJellyfinPlayback(f.user.id,f.connection.id,f.connection.accountGeneration,observations)).toEqual(new Set([f.titles[1].id]));
  observations[1].duration=1201;
  expect((await unchangedJellyfinPlayback(f.user.id,f.connection.id,f.connection.accountGeneration,observations)).size).toBe(0);
  await expect(unchangedJellyfinPlayback(f.user.id,f.connection.id,crypto.randomUUID(),observations)).rejects.toThrow('changed');
});
