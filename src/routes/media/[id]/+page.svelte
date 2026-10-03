<script lang="ts">
  import MediaDetailRows from '$lib/ui/components/MediaDetailRows.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import {setContext} from 'svelte';
  import { page } from '$app/state';
  import { playMedia } from '$lib/playback/client.svelte';
  import { change, message } from '$lib/ui/client';
  import MediaActions from '$lib/ui/components/MediaActions.svelte';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import { createEpisodeTracking } from '$lib/ui/shelves/episodes.svelte';
  import Icon from '$lib/ui/components/Icon.svelte';
  import Rating from '$lib/ui/components/Rating.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Dialog from '$lib/ui/components/Dialog.svelte';
  let { data } = $props();
  setContext('profile-read-only',()=>!page.data.user);
  let enriched = $state<Awaited<typeof data.enhancement> | null>(null);
  const view = $derived(enriched ?? data);
  const section = $derived(page.url.searchParams.get('section'));
  const rowHref = (name: string) => `/media/${view.item.id}?section=${name}`;
  const selectedEdition = $derived(page.url.searchParams.get('edition'));
  const editionSources = $derived(
    selectedEdition === null
      ? []
      : view.availability.filter((source) => (source.edition ?? '') === selectedEdition)
  );
  $effect(() => {
    const pending = data.enhancement;
    enriched = null;
    let current = true;
    void pending.then((result) => {
      if (current) enriched = result;
    });
    return () => {
      current = false;
    };
  });
  const episodeTracking = createEpisodeTracking();
  let error = $state(''),
    episodesOpen = $state(false),
    seasonNumber = $state(1),
    episodeCount = $state(10);
</script>

