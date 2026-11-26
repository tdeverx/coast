<script lang="ts">
 import PreviewSelect from '#lib/ui/cards/editor/PreviewSelect.svelte';
 import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
 import PreviewToggle from '#lib/ui/cards/editor/PreviewToggle.svelte';
 import Button from '#lib/ui/components/Button.svelte';
 import Field from '#lib/ui/components/Field.svelte';
 import {progressiveBlurSteps,progressiveTintSteps} from '#lib/ui/materials/progressive-blur.js';
 import {contracts,dataSample,handlerMode,parseData,propLabel,specimenDefaults,type Customisation,type PropContract,type SlotChoice} from './props';
 let {name,custom,change}:{name:string;custom:Customisation;change:(value:Customisation)=>void}=$props();
 let search=$state(''),drafts=$state<Record<string,string>>({}),errors=$state<Record<string,string>>({});
 const contract=$derived(contracts[name]);
 const defaults=$derived(specimenDefaults(name));
 const fields=$derived(contract.props.filter(prop=>`${prop.name} ${prop.type}`.toLowerCase().includes(search.toLowerCase())));
 const blurStepRanges: Partial<Record<string,{label:string;min:number;max:number;default:number}>> = {
  steps: {label:'Blur steps',...progressiveBlurSteps},
  tintSteps: {label:'Tint steps',...progressiveTintSteps},
 };
 $effect(()=>{name;search='';drafts={};errors={};});
 function value(prop:PropContract) {return Object.hasOwn(custom.props,prop.name)?custom.props[prop.name]:Object.hasOwn(defaults,prop.name)?defaults[prop.name]:prop.defaultValue;}
 function set(key:string,value:unknown) {
  const properties={...custom.props,[key]:value};
  if(name==='Button'&&value===true&&(key==='menu'||key==='item'))properties[key==='menu'?'item':'menu']=false;
  change({...custom,props:properties});
 }
 function dataValue(prop:PropContract) {const current=value(prop);return current===undefined?dataSample(name,prop):current;}
 function reset(key:string) {
  const { [key]:_prop,...properties}=custom.props,{[key]:_slot,...slots}=custom.slots,{[key]:_callback,...callbacks}=custom.callbacks;
  change({props:properties,slots,callbacks});delete drafts[key];delete errors[key];
 }
 function slot(prop:PropContract,kind:SlotChoice['kind'],text=custom.slots[prop.name]?.text??'Preview content') {change({...custom,slots:{...custom.slots,[prop.name]:{kind,text}}});}
 function omit(prop:PropContract) {
  if(prop.kind==='snippet')slot(prop,'hidden');
  else if(prop.kind==='callback')change({...custom,callbacks:{...custom.callbacks,[prop.name]:'off'}});
  else set(prop.name,undefined);
 }
 function apply(prop:PropContract) {
  try {set(prop.name,parseData(drafts[prop.name]??JSON.stringify(dataValue(prop),null,2),prop));errors[prop.name]='';}
  catch(cause){errors[prop.name]=cause instanceof Error?cause.message:'Invalid data';}
 }
