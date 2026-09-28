<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    title,
    description,
    actions,
  }: {
    title: string;
    description?: string;
    actions?: Snippet;
  } = $props();
</script>

<header class="page-heading">
  <div>
    <h1>{title}</h1>
    {#if description}<p>{description}</p>{/if}
  </div>
  {#if actions}<div class="row">{@render actions()}</div>{/if}
</header>
