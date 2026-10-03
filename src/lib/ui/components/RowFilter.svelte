<script lang="ts">
  import ChoiceGroup from './ChoiceGroup.svelte';
  import Button from './Button.svelte';
  import type { FilterGroup } from '$lib/ui/controls/filters';
  import type {Snippet} from 'svelte';
  import type {IconName} from './Icon.svelte';
  let { groups, label = 'Filters', selection = false, actions, icon, submenus = false }: {groups: FilterGroup[]; label?: string; selection?: boolean; actions?:Snippet; icon?:IconName; submenus?:boolean} = $props();
  const text = $derived(icon ? undefined : selection && groups.length === 1 ? groups[0].options.find(option => option.value === groups[0].value)?.label ?? groups[0].label : label);
  const description = $derived(groups.map(group => `${group.label}: ${group.options.find(option => option.value === group.value)?.label ?? group.value}`).join(', '));
</script>

<div class="row-filter">
  <Button menu {text} {icon} label={`${label} · ${description}`} title={label} triggerClass={icon?'icon-button':'row-filter-trigger'}>
    {#each groups as group, index (group.label)}
      {#if submenus}
        <Button menu text={group.label} label={group.label}>
          <ChoiceGroup label={group.label} value={group.value} options={group.options} change={value => { if (value !== null) group.change(value); }} />
        </Button>
      {:else}
        {#if index}<div class="menu-divider" role="separator"></div>{/if}
        <ChoiceGroup label={group.label} value={group.value} options={group.options} change={value => { if (value !== null) group.change(value); }} />
      {/if}
    {/each}
    {#if actions}<div class="menu-divider" role="separator"></div>{@render actions()}{/if}
  </Button>
</div>

<style>
  .row-filter { min-width: 0; }
  .row-filter :global(.row-filter-trigger) {
    max-width: 160px; min-width: 0; height: var(--control-compact-height); padding: 0 8px;
    border: 0; border-radius: 6px; background: transparent; color: var(--muted);
    font: inherit; font-size: var(--text-sm); font-weight: var(--weight-semibold); cursor: pointer; box-shadow: none;
  }
  .row-filter :global(.row-filter-trigger:hover), .row-filter :global(.row-filter-trigger:focus-visible) { color: var(--ink); }
</style>
