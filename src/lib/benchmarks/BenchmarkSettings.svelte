<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  import { message } from '$lib/ui/client';
  import { useClient } from '$lib/ui/client-context';
  import { createResource } from '$lib/ui/resource.svelte';
  import type { listBenchmarks } from './service.server';
  const {api,preview}=useClient();
  let {history}:{history:Awaited<ReturnType<typeof listBenchmarks>>}=$props();
  const resource=createResource(untrack(()=>history),true);
  let current=$derived(resource.data), busy=$state(false), queueError=$state('');
  let error=$derived(queueError||resource.error);
  let generation=0, queueController:AbortController|undefined;
  $effect(()=>{
    const next=history;
    generation++;
    resource.replace(next);
    queueController?.abort();queueController=undefined;
    busy=false;queueError='';
  });
  const ms=(value:number)=>`${value.toFixed(2)} ms`;
  const mib=(value:number)=>`${(value/1024/1024).toFixed(1)} MiB`;
  async function run() {
    if(busy||current.activeId)return;
    busy=true;queueError='';
    const request=new AbortController(), currentGeneration=generation, selectedPage=current.page;
    queueController=request;
    try {
      await api('admin/benchmarks',{},'POST',{signal:request.signal});
      if(request.signal.aborted||currentGeneration!==generation)return;
      await resource.load(signal=>api<Awaited<ReturnType<typeof listBenchmarks>>>(`admin/benchmarks?page=${selectedPage}`,undefined,'GET',{signal}));
    }
    catch(problem){if(!request.signal.aborted&&currentGeneration===generation)queueError=message(problem);}
    finally{if(queueController===request){queueController=undefined;busy=false;}}
  }
  function changePage(selected:number){
    return preview
      ? resource.load(signal=>api<Awaited<ReturnType<typeof listBenchmarks>>>(`admin/benchmarks?page=${selected}`,undefined,'GET',{signal}))
      : goto(`/settings/benchmarks?page=${selected}`);
  }
  onMount(()=>{
    if(preview)return()=>{generation++;resource.dispose();queueController?.abort();queueController=undefined;};
    const timer=setInterval(()=>{
      if(document.hidden||resource.busy||busy||!current.activeId)return;
      const selectedPage=current.page;
      void resource.load(signal=>api<Awaited<ReturnType<typeof listBenchmarks>>>(`admin/benchmarks?page=${selectedPage}`,undefined,'GET',{signal}));
    },2000);
    return()=>{generation++;clearInterval(timer);resource.dispose();queueController?.abort();queueController=undefined;};
  });
</script>
<div class="stack">
  <section>
    <Heading title="Local benchmark" description="Checks local Collection queries and a fixed journal workload. Results are recorded for future comparisons.">
      {#snippet actions()}<Button icon="play" disabled={busy||!!current.activeId} onclick={()=>void run()}>{busy?'Queueing…':current.activeId?'Benchmark queued or running':'Run benchmark'}</Button>{/snippet}
    </Heading>
    <p class="small">One run at a time. Queries are read only and make no provider requests. There is one warm-up followed by five measured rounds (ten for a database round trip). Each statement is limited to five seconds; the workload stops starting new probes after 30 seconds, allowing the current statement to finish.</p>
    <p class="small">Process CPU and memory observed during a run describe the whole Coast process, including other traffic. Observed peaks can miss short spikes. These checks do not measure browser rendering, playback or cold-cache performance. Comparisons require the same workload, runtime and hardware context, with no other background jobs observed; Collection comparisons also require matching account data and catalogue revision. The fixed journal and database round-trip checks can compare across catalogue changes. Changed hardware or limits start a new comparison group.</p>
    {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  </section>
  <section>
    <Heading title="Benchmark history" description={`${current.total} recorded ${current.total===1?'run':'runs'}`} />
    {#if !current.runs.length}<EmptyState title="No benchmark results" description="Run a benchmark to record a baseline for this installation." icon="clock" />
    {:else}{#each current.runs as run (run.id)}
      <div class="result">
        <h3>{run.state==='completed'?'Completed':run.state==='queued'?'Queued':run.state==='running'?'Running':run.state==='cancelled'?'Cancelled':'Failed'} · {new Date(run.createdAt).toLocaleString()}</h3>
        <p class="small">{run.workloadVersion}{#if run.measurements} · {ms(run.measurements.wallMs)} elapsed · CPU {ms(run.measurements.cpuUserMs+run.measurements.cpuSystemMs)}{/if}</p>
        {#if run.errors.length}<p class="small">{run.errors.join(' · ')}</p>{/if}
        {#if run.measurements}
          <div class="metrics">{#each Object.entries(run.measurements.probes) as [name,probe]}
            <div class="row metric"><span>{name} · {probe.rows} {probe.rows===1?'row':'rows'}</span><span>Median {ms(probe.medianMs)} · p95 {ms(probe.p95Ms)}{#if run.changes?.[name]!==undefined} · {run.changes[name]>=0?'+':''}{run.changes[name].toFixed(1)}% vs {new Date(run.comparisons![name].createdAt).toLocaleString()}{:else} · No matching comparison{/if}</span></div>
          {/each}</div>
          <p class="small">RSS {mib(run.measurements.memoryBefore.rss)} → {mib(run.measurements.memoryAfter.rss)} · observed peak {mib(run.measurements.peakObservedRss)}. Heap {mib(run.measurements.memoryBefore.heapUsed)} → {mib(run.measurements.memoryAfter.heapUsed)} · observed peak {mib(run.measurements.peakObservedHeap)}.</p>
          <p class="small">{run.previousId?'Each percentage compares median latency with its recorded matching run. Positive means slower.':'No previous matching result for comparison.'}</p>
        {/if}
        {#if run.context}
          <details><summary class="small">Build, environment and catalogue</summary>
            <p class="small">Build {run.context.build} · {run.context.runtime} · {run.context.platform}/{run.context.arch}</p>
            <p class="small">{run.context.cpuModel} · {run.context.cpuCount} CPUs · host memory {mib(run.context.hostMemoryBytes)} · memory limit {run.context.memoryLimit??'unavailable'} · CPU limit {run.context.cpuLimit??'unavailable'}</p>
            <p class="small">{run.context.database}</p>
            <p class="small">{Object.entries(run.context.dataset).map(([name,count])=>`${name}: ${count}`).join(' · ')}</p>
          </details>
        {/if}
        {#if run.state==='queued'||run.state==='running'}<p class="small">This run uses the existing background job queue. <a href="/settings/jobs">Review Jobs &amp; schedules</a></p>{/if}
      </div>
    {/each}{/if}
    <Pagination page={current.page} pages={current.pages} label="Benchmark history pages" onchange={changePage} />
  </section>
</div>
<style>
  .result{padding:16px 0;border-bottom:1px solid var(--line);min-width:0;}
  h3{font-size:var(--text-md);margin:0 0 6px;}
  p{overflow-wrap:anywhere;}
  .metrics{margin:12px 0;}
  .metric{justify-content:space-between;flex-wrap:wrap;gap:4px 16px;padding:6px 0;}
  details{margin-top:12px;} summary{cursor:pointer;}
</style>
