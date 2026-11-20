import {expect,test} from 'bun:test';
import {canShowTaste,detailActivity,detailTaste} from '../src/lib/ui/pages/detail';
import type {FeatureValues} from '../src/lib/features';
import type {HeroItem} from '../src/lib/ui/heroes/presentation.svelte';
const id='00000000-0000-4000-8000-000000000001';
const item=(kind:string,extra:Record<string,unknown>={})=>({id,kind,...extra}) as HeroItem;
test('every medium uses durable identity for its common Activity row',()=>{
 for(const kind of ['movie','show','season','episode','collection'])expect(detailActivity(item(kind))).toEqual({workId:id,category:'screen'});
 for(const kind of ['book','comic'])expect(detailActivity(item(kind))).toEqual({workId:id,category:'reading'});
 expect(detailActivity(item('game',{id:`game:${id}`,workId:id}))).toEqual({workId:id,category:'game'});
 for(const kind of ['album','track'])expect(detailActivity(item(kind,{id:`music:source:provider-id`,workId:id}))).toEqual({workId:id,category:'music'});
 expect(detailActivity(item('artist',{id:'music:source:provider-id',artistId:id}))).toEqual({artistId:id,category:'music'});
 expect(detailActivity(item('artist',{id:'music:source:provider-id',artistId:'00000000-0000-4000-8000-000000000002',workId:id}))).toEqual({artistId:id,category:'music'});
 expect(detailActivity(item('artist',{id:'music::canonical',workId:id}))).toEqual({artistId:id,category:'music'});
 expect(detailActivity(item('collection',{id:`reading-group:${id}`}))).toEqual({readingGroupId:id,category:'reading'});
 for(const value of [undefined,item('person'),item('game',{id:'game:remote'}),item('book',{id:'OL123W'}),item('artist',{id:'provider-artist'})])expect(detailActivity(value)).toBeUndefined();
});

test('a previously loaded title is no longer scorable when its medium or personalisation is disabled',()=>{
 const allowed={personalisation:true,screen:true,music:true,book:true,comic:true,game:true} as FeatureValues;
 const volume=item('collection',{id:`reading-group:${id}`,href:`/media/reading-collection/${id}`});
 for(const [category,items] of [['screen',[item('movie'),item('collection')]],['music',[item('album'),item('track'),item('artist')]],['game',[item('game')]],['book',[item('book')]],['comic',[item('comic'),volume]]] as const){
  for(const target of items){
   expect(canShowTaste(target,allowed)).toBe(true);
   expect(canShowTaste(target,{...allowed,[category]:false})).toBe(false);
   expect(canShowTaste(target,{...allowed,personalisation:false})).toBe(false);
  }
 }
 expect(canShowTaste(volume,{...allowed,screen:false})).toBe(true);
 expect(canShowTaste(item('person'),allowed)).toBe(false);
});

test('taste uses canonical screen and catalogue work identities and distinguishes volume, box set and playlist',()=>{
 for(const kind of ['movie','show','season','episode'])expect(detailTaste(item(kind))).toEqual({workId:id});
 for(const kind of ['album','track','artist','game','book','comic']){
  const source=item(kind,{href:'/source/item',id,artistId:id});
  expect(detailTaste(source)).toBeUndefined();
  expect(detailTaste(source,id)).toEqual({workId:id});
  expect(detailTaste(item(kind,{id:'source-id',href:'/source/item',workId:id}))).toEqual({workId:id});
 }
 expect(detailTaste(item('collection'))).toEqual({workId:id,group:'collection'});
 const href=`/media/reading-collection/${id}`;
 for(const key of [id,`reading-group:${id}`]){
  expect(detailTaste(item('collection',{id:key,href}),key)).toEqual({workId:id,group:'reading-group'});
 }
 expect(detailTaste(item('collection',{href:`/lists?view=${id}`}),id)).toBeUndefined();
 expect(detailTaste(item('movie',{id:'not-a-uuid'}))).toBeUndefined();
 expect(detailTaste(item('person'),id)).toBeUndefined();
});
