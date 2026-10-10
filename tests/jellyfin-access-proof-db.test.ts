import {beforeAll,expect,test} from 'bun:test';
import {and,eq,sql} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
import {bootstrapJellyfinUser,syncJellyfinUser,scanJellyfinLibrary,type JellyfinSyncContext} from '../src/lib/sync/jellyfin.server';
import {captureScreenAccessProof,tryReuseScreenAccess,screenCensusMaxAgeMs} from '../src/lib/providers/jellyfin/access-proof.server';
import {providerSchedule} from '../src/lib/providers/schedule';
import {workAssessments} from '../src/lib/collection/query.server';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const movies='a'.repeat(32),shows='b'.repeat(32);
const unrestricted=()=>({IsDisabled:false,EnableMediaPlayback:true,EnableRemoteAccess:true,EnableAllDevices:true,
  EnableAllFolders:true,EnabledFolders:[],BlockedMediaFolders:[],
  BlockedTags:[],AllowedTags:[],BlockUnratedItems:[],AccessSchedules:[]});
type Remote={Id:string;Type:string;Name:string;LocationType:string;SourceType?:string;RecursiveItemCount?:number;ParentId?:string;SeriesId?:string;IndexNumber?:number;ParentIndexNumber?:number;UserData:{Played:boolean;IsFavorite:boolean;PlayCount:number;PlaybackPositionTicks:number}};
beforeAll(async()=>{
  if(process.env.COAST_DB_TEST!=='1')return;
  await getDb().insert(s.systemSettings).values({key:'coast',value:{experimentalMusic:false,developerMode:true}})
    .onConflictDoUpdate({target:s.systemSettings.key,set:{value:{experimentalMusic:false,developerMode:true}}});
});
async function fixture(count=104) {
  const db=getDb(),tag=crypto.randomUUID();
  const [instance]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:tag,baseUrl:'https://fixture.invalid',serverIdentity:tag}).returning();
  const titles=Array.from({length:count+2},(_,index)=>({id:crypto.randomUUID(),kind:'movie' as const,title:`Cached ${index}`}));
  await db.insert(s.media).values(titles);await db.insert(s.movies).values(titles.map(title=>({mediaId:title.id})));
  const mappings=titles.map(title=>({instanceId:instance.id,externalId:crypto.randomUUID().replaceAll('-',''),mediaId:title.id,kind:'movie' as const,snapshot:{title:title.title}}));
  await db.insert(s.providerItems).values(mappings);
  await db.insert(s.externalIds).values(mappings.map(mapping=>({provider:`jellyfin:${instance.id}`,externalId:mapping.externalId,mediaKind:mapping.kind,mediaId:mapping.mediaId})));
  const remote:Remote[]=mappings.map((item,index)=>({Id:item.externalId,Type:'Movie',Name:titles[index].title,LocationType:'FileSystem',
    UserData:{Played:index===0,IsFavorite:index===0,PlayCount:index===0?7:0,PlaybackPositionTicks:index===0?90000000:0}}));
  const accounts:JellyfinSyncContext[]=[];
  async function account(folders=[movies,shows],policy:Record<string,unknown>=unrestricted()) {
    const [user]=await db.insert(s.users).values({username:`access-${crypto.randomUUID()}`}).returning();
    const [connection]=await db.insert(s.providerConnections).values({userId:user.id,instanceId:instance.id,externalUserId:crypto.randomUUID().replaceAll('-',''),credentials:'fixture-authenticated',settings:{importPlayback:true}}).returning();
    const requests:URL[]=[];let currentPolicy=policy,currentFolders=folders,failOffset:number|null=null;
    const adapter=new JellyfinAdapter(async path=>{
      const url=new URL(path,'https://fixture.invalid');requests.push(url);
      if(url.pathname==='/System/Info/Public')return {Id:tag,ServerName:'Fixture',ProductName:'Jellyfin Server',Version:'10.11.0'};
      if(url.pathname==='/Users/Me')return {Id:connection.externalUserId,ServerId:tag,Policy:currentPolicy};
      if(url.pathname==='/UserViews/GroupingOptions')return currentFolders.map(Id=>({Id}));
      if(url.pathname!=='/Items')throw new Error(`Unexpected fixture request ${url.pathname}`);
      const q=url.searchParams,parent=q.get('parentId'),filter=q.get('filters'),offset=Number(q.get('startIndex')??0);
      if(failOffset===offset&&!filter)throw new Error('Census interruption');
      let items=parent===movies?remote.slice(0,count):parent===shows?remote.slice(count):remote;
      if(connection.id!==accounts[0]?.connection.id)items=items.map(item=>({...item,UserData:{Played:false,IsFavorite:false,PlayCount:0,PlaybackPositionTicks:0}}));
      if(filter)items=items.filter(item=>filter==='IsPlayed'?item.UserData.Played:filter==='IsFavorite'?item.UserData.IsFavorite:item.UserData.PlaybackPositionTicks>0);
      return {Items:items.slice(offset,offset+100),StartIndex:offset,TotalRecordCount:items.length};
    },user.id,'fixture');
    const context={connection,instance,adapter};accounts.push(context);
    return {context,user,requests,policy:(next:Record<string,unknown>)=>{currentPolicy=next;},folders:(next:string[])=>{currentFolders=next;},fail:(offset:number|null)=>{failOffset=offset;}};
  }
  const a=await account();
  return {a,account,instance,titles,mappings,remote};
}

