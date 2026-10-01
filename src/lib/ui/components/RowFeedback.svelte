<script lang="ts">
  import type { Snippet } from 'svelte';
  import Button from './Button.svelte';
  let { error = '', message = '', retry, retryLabel = 'Try again', inline = true, children }: {
    error?: string;
    message?: string;
    retry?: () => void;
    retryLabel?: string;
    inline?: boolean;
    children?: Snippet;
  } = $props();
</script>

{#if error}
  {#if inline}<span role="alert">{error}</span>{#if retry}<Button variant="ghost" onclick={retry}>{retryLabel}</Button>{/if}
  {:else}<div class="stack"><p role="alert">{error}</p>{#if retry}<Button variant="ghost" onclick={retry}>{retryLabel}</Button>{/if}</div>{/if}
{:else if message}<p class="muted" role="status">{message}{@render children?.()}</p>{/if}
