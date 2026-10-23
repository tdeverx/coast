import {expect,test} from 'bun:test';
// @ts-expect-error Svelte's internal rune control runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {create,settle} from './fixtures/library-window';

for(const boundary of ['pending navigation','committed URL'])test(`a pending grid read cannot overwrite ${boundary} before its server props arrive`,async()=>{
  // Empty ownership controls supplement the separate genuine HTTP/DTO browser replay.
  // No fabricated catalogue identities or provider responses are needed for this race.
  let answer!:(value:unknown)=>void,signal!:AbortSignal,owner:any;
  const initial={items:[],page:1,pages:3,total:120};
  const dispose=runtime.effect_root(()=>{
    owner=create((_path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>{
      signal=options.signal;
      return new Promise(resolve=>{answer=resolve;});
    },{user:{id:'ownership-control'},capabilities:{screen:true},contentRevision:{}},
    {embedded:false,options:{surface:'watch',layout:'grid',initial}});
  });
  try{
    await settle();
    const pending=owner.source.load(2,true);
    if(boundary==='pending navigation')owner.setNavigating('/library?view=listen');
    else owner.setUrl('/library?view=listen');
    answer({items:[],page:2,pages:3,total:120});
    await pending;await settle();
    expect(signal.aborted).toBe(true);
    expect(owner.navigation).toEqual([]);
    expect(owner.content).toBe(initial);
    expect(owner.source.busy).toBe(false);
  }finally{owner.dispose();dispose();}
});
