<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
  import Icon from '#lib/ui/components/Icon.svelte';
  import usage from './usage.json';
  const sourceCounts: Readonly<Record<string, number>> = {...usage.tokens,...usage.materials,...usage.charts};
  import {approvalStatus} from './reference';
  let { title, options, value, change, heading: sectionHeading, thumbnail, thumbnailHeight = 44, disabled = false, search = $bindable('') }: {
    title: string; options: {value:string;label:string;uses?:number;detail?:string}[]; value:string; change:(value:string)=>void;
    heading?:Snippet; thumbnail?:Snippet<[{value:string;label:string;uses?:number;detail?:string}]>; thumbnailHeight?:number; disabled?:boolean; search?:string;
  } = $props();
  function uses(option: {value:string; uses?:number}) { return option.uses ?? sourceCounts[option.value] ?? 0; }
  const filtered = $derived(options.filter(option => `${option.label} ${option.detail ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())));
  let list = $state<HTMLDivElement>();
  $effect(() => {
    const viewport = list;
    value; filtered;
    if (!viewport) return;
    let active = true;
    function revealSelection() {
      if (!active || !viewport) return;
      const selected = viewport.querySelector<HTMLElement>('[aria-pressed=true]');
      if (!selected) { viewport.scrollTop = 0; return; }
      const bounds = viewport.getBoundingClientRect(), row = selected.getBoundingClientRect();
      if (row.top < bounds.top) viewport.scrollTop += row.top - bounds.top;
      else if (row.bottom > bounds.bottom) viewport.scrollTop += row.bottom - bounds.bottom;
    }
    const resize = new ResizeObserver(revealSelection);
    resize.observe(viewport);
    void tick().then(revealSelection);
    return () => { active = false; resize.disconnect(); };
  });
</script>

<div class="browser-heading">
  {#if sectionHeading}{@render sectionHeading()}{:else}<h2>{title}</h2>{/if}
  <span class="small quiet" role="status">{filtered.length} / {options.length}</span>
</div>
<AuthSurface><label class="menu-row search">
  <Icon name="search" /><span class="sr-only">Search {title.toLowerCase()}</span>
  <input type="search" bind:value={search} placeholder="Search" />
</label></AuthSurface>
{#if filtered.length}
  <div class="item-list" role="group" aria-label={title}>
    <AuthSurface resizable>
      <div class="menu-content item-choices" bind:this={list}>
      {#each filtered as option (option.value)}
        {@const count = uses(option)}
        <button type="button" class="menu-row item" aria-pressed={option.value === value} {disabled} onclick={() => change(option.value)}>
          {#if thumbnail}<span class="thumbnail" style:height={`${thumbnailHeight}px`} aria-hidden="true">{@render thumbnail(option)}</span>{/if}
          <span class="menu-row-copy">{option.label}{#if option.detail}<small>{option.detail}</small>{/if}</span>
          <small class="trailing"><span title={option.uses === undefined ? 'Explicit references in production source' : 'Production render sites for this owner'}>{count} {count === 1 ? 'use' : 'uses'}</span><span>{approvalStatus(option.value) === 'approved' ? 'Approved' : 'Unapproved'}</span></small>
          {#if option.value === value}<Icon name="check" />{/if}
        </button>
      {/each}
      </div>
    </AuthSurface>
  </div>
{:else}<p class="small quiet" role="status">No matching items.</p>{/if}

<style>
  .browser-heading {display:flex;align-items:baseline;justify-content:space-between;gap:var(--auth-gap);}
  .browser-heading h2 {font-size:var(--text-xl);}
  .search {width:100%;}
  .item-list {min-width:0;min-height:0;}
  .item-choices {max-height:none;grid-auto-rows:max-content;scrollbar-width:thin;}
  .item {width:100%;text-align:start;}
  .item[aria-pressed=true] {background:var(--control-hover-fill);}
  .menu-row-copy {flex:1;overflow-wrap:anywhere;}
  .thumbnail {width:54px;flex:none;display:grid;align-items:center;overflow:hidden;}
  .trailing {display:grid; justify-items:end; gap:2px; margin-inline-start:auto; font-size:var(--text-sm); font-weight:var(--weight-regular); color:var(--muted); line-height:var(--leading-tight);}
</style>
