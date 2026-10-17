import {expect,test} from 'bun:test';
import * as v from 'valibot';
import {and,desc,eq,inArray,sql} from 'drizzle-orm';
import * as s from '../src/lib/server/db/schema';
import {profileOptionsSchema} from '../src/lib/server/queries/profile';
import {periodStart} from '../src/lib/profile/period';
import {pagination,PAGE_SIZE} from '../src/lib/server/queries/pagination';
import {nextSequenceEntry} from '../src/lib/core/lists/sequence.server';
import {AppError} from '../src/lib/server/security/errors';

// Compile the actual owners with named I/O boundaries, without mocking the shared
// pool process-wide. Database fixtures separately verify the SQL projections.
const compile=(source:string,deps:Record<string,unknown>,result:string)=>new Function(
  ...Object.keys(deps),`${new Bun.Transpiler({loader:'ts'}).transformSync(source).replaceAll('export ','')}\nreturn ${result};`
)(...Object.values(deps));
const mediaSource=await Bun.file(new URL('../src/lib/server/queries/media.ts',import.meta.url)).text();
const nextSource=mediaSource.slice(mediaSource.indexOf('export function applySequenceEntry('),mediaSource.indexOf('export async function nextPlayable('));
const owner=crypto.randomUUID();
const entry=(entryId:string,watched=false)=>({entryId,mediaId:crypto.randomUUID(),watched,dropped:false,progress:20,duration:100,startedAt:null});

test('ordinary next selection requests one bounded entry and retains cursor/from-root behavior',async()=>{
  const entries=[entry('root/first',true),entry('root/next'),entry('other')];
  const fullReads:string[]=[],nextReads:unknown[]=[],hydrated:string[][]=[];
  const select=compile(nextSource,{
    nextSequenceEntry,AppError,
    sequenceEntries:async()=>{fullReads.push('full');return entries;},
    nextSequenceEntries:async(_user:string,sources:{kind:string;id:string}[])=>{nextReads.push(sources);return new Map([[`${sources[0].kind}:${sources[0].id}`,entries[1]]]);},
    mediaViews:async(_user:string,{ids}:{ids:string[]})=>{hydrated.push(ids);return ids.map(id=>({id,kind:'movie',title:id,available:false}));},
  },'sequenceNextView');
  const source={kind:'collection',id:crypto.randomUUID()};
  const next=await select(owner,source);
  expect(next.id).toBe(entries[1].mediaId);expect(next.available).toBe(false);
  expect(next.sequence).toEqual({...source,entryId:entries[1].entryId});
  expect(fullReads).toHaveLength(0);expect(nextReads).toEqual([[source]]);expect(hydrated).toEqual([[entries[1].mediaId]]);
  expect((await select(owner,source,entries[1].entryId)).id).toBe(entries[2].mediaId);
  expect((await select(owner,source,undefined,'root')).id).toBe(entries[1].mediaId);
  // An exact entry can intentionally be reopened even if it is already watched.
  expect((await select(owner,source,undefined,entries[0].entryId)).id).toBe(entries[0].mediaId);
  await expect(select(owner,source,undefined,'removed')).rejects.toMatchObject({status:409});
  expect(fullReads).toHaveLength(4);expect(nextReads).toHaveLength(1);
});

test('empty bounded next selection does not activate card hydration',async()=>{
  const select=compile(nextSource,{nextSequenceEntry,AppError,
    sequenceEntries:()=>{throw Error('Unexpected full sequence');},nextSequenceEntries:async()=>new Map(),
    mediaViews:()=>{throw Error('Unexpected card hydration');}},'sequenceNextView');
  expect(await select(owner,{kind:'collection',id:crypto.randomUUID()})).toBeNull();
});

