<script lang="ts">
  import { useRetention } from '#lib/ui/retention.js';
  import { reportFailure } from '#lib/ui/client-context.js';
  import { menuCondition, useMenuPreview } from '#lib/ui/controls/menu-preview.js';
  import WorkActions from '../components/WorkActions.svelte';
  import { relationshipControls } from '#lib/ui/controls/actions.js';
  import { getContext, onDestroy, untrack, type Snippet } from 'svelte';
  import { createResource } from '#lib/ui/resource.svelte.js';
  import { createMenuResource } from '#lib/ui/controls/menu-resource.svelte.js';
  import { retryMenuRead } from '#lib/ui/controls/menu-read-retry.js';
  import { workMenuScope } from '#lib/ui/controls/work.svelte.js';
  import type { WorkList } from '#lib/media/work-actions.js';
  import WorkListActions from '../components/WorkListActions.svelte';
  import { page } from '$app/state';
  import { createMutation } from '#lib/ui/mutation.svelte.js';
  import { setRelationship } from '#lib/ui/relationships.js';

  import { sequencePath } from '#lib/media/sequence.js';
  import {
    isMediaGroup,
    isResumable,
    targetLabel,
    type MediaActionData,
  } from '#lib/media/actions.js';
  import { requestQualityStatus, requestSeasonChoices, requestSeasonStatus, type RequestDestination } from '#lib/media/requests.js';
  import { requestStatusLabel } from '#lib/library-feed.js';
  import type { MediaView } from '#lib/ui/types.js';
  import { message, ApiError } from '#lib/ui/client.js';
  import { useClient } from '#lib/ui/client-context.js';
  import { playbackTime } from '#lib/playback/time.js';
  import { playMedia } from '#lib/playback/client.svelte.js';
  import { pendingSubtitle, rememberSubtitle } from '#lib/playback/subtitle-selection.svelte.js';
  import { createSubtitleControls } from '#lib/playback/subtitle-controls.svelte.js';
  import SubtitleMenu from '../components/SubtitleMenu.svelte';
  import SubtitleSearchDialog from '../components/SubtitleSearchDialog.svelte';
  import { usePlayback } from '#lib/playback/context.svelte.js';
  import ShareAction from '#lib/sharing/ShareAction.svelte';
  import PlanAction from '#lib/experiments/PlanAction.svelte';
  import Button from '../components/Button.svelte';
  import Icon from '../components/Icon.svelte';
  import CheckInActions from '../components/CheckInActions.svelte';

  import Dialog from '../components/Dialog.svelte';
  import RequestDialog from '../components/RequestDialog.svelte';
  import { createRequestControls } from '#lib/ui/controls/requests.svelte.js';
  import { createSequencePlayback } from '#lib/ui/controls/sequence.svelte.js';
  import MetadataEditor from '../components/MetadataEditor.svelte';

  const readOnly = getContext<() => boolean>('profile-read-only') ?? (() => false);

  const { api, change } = useClient();

  const { player, preview } = usePlayback();
  const fixture = preview ? useMenuPreview() : undefined;
  const allowed = (id: Parameters<typeof menuCondition>[0], actual: boolean) => menuCondition(id, actual, preview, fixture);
  const playbackAllowed = $derived(allowed('playback', page.data.capabilities?.playback !== false));
  const socialAllowed = $derived(allowed('social', page.data.capabilities?.social !== false));
  const planningAllowed = $derived(allowed('planning', !!page.data.experiments?.planning));
  const presenceAllowed = $derived(allowed('presence', page.data.capabilities?.presence !== false));
  const requestsAllowed = $derived(allowed('requests', page.data.capabilities?.requests !== false));

  let {
    item,
    context = 'details',
    next = null,
    requestable = false,
    hero = false,
    menuOnly = false,
    showTrigger = false,editionName,entryActions,tasteAction,
  }: {
    item: MediaView;editionName?:string;
    context?: 'discover' | 'details' | 'home';
    next?: MediaView | null;
    requestable?: boolean;
    hero?: boolean;
    menuOnly?: boolean;
    showTrigger?: boolean;
    entryActions?: Snippet;
    tasteAction?: Snippet<[workId?: string, rating?: number | null]>;
  } = $props();
  type View =
    | 'root'
    | 'play'
    | 'share'
    | 'disposable-link'
    | 'manage'
    | 'tracking'
    | 'history'
    | 'watched'
    | 'rewatch'
    | 'admin';
  let menu = $state<Button>(), ratingActions=$state<WorkActions>();
  const sequenceControl = createSequencePlayback({ source: () => item.kind === 'collection' || item.sequence ? item.sequence ?? {kind: 'collection', id: item.id} : undefined, from: () => item.sequence?.entryId, experimentalMusic: () => !!page.data.experimentalMusic, preview, api, change });
  reportFailure(() => sequenceControl.error);
  const menuScope = () => workMenuScope([item.id, item.sequence, item.listContext]);
  const snapshot = createMenuResource<MediaActionData | null>(() => null,
    menuScope, async signal => {
      const target = item;
      const result = await api<MediaActionData>(`media/${target.id}/actions`, undefined, 'GET', { signal });
      if (target.sequence) {
        result.item.sequence = target.sequence;
        const resolved = await api<{ next: MediaView | null }>(sequencePath(target.sequence, { from: target.sequence.entryId }), undefined, 'GET', { signal });
        if (resolved.next?.id === target.id) result.item = { ...result.item, ...resolved.next };
        result.playable = resolved.next;
      }
      return result;
    }, retryMenuRead);
  const data = $derived(snapshot.data), loading = $derived(snapshot.busy);
  const mutation = createMutation(() => snapshot.refresh(), useClient().feedback.notify, useRetention());
  const busy = $derived(mutation.busy);
  $effect(() => {
    const key = menuScope();
    untrack(() => { key; snapshot.sync(key); requests.resetOptions(); if (snapshot.active && !mutation.busy && !ratingActions?.isBusy()) void snapshot.load(); });
  });
  const playTarget = createResource<MediaView | null>(null);
  let alive = true;
  onDestroy(() => { alive = false; snapshot.dispose(); playTarget.dispose(); requests.resetOptions(); });
  const active = $derived(data?.item ?? item);
  const wholeWork = $derived(data?.wholeWork ?? active);
  const trackingPaused = $derived(wholeWork.status === 'paused');
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
  const canPauseTracking = $derived((wholeWork.kind === 'movie' || wholeWork.kind === 'show') &&
    (wholeWork.dropped || trackingPaused || continuing || (wholeWork.watchlist && !wholeWork.watched)));
  const recordAgain = $derived(active.watched || active.playCount > 0);
  const isAdmin = $derived(allowed('admin', page.data.user?.role === 'admin'));
  const featureTarget=$derived(['movie','show','season','episode'].includes(active.kind)?active:null);
  const featuredHere=$derived(!!featureTarget&&page.data.featuredHeroIds?.includes(featureTarget.id));
  const isGroup = $derived(isMediaGroup(active));
  const playable = $derived(data ? data.playable : isMediaGroup(item) ? next : item);
  const playbackPending = $derived((playable ?? active).playbackPending === true);
  const editions = $derived(data?.editions ?? []);
  let editionChoice = $state<{ mediaId: string; edition: string }>();
  const profileBackground = $derived(fixture?.profileBackground(active.id,page.data.user?.settings?.profile?.backgroundMediaId === active.id)
    ?? page.data.user?.settings?.profile?.backgroundMediaId === active.id);
  const canShare = $derived(allowed('sharing', !!page.data.playbackSharing) && ['movie', 'episode'].includes(active.kind) && active.available);
  const selectedEdition = $derived(
    editionChoice && editionChoice.mediaId === playable?.id ? editionChoice.edition :
    editionName===undefined&&page.params.id === active.id
      ? (page.url.searchParams.get('edition') ?? undefined)
      : undefined
  );
  const subtitleTarget = $derived(playbackAllowed && playable?.available && !playbackPending &&
    ['movie', 'episode'].includes(active.kind) && !readOnly() && !page.data.user?.access?.libraryOnly && (preview || !!page.data.user)
    ? playable : null);
  const subtitleEdition = $derived(selectedEdition !== undefined ? { edition: selectedEdition } : editionName ? { editionName } : {});
  const subtitleChoice = $derived(subtitleTarget ? pendingSubtitle(subtitleTarget.id, subtitleEdition) : undefined);
  let previewSubtitle = $state(-1);
  const subtitleIndex = $derived(preview ? previewSubtitle : subtitleChoice?.index);
  const subtitles = createSubtitleControls({
    endpoint: () => `media/${subtitleTarget?.id}/subtitles?${new URLSearchParams(subtitleEdition as Record<string, string>)}`,
    owner: () => page.data.user?.id ?? '',
    added: ({ source, index }) => {
      if (preview) previewSubtitle = index;
      else if (source && subtitleTarget) rememberSubtitle(subtitleTarget.id, subtitleEdition, { ...source, index });
    },
  });
  const resumable = $derived(!!playable && isResumable(playable));
  const playLabel = $derived(
    `${resumable ? 'Resume' : 'Play'}${playable?.kind === 'episode' ? ` S${String(playable.seasonNumber ?? 0).padStart(2, '0')}E${String(playable.episodeNumber ?? 0).padStart(2, '0')}` : ''}`
  );
  const requestItem = $derived(
    data ? data.requestTarget : ['movie', 'show'].includes(item.kind) ? item : null
  );
  const requests = createRequestControls({item: () => requestItem, data: () => data, scope: menuScope, api, onrequest: () => (fourK = false, options) => {requestOptions = options; openRequest(fourK);}});
  const primaryLabel = $derived(
    (next ?? item).kind === 'episode'
      ? `${isResumable(next ?? item) ? 'Resume' : 'Play'} S${String((next ?? item).seasonNumber ?? 0).padStart(2, '0')}E${String((next ?? item).episodeNumber ?? 0).padStart(2, '0')}`
      : isResumable(item)
        ? 'Resume'
        : 'Play'
  );
  let planningOpen=$state(false),sharingOpen=$state(false);
  let sharingTarget=$state<'website'|'vrchat'>('website');
  let requestOpen = $state(false),
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
  let initialSeasons = $state<readonly number[]>();
  let seasonSelection = $state<Record<'standard' | 'fourK', number[]>>({ standard: [], fourK: [] });
  function openRequest(fourK = false, seasons?: readonly number[]) {
    initialSeasons = seasons;
    request4k = fourK;
    requestOpen = true;
  }
  function manageRequest(
    request: MediaActionData['requests'][number],
    action: 'cancel' | 'approve' | 'decline'
  ) {
    confirm(
      `${action === 'cancel' ? 'Cancel' : action === 'approve' ? 'Approve' : 'Decline'} request?`,
      `${requestItem?.title ?? active.title} · ${requests.scopeLabel(request)}`,
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

  function loadActions() { return snapshot.load(true); }
  function openMenu() { void snapshot.open(); }
  function closeMenu() { snapshot.close(); requests.cancel(); }
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
          : at,
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
    const target = active;
    if (!target.sequence && !isMediaGroup(target)) return data?.playable ?? target;
    return playTarget.load(async signal => {
      const result = await api<{ next: MediaView | null }>(target.sequence
        ? sequencePath(target.sequence, { from: target.sequence.entryId }) : `media/${target.id}/playable`, undefined, 'GET', { signal });
      return result.next;
    });
  }
  async function play(edition?: string, fromStart = false) {
    if (preview) return;
    mutation.error = '';
    try {
      const target = await resolvedPlayback();
      if (!alive) return;
      if (!target?.available) throw new Error('The next item is not available to play.');
      await playMedia(target.id, {
        edition,editionName:edition===undefined?editionName:undefined,
        fromStart,
        sequence: target.sequence,
        continuationId: isGroup ? active.id : target.showId,
      });
    } catch (cause) {
      if (alive) { mutation.error = message(cause); }
    }
  }
  async function startTarget() {
    if (playbackPending) return;
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
    initialSeasons = undefined;
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
  async function toggleList(list: WorkList) {
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
          await snapshot.refresh();
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
          await snapshot.refresh();
        }
      );
    }
  }
  async function toggleContinue() {
    const target = wholeWork;
    const removing = continuing || trackingPaused;
    let result:
      | { eventId?: string; previous?: import('#lib/core/tracking/continue.server.js').ContinueSnapshot }
      | undefined;
    await perform(
      async () => {
        result = await change('continue', {
          mediaId: target.id,
          action: removing ? 'remove' : 'add',
        });
      },
      `${target.title} · ${removing ? 'Hidden from Progress' : target.dropped ? 'Restored to Progress' : 'Added to Next'}`,
      removing
        ? async () => {
            await change('continue', { mediaId: target.id, action: 'undo', ...result });
            await snapshot.refresh();
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
        await snapshot.refresh();
      }
    );
  }
  function refresh() {
    const target = data?.refreshTarget;
    if (target)
      void perform(() => change(`media/${target.id}/refresh`, {}), 'Metadata refreshed.');
  }
  function featureOnForYou(){
    const target=featureTarget,remove=featuredHere;
    if(!target||!isAdmin||preview)return;
    void perform(()=>change('admin/featured-hero',{mediaId:target.id,featured:!remove}),remove?'Title removed from For You heroes.':`${target.title} · Featured on For You.`);
  }
  function toggleBackground() {
    const selected = profileBackground,mediaId=active.id;
    void perform(async () => {
      const result=await change('profile', { action: 'background', mediaId: selected ? null : mediaId });
      fixture?.setProfileBackground(selected ? null : mediaId);
      return result;
    },
      selected ? 'Profile background cleared.' : 'Profile background set.');
  }
  function endRewatch() {
    const mediaId = wholeWork.id;
    void perform(() => change('rewatch', { mediaId, startedAt: null }), 'Rewatch ended.');
  }

  reportFailure(() => mutation.error);
  reportFailure(() => snapshot.error && `Could not load menu actions. ${snapshot.error}`);
  reportFailure(() => requests.requestOptionsError && `Could not load request options. ${requests.requestOptionsError}`);
