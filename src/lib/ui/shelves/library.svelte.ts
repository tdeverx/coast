import {
  createPageRetention,
  retainPageWindow,
  retainedInterval,
  type NativePage
} from '#lib/page-window.js';

import { useShelfLocation } from '#lib/ui/detail-section.svelte.js';
import { surfaceEnabled, categoryEnabled } from '#lib/experimental.js';
import { onDestroy, untrack } from 'svelte';
import { page as route, navigating } from '$app/state';
import { goto } from '$app/navigation';
import type { PresentationRow } from '#lib/server/queries/media-rows.js';
import { useClient } from '#lib/ui/client-context.js';
import { createResource } from '#lib/ui/resource.svelte.js';
import { contentRevisionKey } from '#lib/ui/content-revision.svelte.js';
import { ApiError } from '#lib/ui/client.js';
import {
  libraryBrowsePaths,librarySortOptions,libraryGenres,librarySegments,libraryEntityOptions,libraryCountTitle,
  type LibrarySort,type LibrarySegment,
  libraryTitles,
  librarySelections,
  type LibraryContent,
    type LibrarySurface,
} from '#lib/library.js';
import type { ShelfSource, ShelfControl } from './types';
import { readingTypeOptions } from '#lib/ui/filter-options.js';

export type LibrarySourceOptions = {
  title?:string;
  rows?:1|2;
  entitySegments?:boolean;
  countHeading?:boolean;
  kindControl?:boolean;
  segments?:boolean;
  initialSort?:LibrarySort;
  initialSegment?:LibrarySegment;
  surface: LibrarySurface;
    preview?: { title: string; personal?: boolean; empty: string; refreshKey?: unknown };
  initial?: LibraryContent;
  initialPage?: number;
  initialFirstPage?: number;
  genre?: string;
  layout?: 'row' | 'grid';
  initialSelection?: string;
  initialKind?: import('#lib/library.js').LibraryKind;
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
    genre = '', initialSort='default',initialSegment='all',
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

  let sort=$state<LibrarySort>(untrack(()=>initialSort));
  let segment=$state<LibrarySegment>(untrack(()=>initialSegment));
  let genreOverride=$state<string>();
  const selectedGenre=$derived(genreOverride??genre);
  let collection = $state(untrack(() => initialCollection));
  const title = $derived(getOptions().title ?? preview?.title ?? libraryTitles[surface]);
  const entities=$derived(libraryEntityOptions(surface,{...route.data,features:route.data.capabilities}));
  let selection = $state(untrack(() => initialSelection)),
    kind = $state(untrack(() => initialKind)),
    scope = $state<'all' | 'available'>(untrack(() => collection ? initialAvailability === 'available' ? 'available' : 'all' : initialScope));
  const entity=$derived(surface==='listen'?selection:kind);
  const container=$derived(entity==='playlist'||entity==='series');
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

  const selections = $derived(collection && surface === 'listen'
    ? librarySelections.listen.filter((option) => option.value !== 'artist')
    : librarySelections[surface]);

  const paths = (number = 1, firstPage?: number) => libraryBrowsePaths(
    {
      surface,
      collection,
      selection,
      kind,
      scope,
      genre:selectedGenre,sort,segment,
      relationship,
      source,
      availability,
      username,
      page: number,
      firstPage
    },
    preview
  );

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

  function holdWindow(
    previous: Content,
    next: Content,
    request: {
      number: number;
      append: boolean;
      prepend: boolean;
      revalidate: boolean
     }
  ) {
    const oldKeys = previous.items.map(itemKey),
      nextKeys = next.items.map(itemKey);

    if (retention.canRelease(oldKeys, nextKeys)) return false;

    const retained = new Set(nextKeys);

    blocked = {
      ...request,
      revision: retentionRevision,
      evicted: oldKeys.filter((key) => !retained.has(key))
    };

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

    const bounds = retainedInterval(content);
    const requested = number ?? (activated ? content.page : initialPage);

    const first = revalidate
      ? bounds.firstPage
      : !activated ? initialFirstPage : undefined;

    loadedSelection = selectionKey;

    const captured = paths(requested, preview ? undefined : first),
      owner = ownerKey,
      revision = refreshKey,
      initialItems = initial?.items,
      version = ++requestVersion;
    // Navigation can start before either the route URL or server props update.
    // An old grid read must not replace that navigation with its retained-page URL.
    const routeScope = `${route.url.pathname}${route.url.search}`;
    const current = () => version === requestVersion && owner === ownerKey && revision === refreshKey && initialItems === initial?.items && selectionKey === paths(1).api
      && (location.embedded || layout !== 'grid' || routeScope === `${route.url.pathname}${route.url.search}`
        && (!navigating.to || routeScope === `${navigating.to.url.pathname}${navigating.to.url.search}`));

    if (revalidate) needsRefresh = true;

    let direction: 'replace' | 'append' | 'prepend' = append ? 'append' : prepend ? 'prepend' : 'replace';

    const result = await resource.load(
      async (signal) => {
        function checkScope() {
          signal.throwIfAborted();

          if (!current()) {
            resource.cancel();
            signal.throwIfAborted();
          }
        }

        async function read(path: string): Promise<Content> {
          checkScope();

          const response = !preview
            ? await api<Content>(path, undefined, 'GET', { signal })
            : await api<PresentationRow>(path, undefined, 'GET', { signal }).then((row) => ({ ...row, page: 1, pages: 1, total: row.items.length }));

          checkScope();

          return response;
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
      },
      {
        failure: (result) => current() ? result.failure ?? '' : '',
        usable: (result) => current() && (!result.failure || result.items.length > 0),
        merge: (previous, result) => {
          const next = retainPageWindow<Item, Content>(previous, result, direction, itemKey);

          if ((append || prepend || revalidate) && holdWindow(previous, next, { number: requested, append, prepend, revalidate })) throw new Error(heldMessage);

          needsRefresh = false;

          if (direction === 'replace' && !revalidate) navigation++;

          return next;
        }
      }
    );

    if (result && current() && !location.embedded && !preview && !isolatedPreview && layout === 'grid') {
      const committed = retainedInterval(result);

      goto(paths(committed.lastPage, committed.firstPage).href, { shallow: true, replace: true, reset: false, state: route.state });
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
        if (next.failure) {
          needsRefresh = true;
          resource.error = next.failure;
          return;
        }

        const incoming = retainPageWindow<Item, Content>(content, next, 'replace', itemKey);

        if (holdWindow(content, incoming, {
          number: content.page,
          append: false,
          prepend: false,
          revalidate: true
        })) {
          needsRefresh = true;
          resource.error = heldMessage;

          return;
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
    get enrichSocial(){return !container;},
    get pagination() {
      return {
        kind: 'pages' as const,
        page: content.page,
        pages: content.pages,
        firstPage: retainedInterval(content).firstPage,
        append: true,
        infinite:layout==='grid',
        automatic:layout!=='grid',
        controls:'none' as const
      };
    },
    retain: retention.retain,
    retry: () => {
      if (resource.busy) return Promise.resolve();

      const pending = blocked;

      return pending
        ? load(pending.number, pending.append, pending.revalidate, pending.prepend)
        : load(undefined, false, true);
    },
    loadPrevious: () => load(retainedInterval(content).firstPage - 1, false, false, true),
    get location() {
      const bounds = retainedInterval(content);

      return preview
        ? undefined
        : paths(bounds.lastPage, bounds.firstPage).href;
    },

    get title() {
      return getOptions().countHeading?libraryCountTitle(ready&&!((busy||failure)&&!content.items.length)?content.total:null,surface,entity):title;
    },

    get items() {
      return content.items;
    },

    get busy() {
      return busy;
    },

    get ready() {
      return ready;
    },

    get error() {
      return failure;
    },

    get activated() {
      return resource.activated;
    },

    get href() {
      return layout === 'row' ? href() : undefined;
    },

    get shape() {
      return surface === 'listen' ? 'square' : 'poster';
    },

    get mediaKind() {
      return surface === 'listen'
        ? 'music'
        : surface === 'play' ? 'game' : surface === 'read' ? 'reading' : 'screen';
    },

    get rows() {
      return getOptions().rows ?? (preview ? 1 : 2);
    },

    get resetKey() {
      return preview
        ? `${selection}:${scope}`
        : `${sort}:${segment}:${selectedGenre}:${collection}:${selection}:${kind}:${scope}:${relationship}:${source}:${availability}:${navigation}`;
    },

    get filters(): ShelfControl[] {
      return [
        {
          type: 'segments' as const,
          label: `${title} selection`,
          value: getOptions().entitySegments?entity:getOptions().segments?segment:selection,
          options: getOptions().entitySegments?entities:getOptions().segments?librarySegments.filter(option=>surface!=='listen'||['all','later','favourites'].includes(option.value)):selections,
          change: (value: string) => {
            if(getOptions().entitySegments){if(surface==='listen'){selection=value;if(value==='artist'||value==='playlist')collection=false;}else kind=value as typeof kind;segment='all';genreOverride='';relationship='all';source='all';}
            else if(getOptions().segments){segment=value as LibrarySegment;selection=surface==='listen'?selection:'all';if(surface==='listen'&&selection==='artist'&&segment!=='all')selection='all';}
            else selection = value;
            void load(1);
          }
        },

        ...!preview&&entity!=='playlist'&&entity!=='artist'
          ? [
            {
              type: 'collection' as const,
              label: 'In my Collection only',
              value: collection ? 'collection' : 'all',
              change: (value: string) => {
                collection = value === 'collection';

                if (collection && selection === 'artist') selection = 'all';

                if (collection) availability = scope === 'available'
                  ? 'available'
                  : availability === 'available' ? 'all' : availability;

                void load(1);
              }
            }
          ]
          : [],

        ...(surface!=='watch'||collection ? [
          {
            type: 'availability' as const,
            label: `Available to ${surface==='read'?'read':surface==='watch'?'watch':surface==='listen'?'listen':'play'} only`,
            value: scope,
            change: (value: string) => {
              scope = value as typeof scope;

              if (collection) availability = value === 'available' ? 'available' : 'all';

              void load(1);
            }
          }
        ] : [])
      ];
    },

    get controls(): ShelfControl[] {
      return [
        ...getOptions().entitySegments&&!container&&entity!=='artist'?[{type:'select' as const,label:'Status',value:segment,options:librarySegments.filter(option=>surface!=='listen'||['all','later','favourites'].includes(option.value)).map(option=>({...option,label:surface==='read'&&option.value==='unwatched'?'Unread':surface==='play'&&option.value==='unwatched'?'Unplayed':option.label})),change:(value:string)=>{segment=value as LibrarySegment;void load(1);}}]:[],
        ...layout==='grid'&&!preview?[
          {type:'select' as const,label:'Sort by',value:sort,options:librarySortOptions,change:(value:string)=>{sort=value as LibrarySort;void load(1);}},
          ...surface==='watch'&&!collection&&kind!=='collection'?[{type:'select' as const,label:'Genre',value:selectedGenre,options:[{value:'',label:'All genres'},...[...new Set([...libraryGenres,...(selectedGenre?[selectedGenre]:[])])].sort().map(value=>({value,label:value}))],change:(value:string)=>{genreOverride=value;void load(1);}}]:[],
          ...surface==='listen'&&getOptions().segments&&!getOptions().entitySegments?[{type:'select' as const,label:'Music type',value:selection,options:selections.filter(option=>segment==='all'||option.value!=='artist'),change:(value:string)=>{selection=value;void load(1);}}]:[],
        ]:[],
        ...surface === 'watch'&&getOptions().kindControl!==false
          ? [
            {
              type: 'media-type' as const,
              label: 'Media type',
              value: kind,
              change: (value: string) => {
                kind = value as typeof kind;
                void load(1);
              }
            }
          ]
          : [],

        ...surface === 'read'&&getOptions().kindControl!==false
          ? [
            {
              type: 'select' as const,
              label: 'Reading type',
              value: kind,
              options: readingTypeOptions({ ...route.data, features: route.data.capabilities }),
              change: (value: string) => {
                kind = value as typeof kind;
                void load(1);
              }
            }
          ]
          : [],

        ...collection&&!container
          ? [
            {
              type: 'select' as const,
              label: 'Relationships',
              value: relationship,
              options: [
                { value: 'all', label: 'All relationships' },
                { value: 'collected', label: 'Collected' },
                { value: 'watchlist', label: 'Later' },
                { value: 'favourite', label: 'Favourites' },
                { value: 'rating', label: 'Rated' },
                { value: 'list', label: 'Lists' },
                ...surface !== 'read' ? [{ value: 'queue', label: 'Queued' }] : [],
                { value: 'activity', label: 'Activity' }
              ],

              change: (value: string) => {
                relationship = value;
                void load(1);
              }
            },

            {
              type: 'select' as const,
              label: 'Availability',
              value: availability,
              options: [
                { value: 'all', label: 'All availability' },
                { value: 'available', label: 'Available' },
                ...surface !== 'read'
                  ? [
                    { value: 'partial', label: 'Partial' },
                    { value: 'unavailable', label: 'Missing' }
                  ]
                  : [],
                { value: 'unknown', label: 'Unknown' },
                { value: 'ready', label: 'Ready to continue' }
              ],

              change: (value: string) => {
                availability = value;
                scope = value === 'available' ? 'available' : 'all';
                void load(1);
              }
            },

            ...content.sources?.length
              ? [
                {
                  type: 'select' as const,
                  label: 'Sources',
                  value: source,
                  options: [
                    { value: 'all', label: 'All sources' },
                    ...content.sources.map((item) => ({ value: item.id, label: item.name }))
                  ],

                  change: (value: string) => {
                    source = value;
                    void load(1);
                  }
                }
              ]
              : []
          ]
          : []
      ];
    },
    get empty() { return surface === 'play' && scope === 'available' ? 'No owned games match this selection. Turn off Available to browse all games.' : preview ? busy || !ready ? `Loading ${title.toLowerCase()}…` : preview.empty : ready ? 'No titles in this selection.' : 'Loading titles…'; },
    get emptyHref() { return preview && ready && !busy ? href() : undefined; },
    get emptyLink() { return `Browse ${surface==='listen'?'music':'games'}`; }, load,
  };
}
