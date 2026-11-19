import {afterAll,beforeAll,expect,test} from 'bun:test';
import {eq,inArray} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import {getConfig} from '../src/lib/server/config';
import * as s from '../src/lib/server/db/schema';
import {fallbackArtwork} from '../src/lib/providers/tmdb/fallback.server';
import {mediaViewsForIds} from '../src/lib/server/queries/media';

const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip;
const id=crypto.randomUUID();
beforeAll(async()=>{
  if(!enabled)return;const db=getDb();
  await db.insert(s.works).values({id,category:'screen',kind:'movie'});
  await db.insert(s.media).values({id,kind:'movie',title:'Artwork scope fixture'});
  await db.insert(s.metadataSnapshots).values([
    {mediaId:id,provider:'tmdb',language:'en-US',region:'GB',updatedAt:new Date('2026-01-01'),
      raw:{artwork:{primary:'https://image.tmdb.org/t/p/w342/english.jpg'},artworkUpdatedAt:new Date().toISOString()}},
    {mediaId:id,provider:'tmdb',language:'de-DE',region:'DE',updatedAt:new Date('2026-02-01'),
      raw:{artwork:{primary:'https://image.tmdb.org/t/p/w342/german.jpg'},artworkUpdatedAt:new Date().toISOString()}},
  ]);
});
afterAll(async()=>{if(enabled)await getDb().delete(s.works).where(eq(s.works.id,id));});
run('default artwork fallback reads its own language and region even when another locale is newer',async()=>{
  const response=await fallbackArtwork(id,'primary');
  expect(response.status).toBe(302);expect(response.headers.get('location')).toContain('english.jpg');
  const [german]=await getDb().select().from(s.metadataSnapshots).where(eq(s.metadataSnapshots.language,'de-DE'));
  expect((german.raw.artwork as {primary:string}).primary).toContain('german.jpg');
});

run('preferred TMDB artwork falls back per field to permitted Jellyfin artwork',async()=>{
  const db=getDb(),original=await getConfig();
  const [owner,viewer]=await db.insert(s.users).values([
    {username:'artwork-scope-owner'},{username:'artwork-scope-viewer'},
  ]).returning({id:s.users.id});
  const [server]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:'Artwork fixture',baseUrl:'https://fixture.invalid'}).returning();
  const artwork={logo:'/artwork/local-logo.png',thumb:'/artwork/local-thumbnail.jpg'};
  try {
    const [account]=await db.insert(s.providerConnections).values({userId:owner.id,instanceId:server.id,externalUserId:'artwork-fixture'}).returning();
    const [item]=await db.insert(s.providerItems).values({instanceId:server.id,mediaId:id,externalId:'artwork-fixture',kind:'movie',snapshot:{artwork}}).returning();
    await db.insert(s.availability).values({userId:owner.id,connectionId:account.id,mediaId:id,providerItemId:item.id});
    const config={...original,metadataSource:{details:['jellyfin','tmdb','trakt'],artwork:['tmdb','jellyfin','trakt'],release:['jellyfin','tmdb','trakt']}};
    await db.insert(s.systemSettings).values({key:'coast',value:config}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:config}});
    const [ownerCard]=await mediaViewsForIds(owner.id,[id]);
    expect(ownerCard.poster).toContain('german.jpg');
    expect(ownerCard.artwork).toMatchObject(artwork);
    const [viewerCard]=await mediaViewsForIds(owner.id,[id],viewer.id);
    expect(viewerCard.poster).toContain('german.jpg');
    expect(viewerCard.artwork?.logo).toBeUndefined();
    expect(viewerCard.artwork?.thumb).toBeUndefined();

    await db.update(s.systemSettings).set({value:{...config,metadataSource:{...config.metadataSource,artwork:'tmdb-only'}}})
      .where(eq(s.systemSettings.key,'coast'));
    const [tmdbOnly]=await mediaViewsForIds(owner.id,[id]);
    expect(tmdbOnly.poster).toContain('german.jpg');
    expect(tmdbOnly.artwork?.logo).toBeUndefined();
    expect(tmdbOnly.artwork?.thumb).toBeUndefined();
  } finally {
    await db.update(s.systemSettings).set({value:original}).where(eq(s.systemSettings.key,'coast'));
    await db.delete(s.providerInstances).where(eq(s.providerInstances.id,server.id));
    await db.delete(s.users).where(inArray(s.users.id,[owner.id,viewer.id]));
  }
});