const {relationshipEdges,relationshipReasons}=await import('../src/lib/social/relationships.server');
const socialSource=await Bun.file(new URL('../src/lib/social/queries.server.ts',import.meta.url)).text();
const socialFunction=socialSource.slice(socialSource.indexOf('export async function workSocial('),socialSource.indexOf('/** Batch reads'));
test('social projection retains exact totals and resolves presence only for displayed identities',async()=>{
  const ids=Array.from({length:60},()=>crypto.randomUUID()),selected=Array.from({length:3},()=>crypto.randomUUID());
  const rows=ids.slice(0,-1).flatMap(workId=>selected.map((userId,i)=>({workId,userId,username:`friend-${i}`,avatar:null,rating:null,watched:false,progress:0,total:300})));
  const reaction={targetId:ids[0],emoji:'❤️',count:8};let statement=0,statusIds:string[]=[];
  const workSocial=compile(socialFunction,{relationshipEdges,relationshipReasons,getFeatureConfig:async()=>({features:{social:true}}),v,uuid:v.pipe(v.string(),v.uuid()),sql,
    getDb:()=>({execute:async()=>++statement===1?rows:[reaction]}),
    statusesForUsers:async(_viewer:string,ids:string[])=>{statusIds=ids;return {[selected[0]]:'online'};},
  },'workSocial');
  const result=await workSocial(owner,ids);
  expect(result[ids[0]].total).toBe(300);expect(result[ids[0]].friends.map((row:{userId:string})=>row.userId)).toEqual(selected);
  expect(result[ids[0]].friends.map((row:{status:string})=>row.status)).toEqual(['online','offline','offline']);
  expect(result[ids[0]].friends.every((row:object)=>!('total' in row))).toBe(true);
  expect(result[ids[0]].reactions).toEqual([reaction]);expect(result[ids.at(-1)!]).toEqual({friends:[],total:0,reactions:[]});
  expect(statusIds).toHaveLength(59*3);expect(new Set(statusIds)).toEqual(new Set(selected));
});

const publicSource=await Bun.file(new URL('../src/lib/social/public.server.ts',import.meta.url)).text();
const publicFunctions=publicSource.slice(publicSource.indexOf('export async function publicMedia('),publicSource.indexOf('/** Guest searches'));
test('guest explicit metadata retains complete ordered membership in bounded batches and safe fields',async()=>{
  const ids=Array.from({length:1001},()=>crypto.randomUUID());
  const batches:string[][]=[];
  const db:any=(first:TemplateStringsArray|string[],...values:unknown[])=>{
    if(!('raw' in first))return {ids:first};
    const batch=(values.find(value=>typeof value==='object'&&value!==null&&'ids' in value) as {ids:string[]}|undefined)?.ids;
    if(!batch)return Promise.resolve([{id:'discovery',kind:'movie',title:'Discovery',genres:[]}]);
    batches.push(batch);return Promise.resolve(batch.toReversed().map(id=>({id,kind:'episode',title:id,genres:[],poster_path:'https://private.invalid/art',backdrop_path:'https://image.tmdb.org/t/p/original/safe.jpg'})));
  };
  const {publicMedia}=compile(publicFunctions,{getFeatureConfig:async()=>({cacheTmdbArtwork:false,features:{screen:true}}),getSql:()=>db,tmdbArtworkUrl:(path:string)=>path,AppError},'{publicMedia,publicDetails}');
  const cards=await publicMedia([...ids,ids[0]]);
  expect(cards.map((card:{id:string})=>card.id)).toEqual(ids);expect(batches.map(batch=>batch.length)).toEqual([500,500,1]);
  expect(cards.every((card:{poster:unknown;available:boolean;watched:boolean;rating:unknown})=>card.poster===null&&!card.available&&!card.watched&&card.rating===null)).toBe(true);
  expect((await publicMedia()).map((card:{id:string})=>card.id)).toEqual(['discovery']);
  expect(await publicMedia([])).toEqual([]);expect(batches).toHaveLength(3);
});

