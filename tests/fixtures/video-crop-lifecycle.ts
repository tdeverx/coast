// Isolated browser/timer boundary; actual Svelte lifetimes and crop sampler run together.
import {expect} from 'bun:test';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,moduleUrl,svelteUrl} from './ui-script';
const flush=async()=>{for(let i=0;i<6;i++){runtime.flush();await Promise.resolve();}};
const timers=new Map<number,()=>void>(),listeners=new Map<string,Set<()=>void>>();let serial=0;
const document={hidden:false,createElement:()=>({width:0,height:0,getContext:()=>null}),
 addEventListener(type:string,fn:()=>void){let set=listeners.get(type);if(!set)listeners.set(type,set=new Set());set.add(fn);},
 removeEventListener(type:string,fn:()=>void){listeners.get(type)?.delete(fn);},
};
Object.assign(globalThis,{document,setTimeout:(fn:()=>void)=>{timers.set(++serial,fn);return serial;},clearTimeout:(id:number)=>{timers.delete(id);}});
class Video{
 private value='';writes=0;loads=0;plays=0;private time=0;paused=true;
 listeners=new Map<string,Set<()=>void>>();
 get currentTime(){return this.time;}set currentTime(value:number){this.time=value;queueMicrotask(()=>{for(const fn of this.listeners.get('seeked')??[])fn();});}
 addEventListener(type:string,fn:()=>void){let entries=this.listeners.get(type);if(!entries)this.listeners.set(type,entries=new Set());entries.add(fn);}
 removeEventListener(type:string,fn:()=>void){this.listeners.get(type)?.delete(fn);}
readyState=4;muted=true;videoWidth=1920;videoHeight=1080;
 get src(){return this.value;}set src(value:string){this.value=value;this.writes++;if(this===video)queueMicrotask(()=>hero.loadedMetadata());}
 play(){expect(stub.heroPlayer.ready).toBe(true);this.plays++;this.paused=false;return Promise.resolve();}pause(){this.paused=true;}
 removeAttribute(name:string){if(name==='src')this.value='';}load(){this.loads++;}
}
const lifecycleUrl=moduleUrl(`export {untrack} from ${JSON.stringify(svelteUrl)};export const tick=()=>Promise.resolve();export const mounted=[];export const onMount=fn=>{const cleanup=fn();if(cleanup)mounted.push(cleanup);};`);
const stubUrl=moduleUrl(compileRunes(`
 export const page=$state({data:{capabilities:{screen:true,playback:true}}});
 export const heroPlayer=$state({id:'hero',url:'trailer',visible:false,paused:false,crop:{left:0,right:0,top:.1,bottom:.1},ready:false,playing:false,muted:true,outcome:'idle'});
 export const player=$state({session:null,browsing:false,paused:true});
 export const usePlayback=()=>({heroPlayer,player,preview:false});
 export const config=$state({heroId:'hero',heroActive:true,heroSize:{width:0,height:0},preview:false,src:'playback',active:true,audioMode:false,crop:true,foreground:true,player:{browsing:false,paused:false,session:null}});
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
const dispose=runtime.effect_root(()=>{hero=createHeroPlayback(()=>({id:stub.config.heroId,active:stub.config.heroActive,size:stub.config.heroSize}));hero.video=video;});await flush();
expect(video.src).toBe('trailer');expect(stub.heroPlayer.ready).toBe(false);expect(video.plays).toBe(0);expect(hero.videoStyle).toBe('');
stub.config.heroSize={width:300,height:200};await flush();
expect(timers.size).toBe(0);expect(video.src).toBe('trailer');expect(stub.heroPlayer.ready).toBe(true);expect(hero.videoStyle).toContain('top:');
expect(hero.visible).toBe(false);expect(video.paused).toBe(true);expect(video.plays).toBe(0);
const preparedWrites=video.writes;
stub.heroPlayer.visible=true;await flush();expect(video.paused).toBe(false);expect(video.plays).toBe(1);expect(video.writes).toBe(preparedWrites);expect(video.loads).toBe(0);
video.currentTime=12;const writes=video.writes;
const beforeSize=hero.videoStyle;stub.config.heroSize={width:600,height:200};await flush();
expect(hero.videoStyle).not.toBe(beforeSize);expect(video.writes).toBe(writes);expect(video.loads).toBe(0);
stub.heroPlayer.visible=false;await flush();expect(video.paused).toBe(true);expect(video.src).toBe('trailer');expect(video.currentTime).toBe(12);
stub.heroPlayer.visible=true;await flush();expect(video.paused).toBe(false);expect(video.writes).toBe(writes);
document.hidden=true;for(const fn of listeners.get('visibilitychange')??[])fn();await flush();expect(video.paused).toBe(true);
document.hidden=false;for(const fn of listeners.get('visibilitychange')??[])fn();await flush();expect(video.paused).toBe(false);
stub.heroPlayer.paused=true;await flush();expect(video.paused).toBe(true);stub.heroPlayer.paused=false;await flush();expect(video.paused).toBe(false);
expect(video.src).toBe('trailer');expect(video.writes).toBe(writes);expect(video.currentTime).toBe(12);
for(const capability of ['screen','playback']){
 const beforeLoads=video.loads;stub.page.data.capabilities[capability]=false;await flush();
 expect(hero.visible).toBe(false);expect(video.src).toBe('');expect(video.paused).toBe(true);expect(video.loads).toBe(beforeLoads+1);
 expect(stub.heroPlayer.url).toBe('trailer');stub.page.data.capabilities[capability]=true;await flush();
 expect(hero.visible).toBe(true);expect(video.src).toBe('trailer');expect(stub.heroPlayer.ready).toBe(true);
}
stub.config.heroActive=false;await flush();expect(video.src).toBe('');
stub.config.heroActive=true;await flush();expect(video.src).toBe('trailer');
hero.failed();await flush();expect(stub.heroPlayer.ready).toBe(false);expect(video.paused).toBe(true);expect(stub.heroPlayer.outcome).toBe('failed');
const otherVideo=new Video();let other:any;
const disposeOther=runtime.effect_root(()=>{other=createHeroPlayback(()=>({id:'other',active:true,size:{width:300,height:200}}));other.video=otherVideo;});await flush();
expect(other.visible).toBe(false);expect(otherVideo.writes).toBe(0);
const beforeOutcome=stub.heroPlayer.outcome;stub.heroPlayer.playing=false;other.playing();other.ended();other.failed();
expect(stub.heroPlayer.playing).toBe(false);expect(stub.heroPlayer.outcome).toBe(beforeOutcome);
disposeOther();dispose();for(const cleanup of lifecycle.mounted)cleanup();expect(timers.size).toBe(0);expect(listeners.get('visibilitychange')?.size).toBe(0);

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
const {create}=await import(moduleUrl(playerCode)),media=new Video();media.currentTime=12;media.src='playback';
const stop=runtime.effect_root(()=>create(stub.config,media));await flush();expect(timers.size).toBe(1);
for(const [target,key,disabled,enabled] of [
 [stub.config,'crop',false,true],[stub.config,'foreground',false,true],[stub.config.player,'browsing',true,false],[stub.config.player,'paused',true,false],
 [stub.config,'audioMode',true,false],[stub.config,'active',false,true],[stub.config,'preview',true,false],[stub.config,'src','','playback'],
] as const){
 target[key]=disabled;await flush();expect(timers.size).toBe(0);
 target[key]=enabled;await flush();expect(timers.size).toBe(1);
}
stub.config.player.session={initialCrop:{left:0,right:0,top:.1,bottom:.1}};await flush();expect(timers.size).toBe(0);
stub.config.player.session=null;await flush();expect(timers.size).toBe(1);
expect(media.src).toBe('playback');expect(media.writes).toBe(1);expect(media.currentTime).toBe(12);expect(media.loads).toBe(0);
stop();expect(timers.size).toBe(0);
console.log(JSON.stringify({heroLifetime:true,heroPolicyCases:2,playerDisabledCases:9,pendingTimers:timers.size,retainedSource:true,inlineOwnership:true,resizeWithoutReload:true,artworkPreload:true}));
