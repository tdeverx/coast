<script lang="ts">
  import {useClient} from '$lib/ui/client-context';
  const delivery=useClient().feedback;
  import { providePreviewPlayback } from '$lib/playback/context.svelte';
  import MediaDetails from '$lib/ui/components/MediaDetails.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Field from '$lib/ui/components/Field.svelte';
  import Dialog from '$lib/ui/components/Dialog.svelte';
  import Icon from '$lib/ui/components/Icon.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Toast from '$lib/ui/components/Toast.svelte';
  import ReadingLaunch from '$lib/reading/ReadingLaunch.svelte';
  import ReadingDetails from '$lib/reading/Details.svelte';
  import GroupDetails from '$lib/reading/GroupDetails.svelte';
  import MusicDetails from '$lib/music/Details.svelte';
  import GameDetails from '$lib/games/Details.svelte';
  import RemoteGameDetails from '$lib/games/RemoteDetails.svelte';
  import Reader from '$lib/reading/Reader.svelte';
  import PersonDetails from '$lib/media/PersonDetails.svelte';
  import { gameCard } from '$lib/games/presentation';
  import { readingCard, type ReadingDisplay } from '$lib/reading/presentation';
  import { musicCard } from '$lib/music/presentation';
  import { overviewPanels } from '$lib/ui/insights/overview';
  import type { MediaView, MediaCardPresentation, MediaCardShape } from '$lib/ui/types';
  import { movie, show, episode, music, track, id } from './demo/fixtures';

  let { name, scenario }: { name: string; scenario: string } = $props();
  providePreviewPlayback();
  const artwork = '/coast-mark.png';
  const season: MediaView = { ...show, id: '00000000-0000-4000-8000-000000000077', kind: 'season', title: 'Season one', seasonNumber: 1 };
  const game = { id: '00000000-0000-4000-8000-000000000078', title: 'Preview game', available: true, overview: 'A fictional game for inspecting the existing media presentation.', releaseDate: '2026-01-01', posterPath: artwork, backdropPath: artwork, platforms: ['PC'], genres: ['Adventure'], developers: ['Preview studio'], publishers: ['Preview publisher'] };
  const gameSession={id,gameId:game.id,platform:'PC',status:'in-progress' as const,progressPercent:40,repeat:false,startedAt:new Date('2026-10-01'),completedAt:null,createdAt:new Date('2026-10-01'),updatedAt:new Date('2026-10-01'),minutesPlayed:245,total:3};
  const gameData={item:{...game,category:'game' as const,identities:[],steam:[],playthroughs:[gameSession],createdAt:new Date('2026-01-01'),updatedAt:new Date('2026-01-01')},playthrough:gameSession,sources:[]};
  const book: ReadingDisplay = { id: '00000000-0000-4000-8000-000000000079', kind: 'book', title: 'A different chapter', provider: 'openlibrary', externalId: 'OL123W', authors: ['Alex Example'], subjects: ['Fantasy'], sourceUrl: 'https://openlibrary.org/works/OL123W', coverUrl: artwork, overview: 'Fictional book metadata for inspecting the shared reading presentation.', publishedYear: 2026, pageCount: 320 };
  const comic: ReadingDisplay = { ...book, id: '00000000-0000-4000-8000-000000000080', kind: 'comic', title: 'Preview comic', provider: 'comic-vine', externalId: '4000-123', sourceUrl: 'https://comicvine.gamespot.com/', seriesTitle: 'Preview series', issueNumber: '3' };
  const person: MediaCardPresentation = { id: 'preview-person', kind: 'person', title: 'Alex Example', href: '/people/1', poster: artwork, captionSubtitle: 'Actor · Director' };
  const allCards: Record<string, MediaView | MediaCardPresentation> = {
    movie, show, season, episode, collection: { ...movie, id: '00000000-0000-4000-8000-000000000081', kind: 'collection', title: 'Preview collection' },
    game: gameCard(game), album: musicCard({ ...music, workId: id }, id), track: musicCard({ ...track, workId: track.id }, id),
    artist: musicCard({ ...music, kind: 'artist', workId: undefined, title: 'Preview artist' }, id),
    book: readingCard(book), comic: readingCard(comic), person,
  };
  const chosen = $derived(allCards[scenario] ?? movie);
  const shape = (kind: string): MediaCardShape => ['album', 'track', 'game'].includes(kind) ? 'square' : ['artist', 'person'].includes(kind) ? 'circle' : kind === 'episode' ? 'fanart' : 'poster';
  const rowItems = Object.values(allCards).slice(0, 8);
  let query = $state(''), searched = $state(false), selected = $state(false), episodeWatched = $state(false), confirming = $state(false);
  const detailKind = $derived(scenario);
  const detailItem = $derived(allCards[scenario]??movie);
  const detailPanels = overviewPanels(movie.overview,[{label:'Released',value:'2026'},{label:'Duration',value:'1h 50m'}]);
</script>

