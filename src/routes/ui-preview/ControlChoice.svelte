<script lang="ts">
  import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
  import PreviewToggle from '#lib/ui/cards/editor/PreviewToggle.svelte';
  import PreviewSelect from '#lib/ui/cards/editor/PreviewSelect.svelte';
  import SegmentedControl from '#lib/ui/components/SegmentedControl.svelte';

  let {label,options,value,onchange,switchLabel}: {
    label:string; options:{id:string;label:string}[]; value:string; onchange:(id:string)=>void; switchLabel?:string;
  } = $props();
</script>
{#if switchLabel && options.length===2}
  <AuthSurface><PreviewToggle label={switchLabel} icon="sliders" checked={value===options[1].id}
    onchange={checked=>onchange(options[Number(checked)].id)} /></AuthSurface>
{:else if options.length>1 && options.length<=3 && options.every(option=>option.label.length<=12)}
  <div class="choice"><span>{label}</span><SegmentedControl {label} material="clear" {value} {onchange}
    options={options.map(option=>({value:option.id,label:option.label}))} /></div>
{:else if options.length>1}
  <PreviewSelect {label} {options} {value} {onchange} topLayer />
{/if}
<style>
  .choice {display:grid;justify-items:start;gap:var(--menu-inset);min-width:0;}
  .choice > span {font-size:var(--text-sm);font-weight:var(--weight-semibold);}
</style>
