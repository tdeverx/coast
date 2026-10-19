import {expect,test} from 'bun:test';
import {and,asc,desc,eq,inArray,or,sql} from 'drizzle-orm';
import * as v from 'valibot';
import * as s from '../src/lib/server/db/schema';
import {AppError} from '../src/lib/server/security/errors';
// Source-derived controls execute the current owners at named I/O seams.
// Their authored values protect projection/caller contracts; they are not
// actual catalogue cohorts or provider/resource performance measurements.
const read=(path:string)=>Bun.file(new URL('../'+path,import.meta.url)).text();
const js=(source:string)=>new Bun.Transpiler({loader:'ts'}).transformSync(source).replace(/^import[^;]+;\s*/gm,'').replaceAll('export ','');
const compile=(source:string,deps:Record<string,unknown>,result:string)=>new Function(...Object.keys(deps),js(source)+'\nreturn '+result+';')(...Object.values(deps));
const target=compile(await read('src/lib/media/detail-target.ts'),{},'({mediaDetailTarget,screenDetailChildren})');

test('only isolated section demand omits children; overview, collection and unknown scopes stay complete',()=>{
 for(const section of ['reviews','credits','activity'])expect(target.screenDetailChildren(section)).toBe(false);
 for(const section of [undefined,null,'','insights','related','episodes','progress',crypto.randomUUID(),'unknown','Reviews'])expect(target.screenDetailChildren(section)).toBe(true);
});

function owner(source:string,kind:'season'|'collection'|'movie'){
 const [viewer,root,show,parent,leaf,peer,nextId]=Array.from({length:7},()=>crypto.randomUUID());
 const card=(id:string,kind='movie')=>Object.freeze({id,kind,title:id,showId:kind==='season'?show:undefined,watched:false,progress:4,duration:100,runtimeMinutes:12,available:true,trackingProgress:Object.freeze({unit:'seconds',value:4,total:100})});
 const cards=new Map<string,ReturnType<typeof card>>([[root,card(root,kind)],[show,card(show,'show')],[parent,card(parent,'collection')],[leaf,card(leaf,'episode')],[peer,card(peer)]]);
 const episodes=kind==='season'?[{mediaId:leaf,seasonId:root,showId:show,seasonNumber:1,episodeNumber:1}]:[];
 const seasons=kind==='season'?[{mediaId:root,showId:show,seasonNumber:1}]:[];
 const relationships=[{parentId:parent,childId:root,kind:'collection',position:0},{parentId:root,childId:peer,kind:'related',position:1}];
 const requests:string[][]=[],sequences:string[]=[],nextCalls:string[]=[];
 const entry=(mediaId:string,entryId:string)=>({mediaId,entryId,watched:false,progress:2,duration:100,dropped:false,startedAt:null});
 const entries=[entry(leaf,'first'),entry(leaf,'repeated')];
 const db={select:()=>{let table:unknown;const query:any={from:(value:unknown)=>{table=value;return query;},where:()=>query,innerJoin:()=>query,orderBy:()=>query,limit:()=>query,
  then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(table===s.episodes?episodes:table===s.seasons?seasons:table===s.mediaRelationships?relationships:[]).then(resolve)};return query;}};
 const start=source.indexOf('export async function detailsData('),occurrence=source.slice(source.indexOf('export function applySequenceEntry('),source.indexOf('export async function sequenceNextView('));
 const details=compile(occurrence+'\n'+source.slice(start),{v,uuidSchema:v.pipe(v.string(),v.uuid()),s,and,asc,desc,eq,inArray,or,sql,AppError,getDb:()=>db,
  mediaViews:async(_user:string,{ids}:{ids:string[]})=>{requests.push(ids);return ids.flatMap(id=>cards.has(id)?[cards.get(id)!]:[]);},
  mediaViewsForIds:async(_user:string,ids:string[])=>{requests.push(ids);return [...new Set(ids)].flatMap(id=>cards.has(id)?[cards.get(id)!]:[]);},
  sequenceEntries:async(_user:string,{id}:{id:string})=>{sequences.push(id);return entries;},
  nextPlayable:async(_user:string,item:{id:string})=>{nextCalls.push(item.id);return card(nextId);},permittedAvailability:()=>sql`true`,getConfig:async()=>({cacheTmdbArtwork:false}),tmdbArtworkUrl:(value:unknown)=>value},'detailsData');
 return{details,viewer,root,show,parent,leaf,peer,requests,sequences,nextCalls};
}

