<script lang="ts">
  import type { Snippet } from 'svelte';
  import Button from './Button.svelte';
  let { children, cancel }: { children: Snippet; cancel?: () => void } = $props();
</script>
<div class="row">{@render children()}{#if cancel}<Button emphasis="subtle" onclick={cancel}>Cancel</Button>{/if}</div>
