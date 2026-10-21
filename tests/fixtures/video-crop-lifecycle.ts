// Isolated browser/timer boundary; actual Svelte lifetimes and crop sampler run together.
import {expect} from 'bun:test';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,moduleUrl,svelteUrl} from './ui-script';
const timers=new Map<number,()=>void>(),listeners=new Map<string,Set<()=>void>>();let serial=0;
const document={hidden:false,createElement:()=>({width:0,height:0,getContext:()=>null}),
 addEventListener(type:string,fn:()=>void){let set=listeners.get(type);if(!set)listeners.set(type,set=new Set());set.add(fn);},
 removeEventListener(type:string,fn:()=>void){listeners.get(type)?.delete(fn);},
};
Object.assign(globalThis,{document,setTimeout:(fn:()=>void)=>{timers.set(++serial,fn);return serial;},clearTimeout:(id:number)=>{timers.delete(id);}});
class Video{
 private value='';writes=0;loads=0;currentTime=12;paused=false;readyState=4;muted=true;videoWidth=1920;videoHeight=1080;
 get src(){return this.value;}set src(value:string){this.value=value;this.writes++;}
 play(){this.paused=false;return Promise.resolve();}pause(){this.paused=true;}
 removeAttribute(name:string){if(name==='src')this.value='';}load(){this.loads++;}
}
const lifecycleUrl=moduleUrl(`export {untrack} from ${JSON.stringify(svelteUrl)};export const mounted=[];export const onMount=fn=>{const cleanup=fn();if(cleanup)mounted.push(cleanup);};`);
const stubUrl=moduleUrl(compileRunes(`
 export const page=$state({data:{capabilities:{screen:true,playback:true}}});
 export const heroPlayer=$state({id:'hero',url:'trailer',visible:true,paused:false,ready:false,playing:true,muted:true,rect:null});
 export const player=$state({session:null,browsing:false,paused:true});
 export const usePlayback=()=>({heroPlayer,player,preview:false});
 export const config=$state({preview:false,src:'playback',active:true,audioMode:false,crop:true,foreground:true,player:{browsing:false,paused:false}});
`));
const cropUrl=import.meta.resolve('../../src/lib/playback/observe-crop.ts');
const cropModelUrl=import.meta.resolve('../../src/lib/playback/crop.ts');
const visibilityUrl=import.meta.resolve('../../src/lib/playback/visibility.ts');
const heroSource=(await Bun.file('src/lib/ui/heroes/playback.svelte.ts').text())
 .replaceAll(/from ['"]\$app\/state['"]/g,`from ${JSON.stringify(stubUrl)}`)
 .replaceAll(/from ['"]svelte['"]/g,`from ${JSON.stringify(lifecycleUrl)}`)
 .replaceAll(/from ['"]#lib\/playback\/context.svelte\.js['\"]/g,`from ${JSON.stringify(stubUrl)}`)
 .replaceAll(/from ['"]#lib\/playback\/observe-crop\.js['\"]/g,`from ${JSON.stringify(cropUrl)}`)
 .replaceAll(/from ['"]#lib\/playback\/crop\.js['\"]/g,`from ${JSON.stringify(cropModelUrl)}`)
 .replaceAll(/from ['"]#lib\/playback\/visibility\.js['\"]/g,`from ${JSON.stringify(visibilityUrl)}`);
const {createHeroPlayback}=await import(moduleUrl(compileRunes(heroSource)));
const stub=await import(stubUrl),lifecycle=await import(lifecycleUrl),video=new Video();
let hero:any;
const dispose=runtime.effect_root(()=>{hero=createHeroPlayback();hero.video=video;});runtime.flush();
expect(timers.size).toBe(1);expect(video.src).toBe('trailer');const writes=video.writes;
const stale=[...timers.values()][0];stub.heroPlayer.visible=false;runtime.flush();expect(timers.size).toBe(0);stale();expect(timers.size).toBe(0);
expect(video.src).toBe('trailer');expect(video.currentTime).toBe(12);expect(video.loads).toBe(0);
stub.heroPlayer.visible=true;runtime.flush();expect(timers.size).toBe(1);expect(video.writes).toBe(writes);
document.hidden=true;for(const fn of listeners.get('visibilitychange')??[])fn();runtime.flush();expect(timers.size).toBe(0);
document.hidden=false;for(const fn of listeners.get('visibilitychange')??[])fn();runtime.flush();expect(timers.size).toBe(1);
stub.heroPlayer.paused=true;runtime.flush();expect(timers.size).toBe(0);stub.heroPlayer.paused=false;runtime.flush();expect(timers.size).toBe(1);
expect(video.src).toBe('trailer');expect(video.writes).toBe(writes);expect(video.currentTime).toBe(12);
for(const capability of ['screen','playback']){
 const beforeLoads=video.loads;
 stub.page.data.capabilities[capability]=false;runtime.flush();
 expect(hero.visible).toBe(false);expect(video.src).toBe('');expect(video.paused).toBe(true);
 expect(timers.size).toBe(0);expect(video.loads).toBe(beforeLoads+1);
 // Keep only source identity, so a later permitted owner can attach it afresh.
 expect(stub.heroPlayer.url).toBe('trailer');
 stub.page.data.capabilities[capability]=true;runtime.flush();
 expect(hero.visible).toBe(true);expect(video.src).toBe('trailer');expect(timers.size).toBe(1);
}
dispose();for(const cleanup of lifecycle.mounted)cleanup();expect(timers.size).toBe(0);expect(listeners.get('visibilitychange')?.size).toBe(0);

// Run PersistentPlayer's actual analysis effect, independently of source/transport effects.
const playerSource=await Bun.file('src/lib/ui/components/PersistentPlayer.svelte').text();
const start=playerSource.indexOf('  // Analysis has a shorter lifetime'),effect=playerSource.indexOf('  $effect(',start),end=playerSource.indexOf('  $effect(',effect+1);
expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(effect);
const playerCode=compileRunes(`import {observeVideoCrop} from ${JSON.stringify(cropUrl)};
 import {noCrop} from ${JSON.stringify(cropModelUrl)};
 export function create(config,video){
  const preview=$derived(config.preview),src=$derived(config.src),active=$derived(config.active),audioMode=$derived(config.audioMode),crop=$derived(config.crop),foreground=$derived(config.foreground),player=config.player;
  let bars=$state(noCrop);
  ${playerSource.slice(start,end)}
  return ()=>bars;
 }`);
const {create}=await import(moduleUrl(playerCode)),media=new Video();media.src='playback';
const stop=runtime.effect_root(()=>create(stub.config,media));runtime.flush();expect(timers.size).toBe(1);
for(const [target,key,disabled,enabled] of [
 [stub.config,'crop',false,true],[stub.config,'foreground',false,true],[stub.config.player,'browsing',true,false],[stub.config.player,'paused',true,false],
 [stub.config,'audioMode',true,false],[stub.config,'active',false,true],[stub.config,'preview',true,false],[stub.config,'src','','playback'],
] as const){
 target[key]=disabled;runtime.flush();expect(timers.size).toBe(0);
 target[key]=enabled;runtime.flush();expect(timers.size).toBe(1);
}
expect(media.src).toBe('playback');expect(media.writes).toBe(1);expect(media.currentTime).toBe(12);expect(media.loads).toBe(0);
stop();expect(timers.size).toBe(0);
console.log(JSON.stringify({heroLifetime:true,heroPolicyCases:2,playerDisabledCases:8,pendingTimers:timers.size,retainedSource:true}));