<div class="catalogue-examples" onclickcapture={event => { if ((event.target as Element).closest('a')) event.preventDefault(); }} onsubmitcapture={event => event.preventDefault()}>
  {#if name === 'catalogue.cards'}
    {#if ['available', 'unavailable', 'missing-art', 'long-copy', 'broken-art'].includes(scenario)}
      <Shelf title="Media card states" hideEmpty={false} items={rowItems.map((item, index) => ({ ...item, id: `${item.id}-${index}`, available: scenario === 'available', ...(scenario === 'missing-art' ? { poster: null, backdrop: null } : {}), ...(scenario === 'broken-art' ? { poster: 'data:image/png;base64,AA==', backdrop: null } : {}), ...(scenario === 'long-copy' ? { title: 'A deliberately long title that wraps across the shared caption without hiding the actions', captionSubtitle: 'Long artist, author or collection information remains part of the existing card caption.' } : {}) }))} />
    {:else}
      <Shelf title={`${chosen.kind} presentation`} items={[chosen]} shape={shape(chosen.kind)} hideEmpty={false} />
    {/if}
  {:else if name === 'catalogue.rows'}
    <Shelf title="Related titles" href="/discover" items={scenario === 'loading' || scenario === 'empty' || scenario === 'error' ? [] : rowItems} busy={scenario === 'loading' || scenario === 'refresh'} hideEmpty={false} error={scenario === 'error' ? 'This preview source is temporarily unavailable.' : ''} retry={() => delivery.notify('Preview retry requested.')} />

  {:else if name === 'catalogue.details'}
    <p class="small quiet">Composition reference using the production MediaDetails, presentation adapters and Shelf. Commands are preview-only.</p>
    {#if scenario === 'music'}<MusicDetails data={{item:{...music,workId:id},connectionId:id,children:{items:[],total:0,nextOffset:null},failure:'',page:1,pages:1}} />
    {:else if scenario==='reading-collection'}<GroupDetails data={{group:{id,title:'Preview comic volume'},cover:artwork,statistics:{issues:12,reading:2,completed:5,available:8}}} />
    {:else if ['book','comic','remote-reading'].includes(scenario)}<ReadingDetails data={{item:scenario==='comic'?comic:book,kind:scenario==='comic'?'comic':'book',remote:scenario==='remote-reading',progress:null,relationships:{favourite:false,watchlist:false,collected:false},rating:null}} />
    {:else if scenario==='game'}<GameDetails data={{item:{...game,category:'game',identities:[],steam:[],playthroughs:[],createdAt:new Date('2026-01-01'),updatedAt:new Date('2026-01-01')},playthrough:null,sources:[]}} />
    {:else if scenario==='game-remote'}<RemoteGameDetails data={{item:{...game,externalId:'123'},instanceId:id}} />
    {:else}<MediaDetails view={{item:detailItem}} model={{insights:{selection:'overview',tabs:[{value:'overview',label:'Overview',panels:detailPanels}]}}}>
      {#snippet heroActions()}<Button size="hero" icon="play" onclick={()=>delivery.notify('Preview action acknowledged.')}>Play</Button>{/snippet}

      {#if detailKind === 'show'}<Shelf title="Seasons" items={[season]} filterBy="watched" />
      {:else if detailKind === 'season'}<Shelf title="Episodes" items={[episode]} shape="fanart" artworkStyle="thumb" filterBy="watched">
        {#snippet captionAction(item)}<Button size="icon" icon="check" iconSize={20} class={episodeWatched?'selected':''} pressed={episodeWatched} label={`${episodeWatched ? 'Mark unwatched' : 'Mark watched'}: ${item.title}`} onclick={() => episodeWatched = !episodeWatched} />{/snippet}
        {#snippet body(item)}{#if item.overview}<p>{item.overview}</p>{/if}{/snippet}
        {#snippet footer(item)}
          {#if item.runtimeMinutes}<span>{item.runtimeMinutes} min</span>{/if}{#if item.releaseDate}<time datetime={item.releaseDate}>{new Date(item.releaseDate).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'})}</time>{/if}
        {/snippet}
      </Shelf>
      {:else if detailKind === 'collection'}<Shelf title="In this collection" items={[movie, show]} filterBy="type" />{/if}

    </MediaDetails>{/if}
  {:else if name === 'reading.launch'}
    <p class="small quiet">Read opens an available linked file directly. This reference disables the action and never opens a file or session.</p>
    <ReadingLaunch workId={book.id} />
  {:else if name === 'reading.reader'}
    <Reader example={{ title: book.title, state: (scenario === 'loading' ? 'opening' : ['opening','error','unsaved','follower'].includes(scenario) ? scenario : 'ready') as 'ready'|'opening'|'error'|'unsaved'|'follower' }} />
  {:else if name === 'people.intro'}
    <PersonDetails data={{person:{id:1,name:'Alex Example',department:'Acting',birthday:'1980-04-12',birthplace:'Preview city',portrait:scenario==='missing-art'?undefined:artwork,biography:scenario==='long-bio'?'A fictional biography.\n\n'+'Additional biography text follows the existing native disclosure. '.repeat(12):'A fictional biography demonstrating the existing person-page composition.'}}}/>
  {:else if name === 'search.form'}
    <Heading variant="page" title="Search" />
    <form class="filter-row search-controls" onsubmit={() => searched = true}>
      <label class="search-input"><Icon name="search" /><input type="search" aria-label="Search your library and beyond" placeholder="Search your library and beyond" autocomplete="off" maxlength="200" bind:value={query} /></label>
      <Button type="submit" onclick={() => searched = true}>Search</Button>
    </form>
    {#if scenario === 'error'}<Toast kind="error" text={'Global screen search is temporarily unavailable. Showing your local catalogue.'} />{/if}
    {#if scenario === 'results' || searched}<Shelf title="Available" items={[{ ...movie, available: true }]} /><Shelf title="Unavailable" items={[readingCard(book), gameCard({ ...game, available: false })]} />
    {:else if scenario !== 'error'}<EmptyState title="Find your next story" description="Search movies, shows, music, games, books and comics in your library and beyond." icon="search" />{/if}
  {:else if name === 'catalogue.status'}
    {#if scenario === 'edition'}<section class="row edition-details" aria-label="Selected edition"><div><h2>Original edition</h2><p class="small">Preview Jellyfin</p></div><Button icon="play" onclick={() => delivery.notify('Preview playback requested.')}>Play this edition</Button><Button emphasis="subtle" href="/media/preview">All details</Button></section>
    {:else if scenario === 'missing-demand'}<section class="section"><Button emphasis="subtle" onclick={() => selected = !selected}>{selected ? 'Hide' : 'Show'} missing and uncertain items</Button>{#if selected}<ul><li><a href="/media/preview">Preview series · Season two</a> · No accessible source · Availability uncertain · Release date unknown</li></ul><Pagination page={1} pages={1} onchange={() => {}} label="Missing demand pages" />{/if}</section>
    {:else}<Shelf title="Your requests" items={[movie]} layout="grid" availability={false}>{#snippet details()}<div class="request-details stack"><span class="badge" class:available={scenario === 'available'}>{scenario === 'available' ? 'Available' : 'Pending approval'}</span><p class="small">Preview Seerr · 4K · Seasons 1, 2</p><p class="small">Requested 1 October 2026</p>{#if scenario !== 'available'}<Button danger onclick={() => delivery.notify('Preview cancellation acknowledged.')}>Cancel request</Button>{/if}</div>{/snippet}</Shelf>{/if}

  {:else if name === 'catalogue.history'}
    {#if scenario === 'game-table'}<GameDetails data={gameData} />
    {:else if scenario === 'selection'}<Heading title="Preview title · History" /><div class="stack"><p>Select the entries you want to remove.</p><div class="row"><Button emphasis="subtle" onclick={() => selected = true}>Select shown</Button><Button emphasis="subtle" onclick={() => selected = false}>Clear selection</Button><Button danger disabled={!selected} onclick={() => confirming = true}>Remove entry…</Button></div><Field label="Select preview watch"><input type="checkbox" bind:checked={selected} /></Field></div><Shelf title="1 October 2026" items={[episode]} shape="fanart" />
    {:else}<Shelf title="Activity" shape="poster" artworkOptions={false} availability={false} enrichSocial={false} items={[
      {...readingCard(book),entryId:'reading-progress',captionActor:{username:'alex',avatar:artwork,status:'offline'},captionActivity:{id,occurredAt:'2026-10-01T18:00:00Z',dateKnown:true,kind:'reading-reading',action:'Reading',detail:'80 of 320 pages',myReaction:null},captionSubtitle:'Reading · 80 of 320 pages'},
      {...readingCard(book),entryId:'reading-planned',captionActor:{username:'alex',avatar:artwork,status:'offline'},captionActivity:{id:'00000000-0000-4000-8000-000000000081',occurredAt:'2026-09-30T12:00:00Z',dateKnown:true,kind:'reading-planned',action:'Saved',detail:'',myReaction:null},captionSubtitle:'Saved'},
    ]}/>{/if}

    <Dialog bind:open={confirming} title="Remove from history?">
      <div class="stack">
        <p>Remove <strong>1 entry</strong> from <strong>{movie.title}</strong>?</p>
        <p>Your progress and stats will be recalculated from the history you keep. This cannot be undone. Matching Trakt history will be removed. Jellyfin’s watched status, play count and saved position will be updated to match the history you keep. Provider updates run as jobs; failures appear in Notifications.</p>
        <div class="row"><Button danger disabled={!selected} onclick={() => { confirming = false; selected = false; delivery.notify('Preview removal acknowledged. No history or connected service is changed.'); }}>Remove from history</Button><Button emphasis="subtle" onclick={() => confirming = false}>Keep entries</Button></div>
      </div>
    </Dialog>
  {/if}
</div>

<style>
  .catalogue-examples { min-width: 0; }
  .edition-details { padding: 24px 0; }
  .request-details { gap: 10px; margin-top: 14px; align-items: start; }
  .request-details p { overflow-wrap: anywhere; }

</style>
