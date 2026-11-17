import {expect,test} from 'bun:test';
import type {SQL} from 'bun';
import {cancellableReads,withReadCancellation} from '../src/lib/server/db/read-cancellation';

const index=await Bun.file('src/lib/server/api/index.server.ts').text();
const transpile=(source:string)=>new Bun.Transpiler({loader:'ts'}).transformSync(source.replace(/^import[\s\S]*?from ['"][^'"]+['"];?\s*$/gm,'').replaceAll('export ',''));
function factory(source:string,name:string,dependencies:Record<string,unknown>){
 return Function(...Object.keys(dependencies),transpile(source)+`;return ${name};`)(...Object.values(dependencies)) as (context:Record<string,unknown>)=>Promise<unknown>;
}
const uid='00000000-0000-4000-8000-000000000001',work='00000000-0000-4000-8000-000000000002';
const collectionStart=index.indexOf("    if (path[0] === 'collection' && path[1] &&");
const collectionEnd=index.indexOf("    if (path[0] === 'missing'",collectionStart);
const collection=index.slice(collectionStart,collectionEnd);
const music=(suffix:string)=>index.split('\n').find(line=>line.includes(`path[2]==='${suffix}'`)&&line.includes("method==='GET'"))!;
const indexRead=(branch:string)=>`async function handle(context){const {uid,path,method,url,request}=context;${branch}}`;
const media=await Bun.file('src/lib/server/api/media.server.ts').text();
const games=await Bun.file('src/lib/server/api/games.server.ts').text();
const playthroughs=await Bun.file('src/lib/server/api/game-playthroughs.server.ts').text();
const reading=await Bun.file('src/lib/server/api/reading.server.ts').text();

for(const [label,source,name,path] of [
 ['music history',indexRead(music('history')),'handle',['music',work,'history']],
 ['artist log options',indexRead(music('log-options')),'handle',['music',work,'log-options']],
 ['work action snapshot',indexRead(collection),'handle',['collection',work]],
 ['list membership',indexRead(collection),'handle',['collection',work,'lists']],
 ['screen action snapshot',media,'handleMedia',['media',work,'actions']],
 ['screen history',media,'handleMedia',['media',work,'history']],
 ['playthrough choices',games,'handleGames',['games',work,'playthroughs']],
 ['playthrough history',playthroughs,'handleGamePlaythroughs',['game-playthroughs',work]],
 ['reading history',reading,'handleReading',['reading',work,'history']],
] as const){
 test(`closing the ${label} request cancels its admitted database read`,async()=>{
  let entered!:()=>void,reject!:(cause:unknown)=>void,cancelled=0;
  const started=new Promise<void>(yes=>{entered=yes;});
  const query=Object.assign(new Promise<never>((_,no)=>{reject=no;}),{cancel(){cancelled++;reject(new DOMException('Cancelled menu read','AbortError'));}});
  const client=cancellableReads({unsafe(){entered();return query;}} as unknown as SQL);
  const held=()=>client.unsafe('held menu read');
  const dependencies={withReadCancellation,uuid:(value:string)=>value,requireFeature:async()=>{},requireEnabledCategory:()=>{},getFeatureConfig:async()=>({}),
   getDb:()=>({select:()=>({from:()=>({where:async()=>[{id:work,category:'game'}]})})}),works:{id:{}},eq:()=>{},
   workActionData:held,workActionLists:held,mediaActionData:held,mediaHistory:held,musicHistory:held,musicArtistTrackChoices:held,readingHistoryData:held,
   games:{playthroughChoices:held,playthroughDetails:held}};
  const handler=factory(source,name,dependencies);
  const controller=new AbortController(),request=new Request('https://coast-fixture.invalid/api/'+path.join('/'),{signal:controller.signal});
  const pending=handler({uid,path:[...path],method:'GET',url:new URL(request.url),request,user:{id:uid},body:{}});void pending.catch(()=>{});
  await started;controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(cancelled).toBe(1);
 });
}

test('optional read cancellation does not withdraw an explicit game-session write',async()=>{
 let writes=0;
 const handler=factory(playthroughs,'handleGamePlaythroughs',{withReadCancellation,uuid:(value:string)=>value,
  games:{logGameSession:async()=>{writes++;return {saved:true};}}});
 const controller=new AbortController();controller.abort();
 const request=new Request('https://coast-fixture.invalid/api/game-playthroughs/'+work+'/sessions',{signal:controller.signal});
 const response=await handler({uid,path:['game-playthroughs',work,'sessions'],method:'POST',url:new URL(request.url),request,body:{}}) as Response;
 expect(await response.json()).toEqual({saved:true});expect(writes).toBe(1);
});
