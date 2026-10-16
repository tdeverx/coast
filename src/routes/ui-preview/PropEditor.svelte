<script lang="ts">
 import Button from '$lib/ui/components/Button.svelte';
 import Field from '$lib/ui/components/Field.svelte';
 import {contracts,dataSample,handlerMode,parseData,propLabel,specimenDefaults,type Customisation,type PropContract,type SlotChoice} from './props';
 let {name,custom,change}:{name:string;custom:Customisation;change:(value:Customisation)=>void}=$props();
 let search=$state(''),drafts=$state<Record<string,string>>({}),errors=$state<Record<string,string>>({});
 const contract=$derived(contracts[name]);
 const defaults=$derived(specimenDefaults(name));
 const fields=$derived(contract.props.filter(prop=>`${prop.name} ${prop.type}`.toLowerCase().includes(search.toLowerCase())));
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
 <p class="small quiet">{contract.props.length} source-defined props. Controls edit the real component. Data uses synthetic fixtures; callbacks stay local.</p>
 {#if !contract.props.length}<p class="small quiet">This component has no public props. Its application-owned state is demonstrated in the example states.</p>{/if}
 {#each fields as prop (prop.name)}
  <div class="prop-control">
   <div class="prop-title"><code>{prop.name}</code><div class="prop-actions">{#if prop.optional}<Button emphasis="subtle" compact onclick={()=>omit(prop)} label={`Omit ${prop.name}`}>Omit</Button>{/if}{#if Object.hasOwn(custom.props,prop.name)||custom.slots[prop.name]||custom.callbacks[prop.name]}<Button emphasis="subtle" compact onclick={()=>reset(prop.name)} label={`Reset ${prop.name}`}>Reset</Button>{/if}</div></div>
   {#if Object.hasOwn(custom.props,prop.name)&&custom.props[prop.name]===undefined}<p class="small quiet">Not supplied; the component chooses its default.</p>{/if}
   {#if prop.kind==='boolean'}
    <label class="check"><input type="checkbox" checked={value(prop)===true} onchange={event=>set(prop.name,event.currentTarget.checked)} />{propLabel(prop.name)}</label>
   {:else if prop.kind==='select'}
    <Field label={propLabel(prop.name)}><select value={value(prop)===null?'@null':value(prop)===undefined?'@default':String(value(prop))} onchange={event=>{const selected=event.currentTarget.value;if(selected==='@default')reset(prop.name);else set(prop.name,selected==='@null'?null:prop.choices?.find(value=>String(value)===selected));}}>
     <option value="@default">Example default</option>{#if prop.nullable}<option value="@null">None (null)</option>{/if}
     {#each prop.choices??[] as choice}<option value={String(choice)}>{String(choice)}</option>{/each}
    </select></Field>
   {:else if prop.kind==='number'}
    <Field label={propLabel(prop.name)}><input type="number" step="any" value={value(prop)===null?'':value(prop) as number??''} placeholder={prop.nullable?'None (null)':'Example default'} onchange={event=>{if(event.currentTarget.value===''){if(prop.nullable)set(prop.name,null);else reset(prop.name);}else if(Number.isFinite(event.currentTarget.valueAsNumber))set(prop.name,event.currentTarget.valueAsNumber);}} /></Field>
   {:else if prop.kind==='text'}
    <Field label={propLabel(prop.name)}><input value={value(prop) as string??''} oninput={event=>set(prop.name,event.currentTarget.value)} /></Field>
    {#if prop.nullable}<label class="check"><input type="checkbox" checked={value(prop)===null} onchange={event=>set(prop.name,event.currentTarget.checked?null:'')} />No value (null)</label>{/if}
   {:else if prop.kind==='snippet'}
    <Field label={`${propLabel(prop.name)} slot`}><select value={custom.slots[prop.name]?.kind??'example'} onchange={event=>slot(prop,event.currentTarget.value as SlotChoice['kind'])}>
     <option value="example">Example content</option>{#if prop.optional}<option value="hidden">Hidden</option>{/if}<option value="text">Text</option><option value="actions">Buttons / menu</option><option value="avatar">Avatar</option><option value="field">Input field</option><option value="timeline">Playback timeline</option>
    </select></Field>
    {#if custom.slots[prop.name]?.kind==='text'}<Field label={`${propLabel(prop.name)} content`}><textarea rows="2" value={custom.slots[prop.name].text} oninput={event=>slot(prop,'text',event.currentTarget.value)}></textarea></Field>{/if}
   {:else if prop.kind==='callback'}
    <Field label={`${propLabel(prop.name)} handler`}><select value={handlerMode(name,prop,custom)} onchange={event=>change({...custom,callbacks:{...custom.callbacks,[prop.name]:event.currentTarget.value as 'example'|'record'|'off'}})}><option value="example">Example behavior + record events</option><option value="record">Record events only</option>{#if prop.optional}<option value="off">Not supplied</option>{/if}</select></Field>
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
