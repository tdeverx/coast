import {expect,test} from 'bun:test';
import {menuEntries,menuConditions} from '../src/routes/ui-preview/menu-examples';
import {createPreviewTransport,id,menuPreviewItem} from '../src/routes/ui-preview/demo/fixtures';
import {menuCondition} from '../src/lib/ui/controls/menu-preview';
import {parse} from 'svelte/compiler';
import {emojis,reactionLabels} from '../src/lib/social/model';

const state=async(fetch:ReturnType<typeof createPreviewTransport>)=>(await fetch(`/api/v1/collection/${id}`)).json();

test('interactive menu fixtures retain modal dialog accessibility through their owner wrapper',async()=>{
 const source=await Bun.file(new URL('../src/routes/ui-preview/MenuPreviewScope.svelte',import.meta.url)).text();
 const {fragment}=parse(source,{modern:true});
 const owners=fragment.nodes.filter(node=>node.type==='RegularElement'&&node.fragment.nodes.some(child=>child.type==='RenderTag'));
 expect(owners).toHaveLength(1);
 for(const owner of owners)if(owner.type==='RegularElement'){
  expect(owner.attributes.filter(attribute=>attribute.type==='Attribute'&&['aria-hidden','inert','hidden'].includes(attribute.name))).toEqual([]);
 }
});

test('menu selection stays flat and approval belongs only to the reviewed episode',()=>{
 expect(new Set(menuEntries.map(entry=>entry.value)).size).toBe(menuEntries.length);
 expect(menuEntries.filter(entry=>entry.value==='media')).toHaveLength(1);
 expect(menuEntries.filter(entry=>entry.value==='filter')).toHaveLength(1);
 expect(menuEntries.flatMap(entry=>entry.examples.filter(example=>example.approval==='approved').map(example=>`${entry.value}:${example.value}`))).toEqual([]);
 expect(menuEntries.some(entry=>entry.value==='party-member')).toBe(true);
 expect(menuEntries.some(entry=>entry.value==='profile-background')).toBe(true);
 for(const entry of menuEntries)for(const example of entry.examples){
  const controls=menuConditions(entry,example);
  expect(new Set(controls.map(control=>control.id)).size).toBe(controls.length);
 }
});

test('reading and game condition fixtures expose the real action state independently',async()=>{
 const reading=createPreviewTransport('WorkMenu','book',{paused:true,rewatch:true,checkIn:true,manualCheckIn:true});
 const game=createPreviewTransport('WorkMenu','game',{completed:true});
 expect(await state(reading)).toMatchObject({reading:{state:'paused',page:12,rereadId:id},activeCheckin:{mode:'manual'}});
 expect(await state(game)).toMatchObject({game:{playthrough:{status:'completed'}},reading:null,activeCheckin:null});
 const hidden=createPreviewTransport('WorkMenu','comic',{dropped:true,position:false});
 expect(await state(hidden)).toMatchObject({reading:{state:'dropped',page:0}});
 expect(await state(createPreviewTransport('WorkMenu','game',{playthrough:false}))).toMatchObject({game:{playthrough:null}});
});

test('preview relationship changes stay inside the mounted fixture',async()=>{
 const changed=createPreviewTransport('WorkMenu','album'),untouched=createPreviewTransport('WorkMenu','album');
 const result=await changed('/api/v1/tracking',{method:'POST',body:JSON.stringify({mediaId:id,action:'watchlist',value:false})});
 expect(result.ok).toBe(true);
 expect((await state(changed)).reasons.some((reason:{relationship:string})=>reason.relationship==='watchlist')).toBe(false);
 expect((await state(untouched)).reasons.some((reason:{relationship:string})=>reason.relationship==='watchlist')).toBe(true);
});

test('provider artist and track fixtures retain canonical identities and source conditions',()=>{
 const artist=menuPreviewItem('artist',{available:false});
 expect(artist).toMatchObject({kind:'artist',available:false});
 expect('workId' in artist&&artist.workId).toBeTruthy();
 expect('artistId' in artist&&artist.artistId).toBeTruthy();
 expect(menuPreviewItem('track',{position:false})).toMatchObject({positionSeconds:0});
});