run('A full user import populates library inventory; B inherits every title without a full Items traversal or A personal state',async()=>{
  const f=await fixture();await syncJellyfinUser(f.a.user.id,f.a.context.connection.id,undefined,f.a.context);
  expect(f.a.requests.filter(url=>url.pathname==='/Items').map(url=>url.searchParams.get('parentId'))).toEqual([movies,movies,shows]);
  const [instance]=await getDb().select().from(s.providerInstances).where(eq(s.providerInstances.id,f.instance.id));
  expect(Object.keys(instance.settings.screenLibraryCensus as object)).toEqual([movies,shows]);
  const b=await f.account();await bootstrapJellyfinUser(b.user.id,b.context.connection.id,undefined,b.context);
  const grants=await getDb().select().from(s.availability).where(and(eq(s.availability.connectionId,b.context.connection.id),eq(s.availability.state,'available')));
  expect(grants).toHaveLength(f.titles.length);
  expect(b.requests.filter(url=>url.pathname==='/Items'&&!url.searchParams.has('filters'))).toHaveLength(0);
  expect(b.requests.filter(url=>url.pathname==='/Items'&&url.searchParams.has('filters'))).toHaveLength(3);
  for(const grant of grants) {
    expect(grant.source.coastAccessKind).toBe('library-cache');
    for(const key of ['coastUserData','Path','UserData','TranscodingUrl'])expect(key in grant.source).toBe(false);
  }
  expect(await getDb().select().from(s.trackingState).where(eq(s.trackingState.userId,b.user.id))).toHaveLength(0);
  expect(await getDb().select().from(s.syncCheckpoints).where(and(eq(s.syncCheckpoints.connectionId,b.context.connection.id),eq(s.syncCheckpoints.kind,'jellyfin-user')))).toHaveLength(0);
  const requests=b.requests.length;await bootstrapJellyfinUser(b.user.id,b.context.connection.id,undefined,b.context);expect(b.requests.length).toBe(requests);
});

run('explicit subset and blocked-library grants reuse only their actual visible library',async()=>{
  const f=await fixture(2);await syncJellyfinUser(f.a.user.id,f.a.context.connection.id,undefined,f.a.context);
  for(const policy of [{...unrestricted(),EnableAllFolders:false,EnabledFolders:[movies]},{...unrestricted(),BlockedMediaFolders:[shows]}]) {
    const b=await f.account([movies],policy);expect(await tryReuseScreenAccess(b.context)).toBe(2);
    const grants=await getDb().select().from(s.availability).where(eq(s.availability.connectionId,b.context.connection.id));
    expect(new Set(grants.map(row=>row.mediaId))).toEqual(new Set(f.titles.slice(0,2).map(row=>row.id)));
  }
});

