<script lang="ts">
  import { onMount } from 'svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import PreviewSlot from './PreviewSlot.svelte';
  import { providePreviewClient } from '$lib/ui/client-context';
  import { fixtureFetch } from './demo/fixtures';
  import MaterialTweaker from '$lib/ui/materials/MaterialTweaker.svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Button from '$lib/ui/components/Button.svelte';
  import DetailCard from '$lib/ui/components/DetailCard.svelte';
  import MetricGrid from '$lib/ui/components/MetricGrid.svelte';
  import { manifest, components, elements, composedComponents, referenceSections, referenceSection } from './catalog';
  let search = $state('');
  let chartGallery: Promise<typeof import('./charts/ChartGallery.svelte')> | undefined;
  function loadChartGallery() {
    return chartGallery ??= import('./charts/ChartGallery.svelte');
  }
  const section = $derived(referenceSection(page.url.searchParams.get('section')));
  const inventory = $derived(section === 'elements' ? elements : composedComponents);
  const visible = $derived(inventory.filter(name => name.toLowerCase().includes(search.trim().toLowerCase())));
  function changeSection(value: string) {
    const url = new URL(page.url);
    url.searchParams.set('section', value);
    void goto(url, { noScroll: true, keepFocus: true });
  }
  providePreviewClient(fixtureFetch);
  const previewsReady = true;
  const large = new Set(['DetailCard','Heading','MediaHero','MediaPage','MediaDetailRows','IntegrationSettings','JobsSettings','Dialog','MetadataEditor','ProfileEditor','ProfileFeatureEditor','RequestDialog']);
  const textSizes = ['--text-sm','--text-md','--text-xl','--text-2xl','--text-hero-mobile','--text-hero'];
  const weights = ['--weight-regular','--weight-semibold','--weight-bold'];
  const palette = [
    { title:'Canvas and surfaces', tokens:['--canvas','--white','--surface'] },
    { title:'Text', tokens:['--ink','--muted'] },
    { title:'Accent and status', tokens:['--accent','--danger','--success','--rating'] },
    { title:'Derived roles', tokens:['--surface-hover','--quiet','--line'], derived:true },
  ];
  let tokenValues = $state<Record<string,string>>({});
  onMount(() => {
    const styles = getComputedStyle(document.documentElement);
    tokenValues = Object.fromEntries(
      ['--font-sans',...weights,...textSizes,...palette.flatMap((group)=>group.tokens)]
        .map((token)=>[token,styles.getPropertyValue(token).trim()])
    );
  });
</script>

