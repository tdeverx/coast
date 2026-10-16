<script lang="ts">
  import { providePreviewPlayback } from '$lib/playback/context.svelte';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Field from '$lib/ui/components/Field.svelte';
  import Rating from '$lib/ui/components/Rating.svelte';
  import Dialog from '$lib/ui/components/Dialog.svelte';
  import Icon from '$lib/ui/components/Icon.svelte';
  import DetailCard from '$lib/ui/components/DetailCard.svelte';
  import ProgressChart from '$lib/ui/components/ProgressChart.svelte';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import RowFeedback from '$lib/ui/components/RowFeedback.svelte';
  import ReadingLaunch from '$lib/reading/ReadingLaunch.svelte';
  import Reader from '$lib/reading/Reader.svelte';
  import { gameCard, gameHero, gameFacts, gameMinutes } from '$lib/games/presentation';
  import { readingCard, readingHero, readingFacts, type ReadingDisplay } from '$lib/reading/presentation';
  import { musicCard } from '$lib/music/presentation';
  import { createMusicPage } from '$lib/ui/pages/music.svelte';
  import { overviewPanels } from '$lib/ui/insights/overview';
  import type { MediaView, MediaCardPresentation, MediaCardShape } from '$lib/ui/types';
  import { movie, show, episode, music, track, id } from './demo/fixtures';

  let { name, scenario }: { name: string; scenario: string } = $props();
  providePreviewPlayback();
  const artwork = '/coast-mark.png';
  const season: MediaView = { ...show, id: '00000000-0000-4000-8000-000000000077', kind: 'season', title: 'Season one', seasonNumber: 1 };
  const game = { id: '00000000-0000-4000-8000-000000000078', title: 'Preview game', available: true, overview: 'A fictional game for inspecting the existing media presentation.', releaseDate: '2026-01-01', posterPath: artwork, backdropPath: artwork, platforms: ['PC'], genres: ['Adventure'], developers: ['Preview studio'], publishers: ['Preview publisher'] };
  const book: ReadingDisplay = { id: '00000000-0000-4000-8000-000000000079', kind: 'book', title: 'A different chapter', provider: 'openlibrary', externalId: 'OL123W', authors: ['Alex Example'], subjects: ['Fantasy'], sourceUrl: 'https://openlibrary.org/works/OL123W', coverUrl: artwork, overview: 'Fictional book metadata for inspecting the shared reading presentation.', publishedYear: 2026, pageCount: 320 };
  const comic: ReadingDisplay = { ...book, id: '00000000-0000-4000-8000-000000000080', kind: 'comic', title: 'Preview comic', provider: 'comic-vine', externalId: '4000-123', sourceUrl: 'https://comicvine.gamespot.com/', seriesTitle: 'Preview series', issueNumber: '3' };
  const person: MediaCardPresentation = { id: 'preview-person', kind: 'person', title: 'Alex Example', href: '/people/1', poster: artwork, captionSubtitle: 'Actor · Director' };
  const allCards: Record<string, MediaView | MediaCardPresentation> = {
    movie, show, season, episode, collection: { ...movie, id: '00000000-0000-4000-8000-000000000081', kind: 'collection', title: 'Preview collection' },
    game: gameCard(game), album: musicCard({ ...music, workId: id }, id), track: musicCard({ ...track, workId: track.id }, id),
    artist: musicCard({ ...music, kind: 'artist', workId: id, title: 'Preview artist' }, id),
    book: readingCard(book), comic: readingCard(comic), person,
  };
  const chosen = $derived(allCards[scenario] ?? movie);
  const shape = (kind: string): MediaCardShape => ['album', 'track', 'game'].includes(kind) ? 'square' : ['artist', 'person'].includes(kind) ? 'circle' : kind === 'episode' ? 'fanart' : 'poster';
  const rowItems = Object.values(allCards).slice(0, 8);
  let query = $state(''), searched = $state(false), number = $state(1), notice = $state(''), selected = $state(false), episodeWatched = $state(false), confirming = $state(false);
  const musicPage = createMusicPage(() => ({ item: { ...music, workId: id }, connectionId: id, children: { items: [track], total: 1, nextOffset: null }, failure: '', page: 1, pages: 1 }), () => new URL('https://preview.invalid/music/preview'));
  const detailKind = $derived(scenario === 'remote-reading' ? 'book' : scenario === 'game-remote' ? 'game' : scenario);
  const detailItem = $derived(detailKind === 'game' ? gameHero(game, scenario === 'game-remote' ? '/games/igdb/preview/123' : undefined, scenario !== 'game-remote') : detailKind === 'book' || detailKind === 'comic' ? readingHero(detailKind === 'comic' ? comic : book, scenario === 'remote-reading') : 'href' in (allCards[detailKind] ?? movie) ? undefined : allCards[detailKind] as MediaView ?? movie);
  const detailPanels = $derived(detailKind === 'game' ? overviewPanels(game.overview, gameFacts(game)) : detailKind === 'book' || detailKind === 'comic' ? overviewPanels(book.overview, readingFacts(detailKind === 'comic' ? comic : book)) : overviewPanels(movie.overview, [{ label: 'Released', value: '2026' }, { label: 'Duration', value: '1h 50m' }]));
