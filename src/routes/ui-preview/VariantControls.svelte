<script lang="ts">
  import ControlChoice from './ControlChoice.svelte';
  import type {VariantGroup} from './item-controls';
  let {name,groups,value,onchange}: {name:string;groups:VariantGroup[];value:string;onchange:(id:string)=>void}=$props();
  const group=$derived(groups.find(item=>item.options.some(option=>option.id===value))??groups[0]);
  const sidebar=$derived(value.startsWith('sidebar-'));
  const hasSidebar=$derived(name==='admin.invites'||name==='admin.member');
  const switches:Record<string,string>={'normal,empty':'Empty','normal,error':'Show error','classic,sidebar':'Sidebar layout'};
</script>
{#if hasSidebar}
  <ControlChoice label="View" value={value.replace(/^sidebar-/,'')} options={group.options.filter(o=>!o.id.startsWith('sidebar-'))}
    onchange={id=>onchange((sidebar?'sidebar-':'')+id)}/>
  <ControlChoice label="Layout" switchLabel="Sidebar layout" value={sidebar?'sidebar':'classic'}
    options={[{id:'classic',label:'Classic'},{id:'sidebar',label:'Sidebar'}]}
    onchange={layout=>onchange((layout==='sidebar'?'sidebar-':'')+value.replace(/^sidebar-/,''))}/>
{:else}
  {#if groups.length>1}<ControlChoice label="Preview" options={groups} value={group.id}
    onchange={id=>onchange(groups.find(item=>item.id===id)!.options[0].id)}/>{/if}
  <ControlChoice label={group.id==='Media type'?'Media type':'Variant'} options={group.options} {value} {onchange}
    switchLabel={switches[group.options.map(option=>option.id).join(',')]}/>
{/if}
