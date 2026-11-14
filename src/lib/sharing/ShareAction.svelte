<script lang="ts">
  import Button from '#lib/ui/components/Button.svelte';
  import Dialog from '#lib/ui/components/Dialog.svelte';
  import { message, refreshAfterChange } from '#lib/ui/client.js';
  import { useClient, reportFailure } from '#lib/ui/client-context.js';
  import { publicSharePath, shareCompletionGraceMinutes, shareCompletionPercent, shareIdleMinutes } from './policy';
  import { tick, untrack } from 'svelte';
  import type {ShareTarget,VrchatVideoCodec} from './vrchat-profile';
  import {page} from '$app/state';
  const {api,change,preview,feedback}=useClient();

  let { workId, title, target='website', allowProgressTracking=true, open = $bindable(false) }: {
    workId: string; title: string; target?:ShareTarget; allowProgressTracking?:boolean; open?: boolean;
  } = $props();
  let busy = $state(false), loading = $state(false), error = $state('');
  let hours = $state(6), connectionId = $state(''), copied=$state(false);
  let autoRevoke = $state(false), trackProgress = $state(false);
  let videoCodec=$state<VrchatVideoCodec>('h264');
  let sources = $state<{ id: string; name: string }[]>([]);
  let created = $state<{ id: string; token: string; target: ShareTarget } | null>(null);
  let selection = $state<{ workId: string; title: string; target: ShareTarget }>();
  const selectedTarget = $derived(selection?.target ?? target);
  const inviteUrl = $derived(created ? `${preview?'https://coast.example':location.origin}${publicSharePath(created.token,created.target)}` : '');
  let activeDialog: AbortController | null = null;

  $effect(() => {
    if (!open) return;
    const selected = untrack(() => ({workId,title,target})), controller = new AbortController();
    selection = selected;
    activeDialog = controller;
    created = null; copied=false; error = ''; sources = []; connectionId = ''; loading = true;videoCodec='h264';
    autoRevoke = false; trackProgress = false;
    void api<typeof sources>(`sharing/sources?workId=${selected.workId}`, undefined, 'GET', { signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted) return;
        sources = value;
        connectionId = value[0]?.id ?? '';
      })
      .catch(cause => { if (!controller.signal.aborted) error = message(cause); })
      .finally(() => { if (!controller.signal.aborted) loading = false; });
    return () => {
      controller.abort();
      created = null;
      error = '';
    };
  });

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (busy || loading || !connectionId || !selection) return;
    const scope = activeDialog;
    busy = true; error = '';
    try {
      const result = await api<{ id: string; token: string; target: ShareTarget }>('sharing', { workId:selection.workId, connectionId, hours,target:selection.target,videoCodec,autoRevoke,trackProgress });
      if (scope === activeDialog && !scope?.signal.aborted) {
        created = result;
        await tick();
      }
      if (!preview) void refreshAfterChange('sharing').catch(() => feedback.notify('Link created. Reload the page to refresh your active links.'));
    }
    catch (cause) { if (scope === activeDialog && !scope?.signal.aborted) error = message(cause); }
    finally { busy = false; }
  }
  async function revoke() {
    if (busy || !created) return;
    const scope = activeDialog;
    busy = true; error = '';
    try {
      await change(`sharing/${created.id}`, undefined, 'DELETE');
      if (scope === activeDialog && !scope?.signal.aborted) { created = null; open = false; }
    }
    catch (cause) { if (scope === activeDialog && !scope?.signal.aborted) error = message(cause); }
    finally { busy = false; }
  }
  async function copyLink() {
    if(!created)return;
    if(preview){copied=true;return;}
    const scope=activeDialog;
    try {await navigator.clipboard.writeText(inviteUrl);if(scope===activeDialog&&!scope?.signal.aborted)copied=true;}
    catch {if(scope===activeDialog&&!scope?.signal.aborted)error='Select the link and copy it using your browser.';}
  }
  reportFailure(()=>error);
</script>

<Dialog bind:open title={`${selectedTarget==='vrchat'?'Share to VRChat':'Share'} · ${selection?.title ?? title}`}>
  <p class="small muted">Anyone with this link can play this item until it expires or you revoke it. Each viewer controls their own playback.</p>
  {#if created}
    <label class="field">Invitation link
      <input readonly value={inviteUrl} onfocus={event => event.currentTarget.select()} />
    </label>
    <Button onclick={copyLink}>{copied?'Copied':'Copy'}</Button>
    <Button disabled={busy} onclick={revoke}>Revoke</Button>
  {:else}
    <form class="stack" onsubmit={create}>
      <label class="field">Source
        <select bind:value={connectionId} required disabled={loading}>
          {#each sources as source}<option value={source.id}>{source.name}</option>{/each}
        </select>
      </label>
      <label class="field">Expires in hours<input type="number" min="1" max="24" bind:value={hours} required /></label>
      {#if selectedTarget==='vrchat'}
        <p class="small muted">For AVPro video players, including compatible ProTV and VideoTXL worlds. Unity-only players need a direct video file.</p>
        {#if page.data.allowVrchatHevc}<label class="field">Video format<select bind:value={videoCodec}><option value="h264">H.264 / AAC · MPEG-TS HLS</option><option value="hevc">H.265 / AAC · fMP4 HLS (experimental)</option></select></label>{/if}
      {/if}
      <label class="check"><input type="checkbox" bind:checked={autoRevoke} /> Auto-revoke after playback</label>
      <p class="small muted">Close a used link after {shareIdleMinutes} minutes without a viewer, or {shareCompletionGraceMinutes} minutes after everyone leaves if one viewer reached {shareCompletionPercent}%{selectedTarget==='vrchat'?' (estimated)':''}.</p>
      {#if allowProgressTracking}
        <label class="check"><input type="checkbox" bind:checked={trackProgress} /> Track progress</label>
        <p class="small muted">Show playback in your live activity and record one watch on your account when any viewer reaches {shareCompletionPercent}%.{selectedTarget==='vrchat'?' VRChat progress is estimated from video segments served.':''}</p>
      {/if}
      <Button type="submit" disabled={busy || loading || !connectionId}>{busy ? 'Creating…' : 'Create'}</Button>
    </form>
  {/if}

</Dialog>