<svelte:head><title>{view.item.title} · Coast</title></svelte:head><MediaPage details hero={!section} item={view.item} parents={view.parents} next={view.next} requestable={view.requestable} page={!!section}>
  {#if section}<Button emphasis="subtle" href={`/media/${view.item.id}`} icon="left"
      >{view.item.title}</Button
    >{/if}
  {#if selectedEdition !== null}<section class="row edition-details" aria-label="Selected edition">
      <div>
        <h2>{selectedEdition || 'Original'} edition</h2>
        <p class="small">
          {editionSources.length
            ? [...new Set(editionSources.map((source) => source.provider))].join(' · ')
            : 'This edition is no longer available.'}
        </p>
      </div>
      {#if editionSources.length}<Button
          icon="play"
          onclick={() =>
            playMedia(view.item.id, { edition: selectedEdition }).catch(
              (cause) => (error = message(cause))
            )}>Play this edition</Button
        >{/if}<Button emphasis="subtle" href={`/media/${view.item.id}`}>All details</Button>
    </section>{/if}
  {#if view.refreshUnavailable}<div class="notice" style="margin-bottom:24px">
      Metadata could not be refreshed. Showing the saved details.
    </div>{/if}
  {#if error}<div class="notice error" role="alert">{error}</div>{/if}
  <section class="episode-section">
    {#if view.item.kind === 'show' && (!section || section === 'seasons')}
      <Shelf
        title="Seasons"
        layout={section ? 'grid' : 'row'}
        href={!section ? rowHref('seasons') : undefined}
        filterBy="watched"
        items={view.seasons.flatMap((season) => (season.item ? [season.item] : []))}
      >
        {#snippet details(season)}{#if season.totalEpisodes}<p class="small">
              {season.totalEpisodes} episodes · {season.completedEpisodes ?? 0} watched
            </p>{/if}{/snippet}
      </Shelf>
      {#if !view.seasons.length}<EmptyState
          title="No seasons yet"
          description={view.item.tmdbId
            ? 'The season guide will appear when details are available.'
            : 'Add a season to start tracking episodes.'}
        />{/if}
      {#if !view.item.tmdbId}<Button
          emphasis="subtle"
          icon="plus"
          onclick={() => (episodesOpen = true)}>Add a season</Button
        >{/if}
    {:else if view.item.kind === 'season' && (!section || section === 'episodes')}
      {#if view.episodes.length}<Shelf
          title="Episodes"
          layout={section ? 'grid' : 'row'}
          href={!section ? rowHref('episodes') : undefined}
          items={view.episodes}
          filterBy="watched"
          shape="fanart"
          artworkStyle="thumb"
        >
          {#snippet details(episode)}
            <div class="episode-details">
              {#if episode.overview}<details>
                  <summary>Episode overview</summary>
                  <p>{episode.overview}</p>
                </details>{/if}
              <div class="episode-meta">
                {#if episode.runtimeMinutes}<small>{episode.runtimeMinutes} min</small>{/if}
                <Rating mediaId={episode.id} value={episode.rating} />
                <button
                  class="icon-button"
                  class:selected={episode.watched}
                  aria-pressed={episode.watched}
                  disabled={episodeTracking.busy}
                  aria-label={`${episode.watched ? 'Mark unwatched' : 'Mark watched'}: ${episode.title}`}
                  onclick={() => episodeTracking.watch(episode.id, episode.watched)}><Icon name="check" /></button
                >
              </div>
            </div>
          {/snippet}
          {#snippet empty()}<p class="muted">No episodes in this season yet.</p>{/snippet}
        </Shelf>
        {#if episodeTracking.error}<div class="notice error" role="alert">{episodeTracking.error}</div>{/if}
      {:else}<EmptyState
          title="No episodes yet"
          description="Episodes will appear when this season’s guide is available."
        />{/if}
    {/if}
  </section>
  {#if !section || ['insights', 'reviews', 'credits'].includes(section)}{#key `${view.item.id}:${section}`}<MediaDetailRows
        {section}
        item={view.item}
        cast={view.cast}
        seasons={view.seasons.flatMap((season) => (season.item ? [season.item] : []))}
        members={view.item.kind === 'season'
          ? view.episodes
          : view.item.kind === 'collection'
            ? view.members
            : []}
      />{/key}{/if}
  {#each view.collections.filter((c) => !section || section === c.id) as collection (collection.id)}
    <Shelf
      layout={section ? 'grid' : 'row'}
      href={!section ? rowHref(collection.id) : undefined}
      title={collection.title}
      items={collection.items}
      filterBy="type"
    >
      {#snippet actions()}<MediaActions item={collection.item} menuOnly showMenuTrigger />{/snippet}
    </Shelf>
  {/each}
  {#if !section || section === 'related'}<Shelf
      layout={section ? 'grid' : 'row'}
      href={!section ? rowHref('related') : undefined}
      filterBy="type"
      title={view.item.kind === 'collection' ? 'In this collection' : 'Related titles'}
      items={view.item.kind === 'collection'
        ? view.members
        : view.related.filter((item) => item.kind !== 'collection')}
    />{/if}
</MediaPage>
<Dialog bind:open={episodeTracking.confirm} title="Review episode change">
  <div class="stack">
    <p>{episodeTracking.warning}</p>
    <Button danger disabled={episodeTracking.busy} onclick={episodeTracking.approve}>
      Confirm change
    </Button>
  </div>
</Dialog>
<Dialog bind:open={episodesOpen} title="Add a season"
  ><form
    class="stack"
    onsubmit={async (e) => {
      e.preventDefault();
      try {
        await change(`media/${view.item.id}/episodes`, { seasonNumber, episodeCount });
        episodesOpen = false;
      } catch (e) {
        error = message(e);
      }
    }}
  >
    <label class="field"
      >Season number<input
        type="number"
        min="0"
        max="100"
        bind:value={seasonNumber}
        required
      /><small>Use 0 for specials.</small></label
    ><label class="field"
      >Episodes<input type="number" min="1" max="100" bind:value={episodeCount} required /></label
    ><Button type="submit">Add episodes</Button>
  </form></Dialog
>

<style>
  .edition-details {
    padding: 24px 0;
  }
  .episode-section {
    margin-top: 40px;
  }
  .episode-details {
    display: grid;
    gap: 12px;
    margin-top: 8px;
  }
  .episode-details p {
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
  }
  .episode-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }
  .episode-meta small {
    color: var(--muted);
  }
  .episode-meta .icon-button {
    margin-left: auto;
  }
</style>
