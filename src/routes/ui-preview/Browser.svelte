<script lang="ts">
  import {tick,type Snippet} from 'svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import { createShelfLayout } from '$lib/ui/shelves/layout.svelte';
  let { title, options, value, change, thumbnail, thumbnailHeight = 44, disabled = false, search = $bindable('') }: {
    title: string; options: {value:string;label:string;detail?:string}[]; value:string; change:(value:string)=>void;
    thumbnail?:Snippet<[{value:string;label:string;detail?:string}]>; thumbnailHeight?:number; disabled?:boolean; search?:string;
  } = $props();
  const filtered = $derived(options.filter(option => `${option.label} ${option.detail ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())));
  const rail = createShelfLayout(() => ({size:'poster',artworkStyle:'auto',overlay:'none',layout:'row',busy:false,preserveHeight:false,hasMore:false,resetKey:search}));
  $effect(()=>{
    value;
    const scroller=rail.scroller;
    let cancelled=false;
    if(scroller)void tick().then(()=>{
      if(cancelled)return;
      const selected=scroller.querySelector<HTMLElement>('[aria-pressed=true]');
      if(!selected)return;
      const bounds=scroller.getBoundingClientRect(),item=selected.getBoundingClientRect();
      if(item.left<bounds.left)scroller.scrollLeft-=bounds.left-item.left;
      else if(item.right>bounds.right)scroller.scrollLeft+=item.right-bounds.right;
    });
    return()=>{cancelled=true;};
  });
</script>
<div class="browser-heading"><Heading {title} level={3}>
  {#snippet actions()}<label class="find"><span class="sr-only">Find {title.toLowerCase()}</span><input type="search" bind:value={search} placeholder="Find an item" /></label>{/snippet}
  {#snippet previous()}<Button size="icon" icon="left" label={`Scroll ${title.toLowerCase()} left`} disabled={!rail.previous} onclick={() => rail.scroll(-1)} />{/snippet}
  {#snippet next()}<Button size="icon" icon="right" label={`Scroll ${title.toLowerCase()} right`} disabled={!rail.next} onclick={() => rail.scroll(1)} />{/snippet}
</Heading></div>
<!-- svelte-ignore a11y_no_noninteractive_tabindex (The same keyboard-scrollable rail used by shelves.) -->
<div class="picker-rail" bind:this={rail.scroller} onscroll={rail.reachedEnd} role="region" aria-label={title} tabindex="0">
  {#each filtered as option (option.value)}
    <Button emphasis="subtle" class="picker-option" title={option.label} {disabled} pressed={option.value === value} onclick={() => change(option.value)}>
      {#if thumbnail}<span class="picker-thumbnail" style:height={`${thumbnailHeight}px`} aria-hidden="true">{@render thumbnail(option)}</span>{/if}
      <span class="picker-label">{option.label}</span>{#if option.detail}<small class="quiet picker-detail" title={option.detail}>{option.detail}</small>{/if}
    </Button>
  {/each}
</div>
<p class="small quiet picker-count" role="status">{filtered.length ? `${filtered.length} / ${options.length}` : 'No matching items'}</p>
<style>
  .browser-heading :global(.row-header) {margin-bottom:12px;gap:8px;}
  .browser-heading :global(h3) {font-size:var(--text-md);}
  .find input {width:160px;max-width:100%;}
  .picker-rail {display:grid;grid-auto-flow:column;grid-auto-columns:144px;gap:10px;overflow-x:auto;padding:4px 1px 8px;scrollbar-width:thin;scroll-snap-type:x proximity;overscroll-behavior-x:contain;min-width:0;}
  .picker-rail :global(.picker-option) {display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:8px;width:100%;height:100%;white-space:normal;text-align:left;min-width:0;min-height:58px;padding:12px;border:1px solid var(--line);border-radius:12px;scroll-snap-align:start;}
  .picker-rail :global(.picker-option[aria-pressed=true]) {border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--surface));}
  .picker-thumbnail {display:grid;place-items:center;width:100%;height:44px;overflow:hidden;}
  .picker-label {font-size:var(--text-sm);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;overflow-wrap:anywhere;}
  .picker-detail {white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}
  .picker-count {margin-top:4px;}
  @media(max-width:600px) {.picker-rail {grid-auto-columns:124px;}.find input {width:120px;}}
</style>
