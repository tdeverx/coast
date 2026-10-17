import {expect,test} from 'bun:test';
import {mediaDetailTarget} from '../src/lib/media/detail-target';
import {moduleUrl} from './fixtures/ui-script';
import {readingHref} from '../src/lib/reading/presentation';
import {detailHref} from '../src/lib/ui/pages/detail-rows';
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const base=new URL('https://coast.invalid/for-you?friends=true');
test('shared detail routing covers local media, source previews, reading groups, cast and row-section links',()=>{
 const paths=[`/media/${id}`,`/games/${id}`,`/music/work/${id}`,`/media/reading-collection/${id}`,'/media/openlibrary/OL123W','/media/comic-vine/4000-123',`/games/igdb/${id}/123`,`/music/${id}/${'a'.repeat(32)}`,'/people/123'];
 for(const href of paths){const target=mediaDetailTarget(href,base);expect(target?.href).toBe(href);}
 expect(mediaDetailTarget(`/media/${id}?section=insights&insight=community&source=trakt&period=month`,base)).toMatchObject({kind:'work',id,section:'insights'});
 expect(mediaDetailTarget(`/games/${id}?playthrough=${other}&page=2&section=activity`,base)).toMatchObject({playthrough:other,page:2});
 for(const query of ['section=progress&view=episodes&available=true&specials=true','section=progress&view=seasons&available=false','section=seasons&rowKind=all&rowProgress=unwatched&rowAvailable=true','section=credits&credits=crew','section=activity&relationship=lists','section=all&type=show&department=Acting&available=true'])expect(mediaDetailTarget(`/media/${id}?${query}`,base)).not.toBeNull();
 expect(mediaDetailTarget(`/media/${id}?edition=Director%27s+Cut`,base)?.edition).toBe("Director's Cut");
});
test('reading section links retain provider identity until a canonical work exists',()=>{
 for(const [provider,externalId] of [['openlibrary','OL123W'],['comic-vine','4000-123']] as const){
  const item={id:'provider-placeholder',provider,externalId};
  for(const section of ['credits','insights']){
   const href=detailHref(readingHref(item,true),{section});
   expect(mediaDetailTarget(href,base)).toMatchObject({kind:'reading-provider',provider,id:externalId,section});
   expect(mediaDetailTarget(detailHref(readingHref({...item,id}),{section}),base)).toMatchObject({kind:'work',id,section});
  }
 }
});
test('detail routing leaves commands, history, core pages, fragments and external addresses alone',()=>{
 const invalid=['/for-you','/progress?view=watching','/search?q=movie',`/media/${id}/history`,`/media/${id}?action=progress`,`/media/${id}?section=credits&section=reviews`,`/media/${id}?page=0`,`/media/${id}?playthrough=bad`,`/media/${id}#credits`,`/media/${id}#`,`https://elsewhere.invalid/media/${id}`,'javascript:alert(1)','/media/comic-vine/OL123W','/media/openlibrary/4000-123','/people/nope'];
 for(const href of invalid)expect(mediaDetailTarget(href,base)).toBeNull();
});
const boundaryUrl=moduleUrl(`
 export const page={data:{user:{id:'viewer'}},url:new URL('https://coast.invalid/for-you?friends=true'),state:{friendsPopover:true}};
 export const player={session:null,browsing:false,paused:false};export const calls=[];
 let entries=[],position=0;
 export function reset(){page.data.user={id:'viewer'};page.url=new URL('https://coast.invalid/for-you?friends=true');page.state={friendsPopover:true};player.session=null;player.browsing=false;player.paused=false;calls.length=0;entries=[{url:page.url,state:page.state}];position=0;}
 export function pushState(url,state){entries=entries.slice(0,position+1);entries.push({url,state});position++;page.state=state;calls.push(['push',url.href,state]);}
 export async function goto(href,options){calls.push(['goto',href,options]);}
 export const history={back(){this.go(-1);},go(delta){position+=delta;page.state=entries[position].state;page.url=entries[position].url;}};
 export class MouseEvent{constructor(path,options={}){this.path=path;this.button=0;this.defaultPrevented=false;Object.assign(this,options);}composedPath(){return this.path;}preventDefault(){this.defaultPrevented=true;}}
 export class HTMLAnchorElement{constructor(href){this.href=new URL(href,page.url).href;this.target='';this.attributes=new Map();this.relList={contains:()=>false};}closest(){return this.reload?this:null;}hasAttribute(key){return this.attributes.has(key);}getAttribute(key){return this.attributes.get(key)??null;}setAttribute(key,value){this.attributes.set(key,value);}removeAttribute(key){this.attributes.delete(key);}}
 export class Node{listeners=new Map();addEventListener(type,handler){this.listeners.set(type,handler);}removeEventListener(type){this.listeners.delete(type);}send(type,event){this.listeners.get(type)?.(event);}}
`);
const source=await Bun.file(new URL('../src/lib/ui/media-navigation.ts',import.meta.url)).text();
const code=new Bun.Transpiler({loader:'ts'}).transformSync(source)
 .replaceAll('$app/state',boundaryUrl).replaceAll('$app/navigation',boundaryUrl).replaceAll('$lib/playback/client.svelte',boundaryUrl)
 .replaceAll('$lib/ui/section-target',new URL('../src/lib/ui/section-target.ts',import.meta.url).href)
 .replaceAll('$lib/media/detail-target',new URL('../src/lib/media/detail-target.ts',import.meta.url).href);
