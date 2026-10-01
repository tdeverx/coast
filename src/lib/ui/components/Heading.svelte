<script lang="ts">
  import Icon from './Icon.svelte';
  import SegmentedControl from './SegmentedControl.svelte';
  import type { HeadingSelection } from '$lib/ui/headings';
  import type { Snippet } from 'svelte';
  let {
    title, variant = 'row', level = 2, description, selection,
    heading,
    filters,
    actions,
    navigation,
    href,
  }: {
    title: string;
    variant?: 'row' | 'page' | 'title';
    level?: 1 | 2 | 3;
    description?: string;
    selection?: HeadingSelection;
    heading?: Snippet;
    filters?: Snippet;
    actions?: Snippet;
    navigation?: Snippet;
    href?: string;
  } = $props();
</script>

{#snippet titleContent()}
  <svelte:element this={`h${variant === 'page' ? 1 : level}`} class:row-title={variant !== 'page'}>
    {#if href}<a {href} aria-label={`View all ${title}`}><span>{title}</span><Icon name="right" /></a>
    {:else}{title}{/if}
  </svelte:element>
{/snippet}
{#if variant === 'title'}{@render titleContent()}{:else}
<svelte:element this={variant === 'page' ? 'header' : 'div'} class={variant === 'page' ? 'page-heading' : 'row-header'}>
  <div class={variant === 'row' ? 'identity' : undefined}>
    {#if heading}{@render heading()}
    {:else}{@render titleContent()}{/if}
    {#if description}<p>{description}</p>{/if}
    {#if selection || filters}<div class="filters">
      {#if selection}<SegmentedControl label={selection.label} value={selection.value} options={selection.options} onchange={selection.change} />{/if}
      {@render filters?.()}
    </div>{/if}
  </div>
  {#if actions || navigation}<div class={variant === 'page' ? 'row' : 'actions'}>
    {@render actions?.()}{@render navigation?.()}
  </div>{/if}
</svelte:element>
{/if}

<style>
  .row-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px 20px;
    margin-bottom: 20px;
    min-width: 0;
  }
  .identity {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px 20px;
    min-width: 0;
    flex: 1;
  }
  .row-title {
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
    margin: 0;
    overflow-wrap: anywhere;
  }
  .identity :global(h2),
  .identity :global(h3) {
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
    margin: 0;
    overflow-wrap: anywhere;
  }
  .filters {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
  }
  .actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }
  @media (max-width: 600px) {
    .identity:has(:global(.picker-container)) {
      flex-basis: 100%;
    }
    .actions {
      margin-left: auto;
    }
  }
  a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: inherit;
  }
  a :global(svg) {
    width: 1em;
    height: 1em;
    flex: none;
    opacity: 0.6;
  }
  a:hover :global(svg),
  a:focus-visible :global(svg) {
    opacity: 1;
  }

</style>
