import {expect,test} from 'bun:test';
import {detailActivity} from '../src/lib/ui/pages/detail';
import type {HeroItem} from '../src/lib/ui/heroes/presentation.svelte';
const id='00000000-0000-4000-8000-000000000001';
const item=(kind:string,extra:Record<string,unknown>={})=>({id,kind,...extra}) as HeroItem;
test('every medium uses durable identity for its common Activity row',()=>{
 for(const kind of ['movie','show','season','episode','collection'])expect(detailActivity(item(kind))).toEqual({workId:id,category:'screen'});
 for(const kind of ['book','comic'])expect(detailActivity(item(kind))).toEqual({workId:id,category:'reading'});
 expect(detailActivity(item('game',{id:`game:${id}`,workId:id}))).toEqual({workId:id,category:'game'});
 for(const kind of ['album','track'])expect(detailActivity(item(kind,{id:`music:source:provider-id`,workId:id}))).toEqual({workId:id,category:'music'});
 expect(detailActivity(item('artist',{id:'music:source:provider-id',artistId:id}))).toEqual({artistId:id,category:'music'});
 expect(detailActivity(item('collection',{id:`reading-group:${id}`}))).toEqual({readingGroupId:id,category:'reading'});
 for(const value of [undefined,item('person'),item('game',{id:'game:remote'}),item('book',{id:'OL123W'}),item('artist',{id:'provider-artist'})])expect(detailActivity(value)).toBeUndefined();
});
