import {createPageRetention, retainPageWindow, retainedInterval, type NativePage} from '$lib/page-window';
import {useShelfLocation} from '$lib/ui/detail-section.svelte';
import {surfaceEnabled,categoryEnabled} from '$lib/experimental';

  import { onDestroy, untrack } from 'svelte';
  import { page as route } from '$app/state';
  import { replaceState } from '$app/navigation';
  import type { PresentationRow } from '$lib/server/queries/media-rows';
  import { useClient } from '$lib/ui/client-context';
  import { createResource } from '$lib/ui/resource.svelte';
  import { contentRevisionKey } from '$lib/ui/content-revision.svelte';
  import { ApiError } from '$lib/ui/client';
  import {
    libraryBrowsePaths,
    libraryTitles,
    librarySelections,
    type LibraryContent,
    type LibrarySurface,
  } from '$lib/library';
  import type { ShelfSource, ShelfControl } from './types';
  import { readingTypeOptions } from '$lib/ui/filter-options';

export type LibrarySourceOptions = {
    surface: LibrarySurface;
    preview?: { title: string; personal?: boolean; empty: string; refreshKey?: unknown };
    initial?: LibraryContent;
    initialPage?: number;
    initialFirstPage?: number;
    genre?: string;
    layout?: 'row' | 'grid';
    initialSelection?: string;
    initialKind?: 'all' | 'movie' | 'show' | 'book' | 'comic';
    initialScope?: 'all' | 'available';
    collection?: boolean;
    username?: string;
    initialRelationship?: string;
    initialSource?: string;
    initialAvailability?: string;
  };
