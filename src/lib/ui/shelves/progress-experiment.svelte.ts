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
import {progressCardStyle} from '#lib/ui/progress-card-style.js';
import {profileRowPath} from '#lib/profile/url.js';
import type {ShelfSource, ShelfControl} from './types';

export type ProgressExperimentSourceOptions={category?:'screen'|'game'|'reading';type:'progress-experiment';username?:string;title?:string;profile?:boolean;showEmpty?:boolean;layout?:'row'|'grid';initial?:ProgressExperimentContent;filters?:ProgressExperimentOptions};
export function createProgressExperimentSource(get:()=>ProgressExperimentSourceOptions):ShelfSource {
  const {api,preview}=useClient(),location=useShelfLocation();
  const initial=$derived(get().initial);
  const scopedCategory=$derived(get().category??get().filters?.category??initial?.category);
  const layout=$derived(get().layout??'row');
  let view=$state(untrack(()=>get().filters?.view??initial?.view??'continue'));
  type Filters=Pick<ProgressExperimentOptions,'kind'|'scope'>;
  let preferences=$state<Record<string,Filters>>(Object.fromEntries([...progressExperimentTabs,...profileProgressExperimentTabs].map(tab=>[tab.value,{kind:'all',scope:'all'}])));
  untrack(()=>{const filters=get().filters??initial;if(filters)preferences[view]={kind:filters.kind,scope:filters.scope};});
  const current=$derived(preferences[view]);
  const style=$derived(progressCardStyle(view));
  const resource=createResource<ProgressExperimentContent>(untrack(()=>initial??{view,kind:'all',scope:'all',items:[],total:0,page:1,pages:1}),!!untrack(()=>initial));
  const ownerKey=$derived(JSON.stringify([page.data.user?.id,get().username,scopedCategory]));
  let loadedOwner=$state(untrack(()=>ownerKey));
  const views=$derived(loadedOwner===ownerKey?resource.data.availableViews:undefined);
  const tabs=$derived((get().username?profileProgressExperimentTabs:progressExperimentTabs).map(tab=>({
    ...tab,disabled:views!==undefined&&!views.includes(tab.value as ProgressExperimentOptions['view']),
  })));
  const empty=():ProgressExperimentContent=>({view,...current,items:[],total:0,page:1,pages:1});
  const parameters=(number=1)=>new URLSearchParams({...(scopedCategory?{category:scopedCategory}:{}),view,...current,page:String(number),...(get().username?{username:get().username!}:{})});
  const href=(number=1)=>{
    const request=parameters(number),{profile,username}=get();
    if(!profile||!username)return '/progress-experiment?'+request;
    request.delete('username');
    return profileRowPath(username,'progress',request);
  };
  async function load(number=get().filters?.page??1,append=false) {
    const request=parameters(number);
    if(layout==='row')request.set('preview','true');
    const requestedOwner=ownerKey;
    const epoch=summaryEpoch;
    const includeSummary=confirmedEpoch!==epoch;
    if(includeSummary)request.set('segments','true');
    const result=await resource.load(async signal=>{
      try{
        const next=await api<ProgressExperimentContent>('progress/experiment?'+request,undefined,'GET',{signal});
        if(!signal.aborted&&ownerKey===requestedOwner){
          loadedOwner=requestedOwner;
          if(next.availableViews){
            confirmedEpoch=epoch;
            if(next.view!==view){view=next.view;preferences[view]={kind:next.kind,scope:next.scope};}
          }
        }
        return next;
      }catch(cause){
        if(!signal.aborted&&ownerKey===requestedOwner&&get().username&&cause instanceof ApiError&&[403,404].includes(cause.status)){
          confirmedEpoch=undefined;
          resource.replace(empty(),cause.message);
        }
        throw cause;
      }
    },{
      merge:(old,next)=>({...next,availableViews:next.availableViews??(includeSummary?undefined:old.availableViews),
        items:append&&old.view===next.view?uniqueItems([...old.items,...next.items],item=>item.entryId??item.id):next.items}),
    });
    if(result&&layout==='grid'&&!location.embedded&&!preview)void goto(href(result.page),{shallow:true,replace:true,reset:false,state:page.state});
  }
  const refreshKey=$derived(JSON.stringify([contentRevisionKey(page.data,['tracking','social']),get().username,page.data.experimentalMusic,page.data.experimentalGaming,page.data.experimentalBooks,page.data.experimentalComics,page.data.capabilities]));
  const summaryEpoch=$derived(JSON.stringify([ownerKey,refreshKey]));
  let confirmedEpoch=untrack(()=>initial?.availableViews?summaryEpoch:undefined);
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
      if(next&&initialChanged){view=next.view;preferences[view]={kind:next.kind,scope:next.scope};loadedOwner=owner;resource.replace(next);confirmedEpoch=next.availableViews?summaryEpoch:undefined;}
      else if(ownerChanged){const active=resource.activated||resource.ready;resource.replace(empty());if(active)void load(1);}
      else if(revisionChanged&&(resource.activated||resource.ready))void load(layout==='row'?1:resource.data.page);
    });
  });
  $effect(()=>{
    const settled=initial;
    if(layout==='grid'&&!location.embedded&&!preview&&settled?.availableViews){
      untrack(()=>{
        if(settled.view!==(page.url.searchParams.get('view')??'continue'))
          void goto(href(settled.page),{shallow:true,replace:true,reset:false,state:page.state});
      });
    }
  });
  onDestroy(resource.dispose);
  function update(patch:Partial<Filters>){
    const next={...current,...patch};
    if(next.kind===current.kind&&next.scope===current.scope)return;
    preferences[view]=next;void load(1);
  }
  return {
    get filterReset(){return {disabled:current.kind==='all'&&current.scope==='all',run:()=>update({kind:'all',scope:'all'})};},
    get title(){return get().title ?? (get().username?'Watching':'Progress');},
    get items(){
      if(loadedOwner!==ownerKey||scopedCategory&&resource.data.category!==scopedCategory||resource.data.view!==view||resource.data.kind!==current.kind||resource.data.scope!==current.scope)return [];
      const items=resource.data.items.filter(item=>!['album','track','artist'].includes(item.kind)&&categoryEnabled({...page.data,features:page.data.capabilities},item.kind==='game'?'game':['book','comic'].includes(item.kind)?item.kind:'screen'));
      return items;
    },
    get busy(){return resource.busy;},get ready(){return resource.ready;},get error(){return resource.error;},
    get hideRow(){return !get().showEmpty && views?.length===0;},
    get activated(){return resource.activated;},
    get href(){return layout==='row'?href():undefined;},
    get shape(){return style?.shape??'poster';},
    get artworkStyle(){return style?.artworkStyle??'primary';},
    get artworkPriority(){return style?.artworkPriority;},
    get resetKey(){return JSON.stringify([ownerKey,view,current.kind,current.scope]);},
    get pagination(){return {kind:'pages' as const,page:resource.data.page,pages:resource.data.pages,append:false,controls:layout==='grid'?'both' as const:'none' as const};},
    get filters():ShelfControl[]{return [
      {type:'segments',label:'Progress selection',value:view,options:tabs,change:value=>{
        if(value===view||!tabs.some(tab=>tab.value===value&&!tab.disabled))return;
        view=value as typeof view;void load(1);
      }},
      {type:'availability',label:scopedCategory==='screen'?'Available to watch only':scopedCategory==='reading'?'Available to read only':scopedCategory==='game'?'Available to play only':'Available only',value:current.scope,change:value=>update({scope:value as Filters['scope']})},
    ];},
    get controls():ShelfControl[]{return scopedCategory==='game'?[]:[{type:'select',label:scopedCategory==='reading'?'Reading type':'Media type',value:current.kind,options:mediaTypeOptions({...page.data,experimentalMusic:false,features:page.data.capabilities}).filter(option=>!scopedCategory||option.value==='all'||(scopedCategory==='screen'?['movie','show'].includes(option.value):['book','comic'].includes(option.value))),change:value=>update({kind:value as Filters['kind']})}];},
    get empty(){return 'No titles in this selection.';},
    load,
  };
}