run('restrictions, unknown policy, stale inventory and changed source generation fall back without granting access',async()=>{
  const f=await fixture(1);await syncJellyfinUser(f.a.user.id,f.a.context.connection.id,undefined,f.a.context);
  for(const policy of [{...unrestricted(),MaxParentalRating:5},{...unrestricted(),BlockedTags:['private']},{...unrestricted(),AllowedTags:['public']},
    {...unrestricted(),BlockUnratedItems:['Movie']},{...unrestricted(),AccessSchedules:[{}]},{...unrestricted(),NewVisibilityRule:true}]) {
    const b=await f.account(undefined,policy);expect(await tryReuseScreenAccess(b.context)).toBeNull();
    expect(await getDb().select().from(s.availability).where(eq(s.availability.connectionId,b.context.connection.id))).toHaveLength(0);
  }
  const b=await f.account();await getDb().update(s.providerConnections).set({accountGeneration:crypto.randomUUID()}).where(eq(s.providerConnections.id,f.a.context.connection.id));
  expect(await tryReuseScreenAccess(b.context)).toBeNull();
  await getDb().update(s.providerConnections).set({accountGeneration:f.a.context.connection.accountGeneration}).where(eq(s.providerConnections.id,f.a.context.connection.id));
  const expired=new Date(Date.now()-screenCensusMaxAgeMs()-1000).toISOString();
  await getDb().execute(sql`update provider_instances set settings=jsonb_set(jsonb_set(settings,ARRAY['screenLibraryCensus',${movies},'completedAt'],to_jsonb(${expired}::text)),ARRAY['screenLibraryCensus',${shows},'completedAt'],to_jsonb(${expired}::text)) where id=${f.instance.id}`);
  expect(await tryReuseScreenAccess(b.context)).toBeNull();
});

run('inventory freshness follows full-refresh cadence while B permissions are always fresh',async()=>{
  const f=await fixture(1);await syncJellyfinUser(f.a.user.id,f.a.context.connection.id,undefined,f.a.context);
  const observed=new Date(Date.now()-12*3600000).toISOString();
  await getDb().execute(sql`update provider_instances set settings=jsonb_set(jsonb_set(settings,ARRAY['screenLibraryCensus',${movies},'completedAt'],to_jsonb(${observed}::text)),ARRAY['screenLibraryCensus',${shows},'completedAt'],to_jsonb(${observed}::text)) where id=${f.instance.id}`);
  const b=await f.account();expect(await tryReuseScreenAccess(b.context)).toBe(f.titles.length);
  b.policy({...unrestricted(),BlockedTags:['private']});expect(await tryReuseScreenAccess(b.context)).toBeNull();
  const c=await f.account();
  await getDb().update(s.providerInstances).set({settings:sql`${s.providerInstances.settings} || jsonb_build_object('schedule',${{...providerSchedule('jellyfin'),fullIntervalHours:1}}::jsonb)`}).where(eq(s.providerInstances.id,f.instance.id));
  expect(await tryReuseScreenAccess(c.context)).toBeNull();
});

run('recent ordinary metadata refresh retains completed library provenance',async()=>{
  const f=await fixture(1),db=getDb();await syncJellyfinUser(f.a.user.id,f.a.context.connection.id,undefined,f.a.context);
  const [before]=await db.select().from(s.providerItems).where(and(eq(s.providerItems.instanceId,f.instance.id),eq(s.providerItems.externalId,f.mappings[0].externalId)));
  f.remote[0].Name='Updated shared metadata';
  await scanJellyfinLibrary(f.a.user.id,f.a.context.connection.id,false,undefined,f.a.context);
  const [after]=await db.select().from(s.providerItems).where(eq(s.providerItems.id,before.id));
  expect(after.mediaId).toBe(before.mediaId);expect(after.snapshot.title).toBe('Updated shared metadata');expect(after.snapshot.screenAccess).toEqual(before.snapshot.screenAccess);
  const b=await f.account();expect(await tryReuseScreenAccess(b.context)).toBe(f.titles.length);
});

run('interrupted library census publishes no partial access; a resume commits each page once',async()=>{
  const f=await fixture();f.a.fail(100);
  await expect(syncJellyfinUser(f.a.user.id,f.a.context.connection.id,undefined,f.a.context)).rejects.toThrow('Census interruption');
  const b=await f.account();expect(await tryReuseScreenAccess(b.context)).toBeNull();
  const calls=f.a.requests.filter(url=>url.pathname==='/Items'&&url.searchParams.get('startIndex')==='0').length;
  f.a.fail(null);await syncJellyfinUser(f.a.user.id,f.a.context.connection.id,undefined,f.a.context);
  expect(f.a.requests.filter(url=>url.pathname==='/Items'&&url.searchParams.get('startIndex')==='0')).toHaveLength(calls+1); // The untouched second library only.
  expect(await tryReuseScreenAccess(b.context)).toBe(f.titles.length);
});

