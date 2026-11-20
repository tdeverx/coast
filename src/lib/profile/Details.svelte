<script lang="ts">
  import ProfileBackgroundMenu from '#lib/ui/components/ProfileBackgroundMenu.svelte';
  import { goto } from '$app/navigation';
  import { reportFailure, useClient } from '#lib/ui/client-context.js';
  import MetricGrid from '#lib/ui/components/MetricGrid.svelte';
  import DetailCard from '#lib/ui/components/DetailCard.svelte';
  import MediaCard from '#lib/ui/components/MediaCard.svelte';
  import MediaHero from '#lib/ui/components/MediaHero.svelte';
  import MediaDetails from '#lib/ui/components/MediaDetails.svelte';
  import ListOverview from '#lib/ui/components/ListOverview.svelte';
  import { page } from '$app/state';
  import { periodLabel, type ProfilePeriod } from '#lib/profile/period.js';
  import { profileListsPath, profilePath, profileTastePath } from '#lib/profile/url.js';
  import { copyProfileLink } from '#lib/profile/copy-link.js';
  import { navigateMedia } from '#lib/ui/media-navigation.js';
  import { useDetailSection } from '#lib/ui/detail-section.svelte.js';
  import type { loadProfileDetails } from './details.server.js';
  import ProfileRecap from '#lib/ui/components/ProfileRecap.svelte';
  import TasteComparison from './TasteComparison.svelte';
  import PersonalTaste from './PersonalTaste.svelte';
  import { mediaTypeOptions } from '#lib/ui/filter-options.js';
  import RowFilter from '#lib/ui/components/RowFilter.svelte';
  import Heading from '#lib/ui/components/Heading.svelte';
  import { untrack, setContext, onDestroy, tick, type Snippet } from 'svelte';
  import { api, change, message } from '#lib/ui/client.js';
  import { createResource } from '#lib/ui/resource.svelte.js';
  import Shelf from '#lib/ui/components/Shelf.svelte';

  import Button from '#lib/ui/components/Button.svelte';
  import EmptyState from '#lib/ui/components/EmptyState.svelte';
  import Pagination from '#lib/ui/components/Pagination.svelte';
  import SegmentedControl from '#lib/ui/components/SegmentedControl.svelte';
  import { profileActivityPanels, profileBreakdownPanels } from '#lib/ui/insights/profile.js';
  import ProfileEditor, { type ProfileEditFields } from '#lib/ui/components/ProfileEditor.svelte';
  let { data, modal = false, detailHref }: {
    data: Awaited<ReturnType<typeof loadProfileDetails>>;
    modal?: boolean;
    detailHref?: string;
  } = $props();
  const profileUrl = $derived(profilePath(data.username));
  const detailUrl = $derived(modal ? new URL(detailHref ?? profileUrl, page.url.href) : page.url);
  const sectionHost = useDetailSection();
  const sectionId = $props.id();
  const { feedback } = useClient();
  setContext('profile-read-only', () => !data.isOwner);

  let activityType = $state<'all' | 'movie' | 'show'>(untrack(() => data.filters.activityKind === 'episode' ? 'show' : data.filters.activityKind));

  $effect(() => {
    activityType = data.filters.activityKind === 'episode' ? 'show' : data.filters.activityKind;
  });
  let query = $state('');
  $effect(() => {
    query = data.filters.query;
  });
  const favouriteRead = createResource(
    untrack(() => ({
      favourites: data.favourites,
      page: data.page,
      pages: data.pages,
      total: data.total,
    })), true
  );
  const favouriteData = $derived(favouriteRead.data);
  const expandedStatistics = $derived(data.visibility.insights && detailUrl.searchParams.get('section') === 'insights');
  const profileActivityLink = $derived(`${profileUrl}?section=activity`);
  const showProfileHero = $derived(data.visibility.details && data.view === 'overview' && !data.activityFeed);
  const progressRows = $derived([
    { category: 'screen', title: 'Watching', visible: data.progressCategories.includes('screen') },
    { category: 'game', title: 'Playing', visible: data.progressCategories.includes('game') },
    { category: 'reading', title: 'Reading', visible: data.progressCategories.some(category => category === 'book' || category === 'comic') },
  ] as const);
  const hasProgress = $derived(!!page.data.user && progressRows.some(row => row.visible));
  const tasteUrl = $derived(profileTastePath(data.username));
  const profileSegment = $derived(data.lists ? 'lists' : data.taste || data.personalTaste ? 'taste' : expandedStatistics ? 'insights' : 'overview');
  const profileSegments = $derived([
    { value: 'overview', label: 'Overview' },
    ...(data.visibility.insights ? [{ value: 'insights', label: 'Statistics' }] : []),
    ...(data.canCompareTaste || data.isOwner && page.data.capabilities.personalisation ? [{ value: 'taste', label: 'Taste' }] : []),
    ...(data.isOwner ? [{ value: 'lists', label: 'Lists' }] : []),
  ]);
  $effect(() => {
    if (modal && sectionHost) return untrack(() => sectionHost.attach(sectionId, () => ({
      title: name,
      segments: profileSegments.length > 1 ? profileNavigation : undefined,
    })));
  });
  let favouriteAvailable = $state(
    untrack(() => detailUrl.searchParams.get('scope') === 'available' && data.filters.kind!=='book' && data.filters.kind!=='comic')
  );
  let favouriteKind = $state(untrack(() => data.filters.kind));
  let insightPeriod = $state(untrack(() => data.filters.period));
  const insight = createResource(untrack(() => ({ totals: data.totals, activity: data.activity, period: data.filters.period })), true);
  const insights = $derived(insight.data);
  const favouriteLoading = $derived(favouriteRead.busy), insightLoading = $derived(insight.busy);
  const favouriteError = $derived(favouriteRead.error), insightError = $derived(insight.error);
  onDestroy(() => { favouriteRead.dispose(); insight.dispose(); });
  let preferenceWrites = Promise.resolve<unknown>(undefined);
  function savePreference(patch: { favouriteKind?: typeof favouriteKind; period?: ProfilePeriod }) {
    if (!data.isOwner) return Promise.resolve();
    preferenceWrites = preferenceWrites
      .catch(() => undefined)
      .then(() => change('profile', { action: 'preferences', ...patch }));
    return preferenceWrites;
  }
  $effect(() => {
    favouriteRead.replace({
      favourites: data.favourites,
      page: data.page,
      pages: data.pages,
      total: data.total,
    });
    favouriteKind = data.filters.kind;
    if(data.filters.kind==='book'||data.filters.kind==='comic')favouriteAvailable=false;
    insightPeriod = data.filters.period;
    insight.replace({ totals: data.totals, activity: data.activity, period: data.filters.period });
  });
  async function chooseFavourites(kind: typeof favouriteKind, number = 1) {
    favouriteKind = kind;
    if (kind === 'book' || kind === 'comic') favouriteAvailable = false;
    await favouriteRead.load(async (signal) => {
      const [result] = await Promise.all([
        api<typeof favouriteData>(
          `profile/section?section=favourites&kind=${kind}&scope=${favouriteAvailable ? 'available' : 'all'}&page=${number}&username=${encodeURIComponent(data.username)}`,
          undefined,
          'GET', { signal }
        ),
        savePreference({ favouriteKind: kind }),
      ]);
      return {
          ...result,
          favourites: result.favourites.slice(0, data.view === 'overview' ? 20 : 60),
      };
    });
  }
  async function choosePeriod(period: ProfilePeriod) {
    insightPeriod = period;
    await insight.load(async (signal) => {
      const [result] = await Promise.all([
        api<{ totals: typeof data.totals; activity: Awaited<typeof data.activity> }>(
          `profile/section?section=insights&period=${period}&username=${encodeURIComponent(data.username)}`,
          undefined,
          'GET', { signal }
        ),
        savePreference({ period }),
      ]);
      return { totals: result.totals, activity: Promise.resolve(result.activity), period };
    });
  }
  let arranging = $state(false);
  let editing = $state(false),
    backgroundCleared = $state(false),
    busy = $state(false),
    error = $state('');
  const editButtonId = `${sectionId}-edit`;
  $effect(() => {
    if (editing) return () => {
      void tick().then(() => document.getElementById(editButtonId)?.focus({ preventScroll: true }));
    };
  });
  const name = $derived(data.profile.displayName || data.username);
  const profileBackdrop = $derived(data.background?.backdrop || data.background?.artwork?.backdrop);
  const activityBackground = $derived(data.profile.backgroundMode === 'activity');
  const profilePoster = $derived(data.background?.poster || data.background?.artwork?.primary);
  const hasBackground = $derived(!!(profileBackdrop || profilePoster));
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
  function chooseActivityType(value: typeof activityType) {
    if (activityType === value) return;
    const url = new URL(detailUrl.href);
    url.searchParams.set('type', value === 'show' ? 'episode' : value);
    url.searchParams.delete('page');
    if (modal) void navigateMedia(url.pathname + url.search, { replace: true });
    else {
      activityType = value;
      void goto(url, { shallow: true, replace: true, reset: false, state: page.state });
    }
  }
  function selectProfileSegment(value: string) {
    if (value === profileSegment) return;
    editing = false;
    const href = value === 'lists' ? profileListsPath(data.username)
      : value === 'insights' ? `${profileUrl}?section=insights&period=${insightPeriod}`
      : value === 'taste' ? tasteUrl : profileUrl;
    goToProfileView(href);
  }
  function goToProfileView(href: string) {
    if (modal) void navigateMedia(href, { replace: true });
    else void goto(href, { reset: false });
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
  reportFailure(()=>error);
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
{#snippet favouriteActions(id: string)}
  {@const item = favouriteData.favourites.find((i) => i.id === id)!}{@const adjacent =
    neighbours(id)}
  {#if arranging}<div class="favourite-controls">
      <Button
        emphasis="subtle"
        disabled={busy}
        label={`${item.pinned ? 'Unpin' : 'Pin'} ${item.title}`}
        onclick={() => update({ action: 'pin', mediaId: id, value: !item.pinned })}
        >{item.pinned ? 'Unpin' : 'Pin'}</Button
      >
      <div class="row">
        <Button
          emphasis="subtle"
          icon="left"
          label={`Move ${item.title} earlier`}
          disabled={busy || !adjacent.previous}
          onclick={() => update({ action: 'move', mediaId: id, beforeId: adjacent.previous.id })}
        /><Button
          emphasis="subtle"
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
    layout={layout}
    busy={favouriteLoading}
    error={favouriteError} retry={()=>void chooseFavourites(favouriteKind)}
    pageNumber={favouriteData.page}
    pages={favouriteData.pages}
    onpage={layout === 'grid' ? (number) => chooseFavourites(favouriteKind, number) : undefined}
    filterGroups={[
      {
        label: 'Media type',
        value: favouriteKind,
        options: mediaTypeOptions({ ...page.data, features: page.data.capabilities }),
        change: (kind) => void chooseFavourites(kind as typeof favouriteKind)
      },

      ...favouriteKind !== 'book' && favouriteKind !== 'comic'
        ? [
          {
            label: 'Availability',
            value: favouriteAvailable ? 'available' : 'all',
            options: [
              { value: 'all', label: 'All titles' },
              { value: 'available', label: 'Available only' }
            ],

            change: (value: string) => {
              favouriteAvailable = value === 'available';
              void chooseFavourites(favouriteKind);
            }
          }
        ]
        : []
    ]}
  >
    {#snippet actions()}
      {#if data.isOwner}
        <Button item onclick={() => arranging = !arranging}>{arranging ? 'Done' : 'Arrange'}</Button>
      {/if}
    {/snippet}

    {#snippet details(item)}
      {@render favouriteActions(item.id)}
    {/snippet}

    {#snippet empty()}
      <EmptyState
        icon="heart"
        title={data.isOwner ? 'The ones you come back to.' : 'No favourites here yet.'}
        description={data.isOwner
          ? 'Add a favourite from any title’s menu to keep it here.'
          : 'No favourites match this selection.'}
      />{/snippet}
  </Shelf>
{/snippet}
{#snippet activity()}
  <section class="section">
    {#snippet activityFilters()}
      <RowFilter
        reset={{disabled:activityType==='all',run:()=>chooseActivityType('all')}}
        groups={[{
          label: 'Activity media type',
          value: activityType,
          options: mediaTypeOptions(),
          change: next => chooseActivityType(next as typeof activityType),
        }]}
      />
    {/snippet}
    <Heading title="Activity" controls={activityFilters} />
    {#if data.filters.genre}
      <p class="small">
        Genre: {data.filters.genre === '__other__' ? 'Other genres' : data.filters.genre} · {periodLabel(data.filters.period)}
      </p>
    {/if}

    {#if data.filters.from || data.filters.to}
      <p class="small">{data.filters.from || 'Beginning'} – {data.filters.to || 'Today'} · UTC</p>
    {/if}

    <form
        class="journal-filters"
        action={profileUrl}
        method="GET"
        onsubmit={event => {
          if (!modal) return;
          event.preventDefault();
          const params = new URLSearchParams();
          new FormData(event.currentTarget).forEach((value, key) => {
            if (typeof value === 'string') params.append(key, value);
          });
          void navigateMedia(`${profileUrl}?${params}`, { replace: true });
        }}
      >
        {#if data.filters.from}
          <input
            type="hidden"
            name="from"
            value={data.filters.from}
          />
        {/if}

        {#if data.filters.to}
          <input type="hidden" name="to" value={data.filters.to} />
        {/if}

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
        ><Button type="submit" >Apply</Button>
    </form>
    <div class="activity-preview">
      {#key data}{#key activityType}
        {@const supplied = activityType === (data.filters.activityKind === 'episode' ? 'show' : data.filters.activityKind)}
        <Shelf source={{
          type: 'journal',
          layout: 'grid',
          items: supplied ? data.history : [],
          page: supplied ? data.page : 0,
          pages: Math.max(1, data.pages),
          today: data.today,
          filters: { ...data.filters, username: data.username, activityKind: activityType === 'show' ? 'episode' : activityType },
        }} />
        {/key}{/key}
    </div>
  </section>
{/snippet}
{#snippet statisticsRow()}
  <Shelf
    title="Statistics"
    size="panel"
    layout="grid"
    busy={insightLoading}
    error={insightError} retry={()=>void choosePeriod(insightPeriod)}
  >
    {#snippet segments()}
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
    <DetailCard title={data.isOwner ? 'Your summary' : 'Summary'}>
      {#await insights.activity then activity}{#if activity}<ProfileRecap
            subject={data.isOwner ? 'you' : name}
            movies={activity.days.reduce((n, d) => n + d.movies, 0)}
            episodes={activity.days.reduce((n, d) => n + d.episodes, 0)}
            seasons={activity.completedSeasons}
            previousCount={activity.previousCount}
            period={insights.period}
          />{/if}{/await}
      <MetricGrid items={statistics} />
      {#snippet footer()}
        {periodLabel(insights.period)} · {insights.totals.movies}
        {insights.totals.movies === 1 ? 'distinct movie' : 'distinct movies'} and {insights.totals
          .episodes}
        {insights.totals.episodes === 1 ? 'distinct episode' : 'distinct episodes'} · Recorded watches
        include rewatches and imported history
      {/snippet}
    </DetailCard>
    {#await insights.activity then activity}{#if activity}
        {#each [...profileActivityPanels(activity.days,activity.today,insights.period,profileUrl),
          ...profileBreakdownPanels(activity.genres,activity.ratings,insights.period,profileUrl)] as panel}<DetailCard {...panel} />{/each}
      {:else}<DetailCard title="Activity unavailable">
          <Button emphasis="subtle" onclick={() => choosePeriod(insightPeriod)}>Retry</Button>
        </DetailCard>{/if}{/await}
  </Shelf>
{/snippet}
{#snippet profileAvatar(avatar = data.profile.avatar, avatarMenu?: Snippet)}
  <div class="profile-avatar-card" class:editing={!!avatarMenu}>
    <MediaCard item={{ id: data.username, kind: 'person', title: name, poster: avatar, href: null }}
      showCaption={false} showPrimaryAction={!!avatarMenu} primaryMenu={avatarMenu}
      primaryMenuLabel="Edit avatar" primaryMenuIcon="image" />
  </div>
{/snippet}

{#snippet profileNavigation()}
  <SegmentedControl material="clear" presentation="navigation" label="Profile sections"
    value={profileSegment} options={profileSegments} onchange={selectProfileSegment} />
{/snippet}

{#snippet profileActions()}
  {#if data.isOwner}
    <Button id={editButtonId} size="hero" onclick={() => editing = true}>Edit</Button>
  {:else if data.canCompareTaste && !data.taste}
    <Button href={tasteUrl} size="hero" icon="heart" onclick={event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      selectProfileSegment('taste');
    }}>Taste & overlap</Button>
  {/if}
  <ProfileBackgroundMenu copyLink={() => copyProfileLink(data.username, feedback)} owner={data.isOwner} />
{/snippet}

{#snippet profileHeroContent(fields: ProfileEditFields | undefined)}
  {#snippet editActions()}
    {#if fields}
      {@render fields.actions()}
      <ProfileBackgroundMenu editing
        clearBackground={!activityBackground && data.profile.backgroundMediaId && !backgroundCleared
          ? fields.clearBackground : undefined} />
    {/if}
  {/snippet}
  <MediaHero
    size="compact"
    identity={{
      id: profileUrl, title: name, subtitle: `@${data.username}`, description: data.profile.bio,
      backdrop: backgroundCleared ? undefined : profileBackdrop,
      poster: backgroundCleared ? undefined : profilePoster,
      position: activityBackground ? undefined : fields?.backgroundPosition?.y ?? data.profile.backgroundPosition,
      positionX: activityBackground ? undefined : fields?.backgroundPosition?.x ?? data.profile.backgroundPositionX,
    }}
    logoCard={fields?.avatar ?? profileAvatar}
    titleField={fields?.title}
    overviewField={fields?.bio}
    moveBackground={!backgroundCleared && hasBackground && !activityBackground ? fields?.moveBackground : undefined}
    segments={!modal && profileSegments.length > 1 ? profileNavigation : undefined}
    actions={fields ? editActions : profileActions}
  />
{/snippet}
{#snippet profileHero()}
  {#if data.isOwner}
    <ProfileEditor bind:open={editing} bind:backgroundCleared profile={data.profile} username={data.username}
      avatarPreview={profileAvatar} children={profileHeroContent} />
  {:else}
    {@render profileHeroContent(undefined)}
  {/if}
{/snippet}
<MediaDetails
  view={{
    hero: false,
    heroContent: showProfileHero ? profileHero : undefined,
    context: 'home',
  }}
  detailHref={detailUrl.href}
  artwork={backgroundCleared ? [] : [profileBackdrop || profilePoster]}
>
  {#if data.lists}
    <ListOverview lists={data.lists} username={data.username} />
  {:else if data.personalTaste}
    {#if data.isOwner && data.userId === page.data.user?.id && page.data.capabilities.personalisation}
      {#key data.userId}<PersonalTaste data={data.personalTaste} />{/key}
    {/if}
  {:else if data.taste}
    {#if data.taste.viewerId === page.data.user?.id && page.data.capabilities.personalisation && page.data.capabilities.social}
      <TasteComparison data={data.taste} href={tasteUrl} navigate={goToProfileView} />
    {/if}
  {:else if expandedStatistics}
    {#if !showProfileHero && !modal}<Button href={profileUrl} emphasis="subtle" icon="left">Profile</Button>{/if}
    {@render statisticsRow()}
  {:else if data.activityFeed}
    <Shelf source={{
      ...data.activityFeed, type: 'social', layout: 'grid', mediums: true,
      profileId: data.userId, profileHref: profileActivityLink, profileMedia: data.activityMedia,
    }} hideEmpty={false} />
  {:else if data.view === 'overview'}
    {#if data.visibility.favourites}
      {@render favourites('row')}
    {/if}
    {#if page.data.user && data.activityMedia.length}
      <Shelf source={{
        type: 'social', mediums: true, audience: 'all',
        category: data.activityMedia.includes('screen') ? 'screen' : data.activityMedia[0],
        profileId: data.userId, profileHref: profileActivityLink, profileMedia: data.activityMedia, href: profileActivityLink,
      }} hideEmpty={false} />
    {/if}
    {#if hasProgress}
      {#each progressRows.filter(row => row.visible) as row (row.category)}
        <Shelf source={{
          type: 'progress-experiment', username: data.username, category: row.category, profile: true,
          title: row.title, showEmpty: true,
        }} hideEmpty={false} />
      {/each}
    {/if}
  {:else}
    {#if !showProfileHero && !modal}<div class="back">
      <Button href={profileUrl} emphasis="subtle" icon="left">Profile</Button>
    </div>{/if}
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
    {:else if data.view === 'history'}{@render activity()}
    {:else}{@render favourites('grid')}{/if}
    {#if data.view !== 'history'}<Pagination
        page={data.view === 'favourites' ? favouriteData.page : data.page}
        pages={data.view === 'favourites' ? favouriteData.pages : data.pages}
        pageUrl={(page) => url(data.view, page)}
        label={`${data.view} pages`}
      />{/if}
  {/if}
</MediaDetails>

<style>
  .activity-preview {
    min-height: calc(clamp(255px, 27vw, 380px) * 0.5625 + 150px);
  }

  .profile-avatar-card {
    height: var(--hero-artwork-height);
    aspect-ratio: 1;
  }
  .profile-avatar-card :global(.art-link) { pointer-events: none; }
  .profile-avatar-card.editing :global(.play) { opacity: 1; }
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
  .journal-filters input[type="checkbox"] {
    width: auto;
  }
  .rating-filter {
    margin-bottom: 20px;
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
    .journal-filters label:first-of-type {
      width: 100%;
    }
  }
</style>
