import {onDestroy, untrack} from 'svelte';
import {page} from '$app/state';
import {goto} from '$app/navigation';
import {progressExperimentTabs,profileProgressExperimentTabs, type ProgressExperimentContent, type ProgressExperimentOptions} from '#lib/progress-experiment.js';
import {ApiError} from '#lib/ui/client.js';
import {useClient} from '#lib/ui/client-context.js';
import {useShelfLocation} from '#lib/ui/detail-section.svelte.js';
import {createResource, uniqueItems} from '#lib/ui/resource.svelte.js';
import {contentRevisionKey} from '#lib/ui/content-revision.svelte.js';
import {categoryEnabled} from '#lib/experimental.js';
import {mediaTypeOptions} from '#lib/ui/filter-options.js';
import type {ShelfSource, ShelfControl} from './types';

export type ProgressExperimentSourceOptions={type:'progress-experiment';username?:string;layout?:'row'|'grid';initial?:ProgressExperimentContent;filters?:ProgressExperimentOptions};
export function createProgressExperimentSource(get:()=>ProgressExperimentSourceOptions):ShelfSource {
  const {api,preview}=useClient(),location=useShelfLocation();
  const initial=$derived(get().initial);
  const layout=$derived(get().layout??'row');
  let view=$state(untrack(()=>get().filters?.view??initial?.view??'continue'));
  type Filters=Pick<ProgressExperimentOptions,'kind'|'scope'>;
  let preferences=$state<Record<string,Filters>>(Object.fromEntries(profileProgressExperimentTabs.map(tab=>[tab.value,{kind:'all',scope:'all'}])));
  untrack(()=>{const filters=get().filters??initial;if(filters)preferences[view]={kind:filters.kind,scope:filters.scope};});
  const current=$derived(preferences[view]);
  const resource=createResource<ProgressExperimentContent>(untrack(()=>initial??{view,kind:'all',scope:'all',items:[],total:0,page:1,pages:1}),!!untrack(()=>initial));
  const ownerKey=$derived(JSON.stringify([page.data.user?.id,get().username]));
  let loadedOwner=$state(untrack(()=>ownerKey));
  const empty=():ProgressExperimentContent=>({view,...current,items:[],total:0,page:1,pages:1});
  const parameters=(number=1)=>new URLSearchParams({view,...current,page:String(number),...(get().username?{username:get().username!}:{})});
  const href=(number=1)=>'/progress-experiment?'+parameters(number);
  async function load(number=1,append=false) {
    const request=parameters(number);
    if(layout==='row')request.set('preview','true');
    const requestedOwner=ownerKey;
    const result=await resource.load(async signal=>{
      try{
        const next=await api<ProgressExperimentContent>('progress/experiment?'+request,undefined,'GET',{signal});
        if(!signal.aborted&&ownerKey===requestedOwner)loadedOwner=requestedOwner;
        return next;
      }catch(cause){
        if(!signal.aborted&&ownerKey===requestedOwner&&get().username&&cause instanceof ApiError&&[403,404].includes(cause.status))resource.replace(empty(),cause.message);
        throw cause;
      }
    },{
      merge:(old,next)=>({...next,items:append?uniqueItems([...old.items,...next.items],item=>item.entryId??item.id):next.items}),
    });
    if(result&&layout==='grid'&&!location.embedded&&!preview)void goto(href(result.page),{shallow:true,replace:true,reset:false,state:page.state});
  }
  const refreshKey=$derived(JSON.stringify([contentRevisionKey(page.data,['tracking','social']),get().username,page.data.experimentalMusic,page.data.experimentalGaming,page.data.experimentalBooks,page.data.experimentalComics,page.data.capabilities]));
  let previousKey=untrack(()=>refreshKey);
  let previousInitial=untrack(()=>initial);
  let previousOwner=untrack(()=>ownerKey);
  $effect(()=>{
    const key=refreshKey,next=initial,owner=ownerKey;
    untrack(()=>{
      const revisionChanged=key!==previousKey,initialChanged=next!==previousInitial;
      const ownerChanged=owner!==previousOwner;previousOwner=owner;
      previousKey=key;previousInitial=next;
      // An authoritative route response already includes the revision; do not start a duplicate GET.
      if(next&&initialChanged){view=next.view;preferences[view]={kind:next.kind,scope:next.scope};loadedOwner=owner;resource.replace(next);}
      else if(ownerChanged){const active=resource.activated||resource.ready;resource.replace(empty());if(active)void load();}
      else if(revisionChanged&&(resource.activated||resource.ready))void load(layout==='row'?1:resource.data.page);
    });
  });
  onDestroy(resource.dispose);
  function update(patch:Partial<Filters>){
    const next={...current,...patch};
    if(next.kind===current.kind&&next.scope===current.scope)return;
    preferences[view]=next;void load();
  }
  return {
    get title(){return 'Progress';},
    get items(){
      if(loadedOwner!==ownerKey)return [];
      const items=resource.data.items.filter(item=>!['album','track','artist'].includes(item.kind)&&categoryEnabled({...page.data,features:page.data.capabilities},item.kind==='game'?'game':['book','comic'].includes(item.kind)?item.kind:'screen'));
      return items;
    },
    get busy(){return resource.busy;},get ready(){return resource.ready;},get error(){return resource.error;},
    get activated(){return resource.activated;},
    get href(){return layout==='row'?href():undefined;},
    get mixed(){return true;},
    get resetKey(){return JSON.stringify([ownerKey,view,current.kind,current.scope]);},
    get pagination(){return {kind:'pages' as const,page:resource.data.page,pages:resource.data.pages,append:false,controls:layout==='grid'?'both' as const:'none' as const};},
    get filters():ShelfControl[]{return [
      {type:'segments',label:'Progress selection',value:view,options:get().username?profileProgressExperimentTabs:progressExperimentTabs,change:value=>{if(value===view)return;view=value as typeof view;void load();}},
      {type:'availability',label:'Available only',value:current.scope,change:value=>update({scope:value as Filters['scope']})},
    ];},
    get controls():ShelfControl[]{return [{type:'select',label:'Progress media type',value:current.kind,options:mediaTypeOptions({...page.data,experimentalMusic:false,features:page.data.capabilities}),change:value=>update({kind:value as Filters['kind']})}];},
    get empty(){return 'No titles in this selection.';},
    load,
  };
}
