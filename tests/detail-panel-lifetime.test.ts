import {afterAll,beforeAll,expect,test} from 'bun:test';
import {compile,compileModule} from 'svelte/compiler';
import {chromium,type Browser} from '@playwright/test';

// Browser plugin not available: maintain the existing installed Playwright
// about:blank fixture; no actual app, user browser, provider or DB is used.
// Execute the production component's compiled template, not only its script.
// Transport and child presenters are inert; teardown reads the outgoing props
// just as a section host/source can during a keyed replacement.
const root=new URL('../',import.meta.url).pathname;
const modules:Record<string,{source:string;svelte?:boolean;runes?:boolean}>={
 entry:{source:`import {mount,flushSync,unmount} from 'svelte';import Panel from '${root}src/lib/media/DetailPanel.svelte';import {page} from '$app/state';
 const component=mount(Panel,{target:document.body});window.fixture={navigate(href){flushSync(()=>{page.state.mediaDetailHref=href;});},refresh(){flushSync(()=>{page.data.revision++;});},viewer(id){flushSync(()=>{page.data.user={id};});},requests:[],disposals:[],destroy(){return unmount(component);}};`},
 route:{runes:true,source:`export const page=$state({state:{mediaDetailHref:undefined,mediaDetailDepth:1},url:new URL('http://fixture/library'),data:{user:{id:'viewer'},revision:0,capabilities:{screen:true,music:true,games:true,reading:true}}});`},
 client:{source:`export class ApiError extends Error{constructor(status){super('denied');this.status=status;}}export const message=e=>e.message;export const isFeatureDisabled=e=>e.featureDisabled===true;export function api(path,body,method,{signal}){return new Promise((resolve,reject)=>window.fixture.requests.push({path,signal,resolve,reject}));}`},
 navigation:{source:`export function closeMediaDetails(){}export function backMediaDetails(){}`},
 context:{source:`export const reportFailure=()=>{};`},
 player:{runes:true,source:`export const player=$state({visible:false});`},
 reader:{runes:true,source:`export const reader=$state({visible:false});`},
 visibility:{source:`export const playbackVisible=p=>p.visible;`},
 editions:{source:`export const editionChoices=()=>[];export const namedEdition=value=>({value});`},
 revision:{source:`export const contentRevisionKey=data=>data.revision;`},
 dynamic:{source:`export const dynamicKind=()=>undefined;`},
 overlay:{svelte:true,source:`<script>let {children,open,sectionPage,contentKey}=$props();$effect.pre(()=>{if(open){sectionPage;contentKey;window.fixture?.readSection?.();}});</script>{#if open}<section data-overlay>{@render children?.()}</section>{/if}`},
 row:{svelte:true,source:`<script>import {onDestroy} from 'svelte';import {sectionTarget} from '$lib/ui/section-target';let {href}=$props();const source=$derived(sectionTarget(href,new URL('http://fixture/'))?.source);const options=()=>source;const initialHref=href,family=source.type;const read=()=>{const current=options();if(current.type!==family)throw Error('Outgoing source family changed before disposal');return current.preview;};window.fixture.readSection=read;onDestroy(()=>{window.fixture.disposals.push({family:'row',initialHref,href,type:options().type});if(window.fixture.readSection===read)delete window.fixture.readSection;});</script><main data-kind="row" data-source={source.type}>{href}</main>`},
};
for(const family of ['screen','reading','game','music','reading-group','remote-game','person'])modules[family]={svelte:true,source:`<script>import {onDestroy} from 'svelte';let {data,detailHref}=$props();const initialId=data.item.id;onDestroy(()=>window.fixture.disposals.push({family:'${family}',initialId,id:data.item.id,href:detailHref}));</script><main data-kind="${family}">{data.item.title}</main>`};
// Keep the exact current Details enrichment effect; only the presenter DOM is
// inert. The production Panel's complete compiled template/controller runs.
const detailsSource=await Bun.file(root+'src/lib/media/Details.svelte').text();
const enhancementEffect=detailsSource.match(/  \$effect\(\(\) => \{\n    const pending = data.enhancement;[\s\S]*?\n  \}\);/)?.[0];
if(!enhancementEffect)throw Error('Review actual Details enhancement lifetime before updating its compiled fixture.');
modules.screen={svelte:true,source:`<script>import {onDestroy} from 'svelte';let {data,detailHref}=$props();let enriched=$state(null);const view=$derived(enriched??data);const initialId=data.item.id;
${enhancementEffect}
onDestroy(()=>window.fixture.disposals.push({family:'screen',initialId,id:data.item.id,href:detailHref}));</script><main data-kind="screen" data-href={detailHref} data-episodes={view.episodes?.length??-1} data-refresh={view.refreshUnavailable?'yes':'no'}>{view.item.title}</main>`};

