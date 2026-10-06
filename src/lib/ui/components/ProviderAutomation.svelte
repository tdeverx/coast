<script lang="ts">
  import RowFeedback from './RowFeedback.svelte';
  import { tick } from 'svelte';
  import type { ProviderSchedule } from '$lib/providers/schedule';
  import { notifyAction } from '$lib/ui/action-feedback.svelte';
  import { message } from '$lib/ui/client';
  import { useClient } from '$lib/ui/client-context';
  import Heading from './Heading.svelte';

  const { change } = useClient();

  let {
    instance,
  }: { instance: { id: string; provider: string; enabled: boolean; schedule: ProviderSchedule } } =
    $props();
  let busy = $state(false),
    error = $state('');
  let pending = $state<Partial<ProviderSchedule>>({});
  const schedule = $derived({ ...instance.schedule, ...pending });
  const choices = $derived(
    instance.provider === 'jellyfin'
      ? [
          {key:'liveEnabled' as const,label:'Live activity checks'},
          {key:'streamsEnabled' as const,label:'Record server streams'},
          { key: 'libraryEnabled' as const, label: 'Shared library scans' },
          { key: 'userSyncEnabled' as const, label: 'User activity imports' },
          { key: 'catalogueEnabled' as const, label: 'Discover user-linked titles' },
        ]
      : instance.provider === 'trakt'
        ? [
            {key:'liveEnabled' as const,label:'Live activity checks'},
            { key: 'trackingEnabled' as const, label: 'Tracking imports' },
            { key: 'listsEnabled' as const, label: 'List imports' },
            { key: 'catalogueEnabled' as const, label: 'Discover user-linked titles' },
          ]
        : []
  );
  async function toggle(key: keyof ProviderSchedule, checked: boolean) {
    if (busy) return;
    busy = true;
    error = '';
    pending = { [key]: checked };
    try {
      await change(`providers/${instance.id}/schedule`, { [key]: checked });
      notifyAction(checked ? 'Automatic work enabled.' : 'Automatic work paused.');
    } catch (cause) {
      error = message(cause);
    } finally {
      await tick();
      pending = {};
      busy = false;
    }
  }
</script>

{#if ['jellyfin', 'trakt', 'seerr', 'tmdb', 'steam'].includes(instance.provider)}
  <div class="automation stack">
    <Heading title="Automatic work"
      >{#snippet actions()}<a class="small text-accent" href="/settings/jobs"
          >View tasks & schedules</a
        >{/snippet}</Heading
    >
    <label class="check"
      ><input
        type="checkbox"
        checked={schedule.enabled}
        disabled={busy || !instance.enabled}
        onchange={(event) => void toggle('enabled', event.currentTarget.checked)}
      />Run background jobs automatically</label
    >
    {#each choices as choice (choice.key)}<label class="check"
        ><input
          type="checkbox"
          checked={!!schedule[choice.key]}
          disabled={busy || !instance.enabled}
          onchange={(event) => void toggle(choice.key, event.currentTarget.checked)}
        />{choice.label}</label
      >{/each}
    <p class="small">
      {!instance.enabled
        ? 'Enable this integration to run background work.'
        : !instance.schedule.enabled
          ? 'Automatic work is paused. Your task settings are saved.'
          : 'Selected tasks run on their schedules.'} Already queued jobs remain available in Jobs.
    </p>
    {#if error}<RowFeedback error={error} tag="p" class="notice error" />{/if}
  </div>
{/if}

<style>
  .automation {
    border-top: 1px solid var(--line);
    padding-top: 20px;
    gap: 12px;
  }
  .automation :global(.row-header) {
    margin-bottom: 0;
  }
</style>
