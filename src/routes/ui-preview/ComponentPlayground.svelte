<script lang="ts">
  import {previewJson,previewEvent} from '#lib/ui/preview-input.js';
  import {useClient} from '#lib/ui/client-context.js';
  const delivery=useClient().feedback;
  import type { Snippet } from 'svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import PreviewDisclosure from '#lib/ui/cards/editor/PreviewDisclosure.svelte';
  import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
  import PreviewToggle from '#lib/ui/cards/editor/PreviewToggle.svelte';
  import ControlChoice from './ControlChoice.svelte';
  import ItemOptions from './ItemOptions.svelte';
  import VariantControls from './VariantControls.svelte';
  import { exampleSwitches, fixtureFields, standard, variantGroups, variantProps } from './item-controls';
  import Field from '#lib/ui/components/Field.svelte';
  import PreviewExample from './PreviewExample.svelte';
  import Browser from './Browser.svelte';
  import { referenceEntries, referenceHref } from './catalog';
  import { useCanvas, type WorkspaceParts } from './workspace';
  import PropEditor from './PropEditor.svelte';
  import { contracts,defaultSlot,emptyCustomisation,handlerMode,specimenDefaults,type Customisation } from './props';
  let { name, options, initialScenario, change, onscenario, layout }: {
    name:string; options:{value:string;label:string}[]; initialScenario?:string|null; change:(name:string)=>void;
    onscenario:(value:string|null)=>void; layout:Snippet<[WorkspaceParts]>;
  } = $props();
  const entry = $derived(referenceEntries.find(entry => entry.id === name)!);
  const selected = $derived(entry.states.find(state => state.id === initialScenario) ?? entry.states[0]);
  const groups = $derived(variantGroups(entry,!!contracts[name]));
  const variant = $derived(initialScenario ?? groups[0].options[0].id);
  const preset = $derived(contracts[name] ? variantProps(name,variant) : undefined);
  const custom = $derived(preset !== undefined);
  const only = $derived(fixtureFields(selected.reference,selected.scenario));
  const switches = $derived(custom?[]:exampleSwitches(selected.reference,selected.scenario));
  let edits = $state<Record<string,Customisation>>({});
  const key = $derived(name+':'+variant);
  const draft = $derived(edits[key] ?? emptyCustomisation());
  const values = $derived({...draft,props:{...preset,...draft.props}});
  let events=$state<{name:string;value:string}[]>([]);
  let revision=$state(0);
  const canvasSettings = useCanvas();
  let width = $state(1100);
  let exported = $state(false);
  $effect(()=>{key; events=[]; exported=false;});
  function configurationValue(next:Customisation=values){
    const contract=contracts[name];
    return {...(custom&&contract?{component:name,variant,props:{...Object.fromEntries(contract.props.filter(prop=>prop.defaultValue!==undefined).map(prop=>[prop.name,prop.defaultValue])),...specimenDefaults(name),...next.props},slots:Object.fromEntries(contract.props.filter(prop=>prop.kind==='snippet').map(prop=>[prop.name,next.slots[prop.name]?.kind&&next.slots[prop.name].kind!=='example'?next.slots[prop.name]:defaultSlot(name,prop)])),handlers:Object.fromEntries(contract.props.filter(prop=>prop.kind==='callback').map(prop=>[prop.name,handlerMode(name,prop,next)]))}:{reference:name,scenario:selected.id,options:next.props,sources:entry.sources}),preview:{background:canvasSettings.background,color:canvasSettings.color,hasImage:Boolean(canvasSettings.image),width}};
  }
  const configuration=$derived.by(()=>{
    try{return previewJson(configurationValue(),2);}catch(cause){return cause instanceof Error?cause.message:'Configuration exceeds preview limits.';}
  });
  function restart() {events=[];exported=false;revision++;}
  function reset() {delete edits[key];restart();}
  function accept(next:Customisation){
    try{
      previewJson(configurationValue(next),2);
      edits[key]=next;
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
  function selectState(value:string) {onscenario(value===standard ? null : value);}
</script>

{@render layout({title:entry.title,specimenKey:key,canvas,inspector,browser})}

{#snippet canvas()}

  <div class="element-stage">
    <div class="element-width" style:max-width={`${width}px`}>
      {#key `${key}:${revision}`}<PreviewExample name={custom ? name : selected.reference} scenario={selected.scenario} custom={custom?values:undefined} options={custom?undefined:draft.props} onprop={setProp} onevent={record} />{/key}
    </div>
  </div>
{/snippet}

{#snippet inspector()}
  <div class="stack">
    <VariantControls {name} {groups} value={variant} onchange={selectState} />
    {#if custom || only.length}<ItemOptions {name} only={custom?undefined:only} custom={values} change={accept} />{/if}
    {#each switches as option (option.key)}
      <AuthSurface><PreviewToggle label={option.label} icon="sliders" checked={Boolean(draft.props[option.key]??option.initial)}
        onchange={checked=>setProp(option.key,checked)} /></AuthSurface>
    {/each}
    {#if selected.reference==='editor.carousel'}
      <ControlChoice label="Selected section" value={String(draft.props.section??'sample')}
        options={[{id:'sample',label:'Sample'},{id:'badges',label:'Badges'},{id:'metadata',label:'Metadata'}]}
        onchange={value=>setProp('section',value)} />
    {/if}
    {#if name==='MediaDetailRows'}
      <AuthSurface><PreviewToggle label="Expanded section" icon="sliders" checked={values.props.section==='insights'}
        onchange={checked=>setProp('section',checked?'insights':null)} /></AuthSurface>
    {/if}
    {#if name==='editor.separator'}<p class="small quiet">The glass separator has one fixed style.</p>{/if}
    {#if edits[key]}<Button emphasis="subtle" icon="retry" onclick={reset}>Reset options</Button>{/if}
    {#key key}<PreviewDisclosure label="Advanced" icon="sliders">
      {#if custom}
        <details><summary>Component props</summary><PropEditor {name} custom={values} change={accept} /></details>
        <details><summary>Preview events · {events.length}</summary><div class="stack source-details" aria-live="polite">{#each events as event}<div><code>{event.name}</code><pre>{event.value}</pre></div>{:else}<p class="small quiet">Use a component control to inspect its local callback events.</p>{/each}</div></details>
      {/if}
      <details><summary>Canvas</summary><div class="stack canvas-options">
        <Field label={`Preview width · ${width}px`}><input type="range" min="320" max="1400" step="10" bind:value={width} /></Field>
      </div></details>
      <div class="row"><Button emphasis="subtle" onclick={restart}>Restart preview</Button><Button emphasis="subtle" onclick={copy}>Copy configuration</Button></div>

      {#if exported}<Field label="Configuration"><textarea readonly rows="10" value={configuration}></textarea></Field>{/if}
      <details><summary>Source and usage</summary><div class="stack source-details">
        {#each entry.sources as source}<code>{source}</code>{/each}
        {#if entry.elements.length}<p class="small quiet">Built with</p><div class="row">{#each entry.elements as element}<a href={referenceHref(element)}>{element}</a>{/each}</div>{/if}
        {#if entry.dynamicComposition}<p class="small quiet">Supports snippets or dynamic content.</p>{/if}
        {#each entry.usedBy as consumer}<code>{consumer}</code>{/each}
      </div></details>
    </PreviewDisclosure>{/key}
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