run('C inherits the last completed inventory while B full verification is interrupted; partial new coverage is never published',async()=>{
  const f=await fixture(),db=getDb();await syncJellyfinUser(f.a.user.id,f.a.context.connection.id,undefined,f.a.context);
  const [before]=await db.select().from(s.providerInstances).where(eq(s.providerInstances.id,f.instance.id));
  const old=(before.settings.screenLibraryCensus as Record<string,{scanId:string}>)[movies].scanId;
  const b=await f.account();expect(await tryReuseScreenAccess(b.context)).toBe(f.titles.length);
  b.fail(100);await expect(syncJellyfinUser(b.user.id,b.context.connection.id,undefined,b.context)).rejects.toThrow('Census interruption');
  const [during]=await db.select().from(s.providerInstances).where(eq(s.providerInstances.id,f.instance.id));
  expect(during.settings.screenLibraryCensus).toEqual(before.settings.screenLibraryCensus);
  const [item]=await db.select().from(s.providerItems).where(and(eq(s.providerItems.instanceId,f.instance.id),eq(s.providerItems.externalId,f.mappings[0].externalId)));
  const access=item.snapshot.screenAccess as {libraries:Record<string,{scanId:string}>;completedLibraries:Record<string,{scanId:string}>};
  expect(access.libraries[movies].scanId).not.toBe(old);expect(access.completedLibraries[movies].scanId).toBe(old);
  const c=await f.account();expect(await tryReuseScreenAccess(c.context)).toBe(f.titles.length);
  expect(c.requests.filter(url=>url.pathname==='/Items')).toHaveLength(0);
  const grants=await db.select().from(s.availability).where(eq(s.availability.connectionId,c.context.connection.id));
  expect(grants).toHaveLength(f.titles.length);expect(grants.filter(row=>row.source.coastLibraryId===movies).every(row=>row.source.coastLibraryScanId===old)).toBe(true);
  const assessments=await workAssessments(c.user.id,c.user.id,f.titles.map(item=>item.id));expect(assessments.every(item=>item.availability==='available'&&!item.stale)).toBe(true);
  b.fail(null);await syncJellyfinUser(b.user.id,b.context.connection.id,undefined,b.context);
  const [after]=await db.select().from(s.providerInstances).where(eq(s.providerInstances.id,f.instance.id));
  expect((after.settings.screenLibraryCensus as Record<string,{scanId:string}>)[movies].scanId).not.toBe(old);
  const d=await f.account();expect(await tryReuseScreenAccess(d.context)).toBe(f.titles.length);
});

run('new Channel, unknown or non-file evidence invalidates the retained completed library slot',async()=>{
  for(const change of [{SourceType:'Channel'},{SourceType:'Unexpected'},{LocationType:'Virtual'}]) {
    const f=await fixture(101),db=getDb();await syncJellyfinUser(f.a.user.id,f.a.context.connection.id,undefined,f.a.context);
    Object.assign(f.remote[0],change);
    const b=await f.account();b.fail(100);await expect(syncJellyfinUser(b.user.id,b.context.connection.id,undefined,b.context)).rejects.toThrow('Census interruption');
    const [item]=await db.select().from(s.providerItems).where(and(eq(s.providerItems.instanceId,f.instance.id),eq(s.providerItems.externalId,f.mappings[0].externalId)));
    const access=item.snapshot.screenAccess as {libraries:Record<string,{sourceType:string}>;completedLibraries:Record<string,unknown>};
    expect(access.libraries[movies].sourceType).toBe('Unsupported');expect(access.completedLibraries[movies]).toBeUndefined();
    const c=await f.account([movies]);expect(await tryReuseScreenAccess(c.context)).toBeNull();
    expect(await db.select().from(s.availability).where(eq(s.availability.connectionId,c.context.connection.id))).toHaveLength(0);
  }
});

