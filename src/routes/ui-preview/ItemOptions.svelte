<script lang="ts">
  import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
  import PreviewToggle from '#lib/ui/cards/editor/PreviewToggle.svelte';
  import Field from '#lib/ui/components/Field.svelte';
  import ControlChoice from './ControlChoice.svelte';
  import { contracts, defaultSlot, specimenDefaults, type Customisation, type PropContract } from './props';
  import { optionLabel, ranges, visibleProps } from './item-controls';
  let {name,custom,change,only}: {name:string;only?:string[];custom:Customisation;change:(value:Customisation)=>void} = $props();
  const defaults=$derived(only?{} as Record<string,unknown>:specimenDefaults(name));
  const fields=$derived(only?contracts[name].props.filter(prop=>only.includes(prop.name)):visibleProps(name,contracts[name].props));
  function value(prop:PropContract) {
    if (Object.hasOwn(custom.props,prop.name)) return custom.props[prop.name];
    return Object.hasOwn(defaults,prop.name)?defaults[prop.name]:prop.defaultValue;
  }
  function set(key:string,value:unknown) {change({...custom,props:{...custom.props,[key]:value}});}
</script>

{#each fields as prop (prop.name)}
  {@const current=value(prop)}
  {@const label=optionLabel(prop.name)}
  {#if prop.kind==='boolean'}
    <AuthSurface><PreviewToggle {label} icon="sliders" checked={current===true} onchange={checked=>set(prop.name,checked)} /></AuthSurface>
  {:else if prop.kind==='select'}
    {@const choices=(prop.choices??[]).map(choice=>({id:String(choice),label:optionLabel(String(choice))}))}
    {@const optional=prop.optional && (prop.defaultValue===undefined || (!!only && prop.name==='shape')) && defaults[prop.name]==null}
    <ControlChoice {label} value={current==null?'@auto':String(current)}
      options={optional?[{id:'@auto',label:'Automatic'},...choices]:choices}
      onchange={id=>set(prop.name,prop.choices?.find(choice=>String(choice)===id))} />
  {:else if prop.kind==='number'}
    {@const range=ranges[name+'.'+prop.name]??ranges[prop.name]}
    {#if range}
      <Field {label} hint={String(current??'')}><input type="range" min={range[0]} max={range[1]} step={range[2]}
        value={Number(current)} oninput={event=>set(prop.name,event.currentTarget.valueAsNumber)} /></Field>
    {:else}
      <Field {label}><input type="number" min="0" value={current as number??''}
        onchange={event=>{const input=event.currentTarget;if(input.validity.valid && Number.isFinite(input.valueAsNumber))set(prop.name,input.valueAsNumber);else if(!input.value && prop.nullable)set(prop.name,null);else input.value=String(current??'');}} /></Field>
    {/if}
  {:else if prop.kind==='text'}
    <Field {label}><input value={String(current??'')} oninput={event=>set(prop.name,event.currentTarget.value)} /></Field>
  {:else if prop.kind==='data' && Array.isArray(defaults[prop.name])}
    <AuthSurface><PreviewToggle label="Show sample entries" icon="list" checked={Array.isArray(current) && current.length>0}
      onchange={checked=>set(prop.name,checked?defaults[prop.name]:[])} /></AuthSurface>
  {:else if prop.kind==='snippet'}
    {@const choice=custom.slots[prop.name]}
    <ControlChoice label="Content" value={!choice || choice.kind==='example'?defaultSlot(name,prop).kind:choice.kind}
      options={[{id:'actions',label:'Buttons'},{id:'text',label:'Text'},...(prop.optional?[{id:'hidden',label:'Hidden'}]:[])]}
      onchange={kind=>change({...custom,slots:{...custom.slots,[prop.name]:{kind:kind as 'actions'|'text'|'hidden',text:'Save'}}})}/>
  {/if}
{/each}
