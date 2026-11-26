<script lang="ts">
  import {previewBackground} from '#lib/ui/preview-input.js';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import PreviewSelect from '#lib/ui/cards/editor/PreviewSelect.svelte';
  import { providePreviewClient } from '#lib/ui/client-context.js';
  import { fixtureFetch } from './demo/fixtures';
  import { referenceEntries, referenceSections, referenceSection, resolveReference } from './catalog';
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
  const backgrounds=previewBackground(url=>canvasSettings.image=url,message=>backgroundError=message);
  function setBackgroundImage(file?:File){backgrounds.replace(file);}
  onDestroy(()=>backgrounds.destroy());
  const requestedState = $derived(page.url.searchParams.get('scenario'));
  const selection = $derived(resolveReference(page.url.searchParams.get('component'), requestedState));
  const section = $derived(referenceSection(page.url.searchParams.get('section'), selection?.entry.id));
  const initialScenario = $derived(selection && (requestedState || selection.entry.id !== page.url.searchParams.get('component')) ? selection.state.id : null);
  const options = $derived(referenceEntries.filter(entry => entry.category === section)
    .map(entry => ({value: entry.id, label: entry.title, uses:entry.uses})).sort((a, b) => a.label.localeCompare(b.label, 'en')));
  const name = $derived(options.find(option=>option.value===selection?.entry.id)?.value ?? (section === 'elements' ? 'Button' : options[0]?.value ?? 'Button'));
  let chartGallery: Promise<typeof import('./charts/ChartGallery.svelte')> | undefined;
  let materialEditor: Promise<typeof import('#lib/ui/materials/MaterialTweaker.svelte')> | undefined;
  let menusPreview: Promise<typeof import('./MenusPreview.svelte')> | undefined;
  let componentEditor: Promise<typeof import('./ComponentPlayground.svelte')> | undefined;
  const loadCharts = () => chartGallery ??= import('./charts/ChartGallery.svelte').catch(cause=>{client.feedback.failure('The chart editor could not load. Reload to retry.');throw cause;});
  const loadMaterials = () => materialEditor ??= import('#lib/ui/materials/MaterialTweaker.svelte').catch(cause=>{client.feedback.failure('The material editor could not load. Reload to retry.');throw cause;});
  const loadMenus = () => menusPreview ??= import('./MenusPreview.svelte').catch(cause=>{client.feedback.failure('The menu preview could not load. Reload to retry.');throw cause;});
  const loadComponents = () => componentEditor ??= import('./ComponentPlayground.svelte').catch(cause=>{client.feedback.failure('The component editor could not load. Reload to retry.');throw cause;});
  function update(values:Record<string,string|null>) {
    const url = new URL(page.url.href);
    url.searchParams.set('section', section);
    for (const [key,value] of Object.entries(values)) {if(value===null)url.searchParams.delete(key);else url.searchParams.set(key,value);}
    void goto(url,{reset: false,replace: true});
  }
  const collections = referenceSections.map(({value, label}) => ({id: value, label}));
  function changeSection(value: string) { update({section: value, component: null, scenario: null, menu: null, variant: null, context: null, medium: null, chart: null, dataset: null}); }
</script>

