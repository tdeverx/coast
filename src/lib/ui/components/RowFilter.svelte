<script lang="ts">
  import ChoiceGroup from './ChoiceGroup.svelte';
  import Button from './Button.svelte';
  import { filterSections, type FilterGroup, type FilterReset } from '#lib/ui/controls/filters.js';
  import type {Snippet} from 'svelte';
  import Icon from './Icon.svelte';
  import {filterGroupIcon} from '#lib/ui/controls/filters.js';
  import type {IconName} from './Icon.svelte';
  let { groups, label = 'Filters', selection = false, actions, icon, submenus, reset }: {groups: FilterGroup[]; label?: string; selection?: boolean; actions?:Snippet; icon?:IconName; submenus?:boolean; reset?: FilterReset} = $props();
  const sections = $derived(filterSections(groups));
  const triggerIcon = $derived(icon ?? (selection ? undefined : 'filter'));
  const text = $derived(triggerIcon ? undefined : selection && groups.length === 1 ? groups[0].options.find(option => option.value === groups[0].value)?.label ?? groups[0].label : label);
  const description = $derived(groups.map(group => `${group.label}: ${group.options.find(option => option.value === group.value)?.label ?? group.value}`).join(', '));
</script>

<div class="row-filter">
  <Button menu {text} icon={triggerIcon} label={description?`${label} · ${description}`:label} title={label} triggerClass={triggerIcon?'icon-button':'row-filter-trigger'}>
    {#each sections as section, sectionIndex}
      {#if sectionIndex}<div class="menu-divider" role="separator"></div>{/if}
      {#each section as group, index (group.label)}
      {#if group.presentation === 'checkbox'}
        {@const checked = group.value === group.options[1]?.value}
        <Button item icon={group.icon ?? filterGroupIcon(group.label)} {checked} keepOpen
          onclick={() => group.change(group.options[checked ? 0 : 1].value)}>{group.label}</Button>
      {:else if submenus ?? !selection}
        <Button menu label={group.label}>
          {#snippet trigger()}
            <Icon name={group.icon ?? filterGroupIcon(group.label)} />
            <span class="menu-action-label menu-row-copy">
              <span>{group.label}</span>
              <small class="filter-value">{group.options.find(option => option.value === group.value)?.label ?? group.value}</small>
            </span>
            <span class="menu-chevron"><Icon name="right" /></span>
          {/snippet}
          <ChoiceGroup label={group.label} value={group.value} options={group.options} hideLabel change={value => { if (value !== null) group.change(value); }} />
        </Button>
      {:else}
        {#if index}<div class="menu-divider" role="separator"></div>{/if}
        <ChoiceGroup label={group.label} value={group.value} options={group.options} change={value => { if (value !== null) group.change(value); }} />
      {/if}
      {/each}
    {/each}
    {#if actions}{#if groups.length}<div class="menu-divider" role="separator"></div>{/if}{@render actions()}{/if}
    {#if reset}
      {#if groups.length || actions}<div class="menu-divider" role="separator"></div>{/if}
      <Button item icon="refresh" disabled={reset.disabled} disabledReason="Already using the default filters" onclick={reset.run}>Reset filters</Button>
    {/if}
  </Button>
</div>

<style>
  .filter-value{overflow-wrap:anywhere;}
  .row-filter { min-width: 0; }
  .row-filter :global(.row-filter-trigger) {
    max-width: 160px; min-width: 0; height: var(--control-compact-height); padding: 0 8px;
    border: 0; border-radius: 6px; background: transparent; color: var(--muted);
    font: inherit; font-size: var(--text-sm); font-weight: var(--weight-semibold); cursor: pointer; box-shadow: none;
  }
  .row-filter :global(.row-filter-trigger:hover), .row-filter :global(.row-filter-trigger:focus-visible) { color: var(--ink); }
</style>
