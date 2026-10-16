<script lang="ts">
  import type { Snippet } from 'svelte';
  import { untrack } from 'svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Field from '$lib/ui/components/Field.svelte';
  import PreviewExample from './PreviewExample.svelte';
  import Browser from './Browser.svelte';
  import { referenceEntries, elements } from './catalog';
  import { scenarios, selectedScenario, scenarioLabel, approvalLabel } from './reference';
  import { editable, exampleDefaults, exampleConfiguration, type WorkspaceParts } from './workspace';
  let { name, options, initialScenario, change, onscenario, layout }: {
    name:string; options:{value:string;label:string}[]; initialScenario?:string|null; change:(name:string)=>void;
    onscenario:(value:string)=>void; layout:Snippet<[WorkspaceParts]>;
  } = $props();
  let values = $state(untrack(() => exampleDefaults(name)));
  let scenario = $state(untrack(() => selectedScenario(name, initialScenario)));
  let custom = $state(untrack(()=>!initialScenario && editable(name)));
  let background = $state('theme');
  let width = $state(1100);
  let exported = $state(false);
  let notice = $state('');
  let previousName = untrack(() => name);
  $effect(()=>{
    const selected=name;
    const requested=selectedScenario(selected,initialScenario);
    untrack(()=>{
      if(previousName!==selected){
        previousName=selected;values=exampleDefaults(selected);scenario=requested;custom=!initialScenario && editable(selected);exported=false;notice='';
      }else if(scenario!==requested){
        scenario=requested;custom=false;
      }
    });
  });
  const entry = $derived(referenceEntries.find(entry => entry.id === name)!);
  const configuration = $derived(JSON.stringify({...(custom && editable(name) ? exampleConfiguration(name, values, scenario) : {reference:name,scenario,sources:entry.sources}),preview:{background,width}},null,2));
  function reset() {values = exampleDefaults(name);custom = editable(name);notice = '';}
  async function copy() {
    exported = true;
    try {await navigator.clipboard.writeText(configuration);notice = 'Configuration copied.';}
    catch {notice = 'Select the configuration below to copy it.';}
  }
  function selectState(value:string) {scenario = value;custom = false;onscenario(value);}
</script>

{@render layout({title:entry.title,canvas,inspector,browser})}