run('channel and unknown file evidence cannot publish a reusable authoritative library',async()=>{
  const f=await fixture(1);f.remote[0].SourceType='Channel';await syncJellyfinUser(f.a.user.id,f.a.context.connection.id,undefined,f.a.context);
  const b=await f.account([movies]);expect(await tryReuseScreenAccess(b.context)).toBeNull();
  const proof=await captureScreenAccessProof(b.context);expect(proof?.libraryIds).toEqual([movies]);
});

run('existing personal observations are never relabelled as a fresh inherited scan',async()=>{
  const f=await fixture(1);await syncJellyfinUser(f.a.user.id,f.a.context.connection.id,undefined,f.a.context);
  const b=await f.account(),scanId=crypto.randomUUID(),verifiedAt=new Date('2025-01-01T00:00:00Z');
  const [mapping]=await getDb().select().from(s.providerItems).where(and(eq(s.providerItems.instanceId,f.instance.id),eq(s.providerItems.externalId,f.mappings[0].externalId)));
  await getDb().insert(s.availability).values({userId:b.user.id,connectionId:b.context.connection.id,providerItemId:mapping.id,mediaId:mapping.mediaId,
    sourceId:'default',source:{coastUserData:{played:true}},scanId,verifiedAt});
  expect(await tryReuseScreenAccess(b.context)).toBe(f.titles.length-1);
  const [personal]=await getDb().select().from(s.availability).where(and(eq(s.availability.connectionId,b.context.connection.id),eq(s.availability.providerItemId,mapping.id)));
  expect(personal.scanId).toBe(scanId);expect(personal.verifiedAt).toEqual(verifiedAt);expect(personal.source).toEqual({coastUserData:{played:true}});
});

run('inherited show, season and leaf access is fresh and complete before B has full personal coverage',async()=>{
  const f=await fixture(1),db=getDb();
  const hierarchy=[{id:crypto.randomUUID(),kind:'show' as const,title:'Cached series'},{id:crypto.randomUUID(),kind:'season' as const,title:'Cached season'},
    {id:crypto.randomUUID(),kind:'episode' as const,title:'Cached first'},{id:crypto.randomUUID(),kind:'episode' as const,title:'Cached second'}];
  await db.insert(s.media).values(hierarchy);await db.insert(s.shows).values({mediaId:hierarchy[0].id});
  await db.insert(s.seasons).values({mediaId:hierarchy[1].id,showId:hierarchy[0].id,seasonNumber:1});
  await db.insert(s.episodes).values(hierarchy.slice(2).map((item,index)=>({mediaId:item.id,showId:hierarchy[0].id,seasonId:hierarchy[1].id,seasonNumber:1,episodeNumber:index+1})));
  const mappings=hierarchy.map(item=>({instanceId:f.instance.id,externalId:crypto.randomUUID().replaceAll('-',''),mediaId:item.id,kind:item.kind,snapshot:{title:item.title}}));
  await db.insert(s.providerItems).values(mappings);
  for(const [index,mapping] of mappings.entries())f.remote.push({Id:mapping.externalId,Name:hierarchy[index].title,Type:['Series','Season','Episode','Episode'][index],LocationType:'FileSystem',
    SeriesId:mappings[0].externalId,ParentId:index===1?mappings[0].externalId:mappings[1].externalId,IndexNumber:index===1?1:index-1,ParentIndexNumber:1,
    ...(index<2?{RecursiveItemCount:2}:{}),UserData:{Played:false,IsFavorite:false,PlayCount:0,PlaybackPositionTicks:0}});
  await syncJellyfinUser(f.a.user.id,f.a.context.connection.id,undefined,f.a.context);
  const b=await f.account();expect(await tryReuseScreenAccess(b.context)).toBe(f.titles.length+hierarchy.length);
  const assessments=await workAssessments(b.user.id,b.user.id,hierarchy.map(item=>item.id));
  expect(assessments).toHaveLength(hierarchy.length);
  for(const item of assessments){expect(item.availability).toBe('available');expect(item.stale).toBe(false);expect(item.completed).toBe(false);}
  expect(await db.select().from(s.syncCheckpoints).where(and(eq(s.syncCheckpoints.connectionId,b.context.connection.id),eq(s.syncCheckpoints.kind,'jellyfin-user')))).toHaveLength(0);
});
