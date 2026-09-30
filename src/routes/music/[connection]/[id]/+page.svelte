<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import MediaHero from '$lib/ui/components/MediaHero.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import RowHeader from '$lib/ui/components/RowHeader.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import DetailCard from '$lib/ui/components/DetailCard.svelte';
  import FactList from '$lib/ui/components/FactList.svelte';
  import ContentRow from '$lib/ui/components/ContentRow.svelte';
  import MediaCard from '$lib/ui/components/MediaCard.svelte';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  import {
    musicHero,
    musicCard,
    musicCredits,
    musicDuration,
    musicHref,
  } from '$lib/music/presentation';
  let { data } = $props();
  const item = $derived(data.item);
  const artists = $derived(item.kind === 'album' ? item.albumArtists : item.artists);
  const facts = $derived([
    ...(item.releaseDate
      ? [{ label: 'Released', value: item.releaseDate }]
      : item.year
        ? [{ label: 'Year', value: String(item.year) }]
        : []),
    ...(item.durationSeconds !== undefined
      ? [{ label: 'Duration', value: musicDuration(item.durationSeconds) }]
      : []),
    ...(item.discNumber !== undefined ? [{ label: 'Disc', value: String(item.discNumber) }] : []),
    ...(item.trackNumber !== undefined
      ? [{ label: 'Track', value: String(item.trackNumber) }]
      : []),
    ...(item.genres.length ? [{ label: 'Genres', value: item.genres.join(', ') }] : []),
  ]);
  function pageUrl(page: number) {
    return `${musicHref(data.connectionId, item.id)}?page=${page}`;
  }
</script>

<svelte:head><title>{item.title} · Music · Coast</title></svelte:head>
<MediaHero item={musicHero(item, data.connectionId)}>
  {#snippet actions()}<Button
      variant="ghost"
      href={`/music?connection=${data.connectionId}`}
      icon="left">Music</Button
    >{/snippet}
</MediaHero>
<div class="content" style="padding-bottom:90px">
  {#if artists.length || item.albumId}<div class="row" style="margin-bottom:22px">
      {#each artists as artist}<Button
          variant="ghost"
          href={musicHref(data.connectionId, artist.id)}>{artist.name}</Button
        >{/each}
      {#if item.albumId}<Button variant="ghost" href={musicHref(data.connectionId, item.albumId)}
          >{item.album || 'Album'}</Button
        >{/if}
    </div>{/if}
  {#if item.overview || facts.length}<ContentRow
      title="Overview"
      size="panel"
      artworkOptions={false}
    >
      {#if item.overview}<DetailCard title="About"><p>{item.overview}</p></DetailCard>{/if}
      {#if facts.length}<DetailCard title="Details"><FactList items={facts} /></DetailCard>{/if}
    </ContentRow>{/if}
  {#if item.kind !== 'track'}
    <section class="section" aria-label={item.kind === 'artist' ? 'Albums' : 'Tracks'}>
      <RowHeader title={item.kind === 'artist' ? 'Albums' : 'Tracks'} />
      {#if data.failure}
        <div class="notice error" role="alert">{data.failure}</div>
        <Button variant="secondary" icon="refresh" onclick={() => invalidateAll()}>Try again</Button
        >
      {:else if !data.children.items.length}
        <EmptyState
          title={item.kind === 'artist' ? 'No albums available' : 'No tracks available'}
          description="This Jellyfin account has no matching music here."
          icon="library"
        />
      {:else if item.kind === 'artist'}
        <div class="grid">
          {#each data.children.items as album (album.id)}<MediaCard
              item={musicCard(album, data.connectionId)}
              shape="square"
            />{/each}
        </div>
      {:else}
        <div class="overflow">
          <table class="table">
            <thead
              ><tr
                ><th scope="col">Disc</th><th scope="col">Track</th><th scope="col">Title</th><th
                  scope="col">Artist</th
                ><th scope="col">Duration</th></tr
              ></thead
            >
            <tbody
              >{#each data.children.items as track (track.id)}<tr>
                  <td>{track.discNumber ?? '—'}</td><td>{track.trackNumber ?? '—'}</td>
                  <td><a href={musicHref(data.connectionId, track.id)}>{track.title}</a></td>
                  <td>{musicCredits(track) || '—'}</td><td
                    >{musicDuration(track.durationSeconds) || '—'}</td
                  >
                </tr>{/each}</tbody
            >
          </table>
        </div>
      {/if}
      {#if !data.failure}<Pagination
          page={data.page}
          pages={data.pages}
          {pageUrl}
          label={item.kind === 'artist' ? 'Album pages' : 'Track pages'}
        />{/if}
    </section>
  {/if}
</div>
