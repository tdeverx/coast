import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { getDb, closeDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { getConfig } from '../src/lib/server/config';
import { encryptCredential } from '../src/lib/server/security/credentials';
import { TmdbAdapter } from '../src/lib/providers/tmdb/adapter.server';
import { TraktAdapter } from '../src/lib/providers/trakt/adapter.server';
import { browseRows, genericFeed } from '../src/lib/recommendations/generic.server';
import { dynamicFeed } from '../src/lib/recommendations/feed.server';
import { discoveryHero } from '../src/lib/server/queries/discovery';
import { handler } from '../src/lib/server/api/index.server';
import type { Metadata } from '../src/lib/providers/contracts';

const run = process.env.COAST_DB_TEST==='1' ? test : test.skip;
const signal = new AbortController().signal;
const movie = (id: string, title: string, extras?: Partial<Metadata>): Metadata => ({provider:'tmdb',externalId:id,title,kind:'movie',releaseDate:'2024-01-01',...extras});
const url = (params: string) => new URL(`https://coast.test/feed?category=screen&seed=fixture&${params}`);
const rows = (variant: string, genre?: string) => url(`kind=movie&variant=${variant}${genre?`&genre=${genre}`:''}`);
let viewer: string, other: string, known: string, tmdbId: string, traktId: string;

beforeAll(async()=>{
  if (process.env.COAST_DB_TEST!=='1') return;
  const db=getDb();
  const config={...await getConfig(),enableTrakt:true,siteAccess:'public-read-only' as const};
  await db.insert(s.systemSettings).values({key:'coast',value:config}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:config}});
  [viewer,other]=(await db.insert(s.users).values([{username:'viewer'},{username:'other-viewer',settings:{features:{personalisation:false}}}]).returning()).map(user=>user.id);
  [tmdbId,traktId]=(await db.insert(s.providerInstances).values([
    {provider:'tmdb',name:'TMDB fixture',baseUrl:'https://api.themoviedb.org',credentials:await encryptCredential(JSON.stringify({apiKey:'synthetic'}))},
    {provider:'trakt',name:'Trakt fixture',baseUrl:'https://api.trakt.tv',credentials:await encryptCredential(JSON.stringify({clientId:'synthetic',clientSecret:'synthetic'}))},
  ]).returning()).map(instance=>instance.id);
  const [catalogue]=await db.insert(s.media).values({kind:'movie',title:'Local canon',genres:['Science Fiction'],releaseDate:'2024-01-01'}).returning();
  known=catalogue.id;
  await db.insert(s.externalIds).values({mediaId:known,mediaKind:'movie',provider:'tmdb',externalId:'101'});
  await db.insert(s.trackingState).values({userId:viewer,mediaId:known,watched:true,favourite:true});
});
afterAll(async()=>{if (process.env.COAST_DB_TEST==='1') await closeDb();});

