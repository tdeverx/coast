<script lang="ts">
  import {tick,type Snippet} from 'svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Icon from '$lib/ui/components/Icon.svelte';
  import {approvalStatus} from './reference';
  let { title, options, value, change, heading: sectionHeading, thumbnail, thumbnailHeight = 44, disabled = false, search = $bindable('') }: {
    title: string; options: {value:string;label:string;detail?:string}[]; value:string; change:(value:string)=>void;
    heading?:Snippet; thumbnail?:Snippet<[{value:string;label:string;detail?:string}]>; thumbnailHeight?:number; disabled?:boolean; search?:string;
  } = $props();
  const filtered = $derived(options.filter(option => `${option.label} ${option.detail ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())));
  let scroller=$state<HTMLDivElement>();
  $effect(()=>{
    value;search;
    const viewport=scroller;
    let cancelled=false;
    if(viewport)void tick().then(()=>{
      if(cancelled)return;
      const selected=viewport.querySelector<HTMLElement>('[aria-pressed=true]');
      if(!selected){viewport.scrollLeft=0;return;}
      const bounds=viewport.getBoundingClientRect(),item=selected.getBoundingClientRect();
      if(item.left<bounds.left)viewport.scrollLeft-=bounds.left-item.left;
      else if(item.right>bounds.right)viewport.scrollLeft+=item.right-bounds.right;
    });
    return()=>{cancelled=true;};
  });
</script>
<div class="browser-heading"><Heading {title} level={3}>
  {#snippet heading()}<div class="picker-heading">{#if sectionHeading}{@render sectionHeading()}{:else}<h3>{title}</h3>{/if}<span class="small quiet picker-count" role="status">{filtered.length} / {options.length}</span></div>{/snippet}
  {#snippet actions()}<label class="find"><span class="sr-only">Find {title.toLowerCase()}</span><input type="search" bind:value={search} placeholder="Find an item" /></label>{/snippet}
</Heading></div>
<!-- svelte-ignore a11y_no_noninteractive_tabindex (The overflow rail must remain keyboard-scrollable.) -->
<div class="picker-rail" bind:this={scroller} role="region" aria-label={title} tabindex="0">
  {#each filtered as option (option.value)}
    <Button emphasis="subtle" class="picker-option" title={option.label} {disabled} pressed={option.value === value} onclick={() => change(option.value)}>
      {#if thumbnail}<span class="picker-thumbnail" style:height={`${thumbnailHeight}px`} aria-hidden="true">{@render thumbnail(option)}</span>{/if}
      <span class="picker-label">{option.label}</span>{#if option.detail}<small class="quiet picker-detail" title={option.detail}>{option.detail}</small>{/if}
      <span class="approval" data-approval={approvalStatus(option.value)} role="img" aria-label={`Approval ${approvalStatus(option.value)}`} title={`Approval: ${approvalStatus(option.value)}`}><Icon name="check" size={14} /></span>
    </Button>
  {/each}
</div>
<style>
  .browser-heading :global(.row-header) {margin-bottom:12px;gap:8px;}
  .browser-heading :global(h3) {font-size:var(--text-md);}
  .find input {width:160px;max-width:100%;}
  .picker-rail {display:grid;grid-auto-flow:column;grid-auto-columns:144px;gap:12px;overflow-x:auto;padding:4px 2px;scrollbar-width:thin;scroll-snap-type:x proximity;overscroll-behavior-x:contain;min-width:0;}
  .picker-rail :global(.picker-option) {position:relative;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:var(--preview-control-gap);width:100%;height:100%;white-space:normal;text-align:left;min-width:0;min-height:58px;padding:12px 28px 12px 12px;border:1px solid var(--line);border-radius:12px;scroll-snap-align:start;}
  .approval {position:absolute;top:8px;right:8px;display:grid;place-items:center;color:var(--quiet);}
  .approval[data-approval=unapproved] {color:var(--rating);}
  .approval[data-approval=approved] {color:var(--success);}
  .picker-rail :global(.picker-option[aria-pressed=true]) {border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--surface));}
  .picker-thumbnail {display:grid;place-items:center;width:100%;height:44px;overflow:hidden;}
  .picker-label {font-size:var(--text-sm);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;overflow-wrap:anywhere;}
  .picker-detail {white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}
  .picker-count {white-space:nowrap;}
  .picker-heading {display:flex;align-items:center;gap:12px;min-width:0;max-width:100%;}
  .picker-heading > :global(.picker-container) {flex:1;min-width:0;}
  @media(max-width:600px) {.picker-rail {grid-auto-columns:124px;}.find input {width:120px;}}
</style>
