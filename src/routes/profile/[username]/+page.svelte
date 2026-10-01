<script lang="ts">
  import { homeShelves } from '$lib/ui/shelves/home';
  import MetricGrid from '$lib/ui/components/MetricGrid.svelte';
  import DetailCard from '$lib/ui/components/DetailCard.svelte';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { periodLabel, type ProfilePeriod } from '$lib/profile/period';
  import ProfileRecap from '$lib/ui/components/ProfileRecap.svelte';
  import ProfileFeatureEditor from '$lib/ui/components/ProfileFeatureEditor.svelte';
  import { api } from '$lib/ui/client';
  import { mediaTypeOptions } from '$lib/ui/filter-options';
  import RowFilter from '$lib/ui/components/RowFilter.svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import { untrack, setContext } from 'svelte';
  import { change, message } from '$lib/ui/client';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import AvailabilityToggle from '$lib/ui/components/AvailabilityToggle.svelte';
  import MediaCard from '$lib/ui/components/MediaCard.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  import SegmentedControl from '$lib/ui/components/SegmentedControl.svelte';
  import { profileActivityPanels, profileBreakdownPanels } from '$lib/ui/insights/profile';
  import ProfileEditor from '$lib/ui/components/ProfileEditor.svelte';
  let { data } = $props();
  const profileUrl = $derived('/profile/' + encodeURIComponent(data.username));
  setContext('profile-read-only', () => !data.isOwner);
  let activityType = $state<'all' | 'movie' | 'show'>(
    untrack(() => (data.filters.activityKind === 'episode' ? 'show' : data.filters.activityKind))
  );
  $effect(() => {
    activityType = data.filters.activityKind === 'episode' ? 'show' : data.filters.activityKind;
  });
  let featureOpen = $state(false),
    featureId = $state(''),
    featureTitle = $state('');
  let positioning = $state(false),
    position = $state(50);
  let query = $state('');
  $effect(() => {
    query = data.filters.query;
  });
  function feature(id: string, title: string) {
    featureId = id;
    featureTitle = title;
    featureOpen = true;
  }
  let favouriteData = $state(
    untrack(() => ({
      favourites: data.favourites,
      page: data.page,
      pages: data.pages,
      total: data.total,
    }))
  );
  const heroItems = $derived(
    data.view === 'favourites'
      ? favouriteData.favourites
      : data.view === 'ratings'
        ? data.ratedTitles
        : []
  );
  const expandedStats = $derived(page.url.searchParams.get('section') === 'insights');
  let favouriteAvailable = $state(
    untrack(() => page.url.searchParams.get('scope') === 'available')
  );
  let favouriteKind = $state(untrack(() => data.filters.kind));
  let insightPeriod = $state(untrack(() => data.filters.period));
  let insights = $state(untrack(() => ({ totals: data.totals, activity: data.activity })));
  let favouriteLoading = $state(false),
    insightLoading = $state(false);
  let favouriteError = $state(''),
    insightError = $state('');
  let favouriteRequest = 0,
    insightRequest = 0;
  let preferenceWrites = Promise.resolve<unknown>(undefined);
  function savePreference(patch: { favouriteKind?: typeof favouriteKind; period?: ProfilePeriod }) {
    if (!data.isOwner) return Promise.resolve();
    preferenceWrites = preferenceWrites
      .catch(() => undefined)
      .then(() => api('profile', { action: 'preferences', ...patch }));
    return preferenceWrites;
  }
  $effect(() => {
    favouriteData = {
      favourites: data.favourites,
      page: data.page,
      pages: data.pages,
      total: data.total,
    };
    favouriteKind = data.filters.kind;
    insightPeriod = data.filters.period;
    insights = { totals: data.totals, activity: data.activity };
    favouriteRequest++;
    insightRequest++;
    favouriteLoading = false;
    insightLoading = false;
  });
  async function chooseFavourites(kind: typeof favouriteKind, number = 1) {
    favouriteKind = kind;
    favouriteLoading = true;
    favouriteError = '';
    const request = ++favouriteRequest;
    try {
      const [result] = await Promise.all([
        api<typeof favouriteData>(
          `profile/section?section=favourites&kind=${kind}&scope=${favouriteAvailable ? 'available' : 'all'}&page=${number}&username=${encodeURIComponent(data.username)}`,
          undefined,
          'GET'
        ),
        savePreference({ favouriteKind: kind }),
      ]);
      if (request === favouriteRequest)
        favouriteData = {
          ...result,
          favourites: result.favourites.slice(0, data.view === 'overview' ? 20 : 60),
        };
    } catch (e) {
      if (request === favouriteRequest) favouriteError = message(e);
    } finally {
      if (request === favouriteRequest) favouriteLoading = false;
    }
  }
  async function choosePeriod(period: ProfilePeriod) {
    insightPeriod = period;
    insightLoading = true;
    insightError = '';
    const request = ++insightRequest;
    try {
      const [result] = await Promise.all([
        api<{ totals: typeof data.totals; activity: Awaited<typeof data.activity> }>(
          `profile/section?section=insights&period=${period}&username=${encodeURIComponent(data.username)}`,
          undefined,
          'GET'
        ),
        savePreference({ period }),
      ]);
      if (request === insightRequest)
        insights = { totals: result.totals, activity: Promise.resolve(result.activity) };
    } catch (e) {
      if (request === insightRequest) insightError = message(e);
    } finally {
      if (request === insightRequest) insightLoading = false;
    }
  }
  let arranging = $state(false);
  let editing = $state(false),
    busy = $state(false),
    error = $state('');
  const name = $derived(data.profile.displayName || data.username);
  let backgroundIndex = $state(0);
  const backgrounds = $derived([
    ...new Set(
      [data.background?.backdrop, data.background?.poster].filter(
        (value): value is string => !!value
      )
    ),
  ]);
  const background = $derived(backgrounds[backgroundIndex]);
  $effect(() => {
    backgrounds;
    backgroundIndex = 0;
  });
  const statistics = $derived([
    { label: 'Unique titles', value: insights.totals.unique },
    { label: 'Recorded watches', value: insights.totals.watches },
    { label: 'Unique episodes', value: insights.totals.episodes },
    { label: 'Rated titles', value: insights.totals.rated },
  ]);
  function url(
    view = data.view,
    page = 1,
    kind = favouriteKind,
    period = data.view === 'overview' ? 'all' : data.filters.period
  ) {
    const params = new URLSearchParams({
      view,
      page: String(page),
      kind,
      period,
      scope: favouriteAvailable ? 'available' : 'all',
    });
    if (view === 'history') {
      if (data.filters.genre) params.set('genre', data.filters.genre);
      if (data.filters.query) params.set('q', data.filters.query);
      const activityKind =
        data.view === 'overview'
          ? activityType === 'show'
            ? 'episode'
            : activityType
          : data.filters.activityKind;
      if (activityKind !== 'all') params.set('type', activityKind);
      if (data.filters.repeats) params.set('repeats', 'true');
      if (data.filters.from) params.set('from', data.filters.from);
      if (data.filters.to) params.set('to', data.filters.to);
    }
    if (view === 'ratings' && data.filters.rating !== undefined)
      params.set('rating', String(data.filters.rating));
    return `${profileUrl}?${params}`;
  }
  async function update(body: unknown) {
    if (!data.isOwner) return;
    busy = true;
    error = '';
    try {
      await change('profile', body);
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }
  function neighbours(id: string) {
    const item = favouriteData.favourites.find((i) => i.id === id)!;
    const group = favouriteData.favourites.filter((i) => i.pinned === item.pinned);
    const index = group.findIndex((i) => i.id === id);
    return { previous: group[index - 1], next: group[index + 1], afterNext: group[index + 2] };
  }
</script>

<svelte:head
  ><title
    >{data.view === 'overview'
      ? name
      : data.view === 'history'
        ? `${name}’s activity`
        : data.view === 'ratings'
          ? `${name}’s ratings`
          : `${name}’s favourites`} · Coast</title
  ></svelte:head
>
<ProfileEditor bind:open={editing} profile={data.profile} username={data.username} />
<ProfileFeatureEditor
  bind:open={featureOpen}
  mediaId={featureId}
  title={featureTitle}
  note={featureId === data.profile.featuredMediaId ? (data.profile.featuredNote ?? '') : ''}
/>
{#snippet favouriteFilters()}<RowFilter options={mediaTypeOptions()}
    label="Favourites media type"
    value={favouriteKind}
    onchange={(kind) => chooseFavourites(kind)}
  />{#if favouriteError}<span role="alert">{favouriteError}</span><Button
      variant="ghost"
      onclick={() => chooseFavourites(favouriteKind)}>Retry</Button
    >{/if}{/snippet}
{#snippet favouriteActions(id: string)}
  {@const item = favouriteData.favourites.find((i) => i.id === id)!}{@const adjacent =
    neighbours(id)}
  {#if arranging}<div class="favourite-controls">
      <Button
        variant="ghost"
        disabled={busy}
        label={`${item.pinned ? 'Unpin' : 'Pin'} ${item.title}`}
        onclick={() => update({ action: 'pin', mediaId: id, value: !item.pinned })}
        >{item.pinned ? 'Unpin' : 'Pin'}</Button
      >
      <Button
        variant="ghost"
        label={`Feature ${item.title}`}
        onclick={() => feature(item.id, item.title)}>Feature</Button
      >
      <div class="row">
        <Button
          variant="ghost"
          icon="left"
          label={`Move ${item.title} earlier`}
          disabled={busy || !adjacent.previous}
          onclick={() => update({ action: 'move', mediaId: id, beforeId: adjacent.previous.id })}
        /><Button
          variant="ghost"
          icon="right"
          label={`Move ${item.title} later`}
          disabled={busy || !adjacent.next}
          onclick={() =>
            update({ action: 'move', mediaId: id, beforeId: adjacent.afterNext?.id ?? null })}
        />
      </div>
    </div>{/if}
{/snippet}
{#snippet favourites(layout: 'row' | 'grid')}
  <Shelf
    title="Favourites"
    items={favouriteData.favourites}
    href={layout === 'row' ? url('favourites') : undefined}
    {layout}
    busy={favouriteLoading}
    pageNumber={favouriteData.page}
    pages={favouriteData.pages}
    onpage={layout === 'grid' ? (number) => chooseFavourites(favouriteKind, number) : undefined}
  >
    {#snippet filters()}<AvailabilityToggle value={favouriteAvailable} onchange={available => {
      favouriteAvailable = available; void chooseFavourites(favouriteKind);
    }} />{/snippet}
    {#snippet controls()}{@render favouriteFilters()}{/snippet}
    {#snippet actions()}{#if data.isOwner}<Button
          variant="ghost"
          onclick={() => (arranging = !arranging)}>{arranging ? 'Done' : 'Arrange'}</Button
        >{/if}{/snippet}
    {#snippet details(item)}{@render favouriteActions(item.id)}{/snippet}
    {#snippet empty()}<EmptyState
        icon="heart"
        title={data.isOwner ? 'The ones you come back to.' : 'No favourites here yet.'}
        description={data.isOwner
          ? 'Add a favourite from any title’s menu to keep it here.'
          : 'No favourites match this selection.'}
      />{/snippet}
  </Shelf>
{/snippet}
{#snippet activity(layout: 'row' | 'grid')}
  <section class="section">
    {#snippet activityFilters()}<RowFilter options={mediaTypeOptions()}
        label="Activity media type"
        bind:value={activityType}
        onchange={() => {
          if (layout === 'grid') {
            const next = new URL(page.url);
            next.searchParams.set('type', activityType === 'show' ? 'episode' : activityType);
            next.searchParams.delete('page');
            replaceState(next, page.state);
          }
        }}
      />{/snippet}
    {#if layout === 'grid'}<Heading title="Activity" filters={activityFilters} />{/if}
    {#if layout === 'grid' && data.filters.genre}<p class="small">
        Genre: {data.filters.genre === '__other__' ? 'Other genres' : data.filters.genre} · {periodLabel(
          data.filters.period
        )}
      </p>{/if}
    {#if layout === 'grid' && (data.filters.from || data.filters.to)}<p class="small">
        {data.filters.from || 'Beginning'} – {data.filters.to || 'Today'} · UTC
      </p>{/if}
    {#if layout === 'grid'}<form class="journal-filters" action={profileUrl} method="GET">
        {#if data.filters.from}<input type="hidden" name="from" value={data.filters.from} />{/if}
        {#if data.filters.to}<input type="hidden" name="to" value={data.filters.to} />{/if}
        <input
          type="hidden"
          name="type"
          value={activityType === 'show' ? 'episode' : activityType}
        /><input type="hidden" name="view" value="history" /><input
          type="hidden"
          name="period"
          value={data.filters.period}
        />{#if data.filters.genre}<input
            type="hidden"
            name="genre"
            value={data.filters.genre}
          />{/if}<label
          >Search activity<input
            name="q"
            bind:value={query}
            placeholder="Title or series"
            maxlength="160"
          /></label
        ><label class="repeat-filter"
          ><input
            type="checkbox"
            name="repeats"
            value="true"
            checked={data.filters.repeats}
          />Rewatches only</label
        ><Button type="submit" variant="secondary">Apply</Button>
      </form>{/if}
    <div class="activity-preview">
      {#key data}{#key activityType}
          <Shelf source={{ type: 'journal', preview: layout === 'row'
              ? { href: url('history'), filters: activityFilters }
              : undefined, layout: layout, maxDays: layout === 'row' ? 1 : Infinity, items: layout === 'grid' &&
            activityType ===
              (data.filters.activityKind === 'episode' ? 'show' : data.filters.activityKind)
              ? data.history
              : [], page: layout === 'grid' &&
            activityType ===
              (data.filters.activityKind === 'episode' ? 'show' : data.filters.activityKind)
              ? data.page
              : 0, pages: Math.max(1, data.pages), today: data.today, filters: {
              ...data.filters,
              username: data.username,
              period: layout === 'row' ? 'all' : data.filters.period,
              activityKind: activityType === 'show' ? 'episode' : activityType,
            } }} />
        {/key}{/key}
    </div>
  </section>
{/snippet}
{#snippet statisticsRow(layout: 'row' | 'grid')}
  <Shelf
    title={data.isOwner ? 'Your activity, in perspective' : 'Activity, in perspective'}
    size="panel"
    {layout}
    href={layout === 'row' ? `${profileUrl}?section=insights&period=${insightPeriod}` : undefined}
    busy={insightLoading}
  >
    {#snippet filters()}
      <SegmentedControl
        label="Profile statistics period"
        value={insightPeriod}
        options={[
          { value: 'month', label: 'Month' },
          { value: 'year', label: 'Year' },
          { value: 'all', label: 'All time' },
        ]}
        onchange={(period) => choosePeriod(period as ProfilePeriod)}
      />
    {/snippet}
    {#snippet actions()}
      {#if insightError}<span role="alert">{insightError}</span><Button
          variant="ghost"
          onclick={() => choosePeriod(insightPeriod)}>Retry</Button
        >{/if}
    {/snippet}
    <DetailCard title={data.isOwner ? 'Your summary' : 'Summary'}>
      {#await insights.activity then activity}{#if activity}<ProfileRecap
            subject={data.isOwner ? 'you' : name}
            movies={activity.days.reduce((n, d) => n + d.movies, 0)}
            episodes={activity.days.reduce((n, d) => n + d.episodes, 0)}
            seasons={activity.completedSeasons}
            previousCount={activity.previousCount}
            period={insightPeriod}
          />{/if}{/await}
      <MetricGrid items={statistics} />
      {#snippet footer()}
        {periodLabel(insightPeriod)} · {insights.totals.movies}
        {insights.totals.movies === 1 ? 'distinct movie' : 'distinct movies'} and {insights.totals
          .episodes}
        {insights.totals.episodes === 1 ? 'distinct episode' : 'distinct episodes'} · Recorded watches
        include rewatches and imported history
      {/snippet}
    </DetailCard>
    {#await insights.activity then activity}{#if activity}
        {#each [...profileActivityPanels(activity.days,activity.today,insightPeriod,profileUrl),
          ...profileBreakdownPanels(activity.genres,activity.ratings,insightPeriod,profileUrl)] as panel}<DetailCard {...panel} />{/each}
      {:else}<DetailCard title="Activity unavailable">
          <Button variant="ghost" onclick={() => choosePeriod(insightPeriod)}>Retry</Button>
        </DetailCard>{/if}{/await}
  </Shelf>
{/snippet}
<MediaPage
  hero={data.view === 'favourites' || data.view === 'ratings'}
  collection={{items:heroItems,selection:`${data.view}:${favouriteKind}`,busy:data.view === 'favourites' && favouriteLoading}}
  context="home"
  class="profile"
>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if expandedStats}<Button href={profileUrl} variant="ghost" icon="left">Profile</Button
    >{@render statisticsRow('grid')}
  {:else if data.view === 'overview'}
    <header class="profile-header" class:with-background={!!background}>
      {#if background}<div class="backdrop" aria-hidden="true">
          <img
            src={background}
            alt=""
            onerror={() => (backgroundIndex += 1)}
            style:object-position={`50% ${positioning ? position : (data.profile.backgroundPosition ?? 50)}%`}
          />
          <div></div>
        </div>{/if}
      <div class="profile-heading">
        <div class="avatar">
          {#if data.profile.avatar}<img
              src={data.profile.avatar}
              alt={`${name}'s avatar`}
            />{:else}<span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>{/if}
        </div>
        <div class="identity">
          <p class="eyebrow">{data.isOwner ? 'Your profile' : 'Profile'}</p>
          <h1>{name}</h1>
          <p class="handle">@{data.username}</p>
          <p class="bio">
            {data.profile.bio || (data.isOwner ? 'Your life in stories.' : 'A life in stories.')}
          </p>
          {#if data.isOwner}<div class="row actions">
              <Button variant="hero" onclick={() => (editing = true)}>Edit profile</Button
              >{#if data.profile.backgroundMediaId}<Button
                  variant="ghost"
                  disabled={busy}
                  onclick={() => update({ action: 'background', mediaId: null })}
                  >Clear background</Button
                >{/if}
              {#if background}<Button
                  variant="ghost"
                  onclick={() => {
                    position = data.profile.backgroundPosition ?? 50;
                    positioning = !positioning;
                  }}>Position background</Button
                >{/if}
            </div>
          {/if}
          {#if positioning}<div class="position-controls">
              <label
                >Vertical position<input
                  type="range"
                  min="0"
                  max="100"
                  bind:value={position}
                /></label
              ><Button
                variant="ghost"
                disabled={busy}
                onclick={async () => {
                  await update({ action: 'position', value: position });
                  if (!error) positioning = false;
                }}>Save position</Button
              ><Button variant="ghost" onclick={() => (positioning = false)}>Cancel</Button>
            </div>{/if}
        </div>
      </div>
    </header>
    {#if data.featured}<section class="featured section">
        <div class="featured-art"><MediaCard item={data.featured} /></div>
        <div>
          <p class="small">Featured favourite</p>
          <h2><a href={`/media/${data.featured.id}`}>{data.featured.title}</a></h2>
          {#if data.profile.featuredNote}<p class="feature-note">
              {data.profile.featuredNote}
            </p>{/if}
          {#if data.isOwner}<div class="row">
              <Button
                variant="ghost"
                onclick={() => feature(data.featured!.id, data.featured!.title)}>Edit note</Button
              ><Button
                variant="ghost"
                disabled={busy}
                onclick={() => update({ action: 'feature', mediaId: null, note: '' })}
                >Remove feature</Button
              >
            </div>{/if}
        </div>
      </section>{/if}
    {@render favourites('row')}
    <Shelf source={{ type: 'progress', surface: "profile", username: data.username }} />
    <Shelf source={{ type: 'progress', surface: "watchlist", username: data.username }} />
    {#if data.mediaRows}{#each homeShelves(data.mediaRows, true) as source}<Shelf {source} />{/each}{/if}
    {@render activity('row')}
    {@render statisticsRow('row')}
  {:else}
    <div class="back">
      <Button href={profileUrl} variant="ghost" icon="left">Profile</Button>
    </div>
    {#if data.view === 'ratings'}<p class="small rating-filter">
        {data.filters.rating === undefined ? 'All ratings' : `${data.filters.rating} stars`} · {periodLabel(
          data.filters.period
        )}
      </p>
      <Shelf availability={false} title="Rated titles" items={data.ratedTitles} layout="grid" filterBy="type" />
      {#if !data.ratedTitles.length}<EmptyState
          icon="star"
          title="No ratings in this period."
          description="Try another period or rating."
        />{/if}
    {:else if data.view === 'history'}{@render activity('grid')}
    {:else}{@render favourites('grid')}{/if}
    {#if data.view !== 'history'}<Pagination
        page={data.view === 'favourites' ? favouriteData.page : data.page}
        pages={data.view === 'favourites' ? favouriteData.pages : data.pages}
        pageUrl={(page) => url(data.view, page)}
        label={`${data.view} pages`}
      />{/if}
  {/if}
</MediaPage>

<style>
  .activity-preview {
    min-height: calc(clamp(255px, 27vw, 380px) * 0.5625 + 150px);
  }

  .featured {
    display: flex;
    gap: 28px;
    align-items: center;
  }
  .featured-art {
    width: 140px;
    flex: none;
  }
  .featured h2 {
    margin: 8px 0 12px;
  }
  .feature-note {
    max-width: 560px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: var(--leading-relaxed);
    color: var(--muted);
    margin-bottom: 14px;
  }
  .position-controls {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    align-items: end;
    margin-top: 16px;
  }
  .position-controls label {
    display: grid;
    gap: 6px;
  }
  .journal-filters {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    align-items: end;
    margin-bottom: 28px;
  }
  .journal-filters label {
    display: grid;
    gap: 6px;
  }
  .journal-filters .repeat-filter {
    display: flex;
    align-items: center;
    align-self: center;
  }
  .journal-filters input[type='checkbox'] {
    width: auto;
  }
  .rating-filter {
    margin-bottom: 20px;
  }
  .profile-header {
    position: relative;
    isolation: isolate;
    padding-block: 24px 0;
  }
  .profile-header.with-background {
    min-height: clamp(340px, 48vh, 580px);
    display: flex;
    align-items: flex-end;
    padding-bottom: 20px;
  }
  .backdrop {
    position: absolute;
    z-index: -1;
    inset: -130px calc(-1 * var(--gutter)) 0;
    overflow: hidden;
    pointer-events: none;
  }
  .backdrop img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.85;
  }
  .backdrop > div {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, color-mix(in srgb, var(--canvas) calc(51 / 255 * 100%), transparent), transparent 25%, color-mix(in srgb, var(--canvas) calc(119 / 255 * 100%), transparent) 60%, var(--canvas) 100%);
  }
  .profile-heading {
    display: flex;
    align-items: center;
    gap: 24px;
    padding-block: 12px 36px;
  }
  .avatar {
    width: 104px;
    height: 104px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--white) calc(40 / 255 * 100%), transparent);
    background: color-mix(in srgb, var(--white) calc(16 / 255 * 100%), transparent);
    color: var(--muted);
    font-size: var(--text-2xl);
    overflow: hidden;
  }
  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .identity {
    min-width: 0;
  }
  .eyebrow,
  .handle {
    font-size: var(--text-sm);
    color: var(--muted);
  }
  .eyebrow {
    margin-bottom: 6px;
  }
  h1 {
    overflow-wrap: anywhere;
  }
  .bio {
    color: var(--muted);
    margin: 8px 0 16px;
    max-width: 580px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .actions {
    flex-wrap: wrap;
  }
  h2 {
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
  }
  .back {
    margin-bottom: 20px;
  }
  .favourite-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
  }
  .favourite-controls :global(.button) {
    min-height: 28px;
    padding: 4px 8px;
    font-size: var(--text-sm);
  }
  .favourite-controls .row {
    gap: 0;
  }
  @media (max-width: 600px) {
    .profile-header.with-background {
      min-height: 280px;
      padding-bottom: 0;
    }
    .featured {
      gap: 18px;
    }
    .featured-art {
      width: 100px;
    }
    .profile-heading {
      padding-bottom: 18px;
    }
    .journal-filters label:first-of-type {
      width: 100%;
    }
    .profile-heading {
      gap: 18px;
      padding-top: 0;
    }
    .avatar {
      width: 76px;
      height: 76px;
      font-size: var(--text-2xl);
    }
  }
</style>
