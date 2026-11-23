<script lang="ts">
  import type { Snippet } from 'svelte';
  let { id, expanded, children }: { id:string; expanded:boolean; children:Snippet } = $props();
</script>
<div {id} class="service-details" class:expanded inert={!expanded}>
  <div class="details-clip"><div class="details-content">{@render children()}</div></div>
</div>
<style>
  .service-details {
    display: grid; grid-template-rows: 0fr; visibility: hidden; opacity: 0;
    transition: grid-template-rows var(--motion) var(--ease), opacity var(--fast) ease, visibility 0s var(--motion);
  }
  .service-details.expanded { grid-template-rows: 1fr; visibility: visible; opacity: 1; transition-delay: 0s; }
  .details-clip { min-height: 0; overflow: visible clip; }
  .details-content { display: grid; gap: var(--auth-gap); padding-top: var(--auth-action-gap); }
  @media (prefers-reduced-motion: reduce) { .service-details { transition: none; } }
</style>
