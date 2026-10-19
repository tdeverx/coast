import {expect,test} from 'bun:test';
import {compileRunes,moduleUrl,resourceUrl} from './fixtures/ui-script';

const source=await Bun.file(new URL('../src/lib/ui/controls/work.svelte.ts',import.meta.url)).text();
const start=source.indexOf('export function workMenuScope('),end=source.indexOf('\nconst empty =',start);
if(start<0||end<0)throw Error('Menu scope owner seam changed');
const body=new Bun.Transpiler({loader:'ts'}).transformSync(source.slice(start,end).replace('export ',''));
const revision=await import(moduleUrl(compileRunes(await Bun.file(new URL('../src/lib/ui/content-revision.svelte.ts',import.meta.url)).text())));
const menuUrl=moduleUrl(compileRunes((await Bun.file(new URL('../src/lib/ui/controls/menu-resource.svelte.ts',import.meta.url)).text()).replaceAll('../resource.svelte',resourceUrl)));
const {createMenuResource}=await import(menuUrl);
function harness(){
 const page={data:{user:{id:'viewer',role:'user',settings:{originalTitles:false,profile:{avatar:'data:image/png;base64,owned-avatar',displayName:'Name'},features:{requests:true}}},contentRevision:{tracking:'1'},experimentalMusic:true,experimentalGaming:true,experimentalBooks:true,experimentalComics:true,experimentalParties:true,experiments:{planning:true},playbackSharing:true,capabilities:{playback:true}}};
 const scope=new Function('page','contentRevisionKey',body+';return workMenuScope;')(page,revision.contentRevisionKey) as (target:unknown)=>string;
 return {page,scope};
}
function deferred(){let resolve!:(value:string)=>void;const promise=new Promise<string>(done=>resolve=done);return {promise,resolve};}

test('avatar value and equivalent session replacement keep the loaded menu snapshot',async()=>{
 const {page,scope}=harness();let reads=0;
 const key=scope(['work','occurrence']);
 const menu=createMenuResource(()=>'',()=>scope(['work','occurrence']),async()=>String(++reads));
 await menu.open();menu.close();page.data=structuredClone(page.data);
 page.data.user.settings.profile.avatar='different avatar';
 expect(scope(['work','occurrence'])).toBe(key);
 await menu.open();expect(reads).toBe(1);expect(menu.data).toBe('1');
 expect(JSON.parse(key)[3].profile).toEqual({displayName:'Name'});
 menu.dispose();
});

test('every retained policy, presentation, viewer, revision and target dependency still changes scope',()=>{
 const changes=[
  (d:any)=>d.user.id='other-viewer',(d:any)=>d.user.role='admin',
  (d:any)=>d.user.settings.originalTitles=true,(d:any)=>d.user.settings.features.requests=false,
  (d:any)=>d.user.settings.profile.displayName='New name',(d:any)=>d.contentRevision.tracking='2',
  (d:any)=>d.experimentalMusic=false,(d:any)=>d.experimentalGaming=false,
  (d:any)=>d.experimentalBooks=false,(d:any)=>d.experimentalComics=false,
  (d:any)=>d.experimentalParties=false,(d:any)=>d.experiments.planning=false,
  (d:any)=>d.playbackSharing=false,(d:any)=>d.capabilities.playback=false,
 ];
 for(const change of changes){const {page,scope}=harness(),before=scope(['work','occurrence']);change(page.data);expect(scope(['work','occurrence'])).not.toBe(before);}
 const {scope}=harness();expect(scope(['work','other-occurrence'])).not.toBe(scope(['work','occurrence']));
});

test('avatar changes keep a safe pending read while a real role change cancels stale publication',async()=>{
 const {page,scope}=harness(),held=[deferred(),deferred()],signals:AbortSignal[]=[];
 const menu=createMenuResource(()=>'',()=>scope('work'),(signal:AbortSignal)=>{signals.push(signal);return held[signals.length-1].promise;});
 const first=menu.open();page.data.user.settings.profile.avatar='new avatar';menu.sync();
 expect(signals[0].aborted).toBe(false);
 page.data.user.role='admin';menu.sync();expect(signals[0].aborted).toBe(true);
 const next=menu.load();held[0].resolve('old authority');await first;expect(menu.data).toBe('');
 held[1].resolve('current authority');await next;expect(menu.data).toBe('current authority');expect(signals).toHaveLength(2);
 menu.dispose();
});
