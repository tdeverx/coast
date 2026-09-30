<script lang="ts">
  import { notifyAction } from '$lib/ui/action-feedback.svelte';
  import { untrack } from 'svelte';
  import { providerSchedule } from '$lib/providers/schedule';
  import { change, message } from '$lib/ui/client';
  import Button from './Button.svelte';
  let {
    provider,
  }: {
    provider: {
      id: string;
      connectedAccounts: number;
      schedule: import('$lib/providers/schedule').ProviderSchedule;
      name: string;
      provider: string;
    };
  } = $props();
  let schedule = $state(untrack(() => providerSchedule(provider.provider, provider.schedule)));
  let busy = $state(false),
    error = $state(''),
    saved = $state(untrack(() => JSON.stringify(schedule)));
  const dirty = $derived(JSON.stringify(schedule) !== saved);
  async function perform(run: boolean) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const result = await change<{
        queued: number;
        active: number;
        connections: number;
        busy?: boolean;
      }>(`providers/${provider.id}/${run ? 'run-job' : 'schedule'}`, run ? {} : schedule);
      if (!run) saved = JSON.stringify(schedule);
      notifyAction(
        run
          ? result.busy
            ? 'Maintenance is already being checked.'
            : `${result.queued} account updates queued${result.active ? `; ${result.active} already active` : ''}.`
          : 'Schedule saved.'
      );
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }
</script>

<form
  class="panel stack"
  onsubmit={(event) => {
    event.preventDefault();
    void perform(false);
  }}
>
  <div>
    <h3>{provider.name}</h3>
    <p class="small">
      {provider.provider === 'jellyfin'
        ? 'Library scans and optional playback imports'
        : provider.provider === 'seerr'
          ? 'Request status updates'
          : 'Imports using each account’s selected Trakt sync categories'}
    </p>
  </div>
  <p class="small">
    <span class="badge"
      >{dirty
        ? 'Unsaved changes'
        : schedule.enabled
          ? 'Automatic runs enabled'
          : 'Automatic runs paused'}</span
    >
    ·
    {provider.connectedAccounts} connected {provider.connectedAccounts === 1
      ? 'account'
      : 'accounts'}
  </p>
  <label class="check"
    ><input type="checkbox" bind:checked={schedule.enabled} disabled={busy} />Run automatically</label
  >
  <div class="fields">
    <label class="field"
      >{provider.provider === 'jellyfin'
        ? 'Check for changes every (minutes)'
        : 'Run every (minutes)'}<input
        type="number"
        required
        step="1"
        min="1"
        max="10080"
        bind:value={schedule.intervalMinutes}
        disabled={busy || !schedule.enabled}
      /></label
    >
    {#if provider.provider === 'jellyfin'}<label class="field"
        >Full library scan every (hours)<input
          type="number"
          required
          step="1"
          min="1"
          max="720"
          bind:value={schedule.fullIntervalHours}
          disabled={busy || !schedule.enabled}
        /></label
      >{/if}
  </div>
  <div class="row">
    <Button type="submit" variant="secondary" disabled={busy || !dirty}
      >{busy ? 'Working…' : 'Save schedule'}</Button
    ><Button
      variant="ghost"
      icon="refresh"
      disabled={busy || !provider.connectedAccounts}
      onclick={() => perform(true)}
      >{provider.provider === 'jellyfin' ? 'Run full scan' : 'Run now'}</Button
    >
  </div>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
</form>

<style>
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 16px;
  }
  h3 {
    font-size: 14px;
  }
  p {
    margin-top: 6px;
  }
</style>
