<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import { notifyAction } from '$lib/ui/action-feedback.svelte';
  import { trackingLanguage } from '$lib/media/model';
  import { sequencePath } from '$lib/media/sequence';
  import { isMediaGroup, isResumable, targetLabel, type MediaActionData } from '$lib/media/actions';
  import type { RequestDestination } from '$lib/media/requests';
  import type { MediaView } from '$lib/ui/types';
  import { api, message, ApiError } from '$lib/ui/client';
  import { playbackTime } from '$lib/playback/time';
  import { playMedia, player } from '$lib/playback/client.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import MenuAction from './MenuAction.svelte';
  import Dialog from './Dialog.svelte';
  import RequestDialog from './RequestDialog.svelte';
  import SequenceControl from './SequenceControl.svelte';
  import MetadataEditor from './MetadataEditor.svelte';
  import Rating from './Rating.svelte';

  const readOnly = getContext<() => boolean>('profile-read-only') ?? (() => false);
  let {
    item,
    context = 'details',
    next = null,
    requestable = false,
    hero = false,
    menuOnly = false,
    showMenuTrigger = false,
  }: {
    item: MediaView;
    context?: 'discover' | 'details' | 'home';
    next?: MediaView | null;
    requestable?: boolean;
    hero?: boolean;
    menuOnly?: boolean;
    showMenuTrigger?: boolean;
  } = $props();
  type View =
    | 'root'
    | 'play'
    | 'details'
    | 'saved'
    | 'history'
    | 'watched'
    | 'rewatch'
    | 'personalise'
    | 'admin'
    | 'requests'
    | 'list-entry';
  let menu = $state<ContextMenu>(),
    sequenceControl = $state<SequenceControl>();
  let data = $state<MediaActionData | null>(null),
    busy = $state(false),
    loading = $state(false),
    error = $state('');
  let generation = 0;
  const active = $derived(data?.item ?? item);
  const language = $derived(trackingLanguage(active.category ?? 'screen'));
  const detailTargets = $derived(
    (data?.targets ?? [active]).filter((target) => page.url.pathname !== `/media/${target.id}`)
  );
  const wholeWork = $derived(data?.wholeWork ?? active);
  const continuing = $derived(
    !wholeWork.dropped &&
      !!(
        wholeWork.queued ||
        wholeWork.rewatchStartedAt ||
        wholeWork.progress > 0 ||
        data?.progressTargetIds.includes(wholeWork.id) ||
        (wholeWork.completedEpisodes && !wholeWork.watched)
      )
  );
  const recordAgain = $derived(active.watched || active.playCount > 0);
  const isAdmin = $derived(page.data.user?.role === 'admin');
  const isGroup = $derived(isMediaGroup(active));
  const playable = $derived(data ? data.playable : isMediaGroup(item) ? next : item);
  const editions = $derived(data?.editions ?? []);
  const selectedEdition = $derived(
    page.params.id === active.id ? (page.url.searchParams.get('edition') ?? undefined) : undefined
  );
  const resumable = $derived(!!playable && isResumable(playable));
  const playLabel = $derived(
    `${resumable ? 'Resume' : 'Play'}${playable?.kind === 'episode' ? ` S${String(playable.seasonNumber ?? 0).padStart(2, '0')}E${String(playable.episodeNumber ?? 0).padStart(2, '0')}` : ''}`
  );
  const requestItem = $derived(
    data ? data.requestTarget : ['movie', 'show'].includes(item.kind) ? item : null
  );
  const primaryLabel = $derived(
    (next ?? item).kind === 'episode'
      ? `${isResumable(next ?? item) ? 'Resume' : 'Play'} S${String((next ?? item).seasonNumber ?? 0).padStart(2, '0')}E${String((next ?? item).episodeNumber ?? 0).padStart(2, '0')}`
      : isResumable(item)
        ? 'Resume'
        : 'Play'
  );
  let playbackErrorOpen = $state(false),
    requestOpen = $state(false),
    editOpen = $state(false),
    editAdmin = $state(false);
  let confirmOpen = $state(false),
    confirmation = $state<{
      title: string;
      text: string;
      danger: boolean;
      run: () => Promise<void>;
    } | null>(null);
  let dialogTarget = $state<MediaView | null>(null);
  const formTarget = $derived(dialogTarget ?? active);
  let form = $state<'rewatch' | 'log' | null>(null),
    date = $state(''),
    includeSpecials = $state(false);
  let requestOptions = $state<RequestDestination[] | undefined>(),
    requestOptionsBusy = $state(false),
    requestOptionsError = $state(''),
    request4k = $state(false);
  const existingRequests = $derived(data?.requests ?? []);
  const canManageRequests = $derived(
    existingRequests.some(
      (request) => request.canCancel || request.canApprove || request.canDecline
    )
  );
  const requested = $derived(
    existingRequests.some((request) => ['pending', 'approved'].includes(request.state))
  );
  const requestLabel = $derived(
    canManageRequests
      ? 'Manage request'
      : requested
        ? 'Requested'
        : requestItem?.available || existingRequests.length
          ? 'Request more'
          : 'Request'
  );
  const requestDisabledReason = $derived(
    !data
      ? 'Checking request availability'
      : !data.requestsEnabled
        ? 'Connect Seerr and enable requests'
        : !requestItem?.tmdbId
          ? 'Match this title with TMDB before requesting it'
          : ''
  );
  const canRequestStandard = $derived(
    requestOptions?.some((entry) => entry.variants.standard?.requestable)
  );
  const canRequest4k = $derived(requestOptions?.some((entry) => entry.variants.fourK?.requestable));
  async function loadRequestOptions() {
    if (requestOptionsBusy || requestOptions || requestDisabledReason || !requestItem) return;
    const id = requestItem.id;
    requestOptionsBusy = true;
    requestOptionsError = '';
    try {
      const result = await api<{ destinations: RequestDestination[] }>(
        `requests/options?mediaId=${id}`,
        undefined,
        'GET'
      );
      if (requestItem?.id === id) requestOptions = result.destinations;
    } catch (cause) {
      requestOptionsError = message(cause);
    } finally {
      requestOptionsBusy = false;
    }
  }
  function openRequest(fourK = false) {
    request4k = fourK;
    requestOpen = true;
  }
  function requestScope(request: MediaActionData['requests'][number]) {
    const scope = request.seasons.length
      ? `${request.seasons.length === 1 ? 'Season' : 'Seasons'} ${request.seasons.join(', ')}`
      : request.is4k
        ? '4K version'
        : 'Standard version';
    return `${scope}${request.is4k && request.seasons.length ? ' · 4K' : ''}${new Set(existingRequests.map((entry) => entry.destination)).size > 1 ? ` · ${request.destination}` : ''}`;
  }
  function manageRequest(
    request: MediaActionData['requests'][number],
    action: 'cancel' | 'approve' | 'decline'
  ) {
    confirm(
      `${action === 'cancel' ? 'Cancel' : action === 'approve' ? 'Approve' : 'Decline'} request?`,
      `${requestItem?.title ?? active.title} · ${requestScope(request)}`,
      async () => {
        if (
          await perform(() => api(`requests/${request.id}`, { action }), 'Request update queued.')
        ) {
          confirmOpen = false;
          requestOptions = undefined;
        }
      },
      action !== 'approve'
    );
  }

  async function loadActions() {
    const id = item.id;
    const token = ++generation;
    loading = true;
    error = '';
    try {
      const result = await api<MediaActionData>(`media/${id}/actions`, undefined, 'GET');
      if (id === item.id && item.sequence) {
        result.item.sequence = item.sequence;
        const resolved = await api<{ next: MediaView | null }>(
          sequencePath(item.sequence, { from: item.sequence.entryId }),
          undefined,
          'GET'
        );
        if (resolved.next?.id === id) result.item = { ...result.item, ...resolved.next };
        result.playable = resolved.next;
      }
      if (token === generation) {
        data = result;
      }
      return result;
    } catch (cause) {
      if (token === generation) error = message(cause);
      return null;
    } finally {
      if (token === generation) loading = false;
    }
  }
  function openMenu() {
    data = null;
    requestOptions = undefined;
    requestOptionsError = '';
    void loadActions();
  }
  export function openAt(point: { x: number; y: number }) {
    menu?.openAt(point);
  }
  async function perform(
    task: () => Promise<unknown>,
    success = 'Saved.',
    undo?: () => Promise<void>
  ) {
    if (busy) return false;
    busy = true;
    error = '';
    try {
      if ((await task()) === false) return false;
      await loadActions();
      await invalidateAll();
      notifyAction(success, undo);
      return true;
    } catch (cause) {
      error = message(cause);
      return false;
    } finally {
      busy = false;
    }
  }
  function confirm(title: string, text: string, run: () => Promise<void>, danger = true) {
    confirmation = { title, text, run, danger };
    confirmOpen = true;
  }
  async function track(
    action: string,
    extra: Record<string, unknown> = {},
    acknowledged = false,
    target = active
  ) {
    const path =
      isMediaGroup(target) && ['watch', 'unwatch', 'progress'].includes(action)
        ? 'tracking/bulk'
        : 'tracking';
    try {
      return await api<{ removedQueueIds?: string[] }>(path, {
        mediaId: target.id,
        action,
        acknowledged,
        ...extra,
        ...(target.sequence ? { sequence: target.sequence } : {}),
      });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && !acknowledged) {
        confirm(
          'Review tracking change',
          cause.message,
          async () => {
            if (await perform(() => track(action, extra, true, target))) confirmOpen = false;
          },
          action === 'unwatch'
        );
        return false;
      }
      throw cause;
    }
  }
  async function recordWatch(when: 'now' | 'release' | 'date', at?: string) {
    const target = active;
    const extra = {
      occurredAt:
        when === 'release' && !isMediaGroup(target)
          ? `${data!.releaseDate}T00:00:00.000Z`
          : (at ?? new Date().toISOString()),
      rewatch: recordAgain,
      onReleaseDate: when === 'release',
      includeSpecials: when === 'date' && includeSpecials,
    };
    const save = async () => {
      if (
        await perform(
          () => track('watch', extra, isMediaGroup(target), target),
          `${target.title} · ${recordAgain ? 'Viewing recorded' : 'Marked watched'}`
        )
      ) {
        form = null;
        confirmOpen = false;
      }
    };
    if (isMediaGroup(target))
      confirm(
        `Mark watched · ${target.title}`,
        when === 'release'
          ? 'Mark each episode or movie watched on its release date. Skip anything unreleased or without a release date. Keep your existing watch history.'
          : `Applies to ${target.kind === 'collection' ? 'the titles in this collection' : target.kind === 'season' ? 'the episodes in this season' : 'the regular episodes in this show'}. Your watch history is kept.`,
        save,
        false
      );
    else await save();
  }
  function resetProgress(target: MediaView) {
    confirm(
      `Reset playback position · ${target.title}`,
      `${isMediaGroup(target) ? 'Clears saved playback positions for this item’s episodes or titles.' : 'Clears this item’s saved playback position.'} Keep your watched status and history.`,
      async () => {
        if (await perform(() => track('progress', { positionSeconds: 0 }, true, target)))
          confirmOpen = false;
      }
    );
  }
  async function resolvedPlayback() {
    if (active.sequence) {
      const result = await api<{ next: MediaView | null }>(
        sequencePath(active.sequence, { from: active.sequence.entryId }),
        undefined,
        'GET'
      );
      return result.next;
    }
    return data ? data.playable : isMediaGroup(item) ? (await loadActions())?.playable : item;
  }
  async function play(edition?: string, fromStart = false) {
    error = '';
    try {
      const target = await resolvedPlayback();
      if (!target?.available) throw new Error('The next item is not available to play.');
      await playMedia(target.id, {
        edition,
        fromStart,
        sequence: target.sequence,
        continuationId: isGroup ? active.id : target.showId,
      });
    } catch (cause) {
      error = message(cause);
      playbackErrorOpen = true;
    }
  }
  async function startTarget() {
    if ((active.kind === 'collection' || active.sequence) && active.id === item.id) {
      await sequenceControl?.start();
      return;
    }
    await play(selectedEdition);
  }
  export async function start() {
    await startTarget();
  }
  export function request() {
    request4k = false;
    requestOptions = undefined;
    if (!data && ['season', 'episode'].includes(item.kind)) {
      void loadActions().then((result) => {
        if (result?.requestTarget) requestOpen = true;
      });
    } else requestOpen = true;
  }
  function openForm(value: NonNullable<typeof form>, target = active) {
    dialogTarget = target;
    date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    error = '';
    includeSpecials = false;
    form = value;
  }
  async function submitForm() {
    const kind = form;
    if (kind === 'rewatch') {
      if (
        await perform(
          () => api('rewatch', { mediaId: formTarget.id, startedAt: new Date(date).toISOString() }),
          'Rewatch started.'
        )
      )
        form = null;
    } else if (kind === 'log') {
      await recordWatch('date', new Date(date).toISOString());
    }
  }
  async function toggleList(list: MediaActionData['lists'][number]) {
    const target = active;
    if (list.playlist || !list.entries.length) {
      let added: { entryId: string; added: boolean } | undefined;
      await perform(
        async () => {
          added = await api(`lists/${list.id}/items`, { mediaId: target.id });
        },
        `${target.title} · Added to ${list.name}`,
        async () => {
          if (added?.added)
            await api(`lists/${list.id}/items`, { entryId: added.entryId }, 'DELETE');
          await loadActions();
          await invalidateAll();
        }
      );
    } else {
      await perform(
        () => api(`lists/${list.id}/items`, { entryId: list.entries[0].id }, 'DELETE'),
        `${target.title} · Removed from ${list.name}`,
        async () => {
          await api(`lists/${list.id}/items`, {
            mediaId: target.id,
            restorePosition: list.entries[0].position,
          });
          await loadActions();
          await invalidateAll();
        }
      );
    }
  }
  function removeEntry(listId: string, entryId: string) {
    confirm(
      'Remove this entry?',
      'Only this occurrence will be removed. Your watch history is kept.',
      async () => {
        if (
          await perform(() => api(`lists/${listId}/items`, { entryId }, 'DELETE'), 'Entry removed.')
        ) {
          confirmOpen = false;
        }
      }
    );
  }
  async function toggleContinue() {
    const target = wholeWork;
    const removing = continuing;
    let result:
      | { eventId?: string; previous?: import('$lib/core/tracking/continue').ContinueSnapshot }
      | undefined;
    await perform(
      async () => {
        result = await api('continue', { mediaId: target.id, action: removing ? 'remove' : 'add' });
      },
      `${target.title} · ${removing ? 'Removed from Continue · Rewatch ended · History preserved' : target.dropped ? 'Restored to Continue' : 'Added to Next'}`,
      removing
        ? async () => {
            await api('continue', { mediaId: target.id, action: 'undo', ...result });
            await loadActions();
            await invalidateAll();
          }
        : undefined
    );
  }
  async function startRewatchNow() {
    await perform(
      () => api('rewatch', { mediaId: wholeWork.id, startedAt: new Date().toISOString() }),
      `${wholeWork.title} · Rewatch started`
    );
  }
  function toggleSaved(action: 'watchlist' | 'favourite' | 'queued', target = active) {
    const previous = !!target[action];
    const label =
      action === 'watchlist' ? 'Watchlist' : action === 'favourite' ? 'Favourites' : 'Next';
    const write = (value: boolean) =>
      action === 'queued'
        ? api('up-next', { mediaId: target.id, queued: value })
        : api('tracking', { mediaId: target.id, action, value });
    void perform(
      () => write(!previous),
      `${target.title} · ${previous ? 'Removed from' : 'Added to'} ${label}`,
      async () => {
        await write(previous);
        await loadActions();
        await invalidateAll();
      }
    );
  }
  function refresh() {
    const target = data?.refreshTarget;
    if (target) void perform(() => api(`media/${target.id}/refresh`, {}), 'Metadata refreshed.');
  }