{#snippet canvas()}
  <div class="canvas-toolbar"><span class="small quiet">{approvalLabel(name)}</span><span class="small quiet">Isolated example</span></div>
  <div class="element-stage" data-background={background}>
    <div class="element-width" style:max-width={`${width}px`}>
      {#key name}<PreviewExample {name} scenarioValue={scenario} options={custom && editable(name) ? values : undefined} />{/key}
    </div>
  </div>
{/snippet}

{#snippet inspector()}
  <div class="stack">
    <Field label="Example state"><select value={scenario} onchange={event => selectState(event.currentTarget.value)}>{#each scenarios(name) as value}<option {value}>{scenarioLabel(value)}</option>{/each}</select></Field>
    {#if editable(name)}
      <label class="check"><input type="checkbox" bind:checked={custom} />Customise component props</label>
      {#if custom}<fieldset class="stack property-controls">
        <legend class="sr-only">Component props</legend>
        {#if name !== 'ProgressBar'}<Field label={name === 'Button' || name === 'Field' ? 'Label' : name === 'Avatar' ? 'Name' : 'Title'}><input bind:value={values.text} /></Field>{/if}
        {#if ['Field','Heading','DetailCard','EmptyState'].includes(name)}<Field label="Description"><input bind:value={values.description} /></Field>{/if}
        {#if name === 'DetailCard'}<Field label="Body"><textarea rows="3" bind:value={values.body}></textarea></Field>{/if}
        {#if name === 'Button'}
          <Field label="Emphasis"><select bind:value={values.emphasis}><option value="standard">Standard</option><option value="subtle">Subtle</option></select></Field>
          <Field label="Size"><select bind:value={values.size}><option value="standard">Standard</option><option value="hero">Hero</option><option value="icon">Icon</option></select></Field>
          <label class="check"><input type="checkbox" bind:checked={values.icon} />Show play icon</label>
          <label class="check"><input type="checkbox" bind:checked={values.disabled} />Disabled</label>
          <label class="check"><input type="checkbox" bind:checked={values.danger} />Destructive</label>
        {:else if name === 'Avatar' || name === 'ProgressBar'}
          <Field label={`${name === 'Avatar' ? 'Size' : 'Progress'} · ${values.number}${name === 'Avatar' ? 'px' : '%'}`}><input type="range" min={name === 'Avatar' ? 24 : 0} max={name === 'Avatar' ? 120 : 100} step="1" bind:value={values.number} /></Field>
        {:else if name === 'MediaCard'}
          <Field label="Shape"><select bind:value={values.shape}><option value="fanart">Landscape</option><option value="poster">Poster</option><option value="square">Square</option><option value="circle">Circle</option></select></Field>
          <label class="check"><input type="checkbox" bind:checked={values.showCaption} />Show caption</label>
          <label class="check"><input type="checkbox" bind:checked={values.showPrimaryAction} />Show primary action</label>
        {/if}
      </fieldset>{/if}
    {/if}
    <details><summary>Canvas</summary><div class="stack canvas-options">
      <Field label="Background"><select bind:value={background}><option value="theme">App canvas</option><option value="surface">Surface</option><option value="light">Light</option><option value="artwork">Artwork colours</option></select></Field>
      <Field label={`Preview width · ${width}px`}><input type="range" min="320" max="1400" step="10" bind:value={width} /></Field>
    </div></details>
    <div class="row"><Button emphasis="subtle" onclick={reset}>Reset</Button><Button emphasis="subtle" onclick={copy}>Copy configuration</Button></div>
    <p role="status" class="small quiet">{notice}</p>
    {#if exported}<Field label="Configuration"><textarea readonly rows="10" value={configuration}></textarea></Field>{/if}
    <details><summary>Source and usage</summary><div class="stack source-details">
      {#each entry.sources as source}<code>{source}</code>{/each}
      {#if entry.elements.length}<p class="small quiet">Built with</p><div class="row">{#each entry.elements as element}<a href={`/ui-preview?section=${elements.some(value => value === element) ? 'elements' : 'components'}&component=${element}`}>{element}</a>{/each}</div>{/if}
      {#if entry.dynamicComposition}<p class="small quiet">Supports snippets or dynamic content.</p>{/if}
      {#each entry.usedBy as consumer}<code>{consumer}</code>{/each}
    </div></details>
  </div>
{/snippet}

{#snippet browser()}<Browser title="Browse items" {options} value={name} change={change} />{/snippet}

<style>
  .canvas-toolbar {display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:16px 20px;border-bottom:1px solid var(--line);flex:none;}
  .element-stage {padding:24px;display:flex;align-items:safe center;justify-content:center;flex:1;min-height:0;min-width:0;border-radius:0 0 20px 20px;}
  .element-stage[data-background=surface] {background:var(--surface);}
  .element-stage[data-background=light] {background:var(--white);}
  .element-stage[data-background=artwork] {background:linear-gradient(140deg,color-mix(in srgb,var(--accent) 40%,var(--surface)),var(--surface),color-mix(in srgb,var(--rating) 25%,var(--canvas)));}
  .element-width {width:100%;min-width:0;min-height:0;overflow:auto;max-height:100%;}
  fieldset {border:0;padding:0;margin:0;min-width:0;}
  .canvas-options,.source-details {margin-top:16px;}
  .source-details code {font-size:var(--text-sm);overflow-wrap:anywhere;}
  .row {flex-wrap:wrap;gap:8px;}
  @media(max-width:800px) {.element-stage {padding:12px;}.canvas-toolbar {padding:12px;}.element-width :global(.demo.custom-example) {min-height:160px;padding:16px;}}
</style>