const aliases:Record<string,string>={
 '$app/state':'route','$lib/ui/client':'client','$lib/ui/client-context':'context','$lib/ui/media-navigation':'navigation',
 '$lib/playback/client.svelte':'player','$lib/reading/client.svelte':'reader','$lib/playback/visibility':'visibility',
 '$lib/media/editions':'editions','$lib/ui/content-revision.svelte':'revision','$lib/recommendations/model':'dynamic',
 '$lib/ui/components/DetailOverlay.svelte':'overlay','$lib/ui/pages/SectionDetails.svelte':'row',
 '$lib/media/Details.svelte':'screen','$lib/reading/Details.svelte':'reading','$lib/games/Details.svelte':'game',
 '$lib/music/Details.svelte':'music','$lib/reading/GroupDetails.svelte':'reading-group','$lib/games/RemoteDetails.svelte':'remote-game','$lib/media/PersonDetails.svelte':'person',
};
const browserEnabled=process.env.COAST_TEST_BROWSER==='1';
const browserTest=browserEnabled?test:test.skip;
let browser:Browser,bundle:string;
beforeAll(async()=>{
 if(!browserEnabled)return;
 const result=await Bun.build({entrypoints:['panel-fixture:entry'],target:'browser',conditions:['browser'],plugins:[{name:'detail-panel-runtime',setup(build){
  build.onResolve({filter:/^panel-fixture:/},args=>({path:args.path.slice('panel-fixture:'.length),namespace:'panel-fixture'}));
  build.onResolve({filter:/^\$app\/|^\$lib\//},args=>aliases[args.path]?{path:aliases[args.path],namespace:'panel-fixture'}:{path:root+'src/lib/'+args.path.slice('$lib/'.length)+'.ts'});
  build.onLoad({filter:/.*/,namespace:'panel-fixture'},args=>{const mod=modules[args.path];return {contents:mod.svelte?compile(mod.source,{filename:args.path+'.svelte',generate:'client'}).js.code:mod.runes?compileModule(mod.source,{filename:args.path+'.svelte.js',generate:'client'}).js.code:mod.source,loader:'js',resolveDir:root};});
  build.onLoad({filter:/\.svelte$/},async args=>({contents:compile(await Bun.file(args.path).text(),{filename:args.path,generate:'client'}).js.code,loader:'js',resolveDir:root}));
 }}]});
 if(!result.success)throw new AggregateError(result.logs,'DetailPanel fixture bundle failed');
 bundle=await result.outputs[0].text();browser=await chromium.launch({headless:true});
},30_000);
afterAll(async()=>{await browser?.close();});
async function fixture(){
 const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('about:blank');await page.addScriptTag({type:'module',content:bundle});await page.waitForFunction(()=>!!(window as any).fixture);
 const navigate=(href:string|undefined)=>page.evaluate(href=>(window as any).fixture.navigate(href),href);
 const answer=async(kind:string,id:string,title=id)=>{await page.waitForFunction(()=>(window as any).fixture.requests.some((r:any)=>!r.answered&&!r.signal.aborted));await page.evaluate(({kind,id,title})=>{const request=(window as any).fixture.requests.find((r:any)=>!r.answered&&!r.signal.aborted);request.answered=true;request.resolve({kind,data:{item:{id,title},availability:[]}});},{kind,id,title});await page.locator(`[data-kind="${kind}"]`).waitFor();};
 return {page,errors,navigate,answer,async close(){await page.evaluate(()=>(window as any).fixture.destroy());await page.close();}};
}
const id='00000000-0000-4000-8000-000000000001';
const sections=['/library?view=listen','/progress?view=watchlist','/for-you?section=upcoming','/discover?section=trending','/for-you?section=activity','/profile/fixture?section=history',`/lists?view=${id}`];

browserTest('outgoing section and every detail family keep matching props through replacement and Back',async()=>{
 const f=await fixture();try{
  const families=['music','screen','reading','game','reading-group','remote-game','person'];
  for(let index=0;index<families.length;index++){
   const family=families[index],section=sections[index];await f.navigate(section);await f.page.locator('[data-kind="row"]').waitFor();
   await f.navigate(`/media/${id}?page=${index+1}`);await f.answer(family,`item-${index}`);
   expect(await f.page.locator('[data-kind="row"]').count()).toBe(0);
   await f.navigate(section);await f.page.locator('[data-kind="row"]').waitFor();
  }
  const disposed=await f.page.evaluate(()=>(window as any).fixture.disposals);
  expect(disposed.filter((d:any)=>d.family==='row').every((d:any)=>d.href===d.initialHref&&d.type)).toBe(true);
  expect(disposed.filter((d:any)=>d.family!=='row').map((d:any)=>[d.initialId,d.id])).toEqual(families.map((_family,index)=>[`item-${index}`,`item-${index}`]));
  expect(f.errors).toEqual([]);
 }finally{await f.close();}
},20_000);

browserTest('pending replacement retains coherent old content and aborted results cannot publish after close or a newer target',async()=>{
 const f=await fixture();try{
  await f.navigate(sections[0]);await f.page.locator('[data-kind="row"]').waitFor();
  await f.navigate(`/media/${id}?page=1`);await f.page.waitForFunction(()=>(window as any).fixture.requests.length===1);
  expect(await f.page.locator('[data-kind="row"]').count()).toBe(1);expect(await f.page.locator('.detail-content').getAttribute('inert')).not.toBeNull();
  await f.navigate(`/media/${id}?page=2`);await f.answer('music','current');
  await f.page.evaluate(()=>(window as any).fixture.requests[0].resolve({kind:'screen',data:{item:{id:'stale'},availability:[]}}));
  expect(await f.page.locator('[data-kind="music"]').textContent()).toBe('current');
  await f.navigate(`/media/${id}?page=3`);await f.page.waitForFunction(()=>(window as any).fixture.requests.length===3);await f.navigate(undefined);
  await f.page.evaluate(()=>(window as any).fixture.requests[2].resolve({kind:'game',data:{item:{id:'late'}}}));
  expect(await f.page.locator('[data-overlay]').count()).toBe(0);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

browserTest('same-target refresh preserves its mounted presenter while authorization failure and viewer replacement clear it',async()=>{
 const f=await fixture();try{
  await f.navigate(`/media/${id}`);await f.answer('music','same');
  await f.page.evaluate(()=>(window as any).fixture.refresh());await f.answer('music','same','refreshed');
  expect(await f.page.locator('[data-kind="music"]').textContent()).toBe('refreshed');
  expect(await f.page.evaluate(()=>(window as any).fixture.disposals.length)).toBe(0);
  await f.page.evaluate(()=>(window as any).fixture.refresh());await f.page.waitForFunction(()=>(window as any).fixture.requests.length===3);
  await f.page.evaluate(()=>{const error=Object.assign(new Error('denied'),{featureDisabled:true});(window as any).fixture.requests[2].reject(error);});
  await f.page.locator('[data-overlay]').waitFor({state:'detached'});
  await f.navigate(`/media/${id}?page=2`);await f.answer('game','new');
  await f.page.evaluate(()=>(window as any).fixture.viewer('different'));
  expect(await f.page.locator('[data-overlay]').count()).toBe(0);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

// These are deliberately controlled authored transport schedules. No app server,
// actual catalogue/API/provider response, cookie or database is used.
const overviewHref=`/media/${id}`;
const reviewsHref=`/media/${id}?section=reviews&source=tmdb`;
const screenData=(title:string,episodes=0)=>({item:{id,title},availability:[],episodes:Array.from({length:episodes},(_,i)=>({id:'controlled-'+i}))});
async function requestIndex(f:any,enhancement:boolean){
 await f.page.waitForFunction((wanted:boolean)=>(window as any).fixture.requests.some((r:any)=>!r.answered&&!r.signal.aborted&&r.path.includes('enhance=true')===wanted),enhancement);
 return f.page.evaluate((wanted:boolean)=>(window as any).fixture.requests.findIndex((r:any)=>!r.answered&&!r.signal.aborted&&r.path.includes('enhance=true')===wanted),enhancement);
}
async function resolveAt(f:any,index:number,value:any,reject=false){
 await f.page.evaluate(({index,value,reject}:{index:number;value:unknown;reject:boolean})=>{const request=(window as any).fixture.requests[index];request.answered=true;if(reject)request.reject(new Error('controlled transport failure'));else request.resolve(value);},{index,value,reject});
}
async function showScreen(f:any,href:string,title:string,episodes:number){
 await f.navigate(href);const initial=await requestIndex(f,false);await resolveAt(f,initial,{kind:'screen',data:screenData(title,episodes)});
 await f.page.waitForFunction((title:string)=>document.querySelector('[data-kind="screen"]')?.textContent===title,title);
 return{initial,enhancement:await requestIndex(f,true)};
}
async function snapshot(f:any){return f.page.locator('[data-kind="screen"]').evaluate((node:HTMLElement)=>({title:node.textContent,href:node.dataset.href,episodes:node.dataset.episodes,refresh:node.dataset.refresh}));}
browserTest('captured Reviews enhancement cannot replace a newer full Overview after late resolve or rejection',async()=>{
 for(const reject of [false,true]){
  const f=await fixture();try{
   const old=await showScreen(f,reviewsHref,'Saved reviews',0);
   const capture=await f.page.evaluate((index:number)=>{const r=(window as any).fixture.requests[index],url=new URL('http://fixture/'+r.path);return{href:url.searchParams.get('href'),enhance:url.searchParams.get('enhance'),aborted:r.signal.aborted};},old.enhancement);
   expect(capture).toEqual({href:reviewsHref,enhance:'true',aborted:false});
   const current=await showScreen(f,overviewHref,'Saved full overview',2);
   expect(await f.page.evaluate((index:number)=>(window as any).fixture.requests[index].signal.aborted,old.enhancement)).toBe(true);
   await resolveAt(f,old.enhancement,{kind:'screen',data:screenData('Stale compact',0)},reject);
   expect(await snapshot(f)).toEqual({title:'Saved full overview',href:overviewHref,episodes:'2',refresh:'no'});
   await resolveAt(f,current.enhancement,{kind:'screen',data:{...screenData('Enhanced full overview',3),requestable:true,refreshUnavailable:false}});
   await f.page.waitForFunction(()=>document.querySelector('[data-kind="screen"]')?.textContent==='Enhanced full overview');
   expect(await snapshot(f)).toEqual({title:'Enhanced full overview',href:overviewHref,episodes:'3',refresh:'no'});expect(f.errors).toEqual([]);
  }finally{await f.close();}
 }
});
browserTest('same-href revision, viewer replacement and close fence held screen enhancements',async()=>{
 const f=await fixture();try{
  const first=await showScreen(f,reviewsHref,'Original review view',0);
  await f.page.evaluate(()=>(window as any).fixture.refresh());const revisionInitial=await requestIndex(f,false);
  await resolveAt(f,revisionInitial,{kind:'screen',data:screenData('Revised reviews',0)});
  await f.page.waitForFunction(()=>document.querySelector('[data-kind="screen"]')?.textContent==='Revised reviews');
  const revisionEnhancement=await requestIndex(f,true);
  expect(await f.page.evaluate((i:number)=>(window as any).fixture.requests[i].signal.aborted,first.enhancement)).toBe(true);
  await resolveAt(f,first.enhancement,{kind:'screen',data:screenData('Late pre-revision',8)});
  expect(await snapshot(f)).toEqual({title:'Revised reviews',href:reviewsHref,episodes:'0',refresh:'no'});
  await f.page.evaluate(()=>(window as any).fixture.viewer('replacement-viewer'));
  await f.page.locator('[data-overlay]').waitFor({state:'detached'});const viewerInitial=await requestIndex(f,false);
  await resolveAt(f,revisionEnhancement,{kind:'screen',data:screenData('Late old viewer',9)});
  expect(await f.page.locator('[data-overlay]').count()).toBe(0);
  await resolveAt(f,viewerInitial,{kind:'screen',data:screenData('Replacement viewer',0)});
  await f.page.waitForFunction(()=>document.querySelector('[data-kind="screen"]')?.textContent==='Replacement viewer');
  const viewerEnhancement=await requestIndex(f,true);await f.navigate(undefined);await f.page.locator('[data-overlay]').waitFor({state:'detached'});
  expect(await f.page.evaluate((i:number)=>(window as any).fixture.requests[i].signal.aborted,viewerEnhancement)).toBe(true);
  await resolveAt(f,viewerEnhancement,{kind:'screen',data:screenData('Late after close',10)});
  expect(await f.page.locator('[data-overlay]').count()).toBe(0);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
browserTest('wrong-kind enhanced envelope retains its captured saved screen payload and refresh fallback',async()=>{
 const f=await fixture();try{
  const current=await showScreen(f,reviewsHref,'Saved screen fallback',0);
  await resolveAt(f,current.enhancement,{kind:'reading',data:{item:{id:'controlled-different-kind',title:'Wrong medium'}}});
  await f.page.waitForFunction(()=>document.querySelector('[data-kind="screen"]')?.getAttribute('data-refresh')==='yes');
  expect(await snapshot(f)).toEqual({title:'Saved screen fallback',href:reviewsHref,episodes:'0',refresh:'yes'});expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
