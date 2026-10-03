<script lang="ts">
  import Button from '$lib/ui/components/Button.svelte';
  import Dialog from '$lib/ui/components/Dialog.svelte';
  import { api, message } from '$lib/ui/client';

  let { workId, title, open = $bindable(false) }: {
    workId: string; title: string; open?: boolean;
  } = $props();
  let busy = $state(false), loading = $state(false), error = $state('');
  let hours = $state(6), together = $state(false), connectionId = $state('');
  let sources = $state<{ id: string; name: string }[]>([]);
  let created = $state<{ id: string; token: string } | null>(null);
  let activeDialog: AbortController | null = null;

  $effect(() => {
    if (!open) return;
    const id = workId, controller = new AbortController();
    activeDialog = controller;
    created = null; error = ''; sources = []; connectionId = ''; loading = true;
    void api<typeof sources>(`sharing/sources?workId=${id}`, undefined, 'GET', { signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted) return;
        sources = value;
        connectionId = value[0]?.id ?? '';
      })
      .catch(cause => { if (!controller.signal.aborted) error = message(cause); })
      .finally(() => { if (!controller.signal.aborted) loading = false; });
    return () => controller.abort();
  });

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (busy || loading || !connectionId) return;
    const scope = activeDialog;
    busy = true; error = '';
    try {
      const result = await api<{ id: string; token: string }>('sharing', { workId, connectionId, hours, together });
      if (scope === activeDialog && !scope?.signal.aborted) created = result;
    }
    catch (cause) { if (scope === activeDialog && !scope?.signal.aborted) error = message(cause); }
    finally { busy = false; }
  }
  async function revoke() {
    if (busy || !created) return;
    const scope = activeDialog;
    busy = true; error = '';
    try {
      await api(`sharing/${created.id}`, undefined, 'DELETE');
      if (scope === activeDialog && !scope?.signal.aborted) { created = null; open = false; }
    }
    catch (cause) { if (scope === activeDialog && !scope?.signal.aborted) error = message(cause); }
    finally { busy = false; }
  }
</script>

<Dialog bind:open title={`Share · ${title}`}>
  <p class="small muted">Single-use playback invitation · visual treatment unapproved</p>
  {#if created}
    <label class="field">Invitation link
      <input readonly value={`${location.origin}/share#invite=${created.token}`} onfocus={event => event.currentTarget.select()} />
    </label>
    {#if together}<Button href={`/share?id=${created.id}`}>Host</Button>{/if}
    <Button disabled={busy} onclick={revoke}>Revoke</Button>
  {:else}
    <form class="stack" onsubmit={create}>
      <label class="field">Source
        <select bind:value={connectionId} required disabled={loading}>
          {#each sources as source}<option value={source.id}>{source.name}</option>{/each}
        </select>
      </label>
      <label class="field">Expires in hours<input type="number" min="1" max="24" bind:value={hours} required /></label>
      <label class="check"><input type="checkbox" bind:checked={together} />Watch or listen together</label>
      <Button type="submit" disabled={busy || loading || !connectionId}>{busy ? 'Creating…' : 'Create'}</Button>
    </form>
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
</Dialog>
