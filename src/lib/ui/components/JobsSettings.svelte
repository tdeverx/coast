<script lang="ts">
  import RowHeader from './RowHeader.svelte';
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import JobSchedule from './JobSchedule.svelte';
  import QueueList from './QueueList.svelte';
  import SegmentedControl from './SegmentedControl.svelte';
  let {
    providers,
    actions,
  }: {
    providers: {
      id: string;
      name: string;
      provider: string;
      enabled: boolean;
      connectedAccounts: number;
      schedule: import('$lib/providers/schedule').ProviderSchedule;
    }[];
    actions: {
      id: string;
      kind: string;
      state: string;
      attempts: number;
      lastError: string | null;
      createdAt: Date;
      nextAttemptAt: Date;
      connectionId: string | null;
      connectionLabel?: string;
    }[];
  } = $props();
  let filter = $state('active');
  const visible = $derived(
    actions.filter(
      (job) =>
        filter === 'all' ||
        (filter === 'active'
          ? ['pending', 'running', 'failed'].includes(job.state)
          : ['succeeded', 'cancelled'].includes(job.state))
    )
  );
  onMount(() => {
    let polling = false;
    const timer = setInterval(() => {
      if (!document.hidden && !polling) {
        polling = true;
        void invalidate('coast:settings')
          .catch(() => {})
          .finally(() => {
            polling = false;
          });
      }
    }, 10000);
    return () => clearInterval(timer);
  });
</script>

<div class="stack">
  <p>
    Manage background work for every connected account. Each integration has one shared schedule.
    Pausing a schedule stops future automatic runs; jobs already queued keep their current state.
  </p>
  <h3>Schedules</h3>
  {#each providers.filter((provider) => provider.enabled && ['jellyfin', 'seerr', 'trakt'].includes(provider.provider)) as provider (provider.id)}
    <JobSchedule {provider} />
  {:else}<p class="small">Add an integration to configure scheduled work.</p>{/each}
  <p class="small">
    Schedules run while Coast is running and are checked once a minute. Playback reports and
    tracking exports run when you make changes, with automatic retries if a service is unavailable.
  </p>
  <RowHeader title="Jobs"
    >{#snippet filters()}
      <SegmentedControl
        label="Job status"
        bind:value={filter}
        options={[
          { value: 'active', label: 'Active' },
          { value: 'finished', label: 'Finished' },
          { value: 'all', label: 'All' },
        ]}
      />
    {/snippet}</RowHeader
  >
  <QueueList
    emptyTitle={filter === 'finished'
      ? 'No finished jobs'
      : filter === 'all'
        ? 'No jobs yet'
        : 'No active jobs'}
    emptyDescription={filter === 'finished'
      ? 'Completed and cancelled jobs appear here.'
      : filter === 'all'
        ? 'Library scans, tracking updates and requests appear here when they run.'
        : 'You’re up to date. Scheduled jobs will appear here when they run.'}
    actions={visible}
  />
</div>