</script>

{#snippet branch(label: string, to: View, icon: import('./Icon.svelte').IconName)}
  <ContextMenu
    {label}
    {icon}
    panel
    disabled={busy || loading}
    onopen={to === 'requests' ? () => void loadRequestOptions() : undefined}
  >
    {@render content(to)}
  </ContextMenu>
{/snippet}
{#snippet requestManagement(request: MediaActionData['requests'][number])}
  {#if request.canApprove}<MenuAction
      icon="check"
      disabled={busy}
      onclick={() => manageRequest(request, 'approve')}>Approve request…</MenuAction
    >{/if}
  <MenuAction icon="arrow" href={`/requests?request=${request.id}`}
    >View request · {request.state === 'pending'
      ? 'Pending'
      : request.state === 'approved'
        ? 'Approved'
        : request.state === 'available'
          ? 'Available'
          : 'Failed'}</MenuAction
  >
  {#if request.canCancel || request.canDecline}<div
      class="menu-divider"
      role="separator"
    ></div>{/if}
  {#if request.canDecline}<MenuAction
      icon="close"
      danger
      disabled={busy}
      onclick={() => manageRequest(request, 'decline')}>Decline request…</MenuAction
    >{/if}
  {#if request.canCancel}<MenuAction
      icon="close"
      danger
      disabled={busy}
      onclick={() => manageRequest(request, 'cancel')}>Cancel request…</MenuAction
    >{/if}
{/snippet}
{#snippet playbackChoices(edition?: string)}
  <MenuAction
    icon="play"
    disabled={player.loading || !playable?.available}
    disabledReason={!playable?.available ? 'Not available to play' : undefined}
    onclick={() => (edition === undefined ? startTarget() : play(edition))}
  >
    {resumable ? `Resume from ${playbackTime(playable!.progress)}` : 'Play'}
  </MenuAction>
  {#if resumable}
    <MenuAction
      icon="rewind"
      disabled={player.loading}
      onclick={() => play(edition ?? selectedEdition, true)}
    >
      Play from beginning
    </MenuAction>
  {/if}
{/snippet}
{#snippet content(view: View)}
  {#if view !== 'root'}
    {#if error}<div class="menu-feedback text-danger" role="alert">{error}</div>{/if}
  {/if}
  {#if view === 'root'}
    {#if active.available || data?.progressTargetIds.includes(active.id)}
      {@render branch(playLabel, 'play', 'play')}
    {:else}
      <MenuAction
        icon="play"
        disabled={loading || player.loading || !active.available || !playable}
        disabledReason={!active.available || !playable ? 'Not available to play' : undefined}
        onclick={startTarget}>{playLabel}</MenuAction
      >
    {/if}
    {#if canManageRequests || (!requestDisabledReason && requestLabel !== 'Request')}
      {@render branch(requestLabel, 'requests', 'request')}
    {:else}
      <MenuAction
        icon="request"
        disabled={loading || busy || !!requestDisabledReason}
        disabledReason={requestDisabledReason}
        onclick={() => openRequest()}>{requestLabel}…</MenuAction
      >
    {/if}
    <div class="menu-divider" role="separator"></div>
    {@render branch(language.mark, 'watched', 'check')}
    {@render branch('Rewatch', 'rewatch', 'refresh')}
    {@render branch('History', 'history', 'clock')}
    <Rating
      mediaId={active.id}
      value={active.rating}
      menu
      onrated={(value) => {
        if (data) data.item.rating = value;
      }}
    />

    <div class="menu-divider" role="separator"></div>
    <MenuAction icon="list" disabled={busy || loading} onclick={toggleContinue}
      >{continuing ? 'Remove from Continue' : 'Add to Continue'}</MenuAction
    >
    <MenuAction
      icon="bookmark"
      checked={active.watchlist}
      showCheckmark={false}
      disabled={busy || loading}
      onclick={() => toggleSaved('watchlist')}
      >{active.watchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}</MenuAction
    >
    <MenuAction
      icon="heart"
      checked={active.favourite}
      showCheckmark={false}
      disabled={busy || loading}
      onclick={() => toggleSaved('favourite')}
      >{active.favourite ? 'Remove from Favourites' : 'Add to Favourites'}</MenuAction
    >
    {#if data?.lists.length}
      {@render branch('Lists', 'saved', 'list')}
    {:else}
      <MenuAction icon="list" branch disabled disabledReason="No lists yet">Lists</MenuAction>
    {/if}
    <div class="menu-divider" role="separator"></div>
    {#if detailTargets.length || editions.length > 1}{@render branch(
        'Jump to',
        'details',
        'arrow'
      )}{/if}
    {@render branch('Personalise', 'personalise', 'film')}
    {#if isAdmin}
      <div class="menu-divider" role="separator"></div>
      {@render branch('Admin', 'admin', 'settings')}
    {/if}
  {:else if view === 'details'}
    {#each detailTargets as target (target.id)}
      <MenuAction icon={target.kind === 'show' ? 'library' : 'film'} href={`/media/${target.id}`}>
        {target.kind === 'episode'
          ? `Episode · S${String(target.seasonNumber ?? 0).padStart(2, '0')}E${String(target.episodeNumber ?? 0).padStart(2, '0')}`
          : target.kind === 'show'
            ? 'Show'
            : target.kind[0].toUpperCase() + target.kind.slice(1)} · {target.title}
      </MenuAction>
    {/each}
    {#if editions.length > 1}
      {#if detailTargets.length}<div class="menu-divider" role="separator"></div>{/if}
      {#each editions as edition}<MenuAction
          icon="film"
          href={`/media/${playable?.id ?? active.id}?${new URLSearchParams({ edition })}`}
          >{edition || 'Original'} version</MenuAction
        >{/each}
    {/if}
  {:else if view === 'play'}
    {@render playbackChoices()}
    {#if editions.length > 1}
      <div class="menu-divider" role="separator"></div>
      {#each editions as edition}
        {#if resumable}<ContextMenu
            label={`${edition || 'Original'} version`}
            panel
            disabled={player.loading}
          >
            {#snippet trigger()}<Icon name="film" /><span class="menu-action-label"
                >{edition || 'Original'} version</span
              ><span class="menu-chevron"><Icon name="right" /></span>{/snippet}
            {@render playbackChoices(edition)}
          </ContextMenu>{:else}<MenuAction
            icon="play"
            disabled={player.loading}
            onclick={() => play(edition)}>Play {edition || 'Original'} version</MenuAction
          >{/if}
      {/each}
    {/if}
  {:else if view === 'saved'}
    <div class="menu-lists">
      {#each data?.lists ?? [] as list (list.id)}
        <MenuAction
          icon={list.playlist ? 'plus' : 'list'}
          checked={list.playlist ? undefined : !!list.entries.length}
          disabled={busy || loading}
          onclick={() => toggleList(list)}
          >{list.playlist ? `Add to ${list.name}` : list.name}</MenuAction
        >
      {:else}<div class="menu-label">No lists yet</div>{/each}
    </div>
    {#if item.listContext}<div class="menu-divider" role="separator"></div>
      {@render branch('This list entry', 'list-entry', 'list')}
    {/if}
  {:else if view === 'watched'}
    <MenuAction icon="check" disabled={busy || loading} onclick={() => recordWatch('now')}
      >Right now</MenuAction
    >
    {#if data?.hasReleaseDate}<MenuAction
        icon="clock"
        disabled={busy}
        onclick={() => recordWatch('release')}
        >{['show', 'season', 'episode'].includes(active.kind)
          ? 'On air date'
          : 'On release date'}</MenuAction
      >{/if}
    <MenuAction icon="clock" disabled={busy} onclick={() => openForm('log')}
      >Choose date…</MenuAction
    >
  {:else if view === 'history'}
    <MenuAction icon="clock" href={`/media/${active.id}/history`}>View history</MenuAction>
    <div class="menu-divider" role="separator"></div>
    <MenuAction
      icon="check"
      disabled={busy ||
        loading ||
        !(
          active.watched ||
          active.completedEpisodes ||
          active.progress ||
          data?.progressTargetIds.includes(active.id)
        )}
      disabledReason="Already unwatched"
      onclick={() =>
        confirm(
          `Mark unwatched · ${active.title}`,
          `Mark ${targetLabel(active)} unwatched and clear its saved playback position. Keep all past watches in your history.`,
          async () => {
            if (await perform(() => track('unwatch', {}, true), 'Marked unwatched. History kept.'))
              confirmOpen = false;
          },
          false
        )}>Mark unwatched…</MenuAction
    >
    <MenuAction
      icon="rewind"
      danger
      disabled={busy || !data?.progressTargetIds.includes(active.id)}
      disabledReason="Nothing to reset"
      onclick={() => resetProgress(active)}>Reset playback position…</MenuAction
    >
    <div class="menu-divider" role="separator"></div>
    <MenuAction icon="close" danger href={`/media/${active.id}/history?remove=1`}
      >Remove from history…</MenuAction
    >
  {:else if view === 'rewatch'}
    <MenuAction icon="refresh" disabled={busy || loading} onclick={startRewatchNow}
      >Start now</MenuAction
    >
    <MenuAction
      icon="clock"
      disabled={busy || loading}
      onclick={() => openForm('rewatch', wholeWork)}>Choose date…</MenuAction
    >
  {:else if view === 'personalise'}
    <MenuAction
      icon="user"
      disabled={busy}
      onclick={() =>
        perform(
          () => api('profile', { action: 'background', mediaId: active.id }),
          'Profile background updated.'
        )}>Set as profile background</MenuAction
    >
    <MenuAction
      icon="film"
      onclick={() => {
        editAdmin = false;
        editOpen = true;
      }}>Change artwork or title…</MenuAction
    >
    {#if data?.hasPersonalOverrides}
      <MenuAction
        icon="refresh"
        danger
        disabled={busy}
        onclick={() =>
          confirm(
            'Reset my changes?',
            'Use the original title and artwork again. This only changes your view.',
            async () => {
              if (await perform(() => api(`media/${active.id}/presentation`, {}, 'DELETE')))
                confirmOpen = false;
            }
          )}>Reset my changes…</MenuAction
      >
    {/if}
  {:else if view === 'admin' && isAdmin}
    {#if data?.refreshTarget}<MenuAction icon="refresh" disabled={busy} onclick={refresh}
        >Refresh {data.refreshTarget.id === active.id
          ? 'title details'
          : `show details · ${data.refreshTarget.title}`}</MenuAction
      >{/if}
    {#if page.data.user?.role === 'admin'}<MenuAction
        icon="settings"
        onclick={() => {
          editAdmin = true;
          editOpen = true;
        }}>Edit title details…</MenuAction
      >{/if}
  {:else if view === 'requests'}
    {#if canRequestStandard}
      <MenuAction icon="request" onclick={() => openRequest()}
        >{requestItem?.kind === 'show'
          ? 'Request remaining seasons…'
          : 'Request standard version…'}</MenuAction
      >
    {/if}
    {#if canRequest4k}<MenuAction icon="request" onclick={() => openRequest(true)}
        >Request 4K…</MenuAction
      >{/if}
    {#if requestOptionsError}<MenuAction icon="refresh" onclick={loadRequestOptions}
        >Retry request options</MenuAction
      >{/if}
    {#if existingRequests.length}
      {#if canRequestStandard || canRequest4k || requestOptionsError}<div
          class="menu-divider"
          role="separator"
        ></div>{/if}
      {#if existingRequests.length === 1}
        {@render requestManagement(existingRequests[0])}
      {:else}
        {#each existingRequests as request (request.id)}
          <ContextMenu label={requestScope(request)} panel>
            {#snippet trigger()}<Icon name="request" /><span class="menu-action-label"
                >{requestScope(request)}</span
              ><span class="menu-chevron"><Icon name="right" /></span>{/snippet}
            {@render requestManagement(request)}
          </ContextMenu>
        {/each}
      {/if}
    {:else}
      {#if canRequestStandard || canRequest4k}<div class="menu-divider" role="separator"></div>{/if}
      <MenuAction icon="arrow" href="/requests">View requests</MenuAction>
      {#if requestOptions && !canRequestStandard && !canRequest4k}<MenuAction
          disabled
          disabledReason="Already available, requested, or not permitted for your account"
          >Nothing more to request</MenuAction
        >{/if}
    {/if}
  {:else if view === 'list-entry'}
    {#if item.listContext && active.id === item.id}
      <MenuAction
        icon="left"
        disabled={busy}
        onclick={() =>
          perform(() =>
            api(`lists/${item.listContext!.listId}/move`, {
              entryId: item.listContext!.entryId,
              direction: -1,
            })
          )}>Move this entry earlier</MenuAction
      >
      <MenuAction
        icon="right"
        disabled={busy}
        onclick={() =>
          perform(() =>
            api(`lists/${item.listContext!.listId}/move`, {
              entryId: item.listContext!.entryId,
              direction: 1,
            })
          )}>Move this entry later</MenuAction
      >
      <MenuAction
        icon="close"
        danger
        disabled={busy}
        onclick={() => removeEntry(item.listContext!.listId, item.listContext!.entryId)}
        >Remove from this list…</MenuAction
      >
    {/if}
  {/if}
{/snippet}
{#if readOnly()}<Button href={`/media/${item.id}`} variant="hero">Learn more</Button>{:else}
  <div class="row actions">
    {#if !menuOnly}
      {#if context === 'discover' || (hero && context !== 'details')}<Button
          variant={hero ? 'hero' : 'primary'}
          href={`/media/${item.id}`}
          icon="arrow">Learn more</Button
        >
      {:else if (next ?? item).available}<Button
          variant={hero ? 'hero' : 'primary'}
          icon="play"
          disabled={player.loading}
          onclick={start}>{primaryLabel}</Button
        >
      {:else if requestable || ['season', 'episode'].includes(item.kind)}<Button
          variant={hero ? 'hero' : 'primary'}
          icon="request"
          onclick={request}>Request</Button
        >
      {:else}<span class="badge">Not available to play</span>{/if}
      <button
        class="icon-button"
        class:hero-icon-action={hero}
        class:selected={item.watchlist}
        aria-label={item.watchlist ? 'Remove from watchlist' : 'Add to watchlist'}
        aria-pressed={item.watchlist}
        disabled={busy}
        onclick={() => toggleSaved('watchlist', item)}
        ><Icon name="bookmark" filled={item.watchlist} /></button
      >
      <button
        class="icon-button"
        class:hero-icon-action={hero}
        class:selected={item.favourite}
        aria-label={item.favourite ? 'Remove from favourites' : 'Add to favourites'}
        aria-pressed={item.favourite}
        disabled={busy}
        onclick={() => toggleSaved('favourite', item)}
        ><Icon name="heart" filled={item.favourite} /></button
      >
    {/if}
    <ContextMenu
      bind:this={menu}
      panel
      hideTrigger={menuOnly && !showMenuTrigger}
      onopen={openMenu}
      label={`Actions for ${item.title}`}
      align="start"
      upward={hero}
      triggerClass={hero ? 'icon-button hero-icon-action' : 'icon-button'}
    >
      {#if error}<div class="menu-feedback text-danger" role="alert">{error}</div>
        <MenuAction icon="refresh" onclick={() => loadActions()}>Retry</MenuAction>{/if}
      {@render content('root')}
    </ContextMenu>
  </div>
  {#if item.kind === 'collection' || item.sequence}<SequenceControl
      bind:this={sequenceControl}
      source={item.sequence ?? { kind: 'collection', id: item.id }}
      from={item.sequence?.entryId}
      hidden
    />{/if}
  {#if requestItem}<RequestDialog
      item={requestItem}
      initial4k={request4k}
      options={requestOptions}
      onsent={() => {
        requestOptions = undefined;
        void loadActions();
      }}
      seasonNumber={active.kind === 'episode' || active.kind === 'season'
        ? active.seasonNumber
        : undefined}
      bind:open={requestOpen}
    />{/if}
  <Dialog bind:open={playbackErrorOpen} title="Playback unavailable"
    ><p role="alert">{error}</p></Dialog
  >
  <MetadataEditor mediaId={active.id} admin={editAdmin} bind:open={editOpen} />
  <Dialog bind:open={confirmOpen} title={confirmation?.title ?? 'Confirm change'}
    ><div class="stack">
      <p>{confirmation?.text}</p>
      {#if error}<p role="alert" class="text-danger">{error}</p>{/if}
      <div class="row">
        <Button
          variant={confirmation?.danger ? 'danger' : 'primary'}
          disabled={busy}
          onclick={() => confirmation?.run()}>Confirm</Button
        ><Button variant="ghost" onclick={() => (confirmOpen = false)}>Cancel</Button>
      </div>
    </div></Dialog
  >
  <Dialog
    open={form !== null}
    onclose={() => (form = null)}
    title={form === 'log'
      ? `Mark watched · ${formTarget.title}`
      : form === 'rewatch'
        ? `Rewatch ${formTarget.kind} · ${formTarget.title}`
        : formTarget.title}
  >
    <form
      class="stack"
      onsubmit={(event) => {
        event.preventDefault();
        void submitForm();
      }}
    >
      {#if error}<p role="alert" class="text-danger">{error}</p>{/if}
      <label class="field"
        >{form === 'log' ? 'Watched at' : 'Start date and time'}<input
          type="datetime-local"
          bind:value={date}
          required
        /></label
      >
      <p class="small">
        {form === 'log'
          ? `${recordAgain ? 'Records another viewing' : 'Marks watched'} for ${targetLabel(formTarget)}.`
          : `Rewatch the whole ${formTarget.kind}: ${formTarget.title}. Only viewing since this date counts toward this rewatch. Your earlier watch history is kept.`}
      </p>
      {#if isMediaGroup(formTarget) && form === 'log'}{#if formTarget.kind !== 'season' && !formTarget.sequence}<label
            class="check"
            ><input type="checkbox" bind:checked={includeSpecials} />Include specials</label
          >{/if}
        <p class="small">
          Applies to all {formTarget.kind === 'collection' ? 'titles and episodes' : 'episodes'} in
          {formTarget.title}.
        </p>{/if}
      <div class="row">
        <Button type="submit" disabled={busy}
          >{form === 'rewatch' ? 'Start rewatch' : 'Mark watched'}</Button
        ><Button variant="ghost" onclick={() => (form = null)}>Cancel</Button>
      </div>
    </form>
  </Dialog>
{/if}

<style>
  .menu-lists {
    max-height: min(40dvh, 280px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .actions {
    gap: 12px;
  }
</style>
