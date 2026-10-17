<script lang="ts">
  import { providePreviewPlayback } from '$lib/playback/context.svelte';
  import Avatar from '$lib/ui/components/Avatar.svelte';
  import Header from '$lib/ui/components/Header.svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  import MediaDetails from '$lib/ui/components/MediaDetails.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Field from '$lib/ui/components/Field.svelte';
  import SectionDetails from '$lib/ui/pages/SectionDetails.svelte';
  import DetailOverlay from '$lib/ui/components/DetailOverlay.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Toast from '$lib/ui/components/Toast.svelte';
  import MetricGrid from '$lib/ui/components/MetricGrid.svelte';
  import DetailCard from '$lib/ui/components/DetailCard.svelte';
  import PlanAction from '$lib/experiments/PlanAction.svelte';
  import ShareAction from '$lib/sharing/ShareAction.svelte';
  import { profileActivityPanels, profileBreakdownPanels } from '$lib/ui/insights/profile';
  import { mediaOverviewPanels } from '$lib/ui/insights/media';
  import { readingCard, readingHero, readingFacts } from '$lib/reading/presentation';
  import { overviewPanels } from '$lib/ui/insights/overview';
  import { musicCard } from '$lib/music/presentation';
  import { gameCard } from '$lib/games/presentation';
  import { movie, show, items, music, track, days, today, id } from './demo/fixtures';

  let { name, scenario }: { name: string; scenario: string } = $props();
  providePreviewPlayback();
  let opened = $state(false), feedback = $state(''), backgroundMode = $state('activity'), positioning = $state(false), position = $state(50), range = $state(50), enabled = $state(true), title = $state(''), selected = $state('one');
  let detailStep=$state(0);
  let DynamicFeed = $state<typeof import('$lib/recommendations/DynamicFeed.svelte').default>();
  let dynamicFailure = $state('');
  $effect(() => {
    if (name !== 'recommendations.dynamic') return;
    let active = true;
    void import('$lib/recommendations/DynamicFeed.svelte').then(module => { if (active) DynamicFeed = module.default; }).catch(() => { if (active) dynamicFailure = 'The recommendation example could not load.'; });
    return () => { active = false; };
  });
  const displayName = $derived(scenario === 'long' ? 'An unusually long display name for checking profile wrapping' : 'Alex Example');
  const background = $derived(scenario !== 'no-art' ? '/coast-mark.png' : null);
  const reading = { id: '00000000-0000-4000-8000-000000000079', kind: 'book' as const, provider: 'openlibrary' as const, externalId: 'OL123W', title: 'A different chapter', authors: ['Alex Example'], subjects: ['Fantasy'], sourceUrl: 'https://openlibrary.org/works/OL123W', coverUrl: '/coast-mark.png', overview: 'Fictional reading metadata for the existing shared presentation.', publishedYear: 2026 };
  const game = gameCard({ id: '00000000-0000-4000-8000-000000000078', title: 'Preview game', platforms: ['PC'], genres: ['Adventure'], developers: ['Preview studio'], publishers: [], posterPath: '/coast-mark.png', available: true });
  const musicItems = [musicCard(music, id), musicCard(track, id)];
  const progressPanels = $derived([...profileActivityPanels(days, today, 'month', '/profile/preview'), ...profileBreakdownPanels([{ name: 'Drama', count: 8, filter: 'Drama' }, { name: 'Adventure', count: 4, filter: 'Adventure' }], [{ value: 4, count: 6 }, { value: 4.5, count: 3 }], 'month', '/profile/preview')]);
</script>

