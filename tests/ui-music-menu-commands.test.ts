import { expect, test } from 'bun:test';
import { compileRunes, componentScript, moduleUrl } from './fixtures/ui-script';
const runtime=await import(import.meta.resolve('svelte/internal/client'));

const source=(await componentScript('src/lib/ui/work-menu/MusicCommands.svelte'))
  .replace(/\$props\(\)/g,'properties').replace(/\bexport (?=(?:async )?function)/g,'');
const factory=await import(moduleUrl(compileRunes(`
  import {untrack} from ${JSON.stringify(import.meta.resolve('svelte/internal/client'))};
  export function create(properties,deliver){
    const onDestroy=()=>{},reportFailure=()=>{},workMenuScope=JSON.stringify,retryMenuRead=undefined;
    const useClient=()=>({change:deliver,api:async()=>({}),feedback:{notify(){}}});
    const createMutation=()=>({busy:false,error:'',async run(task){await task();return true;}});
    const createMenuResource=(initial)=>({data:initial(),active:false,busy:false,error:'',sync(){},
      open(){this.active=true;return Promise.resolve(this.data);},close(){this.active=false;},dispose(){}});
    ${source}
    return {log,showDate,submit,resetPosition,confirmReset,replaceWork(value){workId=value;},replaceKind(value){artist=value==='artist';album=value==='album';},
      select(id){selected={id,title:'Selected track'};},setDate(value){date=value;},
      get open(){return logOpen;},get resetOpen(){return resetOpen;},get error(){return mutation.error;}};
  }
`)));

function fixture(artist=false){
  const calls:{path:string;body:Record<string,unknown>}[]=[];
  let owner:any;
  const dispose=runtime.effect_root(()=>{owner=factory.create({workId:'original',artist,changed:async()=>{}},
    async(path:string,body:Record<string,unknown>)=>{calls.push({path,body});});});
  return {owner,calls,dispose};
}

test('dated music logging retains the work whose dialog was opened',async()=>{
  const {owner,calls,dispose}=fixture();
  try{
    owner.showDate();owner.replaceWork('replacement');owner.setDate('2020-02-03T12:30');
    await owner.submit();
    expect(calls).toHaveLength(1);expect(calls[0].path).toBe('music/original/log');
    expect(calls[0].body.occurredAt).toBe(new Date('2020-02-03T12:30').toISOString());
    expect(owner.open).toBe(false);
  }finally{dispose();}
});

test('artist logging requires a concrete track and never logs the artist as a listen',async()=>{
  const {owner,calls,dispose}=fixture(true);
  try{
    await owner.log();expect(owner.open).toBe(true);expect(calls).toHaveLength(0);
    await owner.submit();expect(calls).toHaveLength(0);
    owner.select('track');owner.replaceKind('album');owner.replaceWork('replacement');owner.setDate('2020-02-03T12:30');await owner.submit();
    expect(calls[0].path).toBe('music/track/log');expect(owner.open).toBe(false);
  }finally{dispose();}
});

test('invalid listening dates do not submit or close the dialog',async()=>{
  const {owner,calls,dispose}=fixture();
  try{
    owner.showDate();owner.setDate('2999-02-03T12:30');await owner.submit();
    expect(calls).toHaveLength(0);expect(owner.open).toBe(true);expect(owner.error).toContain('past');
  }finally{dispose();}
});

test('music position reset waits for confirmation and retains its exact track target',async()=>{
 const {owner,calls,dispose}=fixture();
 try{
  owner.resetPosition();expect(owner.resetOpen).toBe(true);expect(calls).toHaveLength(0);
  owner.replaceWork('replacement');owner.replaceKind('album');await owner.confirmReset();
  expect(calls).toEqual([{path:'music/original/reset-position',body:{}}]);expect(owner.resetOpen).toBe(false);
 }finally{dispose();}
 const artist=fixture(true);
 try{artist.owner.resetPosition();expect(artist.owner.resetOpen).toBe(false);expect(artist.calls).toHaveLength(0);}
 finally{artist.dispose();}
});