</script>
<div class="prop-editor stack">
 <Field label="Find a prop"><input type="search" bind:value={search} placeholder="Name or type" /></Field>
 <p class="small quiet">{contract.props.length} source-defined props. Edits and callback events stay in this preview.</p>
 {#if !contract.props.length}<p class="small quiet">This component has no public props. Its application-owned state is demonstrated in the example states.</p>{/if}
 {#each fields as prop (prop.name)}
  {@const range = name==='ProgressiveBlur' ? blurStepRanges[prop.name] : undefined}
  <div class="prop-control">
   <div class="prop-title"><code>{prop.name}</code><div class="prop-actions">{#if prop.optional}<Button emphasis="subtle" compact onclick={()=>omit(prop)} label={`Omit ${prop.name}`}>Omit</Button>{/if}{#if Object.hasOwn(custom.props,prop.name)||custom.slots[prop.name]||custom.callbacks[prop.name]}<Button emphasis="subtle" compact onclick={()=>reset(prop.name)} label={`Reset ${prop.name}`}>Reset</Button>{/if}</div></div>
   {#if Object.hasOwn(custom.props,prop.name)&&custom.props[prop.name]===undefined}<p class="small quiet">Not supplied; the component chooses its default.</p>{/if}
   {#if prop.kind==='boolean'}
    <AuthSurface><PreviewToggle label={propLabel(prop.name)} icon="sliders" checked={value(prop)===true} onchange={checked=>set(prop.name,checked)} /></AuthSurface>
   {:else if prop.kind==='select'}
    <PreviewSelect topLayer label={propLabel(prop.name)} value={value(prop)===null?'@null':value(prop)===undefined?'@default':String(value(prop))}
      options={[{id:'@default',label:'Example default'},...(prop.nullable?[{id:'@null',label:'None (null)'}]:[]),...(prop.choices??[]).map(choice=>({id:String(choice),label:String(choice)}))]}
      onchange={selected=>{if(selected==='@default')reset(prop.name);else set(prop.name,selected==='@null'?null:prop.choices?.find(choice=>String(choice)===selected));}} />
   {:else if range}
    {@const steps = (value(prop) as number | undefined) ?? range.default}
    <Field label={range.label} hint={String(steps)}>
     <input type="range" min={range.min} max={range.max} value={steps} oninput={event=>set(prop.name,event.currentTarget.valueAsNumber)} />
    </Field>
   {:else if prop.kind==='number'}
    <Field label={propLabel(prop.name)}><input type="number" step="any" value={value(prop)===null?'':value(prop) as number??''} placeholder={prop.nullable?'None (null)':'Example default'} onchange={event=>{if(event.currentTarget.value===''){if(prop.nullable)set(prop.name,null);else reset(prop.name);}else if(Number.isFinite(event.currentTarget.valueAsNumber))set(prop.name,event.currentTarget.valueAsNumber);}} /></Field>
   {:else if prop.kind==='text'}
    <Field label={propLabel(prop.name)}><input value={value(prop) as string??''} oninput={event=>set(prop.name,event.currentTarget.value)} /></Field>
    {#if prop.nullable}<AuthSurface><PreviewToggle label="No value (null)" icon="sliders" checked={value(prop)===null} onchange={checked=>set(prop.name,checked?null:'')} /></AuthSurface>{/if}
   {:else if prop.kind==='snippet'}
    <PreviewSelect topLayer label={`${propLabel(prop.name)} slot`} value={custom.slots[prop.name]?.kind??'example'}
      options={[{id:'example',label:'Example content'},...(prop.optional?[{id:'hidden',label:'Hidden'}]:[]),
        {id:'text',label:'Text'},{id:'actions',label:'Buttons / menu'},{id:'avatar',label:'Avatar'},{id:'field',label:'Input field'},{id:'timeline',label:'Playback timeline'}]}
      onchange={selected=>slot(prop,selected as SlotChoice['kind'])} />
    {#if custom.slots[prop.name]?.kind==='text'}<Field label={`${propLabel(prop.name)} content`}><textarea rows="2" value={custom.slots[prop.name].text} oninput={event=>slot(prop,'text',event.currentTarget.value)}></textarea></Field>{/if}
   {:else if prop.kind==='callback'}
    <PreviewSelect topLayer label={`${propLabel(prop.name)} handler`} value={handlerMode(name,prop,custom)}
      options={[{id:'example',label:'Example behavior + record events'},{id:'record',label:'Record events only'},...(prop.optional?[{id:'off',label:'Not supplied'}]:[])]}
      onchange={mode=>change({...custom,callbacks:{...custom.callbacks,[prop.name]:mode as 'example'|'record'|'off'}})} />
   {:else}
    <details><summary>{propLabel(prop.name)} data</summary>
     <div class="stack data-editor"><Field label={`${propLabel(prop.name)} JSON`}><textarea rows="6" spellcheck="false" value={drafts[prop.name]??JSON.stringify(dataValue(prop),null,2)} oninput={event=>drafts[prop.name]=event.currentTarget.value}></textarea></Field>
     <div class="row"><Button emphasis="subtle" onclick={()=>apply(prop)}>Apply data</Button>{#if prop.nullable}<Button emphasis="subtle" onclick={()=>set(prop.name,null)}>Use null</Button>{/if}</div>
     {#if errors[prop.name]}<p role="alert" class="small text-danger">{errors[prop.name]}</p>{/if}</div>
    </details>
   {/if}
   <details class="contract"><summary>Contract{prop.bindable?' · two-way binding':''}</summary><code>{prop.type||'Application context'}</code>{#if prop.defaultSource}<p>Component default: <code>{prop.defaultSource}</code></p>{/if}<p>{prop.optional?'Optional':'Required'} prop</p></details>
  </div>
 {/each}
 {#if !fields.length&&contract.props.length}<p class="small quiet">No matching props.</p>{/if}
</div>
<style>
 .prop-control {display:grid;gap:8px;padding-bottom:16px;border-bottom:1px solid var(--line);min-width:0;}
 .prop-title {display:flex;align-items:center;justify-content:space-between;gap:8px;}
 .prop-actions {display:flex;align-items:center;gap:8px;flex:none;}
 code {font-size:var(--text-sm);overflow-wrap:anywhere;white-space:pre-wrap;}
 .contract {font-size:var(--text-sm);color:var(--muted);}
 .contract code,.contract p {display:block;margin-top:8px;}
 .data-editor {margin-top:12px;}
 textarea {font-family:monospace;font-size:var(--text-sm);}
 .row {flex-wrap:wrap;gap:8px;}
</style>
