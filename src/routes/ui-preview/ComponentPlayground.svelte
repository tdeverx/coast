<script lang="ts">
  import {previewJson,previewEvent} from '#lib/ui/preview-input.js';
  import {useClient} from '#lib/ui/client-context.js';
  const delivery=useClient().feedback;
  import type { Snippet } from 'svelte';
  import { untrack } from 'svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import Field from '#lib/ui/components/Field.svelte';
  import PreviewExample from './PreviewExample.svelte';
  import Browser from './Browser.svelte';
  import { referenceEntries, elements } from './catalog';
  import { scenarios, selectedScenario, scenarioLabel } from './reference';
  import { useCanvas, type WorkspaceParts } from './workspace';
  import PropEditor from './PropEditor.svelte';
  import { contracts,defaultSlot,emptyCustomisation,handlerMode,specimenDefaults,type Customisation } from './props';
  let { name, options, initialScenario, change, onscenario, layout }: {
    name:string; options:{value:string;label:string}[]; initialScenario?:string|null; change:(name:string)=>void;
    onscenario:(value:string)=>void; layout:Snippet<[WorkspaceParts]>;
  } = $props();
  let values = $state<Customisation>(emptyCustomisation());
  let scenario = $state(untrack(() => selectedScenario(name, initialScenario)));
  let custom = $state(untrack(()=>!initialScenario && !!contracts[name]));
  let events=$state<{name:string;value:string}[]>([]);
  let revision=$state(0);
  const canvasSettings = useCanvas();
  let width = $state(1100);
  let exported = $state(false);
  let previousName = untrack(() => name);
  $effect(()=>{
    const selected=name;
    const requested=selectedScenario(selected,initialScenario);
    untrack(()=>{
      if(previousName!==selected){
        previousName=selected;values=emptyCustomisation();scenario=requested;custom=!initialScenario && !!contracts[selected];exported=false;events=[];
      }else if(scenario!==requested){
        scenario=requested;custom=false;
      }
    });
  });
  const entry = $derived(referenceEntries.find(entry => entry.id === name)!);
  function configurationValue(next:Customisation=values,enabled=custom){
    const contract=contracts[name];
    return {...(enabled&&contract?{component:name,props:{...Object.fromEntries(contract.props.filter(prop=>prop.defaultValue!==undefined).map(prop=>[prop.name,prop.defaultValue])),...specimenDefaults(name),...next.props},slots:Object.fromEntries(contract.props.filter(prop=>prop.kind==='snippet').map(prop=>[prop.name,next.slots[prop.name]?.kind&&next.slots[prop.name].kind!=='example'?next.slots[prop.name]:defaultSlot(name,prop)])),handlers:Object.fromEntries(contract.props.filter(prop=>prop.kind==='callback').map(prop=>[prop.name,handlerMode(name,prop,next)]))}:{reference:name,scenario,sources:entry.sources}),preview:{background:canvasSettings.background,color:canvasSettings.color,hasImage:Boolean(canvasSettings.image),width}};
  }
  const configuration=$derived.by(()=>{
    try{return previewJson(configurationValue(),2);}catch(cause){return cause instanceof Error?cause.message:'Configuration exceeds preview limits.';}
  });
  function reset() {values=emptyCustomisation();custom=!!contracts[name];events=[];revision++;}
  function accept(next:Customisation){
    try{
      previewJson(configurationValue(next,true),2);
      values=next;
    }catch(cause){delivery.failure(cause instanceof Error?cause.message:'The preview input could not be accepted.');}
  }
  function setProp(key:string,value:unknown){accept({...values,props:{...values.props,[key]:value}});}
  function record(name:string,args:unknown[]){events=[...events.slice(-7),{name,value:previewEvent(args)}];}

  async function copy() {
    exported = true;
    let text:string;
    try{text=previewJson(configurationValue(),2);}catch(cause){delivery.failure(cause instanceof Error?cause.message:'Configuration exceeds preview limits.');return;}
    try {await navigator.clipboard.writeText(text);delivery.notify('Configuration copied.');}
    catch {delivery.notify('Select the configuration below to copy it.');}
  }
  function selectState(value:string) {scenario = value;custom = false;onscenario(value);}
</script>

{@render layout({title:entry.title,canvas,inspector,browser})}

{#snippet canvas()}

  <div class="element-stage">
    <div class="element-width" style:max-width={`${width}px`}>
      {#key `${name}:${revision}`}<PreviewExample {name} scenarioValue={scenario} custom={custom&&contracts[name]?values:undefined} onprop={setProp} onevent={record} />{/key}
    </div>
  </div>
{/snippet}

{#snippet inspector()}
  <div class="stack">
    <Field label="Example state"><select value={scenario} onchange={event => selectState(event.currentTarget.value)}>{#each scenarios(name) as value}<option {value}>{scenarioLabel(value)}</option>{/each}</select></Field>
    {#if contracts[name]}
      <label class="check"><input type="checkbox" bind:checked={custom} />Customise component props</label>
      {#if custom}<PropEditor {name} custom={values} change={accept} />{/if}
      <details><summary>Preview events · {events.length}</summary><div class="stack source-details" aria-live="polite">{#each events as event}<div><code>{event.name}</code><pre>{event.value}</pre></div>{:else}<p class="small quiet">Use a component control to inspect its local callback events.</p>{/each}</div></details>
    {/if}
    <details><summary>Canvas</summary><div class="stack canvas-options">
      <Field label={`Preview width · ${width}px`}><input type="range" min="320" max="1400" step="10" bind:value={width} /></Field>
    </div></details>
    <div class="row"><Button emphasis="subtle" onclick={reset}>Reset</Button><Button emphasis="subtle" onclick={copy}>Copy configuration</Button></div>

    {#if exported}<Field label="Configuration"><textarea readonly rows="10" value={configuration}></textarea></Field>{/if}
    <details><summary>Source and usage</summary><div class="stack source-details">
      {#each entry.sources as source}<code>{source}</code>{/each}
      {#if entry.elements.length}<p class="small quiet">Built with</p><div class="row">{#each entry.elements as element}<a href={`/ui-preview?section=${elements.some(value => value === element) ? 'elements' : 'components'}&component=${element}`}>{element}</a>{/each}</div>{/if}
      {#if entry.dynamicComposition}<p class="small quiet">Supports snippets or dynamic content.</p>{/if}
      {#each entry.usedBy as consumer}<code>{consumer}</code>{/each}
    </div></details>
  </div>
{/snippet}

{#snippet browser({heading}:{heading:Snippet})}<Browser title="Browse items" {heading} {options} value={name} change={change} />{/snippet}

<style>
  .element-stage {padding:0;display:flex;align-items:safe center;justify-content:center;flex:1;min-height:0;min-width:0;border-radius:0 0 20px 20px;}
  .element-width {width:100%;min-width:0;min-height:0;overflow:visible;}
  .canvas-options,.source-details {margin-top:16px;}
  .source-details code {font-size:var(--text-sm);overflow-wrap:anywhere;}
  .row {flex-wrap:wrap;gap:8px;}
  pre {font-size:var(--text-sm);white-space:pre-wrap;overflow-wrap:anywhere;}
</style>
