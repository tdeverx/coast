import {onDestroy, untrack} from 'svelte';
import {ROW_BATCH_SIZE} from '#lib/page-window.js';

type Options<T>={
  items:T[]; row:boolean; progressive:boolean; scope:string;
  busy:boolean; error:string; hasMore:boolean; page:number;
  load:(page:number,append:boolean)=>Promise<unknown>;
  retry?:()=>Promise<unknown>;
};

/** One row policy: reveal buffered cards before asking the source for its next native page. */
export function createShelfContinuation<T>(get:()=>Options<T>){
  let scope=$state<string>(),limit=$state(ROW_BATCH_SIZE);
  let pending:symbol|undefined,failed:{scope:string;page:number}|undefined,disposed=false;
  const budget=$derived(scope===get().scope?limit:ROW_BATCH_SIZE);
  const buffered=$derived(get().row&&get().progressive&&get().items.length>budget);
  $effect(()=>{const next=get().scope;untrack(()=>{
    if(next===scope)return;
    scope=next;limit=ROW_BATCH_SIZE;pending=undefined;failed=undefined;
  });});
  async function request(page:number){
    const config=get();
    if(disposed||pending||config.busy)return;
    const token=Symbol(),requestedScope=config.scope;pending=token;
    failed={scope:requestedScope,page};
    try{
      await config.load(page,true);
      if(pending===token&&get().scope===requestedScope&&!get().error)failed=undefined;
    }finally{if(pending===token)pending=undefined;}
  }
  async function more(){
    const config=get();
    if(disposed||pending||config.busy||config.error)return;
    if(buffered){limit=budget+ROW_BATCH_SIZE;return;}
    if(!config.hasMore)return;
    if(config.row&&config.progressive)limit=Math.max(budget,config.items.length)+ROW_BATCH_SIZE;
    await request(config.page+1);
  }
  async function retry(){
    const config=get();
    if(disposed||pending||config.busy)return;
    if(config.retry)return config.retry();
    if(failed?.scope===config.scope)return request(failed.page);
    return config.load(config.page,false);
  }
  onDestroy(()=>{disposed=true;pending=undefined;failed=undefined;});
  return {
    get items(){const config=get();return config.row&&config.progressive?config.items.slice(0,budget):config.items;},
    get hasMore(){return buffered||get().hasMore;},more,retry,
  };
}