const navigation=await import(moduleUrl(`import {history,MouseEvent,HTMLAnchorElement} from '${boundaryUrl}';\n${code}`));
const boundary=await import(boundaryUrl);
test('nested detail links retain the underlying URL, support Back/Forward history and close the whole trail',()=>{
 boundary.reset();boundary.player.session={mediaType:'video'};
 expect(navigation.openMediaDetails(`/media/${id}`)).toBe(true);
 expect(navigation.openMediaDetails(`/media/${other}?section=credits`)).toBe(true);
 expect(boundary.page.url.href).toBe(base.href);expect(boundary.page.state).toMatchObject({mediaDetailDepth:2,friendsPopover:true});
 expect(boundary.player).toMatchObject({browsing:true,paused:false});
 navigation.backMediaDetails();expect(boundary.page.state.mediaDetailHref).toBe(`/media/${id}`);
 boundary.history.go(1);expect(boundary.page.state.mediaDetailHref).toBe(`/media/${other}?section=credits`);
 navigation.closeMediaDetails();expect(boundary.page.state).toEqual({friendsPopover:true});
});
test('signed-out browsing and isolated references preserve normal navigation',async()=>{
 for(const mode of ['guest','preview']){
  boundary.reset();if(mode==='guest')boundary.page.data.user=null;else boundary.page.url=new URL('https://coast.invalid/ui-preview');
  await navigation.navigateMedia(`/media/${id}`,{keepFocus:true});
  expect(boundary.calls).toEqual([['goto',`/media/${id}`,{keepFocus:true}]]);
 }
});
test('delegated links honor modified clicks, custom selection, external targets, downloads and reload intent',()=>{
 for(const mode of ['plain','modified','prevented','new-tab','download','reload']){
  boundary.reset();const root=new boundary.Node(),link=new boundary.HTMLAnchorElement(`/media/${id}`),event=new boundary.MouseEvent([link]);
  if(mode==='modified')event.ctrlKey=true;if(mode==='prevented')event.defaultPrevented=true;if(mode==='new-tab')link.target='_blank';if(mode==='download')link.setAttribute('download','');if(mode==='reload')link.reload=true;
  const controller=navigation.mediaDetailLinks(root);root.send('click',event);
  expect(boundary.calls.length).toBe(mode==='plain'?1:0);controller.destroy();expect(root.listeners.size).toBe(0);
 }
});
test('eligible taps suppress duplicate full-route preload only for that event, without retaining link nodes',async()=>{
 boundary.reset();const root=new boundary.Node(),link=new boundary.HTMLAnchorElement(`/media/${id}`),event=new boundary.MouseEvent([link]);
 const controller=navigation.mediaDetailLinks(root);root.send('mousedown',event);
 expect(link.getAttribute('data-sveltekit-preload-data')).toBe('off');expect(event.defaultPrevented).toBe(false);
 await Promise.resolve();expect(link.hasAttribute('data-sveltekit-preload-data')).toBe(false);expect(boundary.calls).toEqual([]);
 controller.destroy();
});

test('row title links use the panel without intercepting ordinary main navigation',()=>{
 boundary.reset();const href='/progress?view=watching&category=music';
 expect(navigation.openMediaDetails(href)).toBe(false);
 const root=new boundary.Node(),link=new boundary.HTMLAnchorElement(href);link.setAttribute('data-detail-section','');
 const controller=navigation.mediaDetailLinks(root),event=new boundary.MouseEvent([link]);root.send('click',event);
 expect(event.defaultPrevented).toBe(true);expect(boundary.page.state.mediaDetailHref).toBe(href);expect(boundary.page.url.href).toBe(base.href);
 controller.destroy();
});