<div class="feature-examples" onclickcapture={event => { if ((event.target as Element).closest('a')) event.preventDefault(); }} onsubmitcapture={event => event.preventDefault()}>
  {#if name === 'profile.identity'}
    {#if scenario === 'private'}<p class="small quiet">The profile visibility decision omits identity details in this scenario. No private profile data is supplied.</p>
    {:else}
      <header class="profile-header" class:with-background={!!background}>
        {#if background}<div class="backdrop" aria-hidden="true"><img src={background} alt="" style:object-position={`50% ${position}%`} /><div></div></div>{/if}
        <div class="profile-heading">
          <div class="avatar"><Avatar name={displayName} src={scenario === 'no-art' ? null : '/coast-mark.png'} label={`${displayName}'s avatar`} class="profile-icon" size={104} /></div>
          <div class="identity"><p class="eyebrow">{scenario === 'self' ? 'Your profile' : 'Profile'}</p><h1>{displayName}</h1><p class="handle">@preview</p><p class="bio">{scenario === 'long' ? 'A fictional biography with room for favourite stories, music and games. '.repeat(8) : scenario === 'self' ? 'Your life in stories.' : 'A life in stories.'}</p>
            {#if scenario === 'self'}<div class="row actions"><Button size="hero" onclick={() => feedback = 'Preview edit requested. No profile is changed.'}>Edit profile</Button><Button menu text="Background" label="Profile background"><Button item selection="radio" checked={backgroundMode === 'activity'} onclick={() => backgroundMode = 'activity'}>Last activity</Button><Button item selection="radio" checked={backgroundMode !== 'activity'} onclick={() => backgroundMode = 'fixed'}>Selected title</Button></Button><Button emphasis="subtle" onclick={() => feedback = 'Preview clear requested.'}>Clear background</Button>{#if background}<Button emphasis="subtle" onclick={() => positioning = !positioning}>Position background</Button>{/if}</div>{/if}
            {#if positioning}<div class="position-controls"><label>Vertical position<input type="range" min="0" max="100" bind:value={position} /></label><Button emphasis="subtle" onclick={() => { positioning = false; feedback = 'Preview position selected.'; }}>Save position</Button><Button emphasis="subtle" onclick={() => positioning = false}>Cancel</Button></div>{/if}
          </div>
        </div>
      </header>
    {/if}
    {#if feedback}<p class="small quiet" role="status">{feedback}</p>{/if}
  {:else if name === 'profile.insights'}
    {#if scenario === 'activity'}<Shelf title="Insights" size="panel" artworkOptions={false} panels={progressPanels} />
    {:else}<Heading variant="page" title="Taste & overlap" description="Alex Example" /><MetricGrid items={[{ label: 'Overall taste', value: scenario === 'unknown' ? 'Not enough data' : '78%', detail: 'Median across qualifying media' }]} />
      {#each ['Movies', 'TV', 'Music', 'Games', 'Books', 'Comics'] as medium}<section class="section"><Heading title={medium} /><MetricGrid items={[{ label: 'Taste score', value: scenario === 'unknown' ? 'Not enough data' : '78%' }, { label: 'Genres', value: scenario === 'unknown' ? 'Not enough data' : '82%', detail: scenario === 'unknown' ? '0 yours · 0 theirs' : '4 shared · 8 yours · 6 theirs' }, { label: 'Completed · you / friend', value: scenario === 'unknown' ? '0 / 0' : '24 / 18' }, { label: 'In progress · you / friend', value: scenario === 'unknown' ? '0 / 0' : '3 / 2' }, { label: 'Shared items', value: scenario === 'unknown' ? 0 : 12 }]} /></section>{/each}
      <Shelf title="Overlap & progress" items={scenario === 'unknown' ? [] : items} hideEmpty={false} />
    {/if}
  {:else if name === 'pages.browse'}
    {#if scenario === 'empty'}<Heading variant="page" title="For You" description="Your stories, all together." /><EmptyState title="Your next story starts here." description="Build a watchlist, remember what you’ve seen, and pick up wherever you left off. Coast keeps it all together." icon="home"><Button href="/discover">Find something to watch</Button></EmptyState>
    {:else if scenario === 'for-you'}<Heading variant="page" title="For You" /><Shelf source={{ type: 'progress', mediums: true }} /><Shelf source={{ type: 'progress', surface: 'next', mediums: true }} /><Shelf source={{ type: 'progress', surface: 'favourites', mediums: true }} />
    {:else if scenario === 'discover'}<Heading variant="page" title="Discover" description="Find your next story." /><Shelf title="Trending" href="/discover?section=trending" items={items} filterBy="type" /><Shelf title="Recently added" href="/discover?section=recent" items={[show, movie]} filterBy="type" />
    {:else if scenario === 'search'}<Heading variant="page" title="Search" /><Shelf title="Available" items={[{ ...movie, available: true }]} /><Shelf title="Unavailable" items={[readingCard(reading), game]} />
    {:else if scenario === 'library'}<Heading variant="page" title="Library" /><Shelf source={{ type: 'library', surface: 'watch', collection: false }} />
    {:else if scenario === 'progress'}<MediaPage collection={{ items, selection: 'preview' }} context="home"><Shelf source={{ type: 'progress', initial: { items, page: 1, pages: 1, total: 2, view: 'watching', category: 'screen', kind: 'all', scope: 'all' }, layout: 'grid' }} /></MediaPage>
    {:else if scenario === 'lists'}<Heading variant="page" title="Your lists">{#snippet actions()}<Button icon="plus" onclick={() => feedback = 'Preview list creation requested.'}>Create list</Button>{/snippet}</Heading><Shelf source={{ type: 'list', view: 'watchlist', title: 'Watchlist' }} /><Shelf source={{ type: 'list', view: 'favourites', title: 'Favourites' }} />
    {:else if scenario === 'music'}<Heading variant="page" title="Music" /><Shelf title="Albums and tracks" items={musicItems} shape="square" layout="grid" />
    {:else if scenario === 'games'}<Heading variant="page" title="Games" /><Shelf title="Your games" items={[game]} shape="poster" layout="grid" />
    {:else if scenario === 'planning'}<Heading title="Planning" variant="page" description="Experimental · your scheduled plans. Visual treatment unapproved." /><Shelf title="Your plans" items={[movie, readingCard(reading)]} layout="grid" availability={false}>{#snippet details()}<div class="row"><Button compact onclick={() => feedback = 'Preview start requested.'}>Start</Button><Button compact emphasis="subtle" onclick={() => feedback = 'Preview cancellation requested.'}>Cancel</Button></div>{/snippet}</Shelf>{/if}
    {#if feedback}<p class="small quiet" role="status">{feedback}</p>{/if}
  {:else if name === 'recommendations.dynamic'}
    <p class="small quiet">The production dynamic feed uses a finite synthetic definition set. Scroll to its bottom to reveal one row at a time.</p>
    {#if dynamicFailure}<Toast kind="error" text={dynamicFailure} />{:else if DynamicFeed}<DynamicFeed />{:else}<p class="small quiet" role="status">{'Loading the recommendation example…'}</p>{/if}
  {:else if name === 'planning.action'}
    <Button onclick={() => opened = true}>Open planning dialog</Button><PlanAction workId={id} title={movie.title} partyAllowed bind:open={opened} />
  {:else if name === 'sharing.action'}
    <Button onclick={() => opened = true}>Open sharing dialog</Button><ShareAction workId={id} title={movie.title} bind:open={opened} />
  {:else if name === 'sharing.landing'}
    {#if scenario === 'party'}<Heading title="Synced session" variant="page" /><div class="stack form-width"><p>Experimental · Join using your own accessible Jellyfin source. Playback follows the host.</p><Button onclick={() => feedback = 'Preview join requested. No party is joined.'}>Join session</Button></div>
    {:else}<Heading title="Playback invitation" /><p>Play this shared item. You control your own playback.</p>{#if scenario === 'expired'}<p class="notice">This preview invitation has expired.</p>{:else}<Button onclick={() => feedback = 'Preview invitation requested. No playback starts.'}>Open invitation</Button>{/if}{#if scenario === 'error'}<p role="alert">This preview invitation could not be opened.</p>{/if}{/if}{#if feedback}<p class="small quiet" role="status">{feedback}</p>{/if}
  {:else if name === 'media.details'}
    <Button onclick={() => {detailStep=0;opened=true;}}>Open media details</Button><DetailOverlay bind:open={opened} sectionPage={scenario==='row'} contentKey={scenario==='row'?'/progress?view=watching':scenario==='section'?`/media/${id}?section=related`:String(detailStep)} onback={detailStep?()=>detailStep=0:undefined} editions={scenario==='editions'?[{value:'theatrical',label:'Theatrical'},{value:'extended',label:'Extended Edition'}]:[]}>{#if scenario==='row'}<SectionDetails href="/progress?view=watching" />{:else if scenario === 'error'}<Toast kind="error" text={'These preview details could not be loaded.'} />{:else}<MediaDetails detailHref={scenario==='section'?`/media/${id}?section=related`:undefined} view={{hero:scenario!=='section',item:scenario==='reading'?readingHero(reading):detailStep?show:movie}} model={scenario==='section'?undefined:{insights:{selection:'overview',tabs:[{value:'overview',label:'Overview',panels:scenario==='reading'?overviewPanels(reading.overview,readingFacts(reading)):mediaOverviewPanels(movie)}]}}}>{#if scenario==='nested'}<Button onclick={()=>detailStep=1}>Open related preview</Button>{/if}<Shelf title="Related titles" items={items} layout={scenario==='section'?'grid':'row'} filterBy={scenario==='section'?'watched':'none'} /></MediaDetails>{/if}</DetailOverlay>
  {:else if name === 'app.shell'}
    {#if scenario === 'error'}<div class="content page"><EmptyState level={1} title="Page not found" description="This fictional page could not be found."><Button href="/for-you">Back to For You</Button></EmptyState></div>
    {:else}<div class="shell-example"><Header user={scenario === 'guest' ? null : { username: 'preview', role: 'admin' }} unread={2} friendRequests={1} /></div>{/if}
  {:else if name === 'ui.native'}
    {#if scenario === 'inputs'}<form class="stack form-width"><Field label="Title"><input bind:value={title} maxlength="120" /></Field><Field label="Selection"><select bind:value={selected}><option value="one">One</option><option value="two">Two</option></select></Field><Field label="Description"><textarea rows="3"></textarea></Field><Field label="Local file"><input type="file" /></Field><Field label="Position"><input type="range" min="0" max="100" bind:value={range} /></Field><label class="check"><input type="checkbox" bind:checked={enabled} />Enable this preview option</label></form>
    {:else if scenario === 'notices'}<div class="stack"><p class="notice">An informational notice.</p><p class="notice success" role="status">The preview operation completed.</p><p class="notice error" role="alert">The preview operation could not complete.</p></div>
    {:else if scenario === 'badges'}<div class="row"><span class="badge">Pending approval</span><span class="badge available">Available</span></div>
    {:else if scenario === 'disclosure'}<details><summary>Read more</summary><p>Existing native disclosure with keyboard and browser behavior.</p></details><div class="overflow"><table class="table"><thead><tr><th scope="col">Item</th><th scope="col">State</th></tr></thead><tbody><tr><td>Preview title</td><td>Available</td></tr></tbody></table></div>
    {:else if scenario === 'skeletons'}<Shelf title="Loading titles" items={[]} busy hideEmpty={false} />{/if}
  {:else if name === 'foundation.controls'}
    {#if scenario === 'sizes'}<div class="row"><Button compact>Compact</Button><Button>Standard</Button><Button size="hero">Hero</Button><Button size="icon" icon="play" label="Icon control" /></div><p class="small quiet">Shared compact, ordinary and hero control tokens. Coarse-pointer targets follow the existing media query.</p>
    {:else if scenario === 'focus'}<div class="row"><Button>Focus with Tab</Button><Button disabled>Disabled</Button><Button pressed>Pressed</Button><Button menu text="Actions" label="Actions"><Button item>Preview action</Button><Button item disabled disabledReason="This preview choice is unavailable">Unavailable</Button></Button></div>
    {:else if scenario === 'motion'}<Button onclick={() => enabled = !enabled} pressed={enabled}>Toggle existing feedback</Button><p class="small quiet">Button feedback and skeleton animation use the current motion rules. The operating system’s reduced-motion preference remains authoritative.</p><Shelf title="Loading titles" items={[]} busy hideEmpty={false} />
    {:else if scenario === 'surfaces'}<div class="stack"><div class="row"><Button material="clear">Clear glass</Button><Button material="glassLight">Light glass</Button><Button material="glassDark">Dark glass</Button><Button fallback>Blur fallback</Button><Button emphasis="subtle">Subtle</Button></div><DetailCard title="Solid detail surface"><p>Existing neutral detail-card surface.</p></DetailCard></div>{/if}
  {/if}
</div>

<style>

  .feature-examples { min-width: 0; }
  .profile-header { position: relative; isolation: isolate; padding-block: 24px 0; }
  .profile-header.with-background { min-height: clamp(340px, 48vh, 580px); display: flex; align-items: flex-end; padding-bottom: 20px; }
  .backdrop { position: absolute; z-index: -1; inset: -130px calc(-1 * var(--gutter)) 0; overflow: hidden; pointer-events: none; }
  .backdrop img { width: 100%; height: 100%; object-fit: cover; opacity: .85; }
  .backdrop > div { position: absolute; inset: 0; background: linear-gradient(180deg, color-mix(in srgb, var(--canvas) calc(51 / 255 * 100%), transparent), transparent 25%, color-mix(in srgb, var(--canvas) calc(119 / 255 * 100%), transparent) 60%, var(--canvas) 100%); }
  .profile-heading { display: flex; align-items: center; gap: 24px; padding-block: 12px 36px; }
  .avatar { width: 104px; height: 104px; flex: none; display: grid; place-items: center; border-radius: 50%; border: 1px solid color-mix(in srgb, var(--white) calc(40 / 255 * 100%), transparent); background: color-mix(in srgb, var(--white) calc(16 / 255 * 100%), transparent); color: var(--muted); font-size: var(--text-2xl); overflow: hidden; }
  .avatar :global(.profile-icon) { width: 100%; height: 100%; background: transparent; color: inherit; font: inherit; }
  .identity { min-width: 0; }
  .eyebrow, .handle { font-size: var(--text-sm); color: var(--muted); }
  .eyebrow { margin-bottom: 6px; }
  h1 { overflow-wrap: anywhere; }
  .bio { color: var(--muted); margin: 8px 0 16px; max-width: 580px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .actions { flex-wrap: wrap; }
  .position-controls { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; margin-top: 16px; }
  .position-controls label { display: grid; gap: 6px; }
  .shell-example { position: relative; contain: layout paint; min-height: 180px; }
  @media (max-width: 600px) { .profile-header.with-background { min-height: 280px; padding-bottom: 0; } .profile-heading { padding-bottom: 18px; gap: 18px; padding-top: 0; } .avatar { width: 76px; height: 76px; font-size: var(--text-2xl); } }
</style>
