import {expect,test} from 'bun:test';
import * as v from 'valibot';
import {libraryTypeOptions} from '../src/lib/library';
import {requestFeedSchema,requestFeedCard,recentLibrarySchema} from '../src/lib/library-feed';
import {sectionTarget} from '../src/lib/ui/section-target';
import type {MediaView} from '../src/lib/ui/types';
test('library media choices respect category and experiment withdrawal',()=>{
 const config={experimentalMusic:true,experimentalGaming:true,experimentalBooks:true,experimentalComics:true,features:{screen:true,music:true,game:true,book:true,comic:true}};
 expect(libraryTypeOptions(config).map(type=>type.value)).toEqual(['movie','show','music','game','book','comic']);
 expect(libraryTypeOptions({...config,features:{...config.features,screen:false,book:false},experimentalMusic:false}).map(type=>type.value)).toEqual(['game','comic']);
});
test('request cards retain request identity and use a status indicator without manufacturing social activity',()=>{
 const item={id:'movie',kind:'movie',title:'A title'} as MediaView;
 for(const [state,label,icon] of [['pending','Pending','clock'],['approved','Accepted','check'],['available','Available','check'],['failed','Failed','close'],['cancelled','Cancelled','close'],['declined','Declined','close']]){
  const card=requestFeedCard(item,{id:'request',state,destination:'Seerr',createdAt:'2026-10-21T12:00:00Z'},{username:'owner'});
  expect(card.id).toBe('movie');expect(card.entryId).toBe('request');expect(card.captionActor?.username).toBe('owner');
  expect(card.captionStatus).toMatchObject({label,icon,href:'/requests?request=request'});
  expect(card.captionDate).toBe('2026-10-21T12:00:00.000Z');expect(card.captionActivity).toBeUndefined();
 }
});
test('feed inputs reject unbounded paging and invalid selections, and expanded rows preserve their scope',()=>{
 expect(v.safeParse(requestFeedSchema,{state:'processing'}).success).toBe(false);
 expect(v.safeParse(requestFeedSchema,{kind:'book'}).success).toBe(false);
 expect(v.safeParse(recentLibrarySchema,{page:1_000_001}).success).toBe(false);
 expect(sectionTarget('/for-you?section=requests&state=approved&kind=show',new URL('http://coast/'))).toMatchObject({source:{type:'library-feed',feature:'requests',state:'approved',kind:'show',layout:'grid'}});
 expect(sectionTarget('/for-you?section=recent&kind=comic',new URL('http://coast/'))).toMatchObject({source:{type:'library-feed',feature:'recent',kind:'comic',layout:'grid'}});
});

test('ordinary request cards omit the requester header while retaining the status action',()=>{
 const card=requestFeedCard({id:'movie',kind:'movie',title:'A title'} as MediaView,{id:'request',state:'pending',destination:'Seerr',createdAt:new Date()});
 expect(card.captionActor).toBeUndefined();expect(card.captionDate).toBeUndefined();
 expect(card.captionStatus?.label).toBe('Pending');
});

test('cancelled request reads stop before opening a database projection',async()=>{
 const {requestList}=await import('../src/lib/server/queries/requests');
 await expect(requestList(crypto.randomUUID(),1,undefined,{},AbortSignal.abort())).rejects.toMatchObject({name:'AbortError'});
});