<svelte:head><title>UI reference · Coast</title></svelte:head>
<div class="playground-page" data-select-viewport>
  <header class="reference-header">
    <AuthSurface anchor><Button href="/settings/admin" size="segment" icon="arrowLeft" label="Back to settings" /></AuthSurface>
    <div class="collection-picker"><PreviewSelect label="UI reference" options={collections} value={section} onchange={changeSection} topLayer /></div>
  </header>
  <h1 class="sr-only">UI reference</h1>
  {#if section === 'materials'}
    {#await loadMaterials()}<p class="quiet" role="status">Loading material editor…</p>
    {:then editor}<editor.default layout={workspace} picker={materialPicker} />
    {:catch}<!-- Failure is delivered by the scoped toast. -->{/await}
  {:else if section === 'charts'}
    {#await loadCharts()}<p class="quiet" role="status">Loading charts…</p>
    {:then gallery}<gallery.default layout={workspace} />
    {:catch}<!-- Failure is delivered by the scoped toast. -->{/await}
  {:else if section === 'menus'}
    {#await loadMenus()}<p class="quiet" role="status">Loading menus…</p>
    {:then gallery}<gallery.default menu={page.url.searchParams.get('menu')} variant={page.url.searchParams.get('variant')}
      select={(menu, variant) => update({ menu, variant })} layout={workspace} />
    {:catch}<!-- Failure is delivered by the scoped toast. -->{/await}
  {:else if section === 'typography' || section === 'colors'}
    {#key section}<Foundations {section} layout={workspace} />{/key}
  {:else}
    {#await loadComponents()}<p class="quiet" role="status">Loading component editor…</p>
    {:then editor}{#key section}<editor.default {name} {options} {initialScenario} change={value=>update({component:value,scenario:null})} onscenario={value=>update({component:name,scenario:value})} layout={workspace} />{/key}
    {:catch}<!-- Failure is delivered by the scoped toast. -->{/await}
  {/if}
</div>
<NotificationToasts notifications={[]} />

{#snippet workspace(parts:WorkspaceParts)}
  <Workspace {...parts} {canvasSettings} {updateCanvas} {setBackgroundImage} {backgroundError}>
    {#snippet categories()}<h2>{collections.find(item => item.id === section)?.label}</h2>{/snippet}
  </Workspace>
{/snippet}

{#snippet materialPicker(config:{options:{value:string;label:string}[];value:string;change:(value:string)=>void;heading?:import('svelte').Snippet})}
  <Browser title="Browse materials" {...config}>
    {#snippet thumbnail()}<span class="material-thumbnail"><span></span></span>{/snippet}
  </Browser>
{/snippet}

<style>
  .playground-page {
    --preview-inset:var(--gutter);
    --preview-gap:var(--auth-gap);
    --editor-auth-width:var(--auth-width);
    --editor-auth-gap:var(--auth-gap);
    --editor-action-gap:var(--auth-action-gap);
    --preview-control-gap:8px;
    --editor-menu-radius:var(--glass-surface-radius);
    --editor-menu-row-gap:round(nearest, 2px, var(--menu-device-pixel, 1px));
    --editor-menu-frame:calc(var(--editor-menu-row-gap) + round(nearest, 1px, var(--menu-device-pixel, 1px)));
    --editor-row-height:max(var(--control-height), calc(var(--leading-menu) + 2 * round(nearest, 10px, var(--menu-device-pixel, 1px))));
    --editor-row-highlight:var(--control-hover-fill);
    --editor-row-text-gap:var(--row-text-gap);
    background:radial-gradient(ellipse at 18% 36%,color-mix(in srgb,var(--accent) 9%,var(--canvas)),var(--canvas) 73%);
    position:relative; isolation:isolate; display:grid; grid-template-rows:auto minmax(0,1fr);
    gap:var(--auth-gap); height:100dvh; padding:max(16px, env(safe-area-inset-top)) var(--gutter) max(14px, env(safe-area-inset-bottom));
  }
  .reference-header {display:grid;grid-template-columns:minmax(72px,1fr) minmax(0,var(--auth-width)) minmax(72px,1fr);align-items:center;gap:var(--auth-action-gap);z-index:2;}
  .collection-picker {min-width:0;}
  @media(max-width:600px) {.reference-header {grid-template-columns:minmax(68px,1fr) minmax(0,var(--auth-width)) minmax(68px,1fr);}}
  @media(max-width:400px) {
    .collection-picker :global(.current) {display:grid;grid-template:repeat(2,minmax(0,1fr)) / minmax(0,1fr) auto;row-gap:0;padding-block:var(--segment-inset);}
    .collection-picker :global(.current .option-icon) {display:none;}
    .collection-picker :global(.current .field-label),.collection-picker :global(.current .field-value) {max-inline-size:none;line-height:var(--leading-tight);white-space:nowrap;margin:0;}
    .collection-picker :global(.current .chevron) {grid-area:1 / 2 / 3;}
  }
  .material-thumbnail {width:100%;height:40px;border-radius:8px;background:linear-gradient(130deg,var(--accent),var(--surface));display:grid;place-items:center;}
  .material-thumbnail span {width:50px;height:24px;border:1px solid color-mix(in srgb,var(--white) 35%,transparent);border-radius:8px;background:color-mix(in srgb,var(--white) 20%,transparent);}
</style>
