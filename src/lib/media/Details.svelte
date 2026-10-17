<script lang="ts">
  import MediaDetailRows from './DetailRows.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import {setContext,onDestroy,untrack} from 'svelte';
  import { page } from '$app/state';
  import { playMedia } from '$lib/playback/client.svelte';
  import { change, message } from '$lib/ui/client';
  import WorkMenu from '$lib/ui/components/WorkMenu.svelte';
  import MediaDetails from '$lib/ui/components/MediaDetails.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import { createEpisodeTracking } from '$lib/ui/shelves/episodes.svelte';
  import Rating from '$lib/ui/components/Rating.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Dialog from '$lib/ui/components/Dialog.svelte';
  import {useClient,reportFailure} from '$lib/ui/client-context';
  import type {MediaView} from '$lib/ui/types';
  import {createResource} from '$lib/ui/resource.svelte';
  let { data,modal=false,editionName,detailHref }: {data:Awaited<ReturnType<typeof import('$lib/application/media-details.server').loadMediaDetails>>;modal?:boolean;editionName?:string;detailHref?:string} = $props();
  const detailUrl=$derived(modal?new URL(detailHref??`/media/${data.item.id}`,page.url):page.url);
  setContext('profile-read-only',()=>!page.data.user);
  let enriched = $state<Awaited<typeof data.enhancement> | null>(null);
  const view = $derived(enriched ?? data);
  const client=useClient();
  const edition=createResource<MediaView|null>(null);
  const item=$derived(edition.data??view.item);
  reportFailure(()=>edition.error);
  onDestroy(edition.dispose);
  $effect(()=>{
    const id=view.item.id,cut=editionName;
    untrack(()=>{
      edition.replace(null);
      if(cut!==undefined&&!client.preview)void edition.load(signal=>client.api<MediaView>(`media/${id}/edition?name=${encodeURIComponent(cut)}`,undefined,'GET',{signal}));
    });
    return edition.cancel;
  });
  const section = $derived(detailUrl.searchParams.get('section'));
  const rowHref = (name: string) => `/media/${view.item.id}?section=${name}`;
  const selectedEdition = $derived(modal?null:detailUrl.searchParams.get('edition'));
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

<svelte:head><title>{item.title} · Coast</title></svelte:head><MediaDetailRows detailHref={modal?detailUrl.href:undefined} {section} {item} cast={view.cast}
 seasons={view.seasons.flatMap(season=>season.item?[season.item]:[])}
 members={view.item.kind==='season'?view.episodes:view.item.kind==='collection'?view.members:[]}>
 {#snippet children(model)}
<MediaDetails {detailHref} {model} {section} view={{hero:!section,item,parents:view.parents,next:view.next,requestable:view.requestable,page:!!section,editionName}}>
  {#if section&&!modal}<Button emphasis="subtle" href={`/media/${view.item.id}`} icon="left"
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
  {#snippet hierarchy()}
  <section class="episode-section">
    {#if view.item.kind === 'show' && (!section || section === 'seasons')}
      <Shelf url={detailUrl}
        title="Seasons"
        layout={section ? 'grid' : 'row'}
        href={!section ? rowHref('seasons') : undefined}
        filterBy="watched"
        items={view.seasons.flatMap((season) => (season.item ? [season.item] : []))}
      >
        {#snippet details(season)}{#if 'totalEpisodes' in season && season.totalEpisodes}<p class="small">
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
      {#if view.episodes.length}<Shelf url={detailUrl}
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
                <Button size="icon" icon="check" iconSize={20} class={episode.watched?'selected':''} pressed={episode.watched} disabled={episodeTracking.busy} label={`${episode.watched ? 'Mark unwatched' : 'Mark watched'}: ${episode.title}`} onclick={() => episodeTracking.watch(episode.id, episode.watched)} />
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
  {/snippet}
  {#each view.collections.filter((c) => !section || section === c.id) as collection (collection.id)}
    <Shelf url={detailUrl}
      layout={section ? 'grid' : 'row'}
      href={!section ? rowHref(collection.id) : undefined}
      title={collection.title}
      items={collection.items}
      filterBy="type"
    >
      {#snippet actions()}<WorkMenu item={collection.item} menuOnly showTrigger />{/snippet}
    </Shelf>
  {/each}
  {#if !section || section === 'related'}<Shelf url={detailUrl}
      layout={section ? 'grid' : 'row'}
      href={!section ? rowHref('related') : undefined}
      filterBy="type"
      title={view.item.kind === 'collection' ? 'In this collection' : 'Related titles'}
      items={view.item.kind === 'collection'
        ? view.members
        : view.related.filter((item) => item.kind !== 'collection')}
    />{/if}
</MediaDetails>
 {/snippet}
</MediaDetailRows>
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
  .episode-meta :global(.icon-button) {
    margin-left: auto;
  }
</style>