export function createLibrarySource(getOptions: () => LibrarySourceOptions): ShelfSource {
 const location=useShelfLocation();
  const { api, preview: isolatedPreview } = useClient();

  let {
    surface,
    initial,
    initialPage = 1,
    initialFirstPage,
    genre = '',
    layout = 'row',
    initialSelection = 'all',
    initialKind = 'all',
    initialScope = getOptions().preview || getOptions().surface === 'read' ? 'all' : 'available',
    collection: initialCollection = false,
    username = '',
    initialRelationship = 'all',
    initialSource = 'all',
    initialAvailability = 'all',
    preview,
  } = $derived(getOptions());

  let collection = $state(untrack(() => initialCollection));
  const title = $derived(preview?.title ?? libraryTitles[surface]);
  let selection = $state(untrack(() => initialSelection)),
    kind = $state(untrack(() => initialKind)),
    scope = $state<'all' | 'available'>(untrack(() => collection ? initialAvailability === 'available' ? 'available' : 'all' : initialScope));
  let relationship = $state(untrack(() => initialRelationship)),
    source = $state(untrack(() => initialSource)),
    availability = $state(untrack(() => initialAvailability));
  type Item=LibraryContent['items'][number];
  type Content = LibraryContent & { sources?: { id: string; name: string }[]; retainedPages?: NativePage<Item>[] };
  const itemKey=(item:Item)=>item.entryId??('href' in item?item.href:item.id);
  let retentionRevision=$state(0);
  const retention=createPageRetention(()=>retentionRevision++);
  const emptyContent=():Content=>({items:[],page:1,pages:1,total:0});
  const resource = createResource<Content>(
    untrack(() => initial ?? { items: [], page: 1, pages: 1, total: 0 }), !!untrack(() => initial)
  );
  const content = $derived(resource.data);
  const busy = $derived(resource.busy);
  const failure = $derived(resource.error);
  const ready = $derived(resource.ready);
  const selections = $derived(collection && surface === 'listen' ? librarySelections.listen.filter(option => option.value !== 'artist') : librarySelections[surface]);
  const paths = (number = 1, firstPage?:number) => libraryBrowsePaths({ surface, collection, selection, kind, scope, genre, relationship, source, availability, username, page: number, firstPage }, preview);
  const href = (number = 1) => paths(number).href;
  const admissionConfig=$derived({...route.data,features:route.data.capabilities});
  const admitted=$derived(!!preview||isolatedPreview||surfaceEnabled(admissionConfig,surface)&&
    (surface!=='read'||!['book','comic'].includes(kind)||categoryEnabled(admissionConfig,kind)));
  const admissionKey=$derived(preview||isolatedPreview?'preview':JSON.stringify([admitted,
    surface==='read'&&categoryEnabled(admissionConfig,'book'),surface==='read'&&categoryEnabled(admissionConfig,'comic')]));
  let loadedSelection = untrack(() => initial ? paths(1).api : undefined);
  // Range metadata describes committed pages, never a pending append.
  let needsRefresh=false,requestVersion=0;
  let blocked:{number:number;append:boolean;prepend:boolean;revalidate:boolean;revision:number;evicted:string[]}|undefined;
  let navigation=$state(0);
  function replaceContent(value:Content,error='') {
    requestVersion++;
    blocked=undefined;
    needsRefresh=false;
    resource.replace(value,error);
  }
  function clearContent(error='') {
    retention.retire();
    replaceContent(emptyContent(),error);
  }
  function holdWindow(previous:Content,next:Content,request:{number:number;append:boolean;prepend:boolean;revalidate:boolean}) {
    const oldKeys=previous.items.map(itemKey),nextKeys=next.items.map(itemKey);
    if(retention.canRelease(oldKeys,nextKeys))return false;
    const retained=new Set(nextKeys);
    blocked={...request,revision:retentionRevision,evicted:oldKeys.filter(key=>!retained.has(key))};
    return true;
  }
  const heldMessage='Finish the card action or move focus outside it to load more titles.';
  async function load(number?:number,append=false,revalidate=false,prepend=false) {
    if(!admitted||!preview&&!isolatedPreview&&!route.data.user) {
      loadedSelection=undefined; clearContent(); return;
    }
    if((append||prepend)&&resource.busy)return;
    blocked=undefined;
    const selectionKey=paths(1).api;
    if(loadedSelection!==undefined && loadedSelection!==selectionKey) {
      clearContent(); number=1;append=false;prepend=false;revalidate=false;
    }
    const activated=resource.activated||resource.ready;
    if(number===undefined && activated || needsRefresh && (number===undefined||append||prepend||number===content.page)) {
      append=false;prepend=false;revalidate=true;
    }
    const bounds=retainedInterval(content);
    const requested=number??(activated?content.page:initialPage);
    const first=revalidate?bounds.firstPage:!activated?initialFirstPage:undefined;
    loadedSelection=selectionKey;
    const captured=paths(requested,preview?undefined:first),owner=ownerKey,revision=refreshKey,
      initialItems=initial?.items,version=++requestVersion;
    const current=()=>version===requestVersion&&owner===ownerKey&&revision===refreshKey
      && initialItems===initial?.items && selectionKey===paths(1).api;
    if(revalidate)needsRefresh=true;
    let direction:'replace'|'append'|'prepend'=append?'append':prepend?'prepend':'replace';
    const result=await resource.load(async signal=>{
      function checkScope() {
        signal.throwIfAborted();
        if(!current()){resource.cancel();signal.throwIfAborted();}
      }
      async function read(path:string):Promise<Content> {
        checkScope();
        const response=!preview?await api<Content>(path,undefined,'GET',{signal}):
          await api<PresentationRow>(path,undefined,'GET',{signal}).then(row=>({...row,page:1,pages:1,total:row.items.length}));
        checkScope();return response;
      }
      try {
        let response=await read(captured.api);
        // A changed last page invalidates the old tail. Rebuild only the bounded
        // retained neighborhood before publishing, never a mixed old/new range.
        if((append||prepend) && response.page!==requested) {
          direction='replace';needsRefresh=true;
          const last=Math.min(bounds.lastPage,response.pages),from=Math.min(bounds.firstPage,last);
          response=await read(paths(last,from).api);
        }
        if((append||prepend||revalidate) && response.failure)
          return {...response,items:[]};
        return response;
      } catch(cause) {
        checkScope();
        if(cause instanceof ApiError&&[403,404].includes(cause.status))clearContent(cause.message);
        throw cause;
      }
    },{
      failure:result=>current()?result.failure??'':'',
      usable:result=>current()&&(!result.failure||result.items.length>0),
      merge:(previous,result)=>{
        const next=retainPageWindow<Item,Content>(previous,result,direction,itemKey);
        if((append||prepend||revalidate)&&holdWindow(previous,next,{number:requested,append,prepend,revalidate}))
          throw new Error(heldMessage);
        needsRefresh=false;
        if(direction==='replace'&&!revalidate)navigation++;
        return next;
      },
    });
    if(result&&current()&&!location.embedded&&!preview&&!isolatedPreview&&layout==='grid') {
      const committed=retainedInterval(result);
      replaceState(paths(committed.lastPage,committed.firstPage).href,route.state);
    }
  }
  const ownerKey = $derived(JSON.stringify([route.data.user?.id ?? '', username, surface]));
  const refreshKey = $derived(JSON.stringify([
    contentRevisionKey(route.data, ['tracking', 'social']), surface, genre, layout, preview?.refreshKey, admissionKey,
  ]));
  let previousAdmission = untrack(() => admissionKey);
  let previousOwner = untrack(() => ownerKey);
  let previousRefresh = untrack(() => refreshKey);
  let previousInitial = untrack(() => initial);
  $effect(() => {
    const owner = ownerKey, key = refreshKey, admission = admissionKey;
    const next = initial;
    const initialChanged = next?.items !== previousInitial?.items
      || next?.page !== previousInitial?.page || next?.pages !== previousInitial?.pages
      || next?.total !== previousInitial?.total || next?.failure !== previousInitial?.failure;
    untrack(() => {
      const ownerChanged = owner !== previousOwner;
      const admissionChanged=admission!==previousAdmission;
      const changed = ownerChanged || key !== previousRefresh || initialChanged;
      previousAdmission=admission;
      previousOwner = owner;
      previousRefresh = key;
      previousInitial = next;
      if (!changed) {
        if(!admitted)clearContent();
        return;
      }
      const activated = resource.activated || resource.ready;
      if ((ownerChanged||admissionChanged) && activated) {
        loadedSelection = undefined;
        clearContent();
      }
      if (!admitted||ownerChanged && !route.data.user && !isolatedPreview) return;
      if (initialChanged && next && layout === 'grid' && !location.embedded && !ownerChanged&&!admissionChanged && !resource.activated) {
        loadedSelection = paths(1).api;
        if(next.failure) {needsRefresh=true;resource.error=next.failure;return;}
        const incoming=retainPageWindow<Item,Content>(content,next,'replace',itemKey);
        if(holdWindow(content,incoming,{number:content.page,append:false,prepend:false,revalidate:true})) {
          needsRefresh=true;resource.error=heldMessage;return;
        }
        replaceContent(incoming);
      } else if (activated) void load(ownerChanged||admissionChanged?1:undefined,false,!ownerChanged&&!admissionChanged);
    });
  });
  $effect(()=>{
    const revision=retentionRevision,busy=resource.busy;
    untrack(()=>{
      if(blocked&&!busy&&revision!==blocked.revision&&retention.canRelease(blocked.evicted,[])) {
        const retry=blocked;
        void load(retry.number,retry.append,retry.revalidate,retry.prepend);
      }
    });
  });
  onDestroy(()=>{requestVersion++;resource.dispose();});


  return {
    get pagination() { return { kind: 'pages' as const, page: content.page, pages: content.pages, firstPage:retainedInterval(content).firstPage, append: true, controls: layout === 'grid' ? 'footer' as const : 'none' as const }; },
    retain:retention.retain,
    retry:()=>{
      if(resource.busy)return Promise.resolve();
      const pending=blocked;
      return pending?load(pending.number,pending.append,pending.revalidate,pending.prepend):load(undefined,false,true);
    },
    loadPrevious:()=>load(retainedInterval(content).firstPage-1,false,false,true),
    get location(){const bounds=retainedInterval(content);return preview?undefined:paths(bounds.lastPage,bounds.firstPage).href;},
    get title() { return title; }, get items() { return content.items; }, get busy() { return busy; }, get ready() { return ready; },
    get error() { return failure; }, get activated() { return resource.activated; },
    get href() { return layout === 'row' ? href() : undefined; },
    get shape() { return surface==='listen' ? 'square' : 'poster'; }, get mediaKind() { return surface==='listen' ? 'music' : surface==='play' ? 'game' : surface==='read' ? 'reading' : 'screen'; },
    get rows() { return preview ? 1 : 2; },

    get resetKey() { return preview ? `${selection}:${scope}` : `${collection}:${selection}:${kind}:${scope}:${relationship}:${source}:${availability}:${navigation}`; },
    get filters(): ShelfControl[] { return [
      {type:'segments' as const,label:`${title} selection`,value:selection,options:selections,change:(value:string)=>{selection=value;void load(1);}},
      ...(!preview ? [{type:'collection' as const,label:'In my Collection only',value:collection ? 'collection' : 'all',change:(value:string)=>{collection=value==='collection';if(collection && selection==='artist') selection='all';if(collection) availability=scope==='available'?'available':availability==='available'?'all':availability;void load(1);}}] : []),
      ...[{type:'availability' as const,label:surface==='read'?'Available to read only':'Available to play only',value:scope,change:(value:string)=>{scope=value as typeof scope;if(collection) availability=value==='available'?'available':'all';void load(1);}}],
    ]; },
    get controls(): ShelfControl[] {
      return [
        ...(surface==='watch' ? [{type:'media-type' as const,label:'Watch type',value:kind,change:(value:string)=>{kind=value as typeof kind;void load(1);}}] : []),
        ...(surface==='read' ? [{type:'select' as const,label:'Reading type',value:kind,options:readingTypeOptions({...route.data,features:route.data.capabilities}),change:(value:string)=>{kind=value as typeof kind;void load(1);}}] : []),
        ...(collection ? [
          {type:'select' as const,label:`${title} relationships`,value:relationship,options:[{value:'all',label:'All relationships'},{value:'collected',label:'Collected'},{value:'watchlist',label:'Watchlist'},{value:'favourite',label:'Favourites'},{value:'rating',label:'Rated'},{value:'list',label:'Lists'},...(surface!=='read'?[{value:'queue',label:'Queued'}]:[]),{value:'activity',label:'Activity'}],change:(value:string)=>{relationship=value;void load(1);}},
          {type:'select' as const,label:`${title} availability`,value:availability,options:[{value:'all',label:'All availability'},{value:'available',label:'Available'},...(surface!=='read'?[{value:'partial',label:'Partial'},{value:'unavailable',label:'Missing'}]:[]),{value:'unknown',label:'Unknown'},{value:'ready',label:'Ready to continue'}],change:(value:string)=>{availability=value;scope=value==='available'?'available':'all';void load(1);}},
          ...(content.sources?.length ? [{type:'select' as const,label:`${title} sources`,value:source,options:[{value:'all',label:'All sources'},...content.sources.map(item=>({value:item.id,label:item.name}))],change:(value:string)=>{source=value;void load(1);}}] : []),
        ] : []),
      ];
    },
    get empty() { return surface === 'play' && scope === 'available' ? 'No owned games match this selection. Turn off Available to browse all games.' : preview ? busy || !ready ? `Loading ${title.toLowerCase()}…` : preview.empty : ready ? 'No titles in this selection.' : 'Loading titles…'; },
    get emptyHref() { return preview && ready && !busy ? href() : undefined; },
    get emptyLink() { return `Browse ${surface==='listen'?'music':'games'}`; }, load,
  };
}
