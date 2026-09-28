<script lang="ts">
  import { page } from '$app/state';
  import { onMount, untrack } from 'svelte';
  import type { MediaView } from '$lib/ui/types';
  import type { CastMember } from '$lib/providers/contracts';
  import type { MediaInsights } from '$lib/media/details';
  import type { ProfilePeriod } from '$lib/profile/period';
  import { api, message } from '$lib/ui/client';
  import ContentRow from './ContentRow.svelte';
  import SegmentedControl from './SegmentedControl.svelte';
  import RowFilter from './RowFilter.svelte';
  import MediaOverview from './MediaOverview.svelte';
  import MediaActivity from './MediaActivity.svelte';
  import CommunityInsights from './CommunityInsights.svelte';
  import CastShelf from './CastShelf.svelte';
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
  let root: HTMLDivElement;
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
  let data = $state<Record<Source, MediaInsights | null>>({ tmdb: null, trakt: null });
  let busy = $state<Record<Source, boolean>>({ tmdb: true, trakt: true });
  let errors = $state<Record<Source, string>>({ tmdb: '', trakt: '' });
  const requests = new Map<Source, AbortController>();
  const community = $derived(
    sources.filter((s) => communitySource === 'all' || s === communitySource)
  );
  const reviews = $derived(sources.filter((s) => reviewSource === 'all' || s === reviewSource));
  const more = $derived(reviews.filter((s) => data[s] && data[s]!.page < data[s]!.pages));
  async function load(source: Source, page = 1) {
    requests.get(source)?.abort();
    const request = new AbortController();
    requests.set(source, request);
    busy[source] = true;
    errors[source] = '';
    try {
      const result = await api<MediaInsights | null>(
        `media/${item.id}/insights?source=${source}&page=${page}`,
        undefined,
        'GET',
        { signal: request.signal }
      );
      if (request.signal.aborted) return;
      const previous = data[source];
      data[source] =
        result && previous && page > 1
          ? {
              ...result,
              reviews: [
                ...new Map([...previous.reviews, ...result.reviews].map((r) => [r.id, r])).values(),
              ],
            }
          : result;
    } catch (cause) {
      if (!request.signal.aborted) errors[source] = message(cause);
    } finally {
      if (!request.signal.aborted) busy[source] = false;
    }
  }
  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          sources.forEach((s) => void load(s));
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(root);
    return () => {
      observer.disconnect();
      requests.forEach((r) => r.abort());
    };
  });
</script>

<div bind:this={root}>
  {#if !section || section === 'insights'}<ContentRow
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
          <MediaOverview {item} {members} {seasons} />
          {#if data.tmdb?.facts.length}<DetailCard title="About this title"
              ><FactList items={data.tmdb.facts} />{#snippet footer()}<a
                  href={data.tmdb!.url}
                  target="_blank"
                  rel="noreferrer">View on TMDB ↗</a
                >{/snippet}</DetailCard
            >{/if}
        {:else if selection === 'activity'}<MediaActivity mediaId={item.id} {period} />
        {:else}
          {#each community as source}{#if data[source]}<CommunityInsights
                details={data[source]!}
              />{/if}{/each}
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
    </ContentRow>
  {/if}
  {#if !section || section === 'reviews'}<ContentRow
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
    </ContentRow>
  {/if}
  {#if !section || section === 'credits'}<CastShelf
      layout={section ? 'grid' : 'row'}
      href={!section ? `/media/${item.id}?section=credits` : undefined}
      people={cast}
      crew={data.tmdb?.crew ?? []}
      busy={busy.tmdb}
    />{/if}
</div>

<style>
  .review summary {
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
  }
  .review p {
    font-size: 12px;
    line-height: 1.7;
    white-space: pre-line;
    overflow-wrap: anywhere;
    max-height: 300px;
    overflow: auto;
    margin-top: 12px;
  }
</style>
