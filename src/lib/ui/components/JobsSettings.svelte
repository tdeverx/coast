<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { maintenanceKinds, serviceTasks, type ServiceTask } from '$lib/providers/tasks';
  import { displayLabel } from '$lib/ui/labels';
  import type { ProviderSchedule } from '$lib/providers/schedule';
  import Heading from './Heading.svelte';
  import RowFilter from './RowFilter.svelte';
  import JobSchedule from './JobSchedule.svelte';
  import QueueList from './QueueList.svelte';
  import type { QueueAction } from '$lib/ui/queue';
  import SegmentedControl from './SegmentedControl.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import MenuAction from './MenuAction.svelte';
  let {
    providers,
    actions,
    timing = [],
  }: {
    providers: {
      id: string;
      name: string;
      provider: string;
      enabled: boolean;
      connectedAccounts: number;
      accounts: { id: string; username: string }[];
      libraryScan?: unknown;
      schedule: ProviderSchedule;
    }[];
    actions: QueueAction[];
    timing?: import('$lib/providers/job-timing.server').JobTiming[];
  } = $props();
  let filter = $state('all'),
    service = $state('all'),
    type = $state('all');
  function matchesType(kind: string) {
    return (
      type === 'all' ||
      (type === 'maintenance'
        ? maintenanceKinds.includes(kind)
        : type === 'playback'
          ? kind.endsWith('.scrobble')
          : !maintenanceKinds.includes(kind) && !kind.endsWith('.scrobble'))
    );
  }
  function matchesTask(task: ServiceTask) {
    return type === 'all' || task.kinds.some(matchesType);
  }
  function matchesState(job: QueueAction) {
    return (
      filter === 'all' ||
      (filter === 'attention'
        ? job.state === 'failed'
        : filter === 'finished'
          ? ['succeeded', 'cancelled'].includes(job.state)
          : ['pending', 'running', 'failed'].includes(job.state))
    );
  }
  const sections = $derived.by(() => {
    const selectedStatus = filter;
    const selectedService = service;
    const matching = actions.filter(job => matchesType(job.kind)).filter(matchesState);
    return providers.filter(provider => selectedService === 'all' || provider.id === selectedService).map(provider => {
      const registered = serviceTasks(provider.provider);
      return {
        provider,
        tasks: registered.filter(task => task.kinds.length > 0 && matchesTask(task) && (selectedStatus === 'all' || matching.some(job => job.instanceId === provider.id && task.kinds.includes(job.kind)))),
        other: matching.filter(job => job.instanceId === provider.id && !registered.some(task => task.kinds.includes(job.kind))),
      };
    }).filter(section => section.tasks.length || section.other.length);
  });
  const orphaned = $derived(
    service === 'all'
      ? actions.filter(
          (job) =>
            !providers.some((provider) => provider.id === job.instanceId) &&
            matchesType(job.kind) &&
            matchesState(job)
        )
      : []
  );
  const visible = $derived(
    actions.filter(
      (job) =>
        (service === 'all' || job.instanceId === service) &&
        matchesType(job.kind) &&
        matchesState(job)
    )
  );
  onMount(() => {
    let polling = false;
    const timer = setInterval(() => {
      if (!document.hidden && !polling) {
        polling = true;
        void invalidate('coast:settings')
          .catch(() => {})
          .finally(() => (polling = false));
      }
    }, 10000);
    return () => clearInterval(timer);
  });
</script>

<div class="stack jobs">
  <Heading title="Background work">
    {#snippet filters()}<SegmentedControl
        label="Job status"
        bind:value={filter}
        options={[
          { value: 'active', label: 'Active' },
          { value: 'attention', label: 'Needs attention' },
          { value: 'finished', label: 'Finished' },
          { value: 'all', label: 'All' },
        ]}
      />{/snippet}
    {#snippet actions()}<RowFilter
        label="Job service"
        bind:value={service}
        options={[
          { value: 'all', label: 'All services' },
          ...providers.map((provider) => ({ value: provider.id, label: provider.name })),
        ]}
      /><RowFilter
        label="Job type"
        bind:value={type}
        options={[
          { value: 'all', label: 'All tasks' },
          { value: 'maintenance', label: 'Imports and scans' },
          { value: 'changes', label: 'Tracking and requests' },
          { value: 'playback', label: 'Playback reports' },
        ]}
      />{/snippet}
  </Heading>
  <p class="small intro">
    One card per job · {visible.length} matching recent runs. Automatic-run toggles
    are in <a class="text-accent" href="/settings/integrations">Integrations</a>.
  </p>
  {#each sections as section (section.provider.id)}
    <section class="service stack" aria-label={`${section.provider.name} tasks`}>
      <Heading title={section.provider.name}>
        {#snippet filters()}<span class="small"
            >{displayLabel(section.provider.provider)} · {section.provider.connectedAccounts} connected
            {section.provider.connectedAccounts === 1 ? 'account' : 'accounts'}</span
          >{#if !section.provider.enabled}<span class="badge">Disabled</span>{/if}{/snippet}
        {#snippet actions()}<ContextMenu label={`${section.provider.name} service actions`}
            ><MenuAction icon="settings" href="/settings/integrations" keepOpen={false}
              >Manage integration</MenuAction
            ><MenuAction icon="user" href="/settings/connections" keepOpen={false}
              >Connections</MenuAction
            ></ContextMenu
          >{/snippet}
      </Heading>
      <div class="task-grid">
        {#each section.tasks as task (task.id)}<JobSchedule
            provider={section.provider}
            {task}
            jobs={actions.filter(
              (job) =>
                job.instanceId === section.provider.id &&
                task.kinds.includes(job.kind) &&
                matchesType(job.kind)
            )}
            timing={timing.find(entry => entry.instanceId === section.provider.id && task.kinds.includes(entry.kind))}
          />{/each}
      </div>
      {#if section.other.length}<div class="panel">
          <Heading title="Other runs" /><QueueList actions={section.other} />
        </div>{/if}
    </section>
  {:else}<p class="small">
      No services match these filters. Add an integration or choose another task type.
    </p>{/each}
  {#if orphaned.length}<section class="service">
      <Heading title="Other background work" /><QueueList actions={orphaned} />
    </section>{/if}
  <p class="small">
    Schedules are checked once a minute while Coast is running. Each service imports one account at
    a time; other services can continue independently. Retries respect service rate limits. Pausing
    automatic work keeps already queued jobs available to review.
  </p>
</div>

<style>
  .jobs {
    gap: 24px;
  }
  .jobs > :global(.row-header) {
    margin-bottom: 0;
  }
  .intro {
    margin: 0;
  }
  .service {
    gap: 0;
  }
  .task-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
    gap: 16px;
  }
  .service + .service {
    margin-top: 12px;
  }
</style>