// Controlled I/O seams protect hidden membership admission and the independent
// next-owner call. They do not establish actual catalogue/query/resource gains.
test('full mode stays exact and compact mode retains headers/next while omitting only hidden arrays',async()=>{
 const source=await read('src/lib/server/queries/media.ts');
 for(const kind of ['season','collection','movie'] as const){
  const f=owner(source,kind),full=await f.details(f.viewer,f.root);
  expect(full.collections).toHaveLength(1);expect(full.collections[0].items.map((x:any)=>x.entryId)).toEqual(['first','repeated']);
  f.requests.length=0;f.sequences.length=0;f.nextCalls.length=0;
  const compact=await f.details(f.viewer,f.root,false);
  expect(compact).toEqual({...full,episodes:[],members:[],seasons:[],related:[],collections:full.collections.map((c:any)=>({...c,items:[]}))});
  expect(f.sequences).toEqual([]);expect(f.nextCalls).toEqual([f.root]);
  expect(f.requests.flat()).not.toContain(f.leaf);expect(f.requests.flat()).not.toContain(f.peer);expect(f.requests.flat()).toContain(f.parent);
  expect(await f.details(f.viewer,f.root,true)).toEqual(full);
 }
});

test('the initial read and both successful enrichment rereads keep one demand and request signal',async()=>{
 const source=await read('src/lib/application/media-details.server.ts');
 for(const includeChildren of [true,false]){
  const reads:any[]=[],refreshes:any[]=[],signals:any[]=[],controller=new AbortController();
  const saved={item:{id:'screen',tmdbId:'actual'},collections:[{id:'parent',items:[]}]};
  const load=compile(source,{detailsData:async(...args:any[])=>{reads.push(args);return saved;},requestOptions:async(_u:string,_id:string,signal:AbortSignal)=>{signals.push(signal);return[{id:'destination'}];},ensureDetails:async(...args:any[])=>{refreshes.push(args);return true;}},'loadMediaDetails');
  const initial=await load('owner','screen',controller.signal,includeChildren);const enhanced=await initial.enhancement;
  expect(reads).toEqual(Array.from({length:3},()=>['owner','screen',includeChildren]));expect(refreshes).toEqual([['owner','screen'],['owner','parent']]);
  expect(signals).toEqual([controller.signal]);expect(enhanced.requestable).toBe(true);expect(enhanced.refreshUnavailable).toBe(false);
 }
});

test('presentation dispatch keeps normalized section in both initial and enhanced screen paths',async()=>{
 const source=await read('src/lib/application/work-details.server.ts'),reads:any[]=[],enhancements:any[]=[],controller=new AbortController();
 const tableQuery:any={from:()=>tableQuery,where:()=>tableQuery,limit:()=>Promise.resolve([{category:'screen'}])};
 const forbidden=()=>{throw Error('Unrequested medium');};
 const dispatch=compile(source,{eq,works:s.works,getDb:()=>({select:()=>tableQuery}),AppError,mediaDetailTarget:target.mediaDetailTarget,screenDetailChildren:target.screenDetailChildren,
  detailsData:async(...args:any[])=>{reads.push(args);return{item:{id:args[1]}};},loadMediaDetails:async(...args:any[])=>{enhancements.push(args);return{enhancement:Promise.resolve({item:{id:args[1]},requestable:true,refreshUnavailable:false})};},readingDetails:forbidden,gameDetailData:forbidden,gameProviderDetailData:forbidden,musicDetailData:forbidden,musicSourceDetailData:forbidden,readingRemoteDetail:forbidden,readingGroupDetail:forbidden,personDetailData:forbidden},'({workDetailData,mediaDetailData})');
 const id=crypto.randomUUID();
 for(const section of [undefined,'reviews','credits','activity',crypto.randomUUID(),'insights']){
  const href=`/media/${id}`+(section?`?section=${section}`:'');const demand=target.screenDetailChildren(section);
  await dispatch.mediaDetailData('viewer',href,controller.signal);expect(reads.at(-1)).toEqual(['viewer',id,demand]);
  const enhanced=await dispatch.mediaDetailData('viewer',href,controller.signal,true);expect(enhanced.kind).toBe('screen');expect(enhanced.data.requestable).toBe(true);
  expect(enhancements.at(-1)).toEqual(['viewer',id,controller.signal,demand]);
 }
 await dispatch.workDetailData('viewer',id);expect(reads.at(-1)).toEqual(['viewer',id,true]);
});

