<script lang="ts">
  import { page } from '$app/state';
  import { onDestroy, untrack } from 'svelte';
  import type { MediaView } from '$lib/ui/types';
  import type { CastMember } from '$lib/providers/contracts';
  import type { MediaInsights } from '$lib/media/details';
  import type { ProfilePeriod } from '$lib/profile/period';
  import { useClient } from '$lib/ui/client-context';
  import { createResource, uniqueItems } from '$lib/ui/resource.svelte';
  import { lazyContent } from '$lib/ui/lazy-content';
  import Shelf from './Shelf.svelte';
  import MediaCard from './MediaCard.svelte';
  import { creditRoles } from '$lib/media/credits';
  import { createCastSelection } from '$lib/ui/shelves/cast.svelte';
  import SegmentedControl from './SegmentedControl.svelte';
  import RowFilter from './RowFilter.svelte';
  import { mediaOverviewPanels } from '$lib/ui/insights/media';
  import MediaActivity from './MediaActivity.svelte';
  import { communityPanels } from '$lib/ui/insights/community';
  import DetailCard from './DetailCard.svelte';
  import FactList from './FactList.svelte';
  import Button from './Button.svelte';

  const { api } = useClient();

  let {
    item,
    members = [],
    seasons = [],
    cast = [],
    section,
  }: {
    section?: string | null;
    item: MediaView;
    members?: MediaView[];
    seasons?: MediaView[];
    cast?: CastMember[];
  } = $props();
  type Source = 'tmdb' | 'trakt';
  const sources: Source[] = ['tmdb', 'trakt'];
  const options = [
    { value: 'all', label: 'All' },
    { value: 'tmdb', label: 'TMDB' },
    { value: 'trakt', label: 'Trakt' },
  ];
  let selection = $state(
      untrack(() =>
        ['overview', 'activity', 'community'].includes(page.url.searchParams.get('insight') ?? '')
          ? page.url.searchParams.get('insight')!
          : 'overview'
      )
    ),
    communitySource = $state(untrack(() => page.url.searchParams.get('source') ?? 'all')),
    reviewSource = $state(untrack(() => page.url.searchParams.get('source') ?? 'all')),
    period = $state<ProfilePeriod>(
      untrack(() => {
        const value = page.url.searchParams.get('period');
        return value === 'month' || value === 'year' ? value : 'all';
      })
    );
  const resources = {
    tmdb: createResource<MediaInsights | null>(null),
    trakt: createResource<MediaInsights | null>(null),
  };
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
  async function load(source: Source, page = 1) {
    const path = `media/${item.id}/insights?source=${source}&page=${page}`;
    await resources[source].load(signal => api<MediaInsights | null>(path, undefined, 'GET', { signal }), {
      merge: (previous, next) => next && previous && page > 1
        ? { ...next, reviews: uniqueItems([...previous.reviews, ...next.reviews], review => review.id) }
        : next,
    });
  }
  onDestroy(() => sources.forEach(source => resources[source].cancel()));
  const credits = createCastSelection(() => ({
    people: cast,
    crew: data.tmdb?.crew ?? [],
    busy: busy.tmdb,
    layout: section ? 'grid' : 'row',
    href: !section ? `/media/${item.id}?section=credits` : undefined,
  }));

</script>