<svelte:head><title>UI reference · Coast</title></svelte:head>
<div class="content page">
  <Heading level={1} title="UI reference" selection={{label:'UI reference section',value:section,options:referenceSections,change:changeSection}}>
    {#snippet actions()}<Button href="/settings/admin" emphasis="subtle">Admin settings</Button>{/snippet}
  </Heading>
  {#if section !== 'charts'}<p class="small reference-description">Shared styles and all {components.length} reusable elements and components. Examples use isolated demo data.</p>{/if}
  {#if section === 'typography'}
  <section class="section token-section" aria-labelledby="typography-heading">
    <h2 id="typography-heading">Typography</h2>
    <p class="small"><code>--font-sans</code> · {tokenValues['--font-sans'] || 'Loading font…'}</p>
    <div class="token-grid">
      <section class="specimen" aria-labelledby="text-sizes-heading">
        <h3 id="text-sizes-heading">Shared text sizes</h3>
        <p class="small">Four everyday sizes: 12, 14, 20 and 28px. The hero keeps its 34px mobile and 58px desktop titles.</p>
        {#each textSizes as token}
          <div class="type-specimen" data-size-token={token}>
            <span class="type-sample" style:font-size={`var(${token})`}>The stories you love · Aa 0123456789</span>
            <div class="row small quiet"><code>{token}</code><span>{tokenValues[token] || '…'}</span></div>
          </div>
        {/each}
      </section>
      <section class="specimen" aria-labelledby="text-weights-heading">
        <h3 id="text-weights-heading">Shared weights</h3>
        <p class="small">Inter variable font · regular, semibold and bold throughout the app.</p>
        {#each weights as weight}
          <div class="type-specimen" data-font-weight={weight}>
            <span class="type-sample" style:font-weight={`var(${weight})`}>The stories you love · Aa 0123456789</span>
            <div class="row small quiet"><code>{weight}</code><span>{tokenValues[weight] || '…'}</span></div>
          </div>
        {/each}
      </section>
    </div>
    <section class="specimen text-styles" aria-labelledby="text-styles-heading">
      <h3 id="text-styles-heading">Reusable text styles</h3>
      <p class="small">Rendered with the existing elements, utility classes and components.</p>
      <div class="token-grid">
        <div class="style-samples">
          <div><code class="small quiet">h1</code><h1>Page heading</h1></div>
          <div><code class="small quiet">h2</code><h2>Section heading</h2></div>
          <div><code class="small quiet">h3</code><h3>Subheading</h3></div>
          <div><code class="small quiet">Heading (title) · --text-xl / --weight-bold</code><Heading variant="title" title="Shelf heading" /></div>
          <div><code class="small quiet">Inherited body text</code><div>Clear, familiar text for everyday content.</div></div>
          <div><code class="small quiet">p / .muted</code><p>Secondary description or supporting copy.</p></div>
          <div><code class="small quiet">.quiet</code><div class="quiet">Low-emphasis supporting text.</div></div>
          <div><code class="small quiet">small / .small</code><small>Caption and metadata text.</small></div>
          <div class="row"><span class="text-accent">.text-accent</span><span class="text-danger">.text-danger</span></div>
        </div>
        <DetailCard title="DetailCard heading" description="Description and footer style">
          <p>DetailCard body text uses the shared body size.</p>
          <MetricGrid items={[{label:'Metric value',value:'128',detail:'Numeric styling and metadata'},{label:'Text value',value:'Watching',text:true}]} />
          {#snippet footer()}Supporting footer copy{/snippet}
        </DetailCard>
      </div>
    </section>
  </section>
  {:else if section === 'colors'}
  <section class="section token-section" aria-labelledby="colors-heading">
    <h2 id="colors-heading">Colors</h2>
    <p class="small">Nine base colors from src/app.css. Hover, subdued text and borders are derived roles; chart shades, transparency and all six glass treatments use the same palette.</p>
    {#each palette as group}
      <section class="palette-group" aria-label={group.title}>
        <h3>{group.title}</h3>
        <div class="color-grid">
          {#each group.tokens as token}
            <div class="color-specimen" data-color-token={group.derived ? undefined : token} data-derived-color-token={group.derived ? token : undefined}>
              <div class="swatch" style:background={`var(${token})`} aria-label={`${token} swatch`}></div>
              <code>{token}</code>
              <span class="small quiet">{tokenValues[token] || '…'}</span>
            </div>
          {/each}
        </div>
      </section>
    {/each}
  </section>
  {:else if section === 'materials'}
  <section class="section" aria-label="Materials">
    <MaterialTweaker />
  </section>
  {:else if section === 'charts'}
    {#await loadChartGallery()}
      <p class="section quiet" role="status">Loading chart exploration…</p>
    {:then gallery}
      <gallery.default />
    {:catch}
      <p class="section" role="alert">The chart exploration could not load. Reload this page to try again.</p>
    {/await}
  {:else}
  <div class="row preview-filters">
    <label class="field">Find {section === 'elements' ? 'an element' : 'a component'}<input type="search" bind:value={search} placeholder="Name" /></label>
    <span class="quiet" role="status">{visible.length} / {inventory.length}</span>
  </div>
  <div class="inventory">
    {#each visible as name (name)}
      <section class="specimen" id={`component-${name}`} aria-labelledby={`label-${name}`}>
        <Heading title={name}>
          {#snippet heading()}<h2 id={`label-${name}`}>{name}{['SocialControls','NotificationInbox','StreamsPanel'].includes(name)?' · Non-approved':''}</h2>{/snippet}
          {#snippet actions()}<a class="small quiet" href={`/ui-preview/demo?component=${name}`} target="_blank" rel="noreferrer">Open ↗</a>{/snippet}
        </Heading>
        <p class="small quiet">{manifest[name].path}</p>
        {#if manifest[name].elements.length}
          <div class="row small"><span class="quiet">Built with</span>
            {#each manifest[name].elements as element}<a href={`/ui-preview?section=${elements.some(value=>value===element)?'elements':'components'}#component-${element}`}>{element}</a>{/each}
          </div>
        {/if}
        {#if manifest[name].dynamicComposition}<p class="small quiet">Also accepts composition through snippets or dynamic content.</p>{/if}
        {#if manifest[name].usedBy.length}
          <details class="small"><summary>Used by {manifest[name].usedBy.length} components / pages</summary>
            {#each manifest[name].usedBy as consumer}<p class="small quiet"><code>{consumer}</code></p>{/each}
          </details>
        {/if}
        {#if previewsReady}<PreviewSlot {name} minimum={large.has(name)?780:360} />{/if}
      </section>
    {:else}<p class="quiet">No matching {section === 'elements' ? 'elements' : 'components'}.</p>{/each}
  </div>
  {/if}
</div>

<style>
  .reference-description { padding-bottom:24px; border-bottom:1px solid var(--line); }
  .preview-filters { margin:24px 0; flex-wrap:wrap; }
  .preview-filters .field { min-width:240px; }
  .inventory { display:grid; }
  .specimen { min-width:0; }
  .inventory > .specimen { padding:24px 0; border-bottom:1px solid var(--line); }
  .token-section > h2 { font-size:var(--text-xl); font-weight:var(--weight-bold); }
  .token-section > p { margin-top:8px; }
  .token-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); align-items:start; gap:32px; margin-top:20px; }
  .type-specimen { display:grid; gap:8px; padding:16px 0; border-bottom:1px solid var(--line); }
  .type-specimen:last-child { border-bottom:0; }
  .type-sample { overflow-wrap:anywhere; }
  .text-styles { margin-top:32px; padding-top:24px; border-top:1px solid var(--line); }
  .style-samples { display:grid; gap:20px; }
  .style-samples > div > code { display:block; margin-bottom:6px; }
  .palette-group { margin-top:24px; padding-bottom:24px; border-bottom:1px solid var(--line); }
  .color-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:24px; margin-top:12px; }
  .color-specimen { min-width:0; display:grid; gap:10px; }
  .color-specimen code { overflow-wrap:anywhere; }
  .swatch { height:64px; border:1px solid var(--line); border-radius:8px; }
  @media(max-width:900px) { .token-grid { grid-template-columns:1fr; } .color-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>
