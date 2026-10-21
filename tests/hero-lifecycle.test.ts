import {expect,test} from 'bun:test';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,moduleUrl,svelteUrl} from './fixtures/ui-script';
const lifecycleUrl=moduleUrl(`export {untrack} from ${JSON.stringify(svelteUrl)};export const onMount=()=>{};`);
const stubUrl=moduleUrl(compileRunes(`
 export const page=$state({data:{capabilities:{playback:true,screen:true}},state:{mediaDetailHref:null}});
 export const reader=$state({visible:false}),heroPlayer=$state({id:null,url:null,visible:false,paused:false,playing:false,ready:false,crop:null,generation:0,muted:true,outcome:'idle'}),player={session:null,browsing:false,paused:true};
 export const requests=[],presentations=[];
 export const useClient=()=>({api:(path,body,method,options)=>new Promise(resolve=>requests.push({path,signal:options?.signal,resolve}))});
 export const usePlayback=()=>({heroPlayer,player,preview:false});
 export const playbackVisible=()=>false,presentTrailer=(id,url,crop)=>{presentations.push([id,url,crop]);Object.assign(heroPlayer,{id,url,crop,visible:true,paused:false,playing:false,ready:false,outcome:'idle'});heroPlayer.generation++;};
 export const heroTitleIds=items=>items.map(item=>item.id),isHeroTitle=()=>true;
`));
const stub=await import(stubUrl);
const source=(await Bun.file(new URL('../src/lib/ui/heroes/presentation.svelte.ts',import.meta.url)).text())
 .replace("from './cycle'",`from ${JSON.stringify(import.meta.resolve('../src/lib/ui/heroes/cycle.ts'))}`)
 .replaceAll(/from ['"]svelte['"]/g,`from ${JSON.stringify(lifecycleUrl)}`)
 .replaceAll(/from ['"]\$app\/state['"]/g,`from ${JSON.stringify(stubUrl)}`)
 .replaceAll(/from ['"]#lib\/[^'"]+['"]/g,`from ${JSON.stringify(stubUrl)}`);
const {createHeroPresentation}=await import(moduleUrl(compileRunes(source)));
const playbackSource=(await Bun.file(new URL('../src/lib/ui/heroes/playback.svelte.ts',import.meta.url)).text())
 .replaceAll(/from ['"]svelte['"]/g,`from ${JSON.stringify(moduleUrl(`export {untrack} from ${JSON.stringify(svelteUrl)};export const onMount=()=>{},tick=()=>Promise.resolve();`))}`)
 .replaceAll(/from ['"]\$app\/state['"]/g,`from ${JSON.stringify(stubUrl)}`)
 .replaceAll(/from ['"]#lib\/playback\/context.svelte.js['"]/g,`from ${JSON.stringify(stubUrl)}`)
 .replaceAll(/from ['"]#lib\/playback\/crop.js['"]/g,`from ${JSON.stringify(import.meta.resolve('../src/lib/playback/crop.ts'))}`)
 .replaceAll(/from ['"]#lib\/playback\/visibility.js['"]/g,`from ${JSON.stringify(import.meta.resolve('../src/lib/playback/visibility.ts'))}`);
const {createHeroPlayback}=await import(moduleUrl(compileRunes(playbackSource)));

test('hero replacement and teardown abort optional trailer lookups and ignore late responses',async()=>{
 const previous={document:globalThis.document,window:globalThis.window,IntersectionObserver:globalThis.IntersectionObserver,ResizeObserver:globalThis.ResizeObserver,
  requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame,matchMedia:globalThis.matchMedia,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
 const timers=new Map<number,()=>void>();let timerId=0;
 globalThis.document={hidden:false,addEventListener(){},removeEventListener(){},querySelector(){return null;}} as unknown as Document;
 globalThis.window={addEventListener(){},removeEventListener(){}} as unknown as Window & typeof globalThis;
 globalThis.IntersectionObserver=class{constructor(private cb:any){}observe(){this.cb([{isIntersecting:true,intersectionRatio:1}]);}disconnect(){}} as unknown as typeof IntersectionObserver;
 globalThis.ResizeObserver=class{observe(){}disconnect(){}} as unknown as typeof ResizeObserver;
 globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};globalThis.matchMedia=(()=>({matches:false,addEventListener(){},removeEventListener(){}})) as unknown as typeof matchMedia;
 globalThis.setTimeout=((fn:()=>void)=>{timers.set(++timerId,fn);return timerId;}) as unknown as typeof setTimeout;
 globalThis.clearTimeout=((id:number)=>timers.delete(id)) as unknown as typeof clearTimeout;
 const options=runtime.state({item:{id:'title-a',kind:'movie',available:true,title:'A'}});
 let hero:any,dispose=()=>{};
 const runTimers=()=>{const current=[...timers.values()];timers.clear();current.forEach(callback=>callback());};
 const settle=async()=>{for(let i=0;i<6;i++){runtime.flush();await Promise.resolve();}};
 try{
  stub.requests.length=0;stub.presentations.length=0;
  dispose=runtime.effect_root(()=>hero=createHeroPresentation(()=>runtime.get(options)));
  hero.host={getBoundingClientRect:()=>({top:0,left:0,width:100,height:100}),addEventListener(){},removeEventListener(){},closest(){return null;}};
  runtime.flush();runTimers();await settle();expect(stub.requests).toHaveLength(1);expect(stub.requests[0].signal.aborted).toBe(false);
  runtime.set(options,{item:{id:'title-b',kind:'movie',available:true,title:'B'}});await settle();
  expect(stub.requests[0].signal.aborted).toBe(true);
  stub.requests[0].resolve({url:'stale-trailer'});await settle();expect(stub.presentations).toHaveLength(0);
  runTimers();await settle();expect(stub.requests).toHaveLength(2);expect(stub.requests[1].signal.aborted).toBe(false);
  stub.page.state.mediaDetailHref='title-b';await settle();
  expect(stub.heroPlayer.visible).toBe(false);expect(stub.requests[1].signal.aborted).toBe(false);
  const crop={left:0,right:0,top:0.1,bottom:0.1};
  stub.requests[1].resolve({url:'cold-trailer',crop});await settle();
  expect(hero.phase).toBe('trailer');expect(hero.attached).toBe(false);expect(stub.presentations).toHaveLength(0);
  stub.page.state.mediaDetailHref=null;await settle();
  expect(stub.presentations).toEqual([['title-b','cold-trailer',crop]]);expect(stub.requests).toHaveLength(2);
  runtime.set(options,{item:{id:'title-c',kind:'movie',available:true,title:'C'}});await settle();
  expect(stub.requests).toHaveLength(3);
  dispose();expect(stub.requests[2].signal.aborted).toBe(true);expect(timers.size).toBe(0);
  stub.requests[2].resolve({url:'late-trailer'});await settle();expect(stub.presentations).toHaveLength(1);
 }finally{dispose();Object.assign(globalThis,previous);}
});

test('the mounted shared owner wires full-trailer completion, decoded item transitions, exact identity and teardown',async()=>{
 const previous={document:globalThis.document,window:globalThis.window,IntersectionObserver:globalThis.IntersectionObserver,ResizeObserver:globalThis.ResizeObserver,
  requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame,matchMedia:globalThis.matchMedia,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,performance:globalThis.performance,Image:globalThis.Image};
 let now=0,serial=0,observers=0,intersection:(entries:any[])=>void=()=>{},resize:(entries:any[])=>void=()=>{};
 const timers=new Map<number,{at:number;run:()=>void}>(),listeners=new Map<string,()=>void>();
 const images:{src:string;resolve:()=>void}[]=[];
 const doc={hidden:false,addEventListener(type:string,fn:()=>void){listeners.set(type,fn);},removeEventListener(type:string){listeners.delete(type);}};
 Object.assign(globalThis,{
  document:doc,window:{addEventListener(){},removeEventListener(){}},performance:{now:()=>now},
  IntersectionObserver:class{constructor(cb:any){intersection=cb;observers++;}observe(){}disconnect(){observers--;}},ResizeObserver:class{constructor(cb:any){resize=cb;observers++;}observe(){}disconnect(){observers--;}},
  requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),
  setTimeout:(run:()=>void,delay:number)=>{timers.set(++serial,{at:now+delay,run});return serial;},clearTimeout:(id:number)=>timers.delete(id),
  Image:class{src='';resolve=()=>{};constructor(){images.push(this);}decode(){return new Promise<void>(resolve=>this.resolve=resolve);}removeAttribute(){this.src='';}},
 });
 const settle=async()=>{for(let i=0;i<6;i++){runtime.flush();await Promise.resolve();}};
 const tick=async(ms:number)=>{
  const until=now+ms;
  while(true){const entry=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!entry||entry[1].at>until)break;
   now=entry[1].at;timers.delete(entry[0]);entry[1].run();await settle();}
  now=until;await settle();
 };
 const a={id:'episode-a',kind:'episode',available:true,title:'The actual episode',backdrop:'episode-art'},b={id:'season-b',kind:'season',title:'The actual season',backdrop:'season-art',logo:'season-logo'};
 let hero:any,playback:any,dispose=()=>{};
 const video=new class{writes=0;plays=0;loads=0;value='';paused=true;currentTime=0;muted=true;videoWidth=1920;videoHeight=1080;
  set src(url:string){this.writes++;this.value=url;queueMicrotask(()=>playback.loadedMetadata());}get src(){return this.value;}
  play(){expect(stub.heroPlayer.ready).toBe(true);expect(playback.videoStyle).not.toBe('');this.plays++;this.paused=false;return Promise.resolve();}
  pause(){this.paused=true;}removeAttribute(){this.value='';}load(){this.loads++;}
 };
 try{
  stub.presentations.length=0;stub.requests.length=0;stub.page.state.mediaDetailHref=null;
  dispose=runtime.effect_root(()=>{
   hero=createHeroPresentation(()=>({items:[a,b]}));
   playback=createHeroPlayback(()=>({id:hero.active?.id,active:hero.attached&&(hero.phase==='artwork'||hero.phase==='trailer'),size:hero.size}));
   playback.video=video;
  });
  hero.host={getBoundingClientRect:()=>({top:0,left:0,width:100,height:100}),addEventListener(){},removeEventListener(){},closest(){return null;}};
  await settle();await tick(10000);expect(stub.presentations).toHaveLength(0);
  intersection([{isIntersecting:true,intersectionRatio:1}]);await settle();
  expect(stub.requests).toHaveLength(1);expect(hero.phase).toBe('artwork');
  await tick(2000);
  const crop={left:0.05,right:0,top:0.1,bottom:0.1};
  stub.requests[0].resolve({url:'local-trailer',crop});await settle();
  expect(stub.presentations).toEqual([[a.id,'local-trailer',crop]]);expect(hero.attached).toBe(true);
  expect(stub.heroPlayer.crop).toEqual(crop);expect(stub.heroPlayer.visible).toBe(false);expect(stub.heroPlayer.playing).toBe(false);
  expect(video.src).toBe('local-trailer');expect(video.writes).toBe(1);expect(video.plays).toBe(0);expect(stub.heroPlayer.ready).toBe(false);
  resize([{borderBoxSize:[{inlineSize:1200,blockSize:672}]}]);await settle();expect(stub.heroPlayer.ready).toBe(true);expect(playback.videoStyle).not.toBe('');
  hero.controlFocused=true;hero.togglePlayback();await settle();expect(hero.paused).toBe(true);await tick(10000);expect(hero.phase).toBe('artwork');expect(stub.heroPlayer.visible).toBe(false);
  hero.togglePlayback();await settle();expect(hero.paused).toBe(false);await tick(2999);expect(hero.phase).toBe('artwork');expect(stub.heroPlayer.visible).toBe(false);
  await tick(1);expect(hero.phase).toBe('trailer');expect(stub.heroPlayer.visible).toBe(true);expect(stub.presentations).toHaveLength(1);expect(stub.requests).toHaveLength(1);
  expect(video.writes).toBe(1);expect(video.plays).toBe(1);expect(video.paused).toBe(false);video.currentTime=12;
  stub.heroPlayer.playing=true;await settle();hero.togglePlayback();await settle();expect(stub.heroPlayer.paused).toBe(true);
  await tick(120000);expect(hero.active.id).toBe(a.id);hero.togglePlayback();await settle();expect(stub.heroPlayer.paused).toBe(false);
  expect(video.writes).toBe(1);expect(video.currentTime).toBe(12);expect(video.paused).toBe(false);
  stub.heroPlayer.playing=false;stub.heroPlayer.paused=true;stub.heroPlayer.outcome='ended';await settle();expect(hero.phase).toBe('after');
  expect(video.src).toBe('');expect(video.loads).toBe(1);
  await tick(2000);doc.hidden=true;listeners.get('visibilitychange')?.();await settle();await tick(10000);expect(hero.active.id).toBe(a.id);
  doc.hidden=false;listeners.get('visibilitychange')?.();await settle();await tick(2999);expect(hero.active.id).toBe(a.id);
  await tick(1);expect(hero.active.id).toBe(a.id);expect(hero.fading).toBe(false);expect(images.map(image=>image.src)).toEqual(['season-art','season-logo']);
  // The old item remains intact while decoding. A newer navigation cancels that preparation.
  void hero.step(-1);expect(images.slice(0,2).map(image=>image.src)).toEqual(['','']);
  images.slice(0,2).forEach(image=>image.resolve());await settle();expect(hero.fading).toBe(false);expect(hero.active.id).toBe(a.id);
  images.slice(2).forEach(image=>image.resolve());await settle();expect(hero.fading).toBe(true);
  await tick(159);expect(hero.active.id).toBe(a.id);
  await tick(1);expect(hero.active.id).toBe(b.id);expect(hero.phase).toBe('artwork');expect(stub.heroPlayer.visible).toBe(false);
  intersection([{isIntersecting:true,intersectionRatio:1}]);await settle();await tick(9999);expect(hero.active.id).toBe(b.id);
  await tick(1);expect(images.at(-1)?.src).toBe('episode-art');dispose();expect(images.at(-1)?.src).toBe('');
  images.at(-1)?.resolve();await tick(1000);expect(hero.active.id).toBe(b.id);expect(hero.fading).toBe(false);expect(timers.size).toBe(0);
  expect(observers).toBe(0);expect(listeners.size).toBe(0);expect(video.src).toBe('');
 }finally{dispose();Object.assign(globalThis,previous);}
});