</script>

<div class="catalogue-examples" onclickcapture={event => { if ((event.target as Element).closest('a')) event.preventDefault(); }} onsubmitcapture={event => event.preventDefault()}>
  {#if name === 'catalogue.cards'}
    {#if ['available', 'unavailable', 'missing-art', 'long-copy', 'broken-art'].includes(scenario)}
      <Shelf title="Media card states" hideEmpty={false} items={rowItems.map((item, index) => ({ ...item, id: `${item.id}-${index}`, available: scenario === 'available', ...(scenario === 'missing-art' ? { poster: null, backdrop: null } : {}), ...(scenario === 'broken-art' ? { poster: 'data:image/png;base64,AA==', backdrop: null } : {}), ...(scenario === 'long-copy' ? { title: 'A deliberately long title that wraps across the shared caption without hiding the actions', captionSubtitle: 'Long artist, author or collection information remains part of the existing card caption.' } : {}) }))} />
    {:else}
      <Shelf title={`${chosen.kind} presentation`} items={[chosen]} shape={shape(chosen.kind)} hideEmpty={false} />
    {/if}
  {:else if name === 'catalogue.rows'}
    <Shelf title="Related titles" href="/discover" items={scenario === 'loading' || scenario === 'empty' || scenario === 'error' ? [] : rowItems} busy={scenario === 'loading' || scenario === 'refresh'} hideEmpty={false} error={scenario === 'error' ? 'This preview source is temporarily unavailable.' : ''} retry={() => notice = 'Preview retry requested.'} />
    <RowFeedback message={notice} />
  {:else if name === 'catalogue.details'}
    <p class="small quiet">Composition reference using the production MediaPage, presentation adapters and Shelf. Commands are preview-only.</p>
    {#if scenario === 'music'}<MediaPage {...musicPage.page} />
    {:else}<MediaPage details item={detailItem}>
      {#snippet heroActions()}{#if (detailKind === 'book' || detailKind === 'comic') && scenario !== 'remote-reading'}<ReadingLaunch workId={detailKind === 'comic' ? comic.id : book.id} title={detailKind === 'comic' ? comic.title : book.title} />{/if}<Button size="hero" icon={scenario === 'remote-reading' || ['game','book','comic'].includes(detailKind) ? 'plus' : 'play'} onclick={() => notice = 'Preview action acknowledged.'}>{scenario === 'remote-reading' ? 'Add book' : detailKind === 'game' ? scenario === 'game-remote' ? 'Add game' : 'Start playthrough' : detailKind === 'book' || detailKind === 'comic' ? 'Update reading' : 'Play'}</Button>{/snippet}
      <RowFeedback message={notice} />
      {#if detailKind === 'show'}<Shelf title="Seasons" items={[season]} filterBy="watched" />
      {:else if detailKind === 'season'}<Shelf title="Episodes" items={[episode]} shape="fanart" artworkStyle="thumb" filterBy="watched">
        {#snippet details(item)}
          <div class="episode-details">
            {#if item.overview}<details><summary>Episode overview</summary><p>{item.overview}</p></details>{/if}
            <div class="episode-meta">
              {#if item.runtimeMinutes}<small>{item.runtimeMinutes} min</small>{/if}
              <Rating mediaId={item.id} value={item.rating} />
              <button class="icon-button" class:selected={episodeWatched} aria-pressed={episodeWatched} aria-label={`${episodeWatched ? 'Mark unwatched' : 'Mark watched'}: ${item.title}`} onclick={() => episodeWatched = !episodeWatched}><Icon name="check" /></button>
            </div>
          </div>
        {/snippet}
      </Shelf>
      {:else if detailKind === 'collection'}<Shelf title="In this collection" items={[movie, show]} filterBy="type" />{/if}
      <Shelf title="Overview" size="panel" artworkOptions={false} panels={detailPanels} />
      {#if ['book', 'comic', 'game'].includes(detailKind) && scenario !== 'remote-reading' && scenario !== 'game-remote'}
        <Shelf title="Progress" size="panel" artworkOptions={false}>
          <DetailCard title={detailKind === 'game' ? 'In progress' : 'Reading'}><ProgressChart label="Preview progress" items={[{ label: detailKind === 'game' ? 'Completion' : 'Pages', value: detailKind === 'game' ? 42 : 80, total: detailKind === 'game' ? 100 : 320 }]} /></DetailCard>
          <DetailCard title="At a glance" content={{ kind: 'metrics', props: { items: [{ label: detailKind === 'game' ? 'Time played' : 'Current page', value: detailKind === 'game' ? '12h 30m' : 80 }, { label: 'Started', value: '1 October 2026', text: true }] } }} />
        </Shelf>
      {/if}
    </MediaPage>{/if}
  {:else if name === 'reading.launch'}
    <p class="small quiet">The production edition chooser uses synthetic connections and files. File selection never opens an engine or uploads a file in this reference.</p>
    <ReadingLaunch workId={book.id} title={book.title} />
  {:else if name === 'reading.reader'}
    <Reader example={{ title: book.title, state: (scenario === 'loading' ? 'opening' : ['opening','error','unsaved','follower'].includes(scenario) ? scenario : 'ready') as 'ready'|'opening'|'error'|'unsaved'|'follower' }} />
  {:else if name === 'people.intro'}
    <section class="person-intro">
      {#if scenario !== 'missing-art'}<img class="portrait" src={artwork} alt="Alex Example" />{/if}
      <div class="bio"><Heading variant="page" title="Alex Example" description="Acting" />
        <dl><div><dt>Born</dt><dd>1980-04-12 · Preview city</dd></div></dl>
        <div><p>A fictional biography demonstrating the existing person-page composition.</p>{#if scenario === 'long-bio'}<details><summary>More about Alex Example</summary><p>{'Additional biography text follows the existing native disclosure. '.repeat(12)}</p></details>{/if}</div>
        <a class="small" href="https://www.themoviedb.org/person/1">View on TMDB ↗</a>
      </div>
    </section>
    <Shelf title="Known for" items={[movie, show]} />
  {:else if name === 'search.form'}
    <Heading variant="page" title="Search" />
    <form class="filter-row search-controls" onsubmit={() => searched = true}>
      <label class="search-input"><Icon name="search" /><input type="search" aria-label="Search your library and beyond" placeholder="Search your library and beyond" autocomplete="off" maxlength="200" bind:value={query} /></label>
      <Button type="submit" onclick={() => searched = true}>Search</Button>
    </form>
    {#if scenario === 'error'}<RowFeedback error="Global screen search is temporarily unavailable. Showing your local catalogue." tag="div" class="notice error" />{/if}
    {#if scenario === 'results' || searched}<Shelf title="Available" items={[{ ...movie, available: true }]} /><Shelf title="Unavailable" items={[readingCard(book), gameCard({ ...game, available: false })]} />
    {:else if scenario !== 'error'}<EmptyState title="Find your next story" description="Search movies, shows, music, games, books and comics in your library and beyond." icon="search" />{/if}
  {:else if name === 'catalogue.status'}
    {#if scenario === 'edition'}<section class="row edition-details" aria-label="Selected edition"><div><h2>Original edition</h2><p class="small">Preview Jellyfin</p></div><Button icon="play" onclick={() => notice = 'Preview playback requested.'}>Play this edition</Button><Button emphasis="subtle" href="/media/preview">All details</Button></section>
    {:else if scenario === 'missing-demand'}<section class="section"><Button emphasis="subtle" onclick={() => selected = !selected}>{selected ? 'Hide' : 'Show'} missing and uncertain items</Button>{#if selected}<ul><li><a href="/media/preview">Preview series · Season two</a> · No accessible source · Availability uncertain · Release date unknown</li></ul><Pagination page={1} pages={1} onchange={() => {}} label="Missing demand pages" />{/if}</section>
    {:else}<Shelf title="Your requests" items={[movie]} layout="grid" availability={false}>{#snippet details()}<div class="request-details stack"><span class="badge" class:available={scenario === 'available'}>{scenario === 'available' ? 'Available' : 'Pending approval'}</span><p class="small">Preview Seerr · 4K · Seasons 1, 2</p><p class="small">Requested 1 October 2026</p>{#if scenario !== 'available'}<Button danger onclick={() => notice = 'Preview cancellation acknowledged.'}>Cancel request</Button>{/if}</div>{/snippet}</Shelf>{/if}
    <RowFeedback message={notice} />
  {:else if name === 'catalogue.history'}
    {#if scenario === 'game-table'}<Heading title="Play history" /><div class="overflow"><table class="table"><thead><tr><th scope="col">Date</th><th scope="col">Time played</th><th scope="col">Note</th></tr></thead><tbody>{#each [30, 90, 125] as minutes, index}<tr><td>{index + 1} October 2026</td><td>{gameMinutes(minutes)}</td><td>{index ? '—' : 'A fictional play session.'}</td></tr>{/each}</tbody></table></div><Pagination page={number} pages={3} onchange={value => number = value} label="Play history pages" />
    {:else if scenario === 'selection'}<Heading title="Preview title · History" /><div class="stack"><p>Select the entries you want to remove.</p><div class="row"><Button emphasis="subtle" onclick={() => selected = true}>Select shown</Button><Button emphasis="subtle" onclick={() => selected = false}>Clear selection</Button><Button danger disabled={!selected} onclick={() => confirming = true}>Remove entry…</Button></div><Field label="Select preview watch"><input type="checkbox" bind:checked={selected} /></Field></div><Shelf title="1 October 2026" items={[episode]} shape="fanart" />
    {:else}<Shelf title="Reading history" size="panel" artworkOptions={false}><DetailCard title="Reading" description="1 October 2026, 18:00"><p class="small quiet">Page 80 of 320</p></DetailCard><DetailCard title="Planned" description="30 September 2026, 12:00"><p class="small quiet">Page 0 of 320</p></DetailCard></Shelf>{/if}
    <RowFeedback message={notice} />
    <Dialog bind:open={confirming} title="Remove from history?">
      <div class="stack">
        <p>Remove <strong>1 entry</strong> from <strong>{movie.title}</strong>?</p>
        <p>Your progress and stats will be recalculated from the history you keep. This cannot be undone. Matching Trakt history will be removed. Jellyfin’s watched status, play count and saved position will be updated to match the history you keep. Provider updates run as jobs; failures appear in Notifications.</p>
        <div class="row"><Button danger disabled={!selected} onclick={() => { confirming = false; selected = false; notice = 'Preview removal acknowledged. No history or connected service is changed.'; }}>Remove from history</Button><Button emphasis="subtle" onclick={() => confirming = false}>Keep entries</Button></div>
      </div>
    </Dialog>
  {/if}
</div>

<style>
  .catalogue-examples { min-width: 0; }
  .person-intro { display: flex; gap: 32px; align-items: start; margin: 24px 0 40px; }
  .portrait { width: clamp(110px, 18vw, 230px); aspect-ratio: 2/3; object-fit: cover; border-radius: 12px; }
  .bio { min-width: 0; max-width: 800px; display: grid; gap: 18px; }
  .bio :global(.page-heading) { margin: 0; }
  .bio p { white-space: pre-line; line-height: var(--leading-relaxed); font-size: var(--text-sm); margin-top: 16px; }
  .bio summary { cursor: pointer; }
  .bio dl { display: grid; gap: 12px; }
  .bio dt { font-size: var(--text-sm); color: var(--muted); }
  .bio dd { font-size: var(--text-sm); margin-top: 4px; }
  .search-controls { flex-wrap: wrap; }
  .search-input { display: flex; align-items: center; position: relative; flex: 1; min-width: min(100%, 200px); }
  .search-input :global(svg) { position: absolute; left: 14px; color: var(--muted); pointer-events: none; }
  .search-input input { width: 100%; padding-left: 42px; }
  .edition-details { padding: 24px 0; }
  .episode-details { display: grid; gap: 12px; margin-top: 8px; }
  .episode-details p { font-size: var(--text-sm); line-height: var(--leading-relaxed); }
  .episode-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
  .episode-meta small { color: var(--muted); }
  .episode-meta .icon-button { margin-left: auto; }
  .request-details { gap: 10px; margin-top: 14px; align-items: start; }
  .request-details p { overflow-wrap: anywhere; }
  @media (max-width: 600px) { .person-intro { gap: 20px; flex-wrap: wrap; } .portrait { width: 120px; } .bio { width: 100%; } }
</style>