test('each supported disposable-link medium exposes an independent preview-only permission',()=>{
 const media=menuEntries.find(entry=>entry.value==='media')!;
 for(const medium of ['episode','movie','track','book','comic']){
  const example=media.examples.find(example=>example.value===medium)!;
  const controls=menuConditions(media,example),sharing=controls.find(control=>control.id==='sharing');
  expect(sharing).toMatchObject({label:'Disposable links enabled',initial:true});
  const fixture={conditions:{sharing:true},claimInline:()=>false,mountInline:()=>({destroy(){}}),wrapsMenu:()=>false,profileBackground:(_id:string|undefined,actual:boolean)=>actual,setProfileBackground:()=>{}};
  expect(menuCondition('sharing',false,true,fixture)).toBe(true);
  fixture.conditions.sharing=false;
  expect(menuCondition('sharing',true,true,fixture)).toBe(false);
  fixture.conditions.sharing=true;
  expect(menuCondition('sharing',false,false,fixture)).toBe(false);
 }
});

test('reaction choices retain their emoji identity with readable accessible names',()=>{
 expect(emojis.map(emoji=>[emoji,reactionLabels[emoji]])).toEqual([['❤️','Love'],['😂','Laugh'],['😮','Surprised'],['😢','Sad'],['🔥','Fire']]);
});

test('screen metadata refresh previews use the actual parent-or-title eligibility and independent source toggle',async()=>{
 const media=menuEntries.find(entry=>entry.value==='media')!;
 for(const medium of ['episode','season','show','movie','collection']){
  const example=media.examples.find(example=>example.value===medium)!;
  expect(menuConditions(media,example).find(control=>control.id==='metadataSource')).toMatchObject({initial:true});
  const item=menuPreviewItem(medium),fetch=createPreviewTransport('WorkMenu',medium);
  const actions=await (await fetch(`/api/v1/media/${item.id}/actions`)).json();
  expect(actions.refreshTarget).toMatchObject({id:medium==='episode'||medium==='season'?'00000000-0000-4000-8000-000000000075':item.id,tmdbId:'1234'});
  expect((await fetch(`/api/v1/media/${actions.refreshTarget.id}/refresh`,{method:'POST'})).ok).toBe(true);
  const missing=createPreviewTransport('WorkMenu',medium,{metadataSource:false});
  expect((await (await missing(`/api/v1/media/${item.id}/actions`)).json()).refreshTarget).toBeNull();
  expect((await missing(`/api/v1/media/${actions.refreshTarget.id}/refresh`,{method:'POST'})).status).toBe(409);
 }
});

const request=async(fetch:ReturnType<typeof createPreviewTransport>,path:string,method='GET',body?:unknown)=>{
 const response=await fetch(`/api/v1/${path}`,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});
 expect(response.ok).toBe(true);return response.json();
};

test('work history fixtures provide complete paged shapes and deletion survives reopening only for the captured target',async()=>{
 for(const [scenario,route,field] of [['book',`reading/${id}/history`,'items'],['track',`music/${id}/history`,'items'],['game',`game-playthroughs/${id}`,'sessions']] as const){
  const fetch=createPreviewTransport('WorkMenu',scenario);
  const before=await state(fetch),first=await request(fetch,route);
  expect(first).toMatchObject({page:1,pages:2,total:3});expect(first[field]).toHaveLength(2);
  const second=await request(fetch,`${route}?page=2`);expect(second[field]).toHaveLength(1);
  for(const item of [...first[field],...second[field]]){
   expect(typeof item.id).toBe('string');
   expect(Number.isFinite(Date.parse(scenario==='game'?item.playedAt:item.occurredAt))).toBe(true);
  }
  const entry=first[field][0].id;
  const wrongTarget=await fetch(`/api/v1/${route.replace(id,'unopened-target')}${scenario==='game'?'/sessions':''}/${entry}`,{method:'DELETE'});
  expect(wrongTarget.status).toBe(404);
  expect((await request(fetch,route)).total).toBe(3);
  await request(fetch,`${route}${scenario==='game'?'/sessions':''}/${entry}`,'DELETE');
  const reopened=await request(fetch,route);
  expect(reopened).toMatchObject({page:1,pages:1,total:2});
  expect(reopened[field].some((item:{id:string})=>item.id===entry)).toBe(false);
  expect(await state(fetch)).toEqual(before);
  expect((await request(createPreviewTransport('WorkMenu',scenario),route)).total).toBe(3);
 }
});

