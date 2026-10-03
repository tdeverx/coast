<script lang="ts">
  import type { Snippet } from 'svelte';
  let { label, hint, children, class: className = 'field' }: { label: string; hint?: string; children: Snippet; class?: string } = $props();
</script>
<label class={className}>{label}{#if hint} <small>{hint}</small>{/if}{@render children()}</label>