test('ordinary media API reads stay full while explicit presentation enhancement retains its href',async()=>{
 const source=await read('src/lib/server/api/media.server.ts'),calls:any[]=[],id=crypto.randomUUID(),signal=new AbortController().signal;
 const query:any={from:()=>query,where:()=>Promise.resolve([])};
 const handle=compile(source,{v,AppError,uuid:(x:string)=>v.parse(v.pipe(v.string(),v.uuid()),x),json:(x:unknown)=>Response.json(x),getDb:()=>({select:()=>query}),readingWorks:s.readingWorks,eq,
  mediaDetailData:async(...args:any[])=>{calls.push(['presentation',...args]);return{kind:'screen',data:{item:{id}}};},detailsData:async(...args:any[])=>{calls.push(['full',...args]);return{item:{id}};},loadMediaDetails:async(...args:any[])=>{calls.push(['full-enhance',...args]);return{enhancement:Promise.resolve({item:{id}})};}},'handleMedia');
 const context=(path:string[],search:string)=>({uid:'viewer',user:{},path,method:'GET',url:new URL('http://test/api/v1/'+path.join('/')+search),body:{},request:{signal}});
 await handle(context(['media',id],'?section=reviews'));expect(calls.at(-1)).toEqual(['full','viewer',id]);
 await handle(context(['media',id],'?enhance=true&section=reviews'));expect(calls.at(-1)).toEqual(['full-enhance','viewer',id,signal]);
 const href=`/media/${id}?section=reviews`;await handle(context(['media','details'],'?href='+encodeURIComponent(href)+'&enhance=true'));
 expect(calls.at(-1)).toEqual(['presentation','viewer',href,signal,true]);
});

test('guest projected detail skips child membership and preserves safe root/parents; full remains default',async()=>{
 const source=await read('src/lib/social/public.server.ts'),start=source.indexOf('export async function publicDetails('),end=source.indexOf('/** Guest searches',start),calls:string[][]=[];
 const [id,child,season,parent]=Array.from({length:4},()=>crypto.randomUUID());
 const cards=new Map<string,{id:string;kind:string}>([[id,{id,kind:'show'}],[child,{id:child,kind:'episode'}],[season,{id:season,kind:'season'}],[parent,{id:parent,kind:'show'}]]);
 const query=(strings:TemplateStringsArray)=>{const text=strings.join('?');return text.includes('select child_id')?[{child_id:child},{child_id:season}]:text.includes('select parent_id')?[{parent_id:parent}]:[{mediaId:season,showId:id,seasonNumber:1}];};
 const detail=compile(source.slice(start,end),{getSql:()=>query,AppError,publicMedia:async(ids:string[])=>{calls.push(ids);return ids.flatMap(id=>cards.has(id)?[cards.get(id)!]:[]);}},'publicDetails');
 const full=await detail(id);expect(full.episodes.map((x:any)=>x.id)).toEqual([child]);expect(full.seasons.map((x:any)=>x.item.id)).toEqual([season]);calls.length=0;
 expect(await detail(id,false)).toEqual({...full,episodes:[],members:[],seasons:[]});expect(calls.flat()).toEqual([id,parent]);
});

test('full route applies the same section demand for signed-in and guest screen reads',async()=>{
 let source=await read('src/routes/media/[id]/+page.server.ts');
 source=source.replace("(await import('$lib/social/public.server')).publicDetails",'publicDetails');
 const calls:any[]=[],id=crypto.randomUUID(),query:any={from:()=>query,where:()=>Promise.resolve([])};
 const load=compile(source,{v,error:(status:number)=>{throw Object.assign(Error('route'),{status});},eq,getDb:()=>({select:()=>query}),readingWorks:s.readingWorks,screenDetailChildren:target.screenDetailChildren,
  readingDetailLoad:()=>{throw Error('Unexpected reading branch');},loadMediaDetails:async(...args:any[])=>{calls.push(['private',...args]);return{item:{id}};},publicDetails:async(...args:any[])=>{calls.push(['guest',...args]);return{item:{id}};}},'load');
 for(const section of [undefined,'reviews','credits','activity',crypto.randomUUID(),'insights'])for(const signedIn of [true,false]){
  const request=new Request('http://test/media/'+id+(section?'?section='+section:'')),event={params:{id},locals:{user:signedIn?{id:'viewer'}:null},request,url:new URL(request.url),depends(){}};
  await load(event);expect(calls.at(-1)).toEqual(signedIn?['private','viewer',id,request.signal,target.screenDetailChildren(section)]:['guest',id,target.screenDetailChildren(section)]);
 }
});