test('artist track choice pages retain a previously selected target when logging and reopening history',async()=>{
 const fetch=createPreviewTransport('WorkMenu','artist');
 const artist=menuPreviewItem('artist');if(!('workId' in artist)||!artist.workId)throw Error('Missing canonical artist fixture');
 const first=await request(fetch,`music/${artist.workId}/log-options`);
 expect(first.hasMore).toBe(true);expect(first.items).toHaveLength(2);
 const selected=first.items[0];
 const next=await request(fetch,`music/${artist.workId}/log-options?page=2`);
 expect(next.hasMore).toBe(false);expect(next.items).toHaveLength(1);
 const occurredAt='2026-09-30T18:00:00Z';
 const log=await request(fetch,`music/${selected.id}/log`,'POST',{batchId:'preview-batch',occurredAt});
 const history=await request(fetch,`music/${artist.workId}/history`);
 expect(history.items[0]).toMatchObject({id:log.id,title:selected.title,occurredAt});
 await request(fetch,`music/${artist.workId}/history/${log.id}`,'DELETE');
 expect((await request(fetch,`music/${artist.workId}/history`)).items.some((item:{id:string})=>item.id===log.id)).toBe(false);
 expect((await request(fetch,`music/${selected.id}/history`)).items.some((item:{id:string})=>item.id===log.id)).toBe(true);
});

test('game playthrough choices use selected state and writes retain the captured playthrough identity',async()=>{
 const fetch=createPreviewTransport('WorkMenu','game');
 const choices=await request(fetch,`games/${id}/playthroughs`);
 expect(choices.items).toHaveLength(2);expect(choices.hasMore).toBe(true);
 const original=choices.items[0],selected=choices.items[1];
 expect((await request(fetch,`collection/${id}?playthrough=${selected.id}`)).game.playthrough).toMatchObject({id:selected.id,status:'paused'});
 await request(fetch,`game-playthroughs/${original.id}`,'PATCH',{status:'completed'});
 expect((await request(fetch,`collection/${id}?playthrough=${selected.id}`)).game.playthrough).toMatchObject({id:selected.id,status:'paused'});
 expect((await request(fetch,`collection/${id}?playthrough=${original.id}`)).game.playthrough).toMatchObject({id:original.id,status:'completed'});
 const created=await request(fetch,`games/${id}/playthroughs`,'POST',{platform:'PC',repeat:true});
 expect((await request(fetch,`games/${id}/playthroughs`)).items[0]).toMatchObject({id:created.id,platform:'PC',status:'in-progress'});
 await request(fetch,`game-playthroughs/${selected.id}/sessions`,'POST',{id:'captured-session',minutesPlayed:45,playedAt:'2026-09-30T18:00:00Z'});
 expect((await request(fetch,`game-playthroughs/${selected.id}`)).sessions[0]).toMatchObject({id:'captured-session',minutesPlayed:45});
 expect((await request(fetch,`game-playthroughs/${original.id}`)).sessions.some((item:{id:string})=>item.id==='captured-session')).toBe(false);
});

test('reading menu sharing stays inside its specimen and revokes its synthetic link',async()=>{
 const fetch=createPreviewTransport('WorkMenu','book');
 expect(await request(fetch,`sharing/sources?workId=${id}`)).toHaveLength(1);
 const link=await request(fetch,'sharing','POST',{workId:id,connectionId:id,hours:6,target:'website'});
 expect(link).toEqual({id,token:'preview-only-not-a-real-link',target:'website'});
 await request(fetch,`sharing/${link.id}`,'DELETE');
 expect((await fetch(`/api/v1/sharing/${link.id}`,{method:'DELETE'})).status).toBe(409);
});

test('screen quick actions and ratings survive reopening within only their own preview transport',async()=>{
 const fetch=createPreviewTransport('WorkMenu','episode'),other=createPreviewTransport('WorkMenu','episode');
 const item=menuPreviewItem('episode');
 const actions=async(deliver=fetch)=>(await (await deliver(`/api/v1/media/${item.id}/actions`)).json()).item;
 expect(await actions()).toMatchObject({watchlist:true,favourite:false,collected:true,rating:4});
 await request(fetch,'tracking','POST',{mediaId:item.id,action:'watchlist',value:false});
 await request(fetch,'tracking','POST',{mediaId:item.id,action:'favourite',value:true});
 await request(fetch,`collection/${item.id}`,'POST',{collected:false});
 await request(fetch,'ratings','POST',{mediaId:item.id,value:2.5});
 expect(await actions()).toMatchObject({watchlist:false,favourite:true,collected:false,rating:2.5});
 expect(await actions(other)).toMatchObject({watchlist:true,favourite:false,collected:true,rating:4});
 await request(fetch,'ratings','POST',{mediaId:item.id,value:null});
 expect((await actions()).rating).toBeNull();expect((await state(fetch)).rating).toBeNull();
});
