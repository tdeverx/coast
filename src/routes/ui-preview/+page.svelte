<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import SegmentedControl from '#lib/ui/components/SegmentedControl.svelte';
  import { providePreviewClient } from '#lib/ui/client-context.js';
  import { fixtureFetch } from './demo/fixtures';
  import { elements, composedComponents, referenceEntries, referenceSections, referenceSection } from './catalog';
  import { compositions } from './reference';
  import Foundations from './Foundations.svelte';
  import Workspace from './Workspace.svelte';
  import NotificationToasts from '#lib/ui/components/NotificationToasts.svelte';
  import Browser from './Browser.svelte';
  import { provideCanvas, type WorkspaceParts } from './workspace';
  const client=providePreviewClient(fixtureFetch);
  const canvasSettings = $state({ background: 'theme', color: '#ffffff', image: '' });
  provideCanvas(canvasSettings);
  function updateCanvas(values: Partial<Pick<typeof canvasSettings,'background'|'color'>>) { Object.assign(canvasSettings,values); }
  let backgroundError = $state('');
  function setBackgroundImage(file?: File) {
    if (file && !file.type.startsWith('image/')) { backgroundError = 'Choose an image for the preview background.'; return; }
    if (canvasSettings.image) URL.revokeObjectURL(canvasSettings.image);
    canvasSettings.image = file ? URL.createObjectURL(file) : '';
    backgroundError = '';
  }
  onDestroy(() => { if (canvasSettings.image) URL.revokeObjectURL(canvasSettings.image); });
  const section = $derived(page.url.searchParams.has('section') ? referenceSection(page.url.searchParams.get('section')) : 'elements');
  const inventory = $derived<readonly string[]>(section === 'elements' ? elements : section === 'compositions' ? compositions.map(item=>item.id) : composedComponents);
  const options = $derived(referenceEntries.filter(entry=>inventory.includes(entry.id)).map(entry=>({value:entry.id,label:entry.title})));
  const name = $derived(options.find(option=>option.value===page.url.searchParams.get('component'))?.value ?? (section==='elements'?'Button':options[0]?.value ?? 'Button'));
  let chartGallery: Promise<typeof import('./charts/ChartGallery.svelte')> | undefined;
  let materialEditor: Promise<typeof import('#lib/ui/materials/MaterialTweaker.svelte')> | undefined;
  let componentEditor: Promise<typeof import('./ComponentPlayground.svelte')> | undefined;
  const loadCharts = () => chartGallery ??= import('./charts/ChartGallery.svelte').catch(cause=>{client.feedback.failure('The chart editor could not load. Reload to retry.');throw cause;});
  const loadMaterials = () => materialEditor ??= import('#lib/ui/materials/MaterialTweaker.svelte').catch(cause=>{client.feedback.failure('The material editor could not load. Reload to retry.');throw cause;});
  const loadComponents = () => componentEditor ??= import('./ComponentPlayground.svelte').catch(cause=>{client.feedback.failure('The component editor could not load. Reload to retry.');throw cause;});
  function update(values:Record<string,string|null>) {
    const url = new URL(page.url.href);
    for (const [key,value] of Object.entries(values)) {if(value===null)url.searchParams.delete(key);else url.searchParams.set(key,value);}
    void goto(url,{reset: false,replace: true});
  }
  function changeSection(value:string) {update({section:value,scenario:null});}
</script>

<svelte:head><title>UI playground · Coast</title></svelte:head>
<div class="content page playground-page">
  <div class="playground-background" data-background={canvasSettings.background} style:background-color={canvasSettings.background === 'color' ? canvasSettings.color : undefined} aria-hidden="true">
    {#if canvasSettings.background === 'image' && canvasSettings.image}<img src={canvasSettings.image} alt="" />{/if}
  </div>
  <h1 class="sr-only">UI playground</h1>
  {#if section === 'materials'}
    {#await loadMaterials()}<p class="quiet" role="status">Loading material editor…</p>
    {:then editor}<editor.default layout={workspace} picker={materialPicker} />
    {:catch}<!-- Failure is delivered by the scoped toast. -->{/await}
  {:else if section === 'charts'}
    {#await loadCharts()}<p class="quiet" role="status">Loading charts…</p>
    {:then gallery}<gallery.default layout={workspace} />
    {:catch}<!-- Failure is delivered by the scoped toast. -->{/await}
  {:else if section === 'typography' || section === 'colors'}
    {#key section}<Foundations {section} layout={workspace} />{/key}
  {:else}
    {#await loadComponents()}<p class="quiet" role="status">Loading component editor…</p>
    {:then editor}<editor.default {name} {options} initialScenario={page.url.searchParams.get('scenario')} change={value=>update({component:value,scenario:null})} onscenario={value=>update({scenario:value})} layout={workspace} />
    {:catch}<!-- Failure is delivered by the scoped toast. -->{/await}
  {/if}
</div>
<NotificationToasts notifications={[]} />

{#snippet workspace(parts:WorkspaceParts)}
  <Workspace {...parts} {canvasSettings} {updateCanvas} {setBackgroundImage} {backgroundError}>
    {#snippet categories()}<SegmentedControl label="UI reference section" value={section} options={referenceSections} onchange={changeSection} />{/snippet}
  </Workspace>
{/snippet}

{#snippet materialPicker(config:{options:{value:string;label:string}[];value:string;change:(value:string)=>void;heading?:import('svelte').Snippet})}
  <Browser title="Browse materials" {...config}>
    {#snippet thumbnail()}<span class="material-thumbnail"><span></span></span>{/snippet}
  </Browser>
{/snippet}

<style>
  .playground-page {--preview-inset:var(--gutter);--preview-gap:var(--gutter);--preview-control-gap:8px;padding-bottom:var(--gutter);isolation:isolate;}
  .playground-background {position:fixed;inset:0;z-index:-1;pointer-events:none;}
  .playground-background[data-background=pattern] {background:repeating-linear-gradient(90deg,transparent 0 28px,color-mix(in srgb,var(--white) 15%,transparent) 28px 33px),linear-gradient(135deg,var(--surface),var(--accent),var(--canvas));}
  .playground-background img {width:100%;height:100%;object-fit:cover;}
  @media(max-width:800px) {.playground-page {padding-bottom:calc(104px + env(safe-area-inset-bottom));}}
  .material-thumbnail {width:100%;height:40px;border-radius:8px;background:linear-gradient(130deg,var(--accent),var(--surface));display:grid;place-items:center;}
  .material-thumbnail span {width:50px;height:24px;border:1px solid color-mix(in srgb,var(--white) 35%,transparent);border-radius:8px;background:color-mix(in srgb,var(--white) 20%,transparent);}
</style>
