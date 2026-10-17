<script lang="ts">
  import { page } from '$app/state';
  import { onDestroy, untrack,type Snippet } from 'svelte';
  import type { MediaView } from '$lib/ui/types';
  import type { CastMember } from '$lib/providers/contracts';
  import type { MediaInsights } from '$lib/media/details';
  import type { ProfilePeriod } from '$lib/profile/period';
  import { useClient } from '$lib/ui/client-context';
  import { createResource, uniqueItems } from '$lib/ui/resource.svelte';
  import { creditRoles } from '$lib/media/credits';
  import { createCastSelection } from '$lib/ui/shelves/cast.svelte';
  import { mediaOverviewPanels } from '$lib/ui/insights/media';
  import MediaActivity from '$lib/ui/components/MediaActivity.svelte';
  import { communityPanels } from '$lib/ui/insights/community';

  import type {DetailRowsModel,DetailFailure} from '$lib/ui/pages/detail-rows';
  import type {MediaCardPresentation} from '$lib/ui/types';
  const { api } = useClient();

  let {
    item,
    members = [],
    seasons = [],
    cast = [],
    section,detailHref,children,
  }: {
    section?: string | null;detailHref?:string;children:Snippet<[DetailRowsModel]>;
    item: MediaView;
    members?: MediaView[];
    seasons?: MediaView[];
    cast?: CastMember[];
  } = $props();
  const detailUrl=$derived(detailHref?new URL(detailHref,page.url):page.url);
  type Source = 'tmdb' | 'trakt';
  const sources: Source[] = ['tmdb', 'trakt'];
  const options = [
    { value: 'all', label: 'All' },
    { value: 'tmdb', label: 'TMDB' },
    { value: 'trakt', label: 'Trakt' },
  ];
  let selection = $state(
      untrack(() =>
        ['overview', 'activity', 'community'].includes(detailUrl.searchParams.get('insight') ?? '')
          ? detailUrl.searchParams.get('insight')!
          : 'overview'
      )
    ),
    communitySource = $state(untrack(() => detailUrl.searchParams.get('source') ?? 'all')),
    reviewSource = $state(untrack(() => detailUrl.searchParams.get('source') ?? 'all')),
    period = $state<ProfilePeriod>(
      untrack(() => {
        const value = detailUrl.searchParams.get('period');
        return value === 'month' || value === 'year' ? value : 'all';
      })
    );
  const createResources = () => ({
    tmdb: createResource<MediaInsights | null>(null),
    trakt: createResource<MediaInsights | null>(null),
  });
  let resources = $state.raw(createResources());
  let insightsActive = $state(false), reviewsActive = $state(false), creditsActive = $state(false);
  const contextKey = $derived(JSON.stringify([item.id, page.data.user?.id ?? '']));
  let previousContext = untrack(() => contextKey);
  $effect(() => {
    const key = contextKey;
    untrack(() => {
      if (key === previousContext) return;
      previousContext = key;
      sources.forEach(source => resources[source].dispose());
      resources = createResources();
    });
  });
  const data = $derived({ tmdb: resources.tmdb.data, trakt: resources.trakt.data });
  const busy = $derived({
    tmdb: resources.tmdb.busy || (!resources.tmdb.ready && !resources.tmdb.error),
    trakt: resources.trakt.busy || (!resources.trakt.ready && !resources.trakt.error),
  });
  const errors = $derived({ tmdb: resources.tmdb.error, trakt: resources.trakt.error });
  const community = $derived(
    sources.filter((s) => communitySource === 'all' || s === communitySource)
  );
  const reviews = $derived(sources.filter((s) => reviewSource === 'all' || s === reviewSource));
  const more = $derived(reviews.filter((s) => data[s] && data[s]!.page < data[s]!.pages));
  const neededSources = $derived.by(() => {
    const needed = new Set<Source>();
    if ((!section || section === 'insights') && insightsActive) {
      if (selection === 'overview') needed.add('tmdb');
      else if (selection === 'community') community.forEach(source => needed.add(source));
    }
    if ((!section || section === 'reviews') && reviewsActive) reviews.forEach(source => needed.add(source));
    // TMDB owns crew even when the cast was already hydrated with the page.
    if ((!section || section === 'credits') && creditsActive) needed.add('tmdb');
    return [...needed];
  });
  $effect(() => {
    const needed = neededSources, current = resources;
    untrack(() => sources.forEach(source => {
      const resource = current[source];
      if (!needed.includes(source)) resource.cancel();
      else if (!resource.ready && !resource.busy && !resource.error) void load(source);
    }));
  });
  async function load(source: Source, page = 1) {
    const path = `media/${item.id}/insights?source=${source}&page=${page}`;
    await resources[source].load(signal => api<MediaInsights | null>(path, undefined, 'GET', { signal }), {
      merge: (previous, next) => next && previous && page > 1
        ? { ...next, reviews: uniqueItems([...previous.reviews, ...next.reviews], review => review.id) }
        : next,
    });
  }
  onDestroy(() => sources.forEach(source => resources[source].dispose()));
  const credits = createCastSelection(() => ({
    url:detailUrl,people: cast,
    crew: data.tmdb?.crew ?? [],
    busy: busy.tmdb,
    layout: section ? 'grid' : 'row',
    href: !section ? `/media/${item.id}?section=credits` : undefined,
  }));


  const people=(entries:CastMember[]):MediaCardPresentation[]=>entries.map(person=>{const roles=creditRoles(person.character);return {
    id:String(person.id),kind:'person',title:person.name,href:`/people/${person.id}`,poster:person.portrait,
    captionSubtitle:roles.preview+(roles.remaining?` · +${roles.remaining} roles`:'')+(roles.voice?' · Voice':''),
  };});
  const failures=(selected:Source[]):DetailFailure[]=>selected.flatMap(source=>errors[source]?[{title:`${source==='tmdb'?'TMDB':'Trakt'} unavailable`,message:errors[source],retry:()=>load(source)}]:[]);
  const model=$derived<DetailRowsModel>({
    insights:{selection,select:value=>selection=value,activate:()=>insightsActive=true,
      href:`/media/${item.id}?section=insights&insight=${selection}&source=${communitySource}&period=${period}`,
      tabs:[
        {value:'overview',label:'Overview',panels:[...mediaOverviewPanels(item,members,seasons),...(data.tmdb?.facts.length?[{title:'About this title',content:{kind:'facts' as const,props:{items:data.tmdb.facts}},footerLink:{href:data.tmdb.url,label:'View on TMDB ↗',external:true}}]:[])],errors:failures(['tmdb'])},
        {value:'activity',label:'Your activity',content:activity,filters:[{label:'Activity period',value:period,options:[{value:'all',label:'All time'},{value:'month',label:'Last 30 days'},{value:'year',label:'Last 365 days'}],change:value=>period=value as ProfilePeriod}]},
        {value:'community',label:'Community',panels:community.flatMap(source=>data[source]?communityPanels(data[source]!):[]),busy:community.some(source=>busy[source]),errors:failures(community),filters:[{label:'Community source',value:communitySource,options,change:value=>communitySource=value}]},
      ]},
    credits:{selection:credits.selection,select:value=>credits.selection=value,href:credits.href,activate:()=>creditsActive=true,hideEmpty:credits.selection==='cast'&&!data.tmdb?.crew.length,errors:failures(['tmdb']),groups:[
      {value:'cast',label:'Cast',people:people(cast)},{value:'crew',label:'Crew',people:people(data.tmdb?.crew??[]),busy:busy.tmdb},
    ]},
    reviews:{selection:reviewSource,select:value=>reviewSource=value,options,activate:()=>reviewsActive=true,href:`/media/${item.id}?section=reviews&source=${reviewSource}`,
      items:reviews.flatMap(source=>(data[source]?.reviews??[]).map(review=>({...review,source:data[source]!.source}))),busy:reviews.some(source=>busy[source]),errors:failures(reviews),
      more:more.length?()=>Promise.all(more.map(source=>load(source,data[source]!.page+1))):undefined},
  });
</script>
{#snippet activity()}<MediaActivity mediaId={item.id} {period} />{/snippet}
{@render children(model)}