</script>

{#snippet requestManagement(request: MediaActionData['requests'][number])}
  <Button item disabled>{requestStatusLabel(request.state)}</Button>
  {#if request.canApprove || request.canCancel || request.canDecline}<div class="menu-divider" role="separator"></div>{/if}
  {#if request.canApprove}<Button item
      icon="check"
      disabled={busy}
      onclick={() => manageRequest(request, 'approve')}>Approve request…</Button>{/if}
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
{#snippet seasons(quality: 'standard' | 'fourK')}
  {@const choices = requestSeasonChoices(requests.requestOptions ?? [], quality, active.kind === 'season' ? active.seasonNumber : undefined)}
  {@const enabled = new Set(choices.filter(choice => choice.selectable).map(choice => choice.number))}
  {@const selected = seasonSelection[quality].filter(number => enabled.has(number))}
  {#each choices as choice (choice.number)}
    <Button item checked={choice.selectable ? selected.includes(choice.number) : undefined}
      disabled={!choice.selectable} keepOpen onclick={() => {
        seasonSelection[quality] = selected.includes(choice.number) ? selected.filter(number => number !== choice.number) : [...selected, choice.number];
      }}>
      <span class="menu-season"><span>Season {choice.number}</span>
        {#if !choice.selectable}<small>{requestSeasonStatus(choice) ?? 'Unavailable'}</small>{/if}
      </span>
    </Button>
  {/each}
  {#if choices.length}
    <div class="menu-divider" role="separator"></div>
    <Button item icon="request" disabled={!selected.length} onclick={() => {
      requestOptions = requests.requestOptions;
      openRequest(quality === 'fourK', selected);
    }}>
      {selected.length === 1 ? 'Request season…' : selected.length ? `Request ${selected.length} seasons…` : 'Request seasons…'}
    </Button>
  {/if}
{/snippet}

{#snippet choices()}
  {@const series = requestItem?.kind === 'show'}
  {@const standard = !!requests.requestOptions?.some(destination => destination.variants.standard)}
  {@const fourK = !!requests.requestOptions?.some(destination => destination.variants.fourK)}
  {#if requests.requestOptionsBusy}
    <div class="menu-label" role="status">Loading request options…</div>
  {:else if requests.requestOptionsError}
    <div class="menu-label" role="status">Request options unavailable</div>
  {/if}
  {#if standard}
    {#if series}{@render seasons('standard')}
    {:else}<Button item icon="request" disabled={!requests.canRequestStandard} onclick={() => requests.openRequest()}>
      <span class="menu-season"><span>Request standard version…</span>
        {#if !requests.canRequestStandard}<small>{requestQualityStatus(requests.requestOptions ?? [], 'standard')}</small>{/if}
      </span>
    </Button>{/if}
  {/if}
  {#if fourK}
    {#if standard}<div class="menu-divider" role="separator"></div>{/if}
    {#if series}
      <Button menu label="Request 4K" icon="request" panel>{@render seasons('fourK')}</Button>
    {:else}
      <Button item icon="request" disabled={!requests.canRequest4k} onclick={() => requests.openRequest(true)}>
        <span class="menu-season"><span>Request 4K…</span>
          {#if !requests.canRequest4k}<small>{requestQualityStatus(requests.requestOptions ?? [], 'fourK')}</small>{/if}
        </span>
      </Button>
    {/if}
  {/if}
  {#if requests.existingRequests.length}
    {#if standard || fourK}<div class="menu-divider" role="separator"></div>{/if}
    <Button menu label="Manage requests" icon="list" panel>
      {#each requests.existingRequests as request (request.id)}
        <Button menu label={requests.scopeLabel(request)} icon="request" title={requestStatusLabel(request.state)} panel>
          {@render requestManagement(request)}
        </Button>
      {/each}
    </Button>
  {:else if !standard && !fourK && requests.requestOptions && !requests.requestOptionsBusy}
    <Button item disabled>Nothing to request</Button>
  {/if}
{/snippet}

{#snippet requestControls()}
  {#if requests.canManageRequests || !requests.requestDisabledReason}
    <Button menu label="Request" icon="request" panel disabled={busy || loading}
      onopen={() => void requests.loadRequestOptions()} onclose={() => {
        requests.cancel();
        seasonSelection = { standard: [], fourK: [] };
      }}>
      {@render choices()}
    </Button>
  {:else}
    <Button item icon="request" disabled disabledReason={requests.requestDisabledReason}>Request</Button>
  {/if}
{/snippet}

{#snippet branch(label: string, to: View, icon: import('../components/Icon.svelte').IconName, primaryAction?: () => void)}
  <Button menu {label} {icon} panel disabled={busy || loading} {primaryAction}>
    {@render content(to)}
  </Button>
{/snippet}
{#snippet content(view: View)}
  {#if view === 'root'}
    {#if playbackPending}
      <Button item icon="clock" disabled disabledReason="In your Jellyfin library. Waiting for a playable stream.">Stream pending</Button>
    {:else if playbackAllowed && (playable?.available || active.kind === 'collection' && active.available)}
      {#if resumable || editions.length > 1 || subtitleTarget}
        {@render branch(playLabel, 'play', 'play', startTarget)}
      {:else}
        <Button item icon="play" disabled={loading || player.loading} onclick={startTarget}>{playLabel}</Button>
      {/if}
    {:else}
      <Button item icon="clock" disabled disabledReason="A playable source is required.">Playback unavailable</Button>
    {/if}
    {#if presenceAllowed}
      <CheckInActions workId={active.id} kind={active.kind} active={data?.activeCheckin} disabled={busy || loading}
        preferredWorkId={['show','season'].includes(active.kind)&&playable?.kind==='episode'?playable.id:undefined}
        preferredLabel={['show','season'].includes(active.kind)&&playable?.kind==='episode'?playable.title:undefined}
        onchange={value => snapshot.patch(data => data ? { ...data, activeCheckin: value, activeCheckinId: value?.id ?? null } : data)} />
    {/if}
    <div class="menu-divider" role="separator"></div>
    <WorkActions bind:this={ratingActions} section="rating" workId={active.id} rating={active.rating}
      onrated={value => snapshot.patch(data => data ? { ...data, item: { ...data.item, rating: value } } : data)} />
    <div class="menu-divider" role="separator"></div>
    {@render branch('Mark as watched', 'watched', 'check', () => recordWatch('now'))}
    {@render branch(wholeWork.rewatchStartedAt ? 'Rewatch' : 'Start rewatch', 'rewatch', 'replay', wholeWork.rewatchStartedAt ? undefined : startRewatchNow)}
    {#if socialAllowed}<WorkActions section="reaction" workId={active.id} disabled={busy || loading} />{/if}
    {#if active.kind !== 'collection' && requestsAllowed}{@render requestControls()}{/if}
    {@render branch('Manage', 'manage', 'sliders')}
    <div class="menu-divider" role="separator"></div>
    <WorkActions section="quick" workId={active.id} controls={[
      ...relationshipControls([
        { kind: 'watchlist', value: active.watchlist, icon: 'bookmark', label: active.watchlist ? 'Remove from Watchlist' : 'Add to Watchlist' },
        { kind: 'collected', value: active.collected, icon: 'collection', label: `${active.collected ? 'Remove from' : 'Add to'} Collection` },
        { kind: 'favourite', value: active.favourite, icon: 'heart', label: `${active.favourite ? 'Remove from' : 'Add to'} Favourites` },
      ], relationship => {
        if (relationship === 'collected') void perform(
          () => setRelationship(active.id, relationship, !active.collected, change),
          active.collected ? 'Removed from Collection.' : 'Added to Collection.'
        );
        else toggleSaved(relationship);
      }, busy || loading),
      { item: true, icon: 'image', checked: profileBackground, text: profileBackground ? 'Clear profile background' : 'Set as profile background',
        disabled: busy, onclick: toggleBackground }
    ]} />
    {#if canShare || socialAllowed || planningAllowed || isAdmin}
      <div class="menu-divider" role="separator"></div>
      {#if canShare || socialAllowed || planningAllowed}
        {@render branch('Share', 'share', 'share')}
      {/if}
      {#if isAdmin}{@render branch('Admin', 'admin', 'shield')}{/if}
    {/if}
  {:else if view === 'share'}
    {#if canShare}
      <Button menu label="Create disposable link" icon="link" panel>
        {#snippet trigger()}
          <Icon name="link" />
          <span class="menu-action-label menu-row-copy"><span>Create disposable link</span><small>No sign-in · expires</small></span>
          <span class="menu-chevron"><Icon name="right" /></span>
        {/snippet}
        {@render content('disposable-link')}
      </Button>
      {#if socialAllowed || planningAllowed}<div class="menu-divider" role="separator"></div>{/if}
    {/if}
    {#if socialAllowed}<WorkActions section="recommend" workId={active.id} disabled={busy || loading} />{/if}
    {#if planningAllowed}<Button item icon="calendar" onclick={() => { planningOpen = true; }}>Plan to watch…</Button>{/if}
  {:else if view === 'disposable-link'}
    <Button item icon="play" onclick={() => { sharingTarget = 'website'; sharingOpen = true; }}>Website link…</Button>
    <Button item icon="broadcast" onclick={() => { sharingTarget = 'vrchat'; sharingOpen = true; }}>VRChat link…</Button>
  {:else if view === 'play'}
    <Button item icon="play" disabled={player.loading} onclick={startTarget}>
      {resumable ? `Resume from ${playbackTime(playable!.progress)}` : playLabel}
    </Button>
    {#if resumable}
      <Button item icon="skipBack" disabled={player.loading} onclick={() => play(selectedEdition, true)}>Play from beginning</Button>
    {/if}
    {#if editions.length > 1 && playable || subtitleTarget}
      <div class="menu-divider" role="separator"></div>
    {/if}
    {#if editions.length > 1 && playable}
      <Button menu label="Version" icon="film" panel>
        {#each editions as edition (edition)}
          <Button item selection="radio" checked={edition === (selectedEdition ?? editions[0])} keepOpen disabled={player.loading}
            onclick={() => { if (playable) editionChoice = { mediaId: playable.id, edition }; }}>{edition || 'Original'}</Button>
        {/each}
      </Button>
    {/if}
    {#if subtitleTarget}
      <SubtitleMenu controls={subtitles} selected={subtitleIndex} onselect={(index, options) => {
        if (preview) previewSubtitle = index;
        else if (options?.source) rememberSubtitle(subtitleTarget!.id, subtitleEdition, { ...options.source, index });
      }} />
    {/if}
  {:else if view === 'manage'}
    {@render branch('Tracking', 'tracking', 'checklist')}
    {@render branch('History', 'history', 'history')}
    <div class="menu-divider" role="separator"></div>
    <WorkListActions workId={active.id} select={toggleList} disabled={busy || loading} />
  {:else if view === 'tracking'}
    {#if canPauseTracking}
      <Button item icon={trackingPaused ? 'play' : 'pause'} disabled={busy || loading} keepOpen
        onclick={() => {
          const paused = trackingPaused;
          const mediaId = wholeWork.id;
          void perform(() => change('tracking', { mediaId, action: paused ? 'resume' : 'pause' }),
            paused ? 'Tracking resumed.' : 'Tracking paused.');
        }}>{trackingPaused ? 'Resume tracking' : 'Pause tracking'}</Button>
    {/if}
    <Button item icon="list" keepOpen disabled={busy || loading} onclick={toggleContinue}>
      {continuing || trackingPaused ? 'Hide from Progress' : wholeWork.dropped ? 'Show in Progress' : 'Add to Next'}
    </Button>
  {:else if view === 'watched'}
    <Button item icon="check" disabled={busy || loading} onclick={() => recordWatch('now')}
      >Now</Button>
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
    <Button item icon="clock" href={`/media/${active.id}?section=activity&relationship=consumed`}>View history</Button>
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
    <Button item icon="close" danger href={`/media/${active.id}/history`}
      >Remove from history…</Button>
  {:else if view === 'rewatch'}
    {#if wholeWork.rewatchStartedAt}
      <Button item icon="close" disabled={busy || loading} onclick={endRewatch}>End rewatch</Button>
    {:else}
      <Button item icon="replay" disabled={busy || loading} onclick={startRewatchNow}>Now</Button>
      <Button item icon="calendar" disabled={busy || loading} onclick={() => openForm('rewatch', wholeWork)}>Choose date…</Button>
    {/if}
  {:else if view === 'admin' && isAdmin}
    {#if featureTarget}<Button item icon="star" checked={featuredHere} disabled={busy||preview} onclick={featureOnForYou}>{featuredHere?'Remove from For You hero':'Feature on For You'}</Button>{/if}
    {#if data?.refreshTarget}<Button item icon="refresh" disabled={busy} onclick={refresh}
        title={data.refreshTarget.id===active.id?undefined:`Refresh metadata for ${data.refreshTarget.title}`}>Refresh metadata</Button>{/if}
    {#if isAdmin}<Button item
        icon="settings"
        onclick={() => {
          editAdmin = true;
          editOpen = true;
        }}>Edit metadata…</Button>{/if}
    {@render tasteAction?.(active.id, active.rating)}
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
      {:else if (next ?? item).playbackPending}<span class="badge">Stream pending</span>
      {:else if (next ?? item).available && playbackAllowed}<Button
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
      <Button size="icon" icon="bookmark" iconSize={20} class={`${hero?'hero-icon-action ':''}${item.watchlist?'selected':''}`} label={item.watchlist?'Remove from watchlist':'Add to watchlist'} pressed={item.watchlist} disabled={busy} onclick={()=>toggleSaved('watchlist',item)} />
      <Button size="icon" icon="heart" iconSize={20} class={`${hero?'hero-icon-action ':''}${item.favourite?'selected':''}`} label={item.favourite?'Remove from favourites':'Add to favourites'} pressed={item.favourite} disabled={busy} onclick={()=>toggleSaved('favourite',item)} />
    {/if}
    <Button menu
      bind:this={menu}
      panel
      hideTrigger={menuOnly && !showTrigger}
      onopen={entryActions ? undefined : openMenu}
      onclose={entryActions ? undefined : closeMenu}
      label={`Actions for ${item.title}`}
      align="start"
      upward={hero}
      triggerClass={hero ? 'icon-button hero-icon-action' : 'icon-button'}
    >
      {#if entryActions}
        {@render entryActions()}
        <div class="menu-divider" role="separator"></div>
        <Button menu label="Title actions" icon="more" panel onopen={openMenu} onclose={closeMenu}>
          {@render content('root')}
        </Button>
      {:else}
        {@render content('root')}
      {/if}
    </Button>
  </div>
  {#if subtitles.advanced && subtitleTarget}
    <SubtitleSearchDialog controls={subtitles} title={subtitleTarget.title} selected={subtitleIndex} />
  {/if}
  {#if item.kind === 'collection' || item.sequence}<Dialog bind:open={sequenceControl.open} title={sequenceControl.title} message={sequenceControl.message} actions={sequenceControl.actions} />{/if}
  {#if requestItem}<RequestDialog
      item={requestItem}
      initial4k={request4k}
      {initialSeasons}
      options={requestOptions}
      onsent={() => {
        requestOptions = undefined;
        void snapshot.refresh();
      }}
      seasonNumber={active.kind === 'episode' || active.kind === 'season'
        ? active.seasonNumber
        : undefined}
      bind:open={requestOpen}
    />{/if}

  {#if planningAllowed}<PlanAction bind:open={planningOpen} workId={active.id} title={active.title} partyAllowed={page.data.experimentalParties&&['movie','episode','track'].includes(active.kind)}/>{/if}
  {#if allowed('sharing', !!page.data.playbackSharing)}<ShareAction bind:open={sharingOpen} workId={active.id} title={active.title} target={sharingTarget}/>{/if}
  <MetadataEditor mediaId={active.id} admin={editAdmin} bind:open={editOpen} />
  <Dialog bind:open={confirmOpen} title={confirmation?.title ?? 'Confirm change'}
    ><div class="stack">
      <p>{confirmation?.text}</p>

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
  .menu-season { display: flex; gap: var(--menu-inset); justify-content: space-between; }
  .menu-season small { color: var(--muted); font-weight: var(--weight-regular); }
  .actions {
    gap: 12px;
  }
</style>