run('the definition census and hero perform no provider requests, then personal and generic rows share one normalized provider read',async()=>{
  const tmdb=spyOn(TmdbAdapter.prototype,'browse').mockResolvedValue([movie('102','Only on TMDB'),movie('101','Remote title for known work')]);
  const trakt=spyOn(TraktAdapter.prototype,'browse').mockResolvedValue([
    movie('201','Trakt version of known work',{provider:'trakt',externalIds:{tmdb:'101'},genres:['science fiction']}),
    movie('203','Only on Trakt',{provider:'trakt',externalIds:{tmdb:'103'}}),
  ]);
  try {
    expect((await discoveryHero(viewer)).map(item=>item.id)).toEqual([known]);
    const [generic,personal]=await Promise.all([genericFeed(viewer,url('')),dynamicFeed(viewer,url(''))]);
    expect(generic.rows.slice(0,2).map(row=>row.key)).toEqual(['discovery:trending','discovery:recent']);
    expect(generic.rows.some(row=>row.surface==='browse'&&row.variant==='provider-rated')).toBe(true);
    expect(personal.rows.some(row=>row.surface==='browse'&&row.variant==='provider-genre'&&row.genre==='scifi')).toBe(true);
    expect(tmdb).toHaveBeenCalledTimes(0); expect(trakt).toHaveBeenCalledTimes(0);

    const [discovered,recommended]=await Promise.all([
      browseRows(other,'generic',rows('provider-genre','scifi'),signal),
      browseRows(viewer,'personal',rows('provider-genre','scifi'),signal),
    ]);
    expect(discovered.items.map(item=>item.title)).toEqual(['Local canon','Only on TMDB','Only on Trakt']);
    expect(recommended.items.map(item=>item.title)).toEqual(['Only on TMDB','Only on Trakt']);
    expect(tmdb).toHaveBeenCalledTimes(1); expect(trakt).toHaveBeenCalledTimes(1);
    const snapshots=await getDb().select().from(s.metadataSnapshots);
    expect(snapshots).toHaveLength(2);
    expect(await browseRows(other,'generic',rows('provider-genre','scifi'),signal)).toEqual(discovered);
    expect(await getDb().select().from(s.metadataSnapshots)).toEqual(snapshots);
    expect((await browseRows(null,'generic',rows('provider-genre','scifi'),signal)).items.map(item=>item.id)).toEqual(discovered.items.map(item=>item.id));
    await expect(browseRows(other,'personal',rows('provider-genre','scifi'),signal)).rejects.toMatchObject({status:403});
    await expect(browseRows(null,'generic',rows('library'),signal)).rejects.toMatchObject({status:404});
    await expect(browseRows(other,'generic',rows('provider-rated','arbitrary cache key'),signal)).rejects.toMatchObject({status:404});
  } finally {tmdb.mockRestore();trakt.mockRestore();}
});

run('provider failure preserves healthy results, and a disabled provider cannot serve its warm page',async()=>{
  const tmdb=spyOn(TmdbAdapter.prototype,'browse').mockResolvedValue([movie('104','Healthy result')]);
  const trakt=spyOn(TraktAdapter.prototype,'browse').mockRejectedValue(new Error('Synthetic outage'));
  try {
    expect((await browseRows(viewer,'generic',rows('provider-popular'),signal)).items.map(item=>item.title)).toEqual(['Healthy result']);
    await getDb().update(s.providerInstances).set({enabled:false}).where(eq(s.providerInstances.id,tmdbId));
    await expect(browseRows(viewer,'generic',rows('provider-popular'),signal)).rejects.toMatchObject({status:502});
    expect(tmdb).toHaveBeenCalledTimes(1); expect(trakt).toHaveBeenCalledTimes(2);
    await getDb().update(s.providerInstances).set({enabled:false}).where(eq(s.providerInstances.id,traktId));
    await expect(browseRows(viewer,'generic',rows('provider-popular'),signal)).rejects.toMatchObject({status:404});
  } finally {tmdb.mockRestore();trakt.mockRestore();}
});

run('only public browsing admits the guest screen routes and never opens the library or personal source',async()=>{
  const get = (path: string, params: string) => {
    const url = new URL(`https://coast.test/api/v1/${path}?${params}`);
    return handler({request:new Request(url),url,locals:{user:null},params:{path}} as Parameters<typeof handler>[0]);
  };
  expect((await get('discover','surface=watch&section=trending')).status).toBe(200);
  expect((await get('discover','surface=read&section=trending')).status).toBe(404);
  expect((await get('discover/browse','category=screen&kind=movie&variant=library')).status).toBe(404);
  expect((await get('experiments/browse','category=screen&kind=movie&variant=provider-genre&genre=scifi')).status).toBe(401);
  const config={...await getConfig(),siteAccess:'public-profiles' as const};
  await getDb().update(s.systemSettings).set({value:config}).where(eq(s.systemSettings.key,'coast'));
  expect((await get('discover/feed','category=screen')).status).toBe(401);
});
