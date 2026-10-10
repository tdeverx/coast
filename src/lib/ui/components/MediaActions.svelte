<script lang="ts">
  import RowFeedback from './RowFeedback.svelte';
  import WorkActions from './WorkActions.svelte';
  import { relationshipControls, listMembershipControls } from '$lib/ui/controls/actions';
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createMutation } from '$lib/ui/mutation.svelte';
  import { setRelationship } from '$lib/ui/relationships';

  import { trackingLanguage } from '$lib/media/model';
  import { sequencePath } from '$lib/media/sequence';
  import {
    isMediaGroup,
    isResumable,
    targetLabel,
    type MediaActionData,
  } from '$lib/media/actions';
  import type { RequestDestination } from '$lib/media/requests';
  import type { MediaView } from '$lib/ui/types';
  import { message, ApiError } from '$lib/ui/client';
  import { useClient } from '$lib/ui/client-context';
  import { playbackTime } from '$lib/playback/time';
  import { playMedia } from '$lib/playback/client.svelte';
  import { usePlayback } from '$lib/playback/context.svelte';
  import ShareAction from '$lib/sharing/ShareAction.svelte';
  import PlanAction from '$lib/experiments/PlanAction.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';

  import Dialog from './Dialog.svelte';
  import RequestDialog from './RequestDialog.svelte';
  import { createRequestControls } from '$lib/ui/controls/requests.svelte';
  import { requestScope } from '$lib/media/requests';
  import { createSequencePlayback } from '$lib/ui/controls/sequence.svelte';
  import MetadataEditor from './MetadataEditor.svelte';

  const readOnly = getContext<() => boolean>('profile-read-only') ?? (() => false);

  const { api, change } = useClient();

  const { player, preview } = usePlayback();

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
    | 'list-entry';
  let menu = $state<Button>();
  const sequenceControl = createSequencePlayback({ source: () => item.kind === 'collection' || item.sequence ? item.sequence ?? {kind: 'collection', id: item.id} : undefined, from: () => item.sequence?.entryId, experimentalMusic: () => !!page.data.experimentalMusic, preview, api, change });
  let data = $state<MediaActionData | null>(null), loading = $state(false);
  const mutation = createMutation(loadActions);
  const busy = $derived(mutation.busy);
  const error = $derived(mutation.error);
  let generation = 0;
  const identity = $derived(item.id);
  $effect(() => {
    identity;
    generation++;
    data = null;
    loading = false;
  });
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
    page.params.id === active.id
      ? (page.url.searchParams.get('edition') ?? undefined)
      : undefined
  );
  const resumable = $derived(!!playable && isResumable(playable));
  const playLabel = $derived(
    `${resumable ? 'Resume' : 'Play'}${playable?.kind === 'episode' ? ` S${String(playable.seasonNumber ?? 0).padStart(2, '0')}E${String(playable.episodeNumber ?? 0).padStart(2, '0')}` : ''}`
  );
  const requestItem = $derived(
    data ? data.requestTarget : ['movie', 'show'].includes(item.kind) ? item : null
  );
  const requests = createRequestControls({item: () => requestItem, data: () => data, api, onrequest: () => (fourK = false, options) => {requestOptions = options; openRequest(fourK);}});
  const primaryLabel = $derived(
    (next ?? item).kind === 'episode'
      ? `${isResumable(next ?? item) ? 'Resume' : 'Play'} S${String((next ?? item).seasonNumber ?? 0).padStart(2, '0')}E${String((next ?? item).episodeNumber ?? 0).padStart(2, '0')}`
      : isResumable(item)
        ? 'Resume'
        : 'Play'
  );
  let planningOpen=$state(false),sharingOpen=$state(false);
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
    request4k = $state(false);
  function openRequest(fourK = false) {
    request4k = fourK;
    requestOpen = true;
  }
  function manageRequest(
    request: MediaActionData['requests'][number],
    action: 'cancel' | 'approve' | 'decline'
  ) {
    confirm(
      `${action === 'cancel' ? 'Cancel' : action === 'approve' ? 'Approve' : 'Decline'} request?`,
      `${requestItem?.title ?? active.title} · ${requestScope(request, data?.requests ?? [])}`,
      async () => {
        if (
          await perform(
            () => change(`requests/${request.id}`, { action }),
            'Request update queued.'
          )
        ) {
          confirmOpen = false;
          requestOptions = undefined;
          requests.resetOptions();
        }
      },
      action !== 'approve'
    );
  }

  async function loadActions() {
    const id = item.id;
    const token = ++generation;
    loading = true;
    mutation.error = '';
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
      if (token === generation && id === item.id) {
        data = result;
      }
      return result;
    } catch (cause) {
      if (token === generation) mutation.error = message(cause);
      return null;
    } finally {
      if (token === generation) loading = false;
    }
  }
  function openMenu() {
    data = null;
    requestOptions = undefined;
    requests.resetOptions();
    void loadActions();
  }
  export function openAt(point: { x: number; y: number }) {
    menu?.openAt(point);
  }
  const perform = mutation.run;
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
      return await change<{ removedQueueIds?: string[] }>(path, {
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
    // A completed episode can change the group's next item while this menu's
    // lazily loaded action data is still cached.
    return isMediaGroup(item) ? (await loadActions())?.playable : data?.playable ?? item;
  }
  async function play(edition?: string, fromStart = false) {
    if (preview) return;
    mutation.error = '';
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
      mutation.error = message(cause);
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
    date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    mutation.error = '';
    includeSpecials = false;
    form = value;
  }
  async function submitForm() {
    const kind = form;
    if (kind === 'rewatch') {
      if (
        await perform(
          () =>
            change('rewatch', { mediaId: formTarget.id, startedAt: new Date(date).toISOString() }),
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
          added = await change(`lists/${list.id}/items`, { mediaId: target.id });
        },
        `${target.title} · Added to ${list.name}`,
        async () => {
          if (added?.added)
            await change(`lists/${list.id}/items`, { entryId: added.entryId }, 'DELETE');
          await loadActions();
        }
      );
    } else {
      await perform(
        () => change(`lists/${list.id}/items`, { entryId: list.entries[0].id }, 'DELETE'),
        `${target.title} · Removed from ${list.name}`,
        async () => {
          await change(`lists/${list.id}/items`, {
            mediaId: target.id,
            restorePosition: list.entries[0].position,
          });
          await loadActions();
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
          await perform(
            () => change(`lists/${listId}/items`, { entryId }, 'DELETE'),
            'Entry removed.'
          )
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
      | { eventId?: string; previous?: import('$lib/core/tracking/continue.server').ContinueSnapshot }
      | undefined;
    await perform(
      async () => {
        result = await change('continue', {
          mediaId: target.id,
          action: removing ? 'remove' : 'add',
        });
      },
      `${target.title} · ${removing ? 'Removed from Continue · Rewatch ended · History preserved' : target.dropped ? 'Restored to Continue' : 'Added to Next'}`,
      removing
        ? async () => {
            await change('continue', { mediaId: target.id, action: 'undo', ...result });
            await loadActions();
            }
        : undefined
    );
  }
  async function startRewatchNow() {
    await perform(
      () => change('rewatch', { mediaId: wholeWork.id, startedAt: new Date().toISOString() }),
      `${wholeWork.title} · Rewatch started`
    );
  }
  function toggleSaved(action: 'watchlist' | 'favourite' | 'queued', target = active) {
    const previous = !!target[action];
    const label =
      action === 'watchlist' ? 'Watchlist' : action === 'favourite' ? 'Favourites' : 'Next';
    const write = (value: boolean) => setRelationship(target.id, action, value, change);
    void perform(
      () => write(!previous),
      `${target.title} · ${previous ? 'Removed from' : 'Added to'} ${label}`,
      async () => {
        await write(previous);
        await loadActions();
      }
    );
  }
  function refresh() {
    const target = data?.refreshTarget;
    if (target)
      void perform(() => change(`media/${target.id}/refresh`, {}), 'Metadata refreshed.');
  }
  async function checkIn(){try{await change('social/checkins',{workId:active.id});}catch(cause){mutation.error=message(cause);}}
</script>

{#snippet requestManagement(request: MediaActionData['requests'][number])}
  {#if request.canApprove}<Button item
      icon="check"
      disabled={busy}
      onclick={() => manageRequest(request, 'approve')}>Approve request…</Button>{/if}
  <Button item icon="arrow" href={`/requests?request=${request.id}`}
    >View request · {request.state === 'pending'
      ? 'Pending'
      : request.state === 'approved'
        ? 'Approved'
        : request.state === 'available'
          ? 'Available'
          : 'Failed'}</Button>
  {#if request.canCancel || request.canDecline}<div
      class="menu-divider"
      role="separator"
    ></div>{/if}
  {#if request.canDecline}<Button item
      icon="close"
      danger
      disabled={busy}
      onclick={() => manageRequest(request, 'decline')}>Decline request…</Button>{/if}
  {#if request.canCancel}<Button item
      icon="close"
      danger
      disabled={busy}
      onclick={() => manageRequest(request, 'cancel')}>Cancel request…</Button>{/if}
{/snippet}
{#snippet choices()}
  {#if error}<RowFeedback error={error} tag="div" class="menu-feedback text-danger" />{/if}
  {#if requests.canRequestStandard}
    <Button item icon="request" onclick={() => requests.openRequest()}
      >{requestItem?.kind === 'show'
        ? 'Request remaining seasons…'
        : 'Request standard version…'}</Button>
  {/if}
  {#if requests.canRequest4k}<Button item icon="request" onclick={() => requests.openRequest(true)}
      >Request 4K…</Button>{/if}
  {#if requests.requestOptionsError}<Button item icon="refresh" onclick={requests.loadRequestOptions}
      >Retry request options</Button>{/if}
  {#if requests.existingRequests.length}
    {#if requests.canRequestStandard || requests.canRequest4k || requests.requestOptionsError}<div
        class="menu-divider"
        role="separator"
      ></div>{/if}
    {#if requests.existingRequests.length === 1}
      {@render requestManagement(requests.existingRequests[0])}
    {:else}
      {#each requests.existingRequests as request (request.id)}
        <Button menu label={requestScope(request, requests.existingRequests)} panel>
          {#snippet trigger()}<Icon name="request" /><span class="menu-action-label"
              >{requestScope(request, requests.existingRequests)}</span
            ><span class="menu-chevron"><Icon name="right" /></span>{/snippet}
          {@render requestManagement(request)}
        </Button>
      {/each}
    {/if}
  {:else}
    {#if requests.canRequestStandard || requests.canRequest4k}<div
        class="menu-divider"
        role="separator"
      ></div>{/if}
    <Button item icon="arrow" href="/requests">View requests</Button>
    {#if requests.requestOptions && !requests.canRequestStandard && !requests.canRequest4k}<Button item
        disabled
        disabledReason="Already available, requested, or not permitted for your account"
        >Nothing more to request</Button>{/if}
  {/if}
{/snippet}

{#snippet requestControls()}
{#if requests.canManageRequests || (!requests.requestDisabledReason && requests.requestLabel !== 'Request')}
  <Button menu
    label={requests.requestLabel}
    icon="request"
    panel
    disabled={busy || loading}
    onopen={() => void requests.loadRequestOptions()}
  >
    {@render choices()}
  </Button>
{:else}
  <Button item
    icon="request"
    disabled={loading || busy || !!requests.requestDisabledReason}
    disabledReason={requests.requestDisabledReason}
    onclick={() => requests.openRequest()}>{requests.requestLabel}…</Button>
{/if}

{/snippet}

{#snippet branch(label: string, to: View, icon: import('./Icon.svelte').IconName)}
  <Button menu {label} {icon} panel disabled={busy || loading}>
    {@render content(to)}
  </Button>
{/snippet}
{#snippet playbackChoices(edition?: string)}
  <Button item
    icon="play"
    disabled={player.loading || !playable?.available}
    disabledReason={!playable?.available ? 'Not available to play' : undefined}
    onclick={() => (edition === undefined ? startTarget() : play(edition))}
  >
    {resumable ? `Resume from ${playbackTime(playable!.progress)}` : 'Play'}
  </Button>
  {#if resumable}
    <Button item
      icon="rewind"
      disabled={player.loading}
      onclick={() => play(edition ?? selectedEdition, true)}
    >
      Play from beginning
    </Button>
  {/if}
{/snippet}
{#snippet content(view: View)}
  {#if view !== 'root'}
    {#if error}<RowFeedback error={error} tag="div" class="menu-feedback text-danger" />{/if}
  {/if}
  {#if view === 'root'}
    {#if active.available || data?.progressTargetIds.includes(active.id)}
      {@render branch(playLabel, 'play', 'play')}
    {:else}
      <Button item
        icon="play"
        disabled={loading || player.loading || !active.available || !playable}
        disabledReason={!active.available || !playable ? 'Not available to play' : undefined}
        onclick={startTarget}>{playLabel}</Button>
    {/if}
    {@render requestControls()}
    {#if page.data.playbackSharing&&['movie','episode','track'].includes(active.kind)}<Button item icon="friends" onclick={()=>sharingOpen=true}>Share</Button>{/if}
    {#if page.data.experiments?.planning}<Button item icon="list" onclick={()=>planningOpen=true}>Plan</Button>{/if}
    {#if item.recommendationIds?.length}<WorkActions section="recommendations" workId={active.id} recommendationIds={item.recommendationIds} disabled={busy||loading} />{/if}
    <WorkActions section="social" workId={active.id} disabled={busy||loading} />
    {#if ['movie','episode'].includes(active.kind)}<Button item icon="clock" disabled={busy||loading||!active.runtimeMinutes} onclick={checkIn}>Check in</Button>{/if}
    <div class="menu-divider" role="separator"></div>
    {@render branch(language.mark, 'watched', 'check')}
    {@render branch('Rewatch', 'rewatch', 'refresh')}
    {@render branch('History', 'history', 'clock')}
    <WorkActions section="rating"
      workId={active.id}
      rating={active.rating}
      onrated={(value) => {
        if (data) data.item.rating = value;
      }}
    />

    <div class="menu-divider" role="separator"></div>
    <Button item icon="list" disabled={busy || loading} onclick={toggleContinue}
      >{continuing ? 'Remove from Continue' : 'Add to Continue'}</Button>
    <WorkActions section="relationships" workId={active.id} controls={relationshipControls([
      { kind: 'watchlist', value: active.watchlist, icon: 'bookmark', showCheckmark: false,
        label: active.watchlist ? 'Remove from Watchlist' : 'Add to Watchlist' },
      { kind: 'collected', value: active.collected, icon: 'plus',
        label: `${active.collected ? 'Remove from' : 'Add to'} Collection` },
      { kind: 'favourite', value: active.favourite, icon: 'heart', showCheckmark: false,
        label: active.favourite ? 'Remove from Favourites' : 'Add to Favourites' },
    ], relationship => {
      if (relationship === 'collected') void perform(
        () => setRelationship(active.id, relationship, !active.collected, change),
        active.collected ? 'Removed Collected status. Other relationships and history are preserved.' : 'Added to Collection.'
      );
      else toggleSaved(relationship);
    }, busy || loading)} />
    {#if data?.lists.length}
      {@render branch('Lists', 'saved', 'list')}
    {:else}
      <Button item icon="list" branch disabled disabledReason="No lists yet">Lists</Button>
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
      <Button item
        icon={target.kind === 'show' ? 'library' : 'film'}
        href={`/media/${target.id}`}
      >
        {target.kind === 'episode'
          ? `Episode · S${String(target.seasonNumber ?? 0).padStart(2, '0')}E${String(target.episodeNumber ?? 0).padStart(2, '0')}`
          : target.kind === 'show'
            ? 'Show'
            : target.kind[0].toUpperCase() + target.kind.slice(1)} · {target.title}
      </Button>
    {/each}
    {#if editions.length > 1}
      {#if detailTargets.length}<div class="menu-divider" role="separator"></div>{/if}
      {#each editions as edition}<Button item
          icon="film"
          href={`/media/${playable?.id ?? active.id}?${new URLSearchParams({ edition })}`}
          >{edition || 'Original'} version</Button>{/each}
    {/if}
  {:else if view === 'play'}
    {@render playbackChoices()}
    {#if editions.length > 1}
      <div class="menu-divider" role="separator"></div>
      {#each editions as edition}
        {#if resumable}<Button menu
            label={`${edition || 'Original'} version`}
            panel
            disabled={player.loading}
          >
            {#snippet trigger()}<Icon name="film" /><span class="menu-action-label"
                >{edition || 'Original'} version</span
              ><span class="menu-chevron"><Icon name="right" /></span>{/snippet}
            {@render playbackChoices(edition)}
          </Button>{:else}<Button item
            icon="play"
            disabled={player.loading}
            onclick={() => play(edition)}>Play {edition || 'Original'} version</Button>{/if}
      {/each}
    {/if}
  {:else if view === 'saved'}
    <div class="menu-lists">
      <WorkActions section="lists" workId={active.id} controls={listMembershipControls(data?.lists ?? [], list => !!list.entries.length, toggleList, busy || loading, 'Add to', 'plus')}>{#snippet empty()}<div class="menu-label">No lists yet</div>{/snippet}</WorkActions>
    </div>
    {#if item.listContext}<div class="menu-divider" role="separator"></div>
      {@render branch('This list entry', 'list-entry', 'list')}
    {/if}
  {:else if view === 'watched'}
    <Button item icon="check" disabled={busy || loading} onclick={() => recordWatch('now')}
      >Right now</Button>
    {#if data?.hasReleaseDate}<Button item
        icon="clock"
        disabled={busy}
        onclick={() => recordWatch('release')}
        >{['show', 'season', 'episode'].includes(active.kind)
          ? 'On air date'
          : 'On release date'}</Button>{/if}
    <Button item icon="clock" disabled={busy} onclick={() => openForm('log')}
      >Choose date…</Button>
  {:else if view === 'history'}
    <Button item icon="clock" href={`/media/${active.id}/history`}>View history</Button>
    <div class="menu-divider" role="separator"></div>
    <Button item
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
            if (
              await perform(() => track('unwatch', {}, true), 'Marked unwatched. History kept.')
            )
              confirmOpen = false;
          },
          false
        )}>Mark unwatched…</Button>
    <Button item
      icon="rewind"
      danger
      disabled={busy || !data?.progressTargetIds.includes(active.id)}
      disabledReason="Nothing to reset"
      onclick={() => resetProgress(active)}>Reset playback position…</Button>
    <div class="menu-divider" role="separator"></div>
    <Button item icon="close" danger href={`/media/${active.id}/history?remove=1`}
      >Remove from history…</Button>
  {:else if view === 'rewatch'}
    <Button item icon="refresh" disabled={busy || loading} onclick={startRewatchNow}
      >Start now</Button>
    <Button item
      icon="clock"
      disabled={busy || loading}
      onclick={() => openForm('rewatch', wholeWork)}>Choose date…</Button>
  {:else if view === 'personalise'}
    <Button item
      icon="user"
      disabled={busy}
      onclick={() =>
        perform(
          () => api('profile', { action: 'background', mediaId: active.id }),
          'Profile background updated.'
        )}>Set as profile background</Button>
    <Button item
      icon="film"
      onclick={() => {
        editAdmin = false;
        editOpen = true;
      }}>Change artwork or title…</Button>
    {#if data?.hasPersonalOverrides}
      <Button item
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
          )}>Reset my changes…</Button>
    {/if}
  {:else if view === 'admin' && isAdmin}
    {#if data?.refreshTarget}<Button item icon="refresh" disabled={busy} onclick={refresh}
        >Refresh {data.refreshTarget.id === active.id
          ? 'title details'
          : `show details · ${data.refreshTarget.title}`}</Button>{/if}
    {#if page.data.user?.role === 'admin'}<Button item
        icon="settings"
        onclick={() => {
          editAdmin = true;
          editOpen = true;
        }}>Edit title details…</Button>{/if}
  {:else if view === 'list-entry'}
    {#if item.listContext && active.id === item.id}
      <Button item
        icon="left"
        disabled={busy}
        onclick={() =>
          perform(() =>
            api(`lists/${item.listContext!.listId}/move`, {
              entryId: item.listContext!.entryId,
              direction: -1,
            })
          )}>Move this entry earlier</Button>
      <Button item
        icon="right"
        disabled={busy}
        onclick={() =>
          perform(() =>
            api(`lists/${item.listContext!.listId}/move`, {
              entryId: item.listContext!.entryId,
              direction: 1,
            })
          )}>Move this entry later</Button>
      <Button item
        icon="close"
        danger
        disabled={busy}
        onclick={() => removeEntry(item.listContext!.listId, item.listContext!.entryId)}
        >Remove from this list…</Button>
    {/if}
  {/if}
{/snippet}
{#if readOnly()}<Button href={`/media/${item.id}`} size="hero">Learn more</Button>{:else}
  <div class="row actions">
    {#if !menuOnly}
      {#if context === 'discover' || (hero && context !== 'details')}<Button
          size={hero ? "hero" : "standard"}
          href={`/media/${item.id}`}
          icon="arrow">Learn more</Button
        >
      {:else if (next ?? item).available}<Button
          size={hero ? "hero" : "standard"}
          icon="play"
          disabled={player.loading}
          onclick={start}>{primaryLabel}</Button
        >
      {:else if requestable || ['season', 'episode'].includes(item.kind)}<Button
          size={hero ? "hero" : "standard"}
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
    <Button menu
      bind:this={menu}
      panel
      hideTrigger={menuOnly && !showMenuTrigger}
      onopen={openMenu}
      label={`Actions for ${item.title}`}
      align="start"
      upward={hero}
      triggerClass={hero ? 'icon-button hero-icon-action' : 'icon-button'}
    >
      {#if error}<RowFeedback error={error} tag="div" class="menu-feedback text-danger" />
        <Button item icon="refresh" onclick={() => loadActions()}>Retry</Button>{/if}
      {@render content('root')}
    </Button>
  </div>
  {#if item.kind === 'collection' || item.sequence}<Dialog bind:open={sequenceControl.open} title={sequenceControl.title} message={sequenceControl.message} alert={!!sequenceControl.error} actions={sequenceControl.actions} />{/if}
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
    ><RowFeedback error={error} tag="p" class="" /></Dialog
  >
  {#if page.data.experiments?.planning}<PlanAction bind:open={planningOpen} workId={active.id} title={active.title} partyAllowed={page.data.experimentalParties&&['movie','episode','track'].includes(active.kind)}/>{/if}
  {#if page.data.playbackSharing}<ShareAction bind:open={sharingOpen} workId={active.id} title={active.title}/>{/if}
  <MetadataEditor mediaId={active.id} admin={editAdmin} bind:open={editOpen} />
  <Dialog bind:open={confirmOpen} title={confirmation?.title ?? 'Confirm change'}
    ><div class="stack">
      <p>{confirmation?.text}</p>
      {#if error}<RowFeedback error={error} tag="p" class="text-danger" />{/if}
      <div class="row">
        <Button
          danger={confirmation?.danger}
          disabled={busy}
          onclick={() => confirmation?.run()}>Confirm</Button
        ><Button emphasis="subtle" onclick={() => (confirmOpen = false)}>Cancel</Button>
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
      {#if error}<RowFeedback error={error} tag="p" class="text-danger" />{/if}
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
        ><Button emphasis="subtle" onclick={() => (form = null)}>Cancel</Button>
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
