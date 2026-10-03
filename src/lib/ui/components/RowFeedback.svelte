<script lang="ts">
  import type { Snippet } from 'svelte';
  import Button from './Button.svelte';
  let { error = '', message = '', retry, retryLabel = 'Try again', inline = true, children, tag, class: className = '' }: {
    error?: string;
    message?: string;
    retry?: () => void;
    retryLabel?: string;
    inline?: boolean;
    children?: Snippet;
    tag?: 'p' | 'div'; class?: string;
  } = $props();
</script>

{#if error}
  {#if tag}<svelte:element this={tag} class={className} role="alert">{error}</svelte:element>
  {:else if inline}<span role="alert">{error}</span>{#if retry}<Button emphasis="subtle" onclick={retry}>{retryLabel}</Button>{/if}
  {:else}<div class="stack"><p role="alert">{error}</p>{#if retry}<Button emphasis="subtle" onclick={retry}>{retryLabel}</Button>{/if}</div>{/if}
{:else if message}<p class="muted" role="status">{message}{@render children?.()}</p>{/if}
