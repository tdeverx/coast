<script lang="ts">
  import RowTitle from './RowTitle.svelte';
  import type { Snippet } from 'svelte';
  let {
    title,
    heading,
    filters,
    actions,
    navigation,
    href,
  }: {
    title: string;
    heading?: Snippet;
    filters?: Snippet;
    actions?: Snippet;
    navigation?: Snippet;
    href?: string;
  } = $props();
</script>

<div class="row-header">
  <div class="identity">
    {#if heading}{@render heading()}{:else}<RowTitle {title} {href} />{/if}
    {#if filters}<div class="filters">{@render filters()}</div>{/if}
  </div>
  {#if actions || navigation}<div class="actions">
      {#if actions}{@render actions()}{/if}
      {#if navigation}{@render navigation()}{/if}
    </div>{/if}
</div>

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
  .identity :global(h2),
  .identity :global(h3) {
    font-size: var(--row-title-size);
    font-weight: var(--row-title-weight);
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
</style>
