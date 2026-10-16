<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import SegmentedControl from '$lib/ui/components/SegmentedControl.svelte';
  import { providePreviewClient } from '$lib/ui/client-context';
  import { fixtureFetch } from './demo/fixtures';
  import { elements, composedComponents, referenceEntries, referenceSections, referenceSection } from './catalog';
  import { compositions } from './reference';
  import ComponentPlayground from './ComponentPlayground.svelte';
  import Foundations from './Foundations.svelte';
  import Workspace from './Workspace.svelte';
  import Browser from './Browser.svelte';
  import type { WorkspaceParts } from './workspace';
  providePreviewClient(fixtureFetch);
  let inspectorOpen = $state(false);
  let inspectorPinned = $state(false);
  const section = $derived(page.url.searchParams.has('section') ? referenceSection(page.url.searchParams.get('section')) : 'elements');
  const inventory = $derived<readonly string[]>(section === 'elements' ? elements : section === 'compositions' ? compositions.map(item=>item.id) : composedComponents);
  const options = $derived(referenceEntries.filter(entry=>inventory.includes(entry.id)).map(entry=>({value:entry.id,label:entry.title})));
  const name = $derived(options.find(option=>option.value===page.url.searchParams.get('component'))?.value ?? (section==='elements'?'Button':options[0]?.value ?? 'Button'));
  let chartGallery: Promise<typeof import('./charts/ChartGallery.svelte')> | undefined;
  let materialEditor: Promise<typeof import('$lib/ui/materials/MaterialTweaker.svelte')> | undefined;
  const loadCharts = () => chartGallery ??= import('./charts/ChartGallery.svelte');
  const loadMaterials = () => materialEditor ??= import('$lib/ui/materials/MaterialTweaker.svelte');
  function update(values:Record<string,string|null>) {
    const url = new URL(page.url);
    for (const [key,value] of Object.entries(values)) {if(value===null)url.searchParams.delete(key);else url.searchParams.set(key,value);}
    void goto(url,{noScroll:true,keepFocus:true,replaceState:true});
  }
  function changeSection(value:string) {update({section:value,scenario:null});}
</script>

<svelte:head><title>UI playground · Coast</title></svelte:head>
<div class="content page playground-page">
  <p class="small quiet breadcrumb"><a href="/settings/admin">Settings</a> / UI</p>
  <Heading level={1} title="Playground">
    {#snippet actions()}<Button href="/settings/admin" emphasis="subtle">Admin settings</Button>{/snippet}
  </Heading>
  {#if section === 'materials'}
    {#await loadMaterials()}<p class="quiet" role="status">Loading material editor…</p>
    {:then editor}<editor.default layout={workspace} picker={materialPicker} />
    {:catch}<p role="alert">The material editor could not load. Reload to retry.</p>{/await}
  {:else if section === 'charts'}
    {#await loadCharts()}<p class="quiet" role="status">Loading charts…</p>
    {:then gallery}<gallery.default layout={workspace} />
    {:catch}<p role="alert">The chart editor could not load. Reload to retry.</p>{/await}
  {:else if section === 'typography' || section === 'colors'}
    {#key section}<Foundations {section} layout={workspace} />{/key}
  {:else}
    <ComponentPlayground {name} {options} initialScenario={page.url.searchParams.get('scenario')} change={value=>update({component:value,scenario:null})} onscenario={value=>update({scenario:value})} layout={workspace} />
  {/if}
</div>

{#snippet workspace(parts:WorkspaceParts)}
  <Workspace {...parts} bind:open={inspectorOpen} bind:pinned={inspectorPinned}>
    {#snippet categories()}<SegmentedControl label="UI reference section" value={section} options={referenceSections} onchange={changeSection} />{/snippet}
  </Workspace>
{/snippet}

{#snippet materialPicker(config:{options:{value:string;label:string}[];value:string;change:(value:string)=>void})}
  <Browser title="Browse materials" {...config}>
    {#snippet thumbnail()}<span class="material-thumbnail"><span></span></span>{/snippet}
  </Browser>
{/snippet}

<style>
  .playground-page {padding-bottom:32px;}
  .breadcrumb {margin-bottom:8px;}
  .breadcrumb a {color:inherit;}
  .material-thumbnail {width:100%;height:40px;border-radius:8px;background:linear-gradient(130deg,var(--accent),var(--surface));display:grid;place-items:center;}
  .material-thumbnail span {width:50px;height:24px;border:1px solid color-mix(in srgb,var(--white) 35%,transparent);border-radius:8px;background:color-mix(in srgb,var(--white) 20%,transparent);}
</style>
