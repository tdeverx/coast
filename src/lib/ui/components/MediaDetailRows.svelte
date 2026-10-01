<script lang="ts">
  import { page } from '$app/state';
  import { onDestroy, untrack } from 'svelte';
  import type { MediaView } from '$lib/ui/types';
  import type { CastMember } from '$lib/providers/contracts';
  import type { MediaInsights } from '$lib/media/details';
  import type { ProfilePeriod } from '$lib/profile/period';
  import { api } from '$lib/ui/client';
  import { createResource, uniqueItems } from '$lib/ui/resource.svelte';
  import { lazyContent } from '$lib/ui/lazy-content';
  import Shelf from './Shelf.svelte';
  import { lazyImage } from '$lib/ui/lazy-image';
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
  let failedPortraits = $state<string[]>([]);

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
        {#if selection === 'activity'}<RowFilter
            label="Activity period"
            bind:value={period}
            options={[
              { value: 'all', label: 'All time' },
              { value: 'month', label: 'Last 30 days' },
              { value: 'year', label: 'Last 365 days' },
            ]}
          />
        {:else if selection === 'community'}<RowFilter
            label="Community source"
            bind:value={communitySource}
            {options}
          />{/if}
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
                <Button variant="ghost" onclick={() => load(source)}>Try again</Button></DetailCard
              >{/if}{/each}{/if}
      {/snippet}
    </Shelf>
  {/if}
  {#if !section || section === 'reviews'}<Shelf
      layout={section ? 'grid' : 'row'}
      href={!section ? `/media/${item.id}?section=reviews&source=${reviewSource}` : undefined}
      title="Reviews"
      size="panel"
      preserveHeight
      busy={reviews.some((s) => busy[s])}
    >
      {#snippet controls()}<RowFilter
          label="Review source"
          bind:value={reviewSource}
          {options}
        />{/snippet}
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
              <Button variant="ghost" onclick={() => load(source, data[source]?.page ?? 1)}
                >Try again</Button
              ></DetailCard
            >{/if}
        {/each}
        {#if !reviews.some((s) => busy[s] || data[s]?.reviews.length || errors[s])}<p class="muted">
            No reviews are available for this selection.
          </p>{/if}
        {#if more.length}<div>
            <Button
              variant="ghost"
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
        {#each credits.people as person (person.id)}{@const roles = creditRoles(person.character)}<a
            href={`/people/${person.id}`}
            aria-label={`View ${person.name}`}
            class="credit-card"
          >
            <div
              class="portrait"
              style:aspect-ratio={style.shape === 'poster'
                ? '2 / 3'
                : style.shape === 'square'
                  ? '1'
                  : style.shape === 'banner'
                    ? '5.4'
                    : '16 / 9'}
            >
              {#if person.portrait && !failedPortraits.includes(person.portrait)}<img
                  use:lazyImage={person.portrait}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onerror={() => (failedPortraits = [...failedPortraits, person.portrait!])}
                />
              {:else}<span aria-hidden="true"
                  >{person.name
                    .split(' ')
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join('')}</span
                >{/if}
            </div>
            <h3>{person.name}</h3>
            {#if roles.names.length}<p title={roles.full}>
                {roles.preview}{#if roles.remaining}<span class="remaining">
                    {' · '}+{roles.remaining} {roles.remaining === 1 ? 'role' : 'roles'}</span
                  >{/if}{#if roles.voice}<span class="remaining">{' · '}Voice</span>{/if}
              </p>{/if}
          </a>{/each}
        {#if !credits.people.length && !busy.tmdb}<div class="row-empty">
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
  .credit-card {
    display: block;
    min-width: 0;
    scroll-snap-align: start;
  }
  .portrait {
    aspect-ratio: 2/3;
    border-radius: 12px;
    overflow: hidden;
    background: var(--surface);
    display: grid;
    place-items: center;
    color: var(--quiet);
    font-size: var(--text-2xl);
  }
  .credit-card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .credit-card h3 {
    font-size: var(--text-sm);
    margin-top: 12px;
    font-weight: var(--weight-semibold);
  }
  .credit-card p {
    font-size: var(--text-sm);
    color: var(--muted);
    margin-top: 4px;
    line-height: var(--leading-relaxed);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .remaining {
    color: var(--quiet);
  }
</style>
