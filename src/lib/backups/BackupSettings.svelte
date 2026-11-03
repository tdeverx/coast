<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import SettingsRow from '#lib/ui/components/SettingsRow.svelte';
  import { message } from '#lib/ui/client.js';
  import { reportFailure, useClient } from '#lib/ui/client-context.js';
  import type { BackupStatus } from './model';

  const { api, preview } = useClient();
  let { initial }: { initial: BackupStatus } = $props();
  let current = $state(untrack(() => initial));
  let policy = $state(untrack(() => ({ ...initial.policy })));
  let busy = $state(false);
  let error = $state('');
  let active = $derived(current.state === 'queued' || current.state === 'running');
  let dirty = $derived(JSON.stringify(policy) !== JSON.stringify(current.policy));
  let request: AbortController | undefined;

  async function update(method: 'PATCH' | 'POST' | 'GET') {
    if (busy || preview) return;
    busy = true;
    error = '';
    const controller = new AbortController();
    request = controller;
    try {
      current = await api<BackupStatus>('admin/backups',
        method === 'PATCH' ? { ...policy } : method === 'POST' ? {} : undefined,
        method, { signal: controller.signal });
      if (method === 'PATCH') policy = { ...current.policy };
    } catch (cause) {
      if (!controller.signal.aborted) error = message(cause);
    } finally {
      if (request === controller) {
        request = undefined;
        busy = false;
      }
    }
  }

  onMount(() => {
    if (preview) return;
    const timer = setInterval(() => {
      if (active && !document.hidden) void update('GET');
    }, 3000);
    return () => {
      clearInterval(timer);
      request?.abort();
    };
  });
  reportFailure(() => error);

  const labels = {
    idle: 'No Coast backups yet',
    queued: 'Backup queued',
    running: 'Backup in progress',
    completed: 'Backup completed',
    failed: 'Backup failed',
  };
</script>

{#if !current.available}
  <p>Backups are available on installations using Coast’s bundled PostgreSQL.</p>
{:else}
  <div class="stack form-width">
    <div class="stack" aria-live="polite">
      <h3>{labels[current.state]}</h3>
      {#if current.latest}
        <p class="small">Last successful backup: {new Date(current.latest.completedAt).toLocaleString()} · {(current.latest.bytes / 1024 ** 2).toFixed(1)} MiB</p>
        <p class="small path">coast/backups/{current.latest.name}</p>
      {/if}
      {#if current.error}<p class="small">{current.error}</p>{/if}
      <div class="row">
        <Button icon="play" disabled={preview || busy || active || dirty || !current.policy.recipient} onclick={() => void update('POST')}>Back up now</Button>
        <Button disabled={preview || busy} onclick={() => void update('GET')}>Refresh status</Button>
      </div>
    </div>

    <form class="stack" onsubmit={(event) => { event.preventDefault(); void update('PATCH'); }}>
      <SettingsRow title="Automatic backups" description="Capture an encrypted database dump, credential keys and uploaded avatars once a day.">
        <input type="checkbox" aria-label="Automatic backups" bind:checked={policy.enabled} />
      </SettingsRow>
      <SettingsRow title="Daily time" description="Coast catches up after startup if the scheduled time has passed.">
        <input type="time" aria-label="Daily backup time" bind:value={policy.time} required />
      </SettingsRow>
      <label class="stack">Time zone
        <input type="text" bind:value={policy.timeZone} placeholder="Europe/London" maxlength="80" required />
      </label>
      <label class="stack">Snapshots to keep
        <input type="number" min="1" max="90" step="1" bind:value={policy.keep} required />
      </label>
      <label class="stack">Public recovery certificate
        <textarea rows="5" maxlength="16384" bind:value={policy.recipient} placeholder="-----BEGIN CERTIFICATE-----"></textarea>
      </label>
      <p class="small">Keep the matching private key outside Coast. Restore the archives offline using that key and the deployment recovery instructions.</p>
      <div><Button type="submit" disabled={preview || busy || !dirty}>Save backup settings</Button></div>
    </form>
  </div>
{/if}

<style>
  .path { overflow-wrap: anywhere; }
  textarea { width: 100%; }
</style>