<div use:lazyContent={{ load: () => { sources.forEach(source => void load(source)); } }}>
  {#if !section || section === 'insights'}<Shelf
      title="Insights"
      size="panel"
      preserveHeight
      layout={section ? 'grid' : 'row'}
      href={!section
        ? `/media/${item.id}?section=insights&insight=${selection}&source=${communitySource}&period=${period}`
        : undefined}
    >
      {#snippet filters()}<SegmentedControl
          label="Insights selection"
          bind:value={selection}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'activity', label: 'Your activity' },
            { value: 'community', label: 'Community' },
          ]}
        />{/snippet}
      {#snippet controls()}
        {#if selection === 'activity'}<RowFilter groups={[{label:"Activity period", value:period, options:[
              { value: 'all', label: 'All time' },
              { value: 'month', label: 'Last 30 days' },
              { value: 'year', label: 'Last 365 days' },
            ], change:next=>{period=next as typeof period;}}]} />
        {:else if selection === 'community'}<RowFilter groups={[{label:"Community source", value:communitySource, options:options, change:next=>{communitySource=next;}}]} />{/if}
      {/snippet}
      {#snippet children()}
        {#if selection === 'overview'}
          {#each mediaOverviewPanels(item,members,seasons) as panel}<DetailCard {...panel} />{/each}
          {#if data.tmdb?.facts.length}<DetailCard title="About this title"
              ><FactList items={data.tmdb.facts} />{#snippet footer()}<a
                  href={data.tmdb!.url}
                  target="_blank"
                  rel="noreferrer">View on TMDB ↗</a
                >{/snippet}</DetailCard
            >{/if}
        {:else if selection === 'activity'}<MediaActivity mediaId={item.id} {period} />
        {:else}
          {#each community as source}{#if data[source]}{#each communityPanels(data[source]!) as panel}<DetailCard {...panel} />{/each}{/if}{/each}
          {#if !community.some((s) => busy[s] || data[s] || errors[s])}<p class="muted">
              No community statistics are available for this selection.
            </p>{/if}
        {/if}
        {#if selection !== 'activity'}{#each selection === 'overview' ? (['tmdb'] as Source[]) : community as source}{#if errors[source]}<DetailCard
                title={`${source === 'tmdb' ? 'TMDB' : 'Trakt'} unavailable`}
                ><p>{errors[source]}</p>
                <Button emphasis="subtle" onclick={() => load(source)}>Try again</Button></DetailCard
              >{/if}{/each}{/if}
      {/snippet}
    </Shelf>
  {/if}
  {#if !section || section === 'reviews'}<Shelf
      layout={section ? 'grid' : 'row'}
      href={!section ? `/media/${item.id}?section=reviews&source=${reviewSource}` : undefined}
      title="Reviews"
      itemCount={reviews.reduce((count,source)=>count+(data[source]?.reviews.length??0)+(errors[source]?1:0),0)}
      hideEmpty={reviewSource==='all'}
      size="panel"
      preserveHeight
      busy={reviews.some((s) => busy[s])}
    >
      {#snippet controls()}<RowFilter groups={[{label:"Review source", value:reviewSource, options:options, change:next=>{reviewSource=next;}}]} />{/snippet}
      {#snippet children()}
        {#each reviews as source}
          {#each data[source]?.reviews ?? [] as review (review.id)}
            <DetailCard
              title={review.author}
              description={[
                data[source]!.source,
                review.date?.slice(0, 10),
                review.rating === undefined ? '' : `${review.rating} / 10`,
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              <details class="review">
                <summary>{review.spoiler ? 'Reveal spoiler review' : 'Read review'}</summary>
                <p>{review.text}</p>
              </details>
              {#snippet footer()}<a href={review.url} target="_blank" rel="noreferrer"
                  >View on {data[source]!.source} ↗</a
                >{/snippet}
            </DetailCard>
          {/each}
          {#if errors[source]}<DetailCard title="Reviews unavailable"
              ><p>{errors[source]}</p>
              <Button emphasis="subtle" onclick={() => load(source, data[source]?.page ?? 1)}
                >Try again</Button
              ></DetailCard
            >{/if}
        {/each}
        {#if !reviews.some((s) => busy[s] || data[s]?.reviews.length || errors[s])}<p class="muted">
            No reviews are available for this selection.
          </p>{/if}
        {#if more.length}<div>
            <Button
              emphasis="subtle"
              disabled={reviews.some((s) => busy[s])}
              onclick={() => Promise.all(more.map((s) => load(s, data[s]!.page + 1)))}
              >Load more reviews</Button
            >
          </div>{/if}
      {/snippet}
    </Shelf>
  {/if}
  {#if !section || section === 'credits'}<Shelf
      title="Credits"
      itemCount={credits.people.length+(errors.tmdb?1:0)}
      hideEmpty={credits.selection==='cast' && !data.tmdb?.crew.length}
      size="circle"
      layout={section ? 'grid' : 'row'}
      href={credits.href}
      artworkOptions={false}
      preserveHeight
      busy={credits.busy}
    >
      {#snippet filters()}<SegmentedControl
          label="Credits selection"
          bind:value={credits.selection}
          options={[{ value: 'cast', label: 'Cast' }, { value: 'crew', label: 'Crew' }]}
        />{/snippet}
      {#snippet children(style)}
        {#each credits.people as person (person.id)}{@const roles = creditRoles(person.character)}
          <MediaCard item={{
            id: String(person.id), kind: 'person', title: person.name,
            href: `/people/${person.id}`, poster: person.portrait,
            captionSubtitle: roles.preview + (roles.remaining ? ` · +${roles.remaining} roles` : '') + (roles.voice ? ' · Voice' : ''),
          }} shape={style.shape} artworkStyle={style.artworkStyle} overlay={style.overlay} />
        {/each}
        {#if errors.tmdb}<div class="row-empty"><p role="alert">{errors.tmdb}</p><Button emphasis="subtle" onclick={()=>load('tmdb')}>Retry</Button></div>{/if}
        {#if !errors.tmdb && !credits.people.length && !busy.tmdb}<div class="row-empty">
            <p class="muted">No {credits.selection} credits are available for this title.</p>
          </div>{/if}
      {/snippet}
    </Shelf>{/if}
</div>

<style>
  .review summary {
    cursor: pointer;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }
  .review p {
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    white-space: pre-line;
    overflow-wrap: anywhere;
    max-height: 300px;
    overflow: auto;
    margin-top: 12px;
  }
</style>