const profileSource=await Bun.file(new URL('../src/lib/server/queries/profile.ts',import.meta.url)).text();
const profileFunctions=profileSource.slice(profileSource.indexOf('async function profileSummary('),profileSource.indexOf('export async function profileActivity('));
test('insight projection reuses identical totals without activating profile cards or preferences',async()=>{
  let executions=0,hydrated=0,userReads=0;
  const db={execute:async()=>++executions%2===1?[{favourites:true,ratings:true}]:[{total:10,unique:9,movies:7,episodes:2,filtered:10}],
    select:(projection:Record<string,unknown>)=>{
      let table:unknown;
      const query:any={from:(next:unknown)=>{table=next;return query;},where:()=>query,innerJoin:()=>query,leftJoin:()=>query,orderBy:()=>query,limit:()=>query,offset:()=>query,
        then:(resolve:(rows:unknown[])=>unknown)=>{
          if(table===s.users){userReads++;return Promise.resolve([{settings:{profile:{backgroundMode:'fixed'}}}]).then(resolve);}
          if('favourites' in projection)return Promise.resolve([{favourites:20,categories:['screen']}]).then(resolve);
          if('insightCount' in projection)return Promise.resolve([{count:4,insightCount:3,categories:['screen']}]).then(resolve);
          if('count' in projection)return Promise.resolve([{count:20}]).then(resolve);
          return Promise.resolve(Array.from({length:20},()=>({id:crypto.randomUUID()}))).then(resolve);
        }};return query;
    }};
  const {profileData,profileInsightsData}=compile(profileFunctions,{v,profileOptionsSchema,getDb:()=>db,s,sql,and,desc,eq,inArray,
    profileVisibility:async()=>({details:true,insights:true,activity:true,progress:true,collection:true}),getFeatureConfig:async()=>({}),enabledCategories:()=>sql`true`,
    periodHistory:()=>sql`history`,genreRows:()=>sql`genres`,periodStart,AppError,requireVisible:async()=>{},pagination,PAGE_SIZE,
    workCards:async(_owner:string,_viewer:string|null,ids:string[])=>{hydrated+=ids.length;return ids.map(id=>({id,title:id,kind:'movie'}));},mediaViews:async()=>[],
    profileActivity:async(_owner:string,_now:Date,period:string,viewerId:string|null)=>({period,viewerId}),
  },'{profileData,profileInsightsData}');
  const now=new Date('2026-10-15T12:00:00Z');
  const full=await profileData(owner,{},now,owner);expect(hydrated).toBe(20);expect(userReads).toBe(1);
  const insight=await profileInsightsData(owner,{},now,owner);
  expect(insight.totals).toEqual(full.totals);expect(insight.activity).toEqual({period:'all',viewerId:owner});
  expect(hydrated).toBe(20);expect(userReads).toBe(1);
  const guest=await profileInsightsData(owner,{period:'month'},now,null);
  expect(guest.activity).toEqual({period:'month',viewerId:null});expect(hydrated).toBe(20);expect(userReads).toBe(1);
});

test('profile section handler activates the insight reader only for insights',async()=>{
  const source=await Bun.file(new URL('../src/lib/server/api/profile.server.ts',import.meta.url)).text();
  const fullReads:unknown[]=[],insightReads:unknown[]=[];
  const handleProfile=compile(source.slice(source.indexOf('export async function handleProfile(')),{v,json:(value:unknown)=>value,
    profileData:async(...args:unknown[])=>{fullReads.push(args);return {favourites:['favourite'],history:['event'],page:1,pages:1,total:1};},
    profileInsightsData:async(...args:unknown[])=>{insightReads.push(args);return {totals:{watches:4},activity:{days:[]}};},updateProfile:async()=>{},
  },'handleProfile');
  const context={uid:owner,subjectId:owner,method:'GET',body:{}};
  expect(await handleProfile({...context,path:['profile','section'],url:new URL('https://fixture.invalid/api/v1/profile/section?section=insights&period=month')})).toEqual({totals:{watches:4},activity:{days:[]}});
  expect(fullReads).toHaveLength(0);expect(insightReads).toHaveLength(1);
  expect(await handleProfile({...context,path:['profile','section'],url:new URL('https://fixture.invalid/api/v1/profile/section?section=favourites')})).toEqual({favourites:['favourite'],page:1,pages:1,total:1});
  expect(await handleProfile({...context,path:['profile','activity'],url:new URL('https://fixture.invalid/api/v1/profile/activity')})).toEqual({items:['event'],page:1,pages:1,total:1});
  expect(fullReads).toHaveLength(2);expect(insightReads).toHaveLength(1);
});
