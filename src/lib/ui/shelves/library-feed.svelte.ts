import {onDestroy,untrack} from 'svelte';
import {page} from '$app/state';
import {goto} from '$app/navigation';
import {libraryTypeOptions} from '#lib/library.js';
import {requestStates,type LibraryFeedContent} from '#lib/library-feed.js';
import {ApiError} from '#lib/ui/client.js';
import {useClient} from '#lib/ui/client-context.js';
import {useShelfLocation} from '#lib/ui/detail-section.svelte.js';
import {createResource,uniqueItems} from '#lib/ui/resource.svelte.js';
import {contentRevisionKey} from '#lib/ui/content-revision.svelte.js';
import type {ShelfSource,ShelfControl} from './types';

export type LibraryFeedOptions={type:'library-feed';feature:'recent'|'requests';layout?:'row'|'grid';kind?:string;state?:string};
export function createLibraryFeedSource(get:()=>LibraryFeedOptions):ShelfSource{
  const {api,preview}=useClient(),location=useShelfLocation();
  let kind=$state(untrack(()=>get().kind??(get().feature==='requests'?'all':'movie')));
  let state=$state(untrack(()=>get().state??'all'));
  type Content=LibraryFeedContent&{scope:string};
  const empty=():Content=>({items:[],page:1,pages:1,total:0,scope:''});
  const resource=createResource<Content>(empty());
  const types=$derived(libraryTypeOptions({...page.data,features:page.data.capabilities}));
  const scope=$derived(JSON.stringify([page.data.user?.id,page.data.user?.role,get().feature,kind,state]));
  const parameters=(number=1)=>new URLSearchParams({kind,...(get().feature==='requests'?{state}:{}),page:String(number)});
  const href=()=>'/for-you?'+new URLSearchParams({section:get().feature,...Object.fromEntries(parameters())});
  function enabled(){return !!page.data.user&&(get().feature==='requests'?page.data.capabilities?.requests!==false&&page.data.capabilities?.screen!==false:types.some(type=>type.value===kind));}
  async function load(number=get().layout==='grid'?Number(location.url.searchParams.get('page')??1):1,append=false){
    if(get().feature==='recent'&&!types.some(type=>type.value===kind))kind=types[0]?.value??'movie';
    if(!enabled()){resource.replace(empty());return;}
    if(append&&resource.busy)return;
    if(append&&resource.data.scope!==scope){append=false;number=1;}
    const requested=scope,params=parameters(number);
    if(get().layout!=='grid')params.set('preview','true');
    const result=await resource.load(async signal=>{
      try{
        const data=await api<LibraryFeedContent>(`${get().feature==='recent'?'library/recent':'requests'}?${params}`,undefined,'GET',{signal});
        return {...data,scope:requested};
      }catch(cause){
        if(!signal.aborted&&scope===requested&&cause instanceof ApiError&&[403,404].includes(cause.status))resource.replace(empty(),cause.message);
        throw cause;
      }
    },{merge:(old,next)=>({...next,items:append?uniqueItems([...old.items,...next.items],item=>item.entryId??item.id):next.items})});
    if(result&&scope===requested&&get().layout==='grid'&&!location.embedded&&!preview){
      const url=new URL(href(),page.url.href);url.searchParams.set('page',String(result.page));
      void goto(url,{shallow:true,replace:true,reset:false,state:page.state});
    }
  }
  const refreshKey=$derived(JSON.stringify([page.data.user?.id,page.data.user?.role,get().feature,
    page.data.capabilities,page.data.experimentalMusic,page.data.experimentalGaming,page.data.experimentalBooks,page.data.experimentalComics,
    contentRevisionKey(page.data,['tracking'])]));
  let previous=untrack(()=>refreshKey),previousOwner=untrack(()=>page.data.user?.id),suppliedKind=untrack(()=>get().kind),suppliedState=untrack(()=>get().state);
  $effect(()=>{const key=refreshKey,owner=page.data.user?.id,nextKind=get().kind,nextState=get().state;untrack(()=>{
    let selectionChanged=false;
    if(nextKind!==suppliedKind){suppliedKind=nextKind;if(nextKind!==undefined&&nextKind!==kind){kind=nextKind;selectionChanged=true;}}
    if(nextState!==suppliedState){suppliedState=nextState;if(nextState!==undefined&&nextState!==state){state=nextState;selectionChanged=true;}}
    if(key===previous&&!selectionChanged)return;previous=key;
    const activated=resource.activated||resource.ready;
    if(owner!==previousOwner){previousOwner=owner;resource.replace(empty());}
    if(get().feature==='requests'&&!enabled()){resource.replace(empty());return;}
    if(activated)void load(1);
  });});
  onDestroy(resource.dispose);
  function choose(field:'kind'|'state',value:string){if(field==='kind'){if(value===kind)return;kind=value;}else{if(value===state)return;state=value;}void load(1);}
  return {
    get enrichSocial(){return get().feature!=='requests';},
    get title(){return get().feature==='recent'?'Recently added':'Requests';},
    get items(){return enabled()&&resource.data.scope===scope?resource.data.items:[];},
    get busy(){return resource.busy;},get ready(){return resource.ready;},get error(){return resource.error;},get activated(){return resource.activated;},
    get href(){return get().layout==='grid'?undefined:href();},
    get resetKey(){return scope;},
    get shape(){return get().feature==='requests'?'fanart' as const:kind==='music'?'square' as const:'poster' as const;},
    get artworkStyle(){return get().feature==='requests'?'thumb' as const:'primary' as const;},
    get pagination(){return {kind:'pages' as const,page:resource.data.page,pages:resource.data.pages,append:true,infinite:get().layout==='grid',controls:'none' as const};},
    get filters():ShelfControl[]{return [{type:'segments',label:get().feature==='recent'?'Recently added media':'Request status',value:get().feature==='recent'?kind:state,
      options:get().feature==='recent'?types:[...requestStates],change:value=>choose(get().feature==='recent'?'kind':'state',value)}];},
    get controls():ShelfControl[]{return get().feature==='requests'?[{type:'select',label:'Requested media',value:kind,options:[{value:'all',label:'All'},{value:'movie',label:'Movies'},{value:'show',label:'Shows'}],change:value=>choose('kind',value)}]:[];},
    get empty(){return get().feature==='recent'?'No recently added titles are available in this library.':'No requests in this selection.';},
    load,
  };
}
