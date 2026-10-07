<script lang="ts">
  import {page} from '$app/state';
  import {providerSchedule} from '$lib/providers/schedule';
  import {recurringTask} from '$lib/providers/task-timing';
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { maintenanceKinds, serviceTasks, type ServiceTask } from '$lib/providers/tasks';
  import type { ProviderSchedule } from '$lib/providers/schedule';
  import Heading from './Heading.svelte';
  import RowFilter from './RowFilter.svelte';
  import JobSchedule from './JobSchedule.svelte';
  import EmptyState from './EmptyState.svelte';
  import {displayLabel} from '$lib/ui/labels';
  import {jobTaskSections,type QueueAction} from '$lib/ui/queue';

  let {
    providers,
    actions,
    timing = [],
    tasteJob=null,
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
    tasteJob?:Awaited<ReturnType<typeof import('$lib/social/taste-cache.server').tasteJob>>|null;
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
  const sections = $derived.by(() => {
    const entries = providers.filter(provider => service === 'all' || provider.id === service).flatMap(provider =>
      serviceTasks(provider.provider).filter(task => task.kinds.length > 0 && matchesTask(task) && (task.scope && recurringTask(task.kinds[0]) || actions.some(job=>job.instanceId===provider.id&&task.kinds.includes(job.kind)))).map(task => ({
        provider, task, local: false,
        jobs: actions.filter(job => job.instanceId === provider.id && task.kinds.includes(job.kind)),
        timing: timing.find(entry => entry.instanceId === provider.id && task.kinds.includes(entry.kind)),
      })));
    if (tasteJob && service === 'all' && (type === 'all' || type === 'maintenance')) entries.push({
      provider: { id: 'taste', name: 'Coast', provider: 'coast', enabled: true, connectedAccounts: 0, accounts: [], schedule: { ...providerSchedule('coast'), ...tasteJob.schedule } },
      task: { id: 'taste', title: 'Taste profiles', description: 'Refresh changed user interests and score up to 500 recommendation candidates per medium. Ten users per run.', kinds: ['taste.refresh'], scope: 'metadata', interval: 'intervalMinutes' },
      local: true, timing: tasteJob.timing, jobs: actions.filter(job => job.kind === 'taste.refresh'),
    });
    // Local/event-driven work without a service schedule still gets one task
    // row. No account job is removed or merged in the execution queue.
    for(const job of actions){
      if(!matchesType(job.kind)||(service!=='all'&&job.instanceId!==service)||entries.some(entry=>entry.jobs.some(existing=>existing.id===job.id)))continue;
      const jobs=actions.filter(candidate=>candidate.kind===job.kind&&candidate.instanceId===job.instanceId);
      const provider=providers.find(provider=>provider.id===job.instanceId)??{id:job.instanceId??'coast',name:'Coast',provider:'coast',enabled:true,connectedAccounts:0,accounts:[],schedule:providerSchedule('coast')};
      entries.push({provider,task:{id:job.kind,title:displayLabel(job.kind),description:'Work requested by Coast or a user action.',kinds:[job.kind]},local:provider.provider==='coast',jobs,timing:timing.find(entry=>entry.instanceId===provider.id&&entry.kind===job.kind)});
    }
    const order=(entry:(typeof entries)[number])=>Math.min(...entry.jobs.filter(job=>['running','pending','failed'].includes(job.state)).map(job=>actions.indexOf(job)));
    entries.sort((a,b)=>order(a)-order(b));
    return jobTaskSections(entries);
  });
  const groups = $derived([
    {id:'running',title:'Running',description:undefined,entries:sections.running},
    {id:'pending',title:'Waiting',description:undefined,entries:sections.waiting},
    {id:'failed',title:'Needs attention',description:undefined,entries:sections.attention},
    {id:'upcoming',title:'Upcoming',description:undefined,entries:sections.upcoming},
    {id:'manual',title:'Manual',description:undefined,entries:sections.manual},
  ].filter(group=>(filter==='all'||filter===group.id)&&group.entries.length));
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
{#if page.data.developerMode}<p class="notice" role="status">Developer mode: automatic jobs are paused. Run or Retry to start work explicitly.</p>{/if}

<div class="stack jobs">
  <Heading title="Queue">
    {#snippet actions()}<RowFilter groups={[
      { label: 'Job service', value: service, options: [
        { value: 'all', label: 'All services' },
        ...providers.map(provider => ({ value: provider.id, label: provider.name })),
      ], change: next => { service = next; } },
      { label: 'Job type', value: type, options: [
        { value: 'all', label: 'All tasks' },
        { value: 'maintenance', label: 'Imports and scans' },
        { value: 'changes', label: 'Tracking and requests' },
        { value: 'playback', label: 'Playback reports' },
      ], change: next => { type = next; } },
      { label: 'Job status', value: filter,
        options: [
          { value: 'all', label: 'All work' },
          { value: 'running', label: 'Running' },
          { value: 'pending', label: 'Waiting' },
          { value: 'failed', label: 'Needs attention' },
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'manual', label: 'Manual' },
        ], change: (next: string) => { filter = next; } },
    ]} />{/snippet}
  </Heading>

  {#each groups as group (group.id)}
    <section class="service stack" aria-label={`${group.title} tasks`}>
      <Heading title={group.title} description={group.description} />
      <div class="task-list">{#each group.entries as entry (`${entry.provider.id}:${entry.task.id}`)}
        <JobSchedule provider={entry.provider} task={entry.task} jobs={entry.jobs} timing={entry.timing} local={entry.local} showSource />
      {/each}</div>
    </section>
  {:else}<EmptyState title="No matching tasks" description="Choose another filter to see active work, upcoming schedules or manual tasks." icon="clock" />{/each}
</div>

<style>
  .jobs {
    gap: 16px;
    min-width: 0;
  }
  .jobs > :global(.row-header) {
    margin-bottom: 0;
  }
  .service {
    gap: 0;
    min-width: 0;
  }
  .task-list {min-width:0;}
  .service > :global(.row-header) {margin-bottom:0;}
</style>
