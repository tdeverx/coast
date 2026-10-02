<script lang="ts">
  import Demo from './Demo.svelte';
  let { name, minimum = 360 }: { name: string; minimum?: number } = $props();
  let visible = $state(false);
  function observe(node: HTMLElement) {
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
    }, { rootMargin: '300px 0px' });
    observer.observe(node);
    return { destroy() { observer.disconnect(); } };
  }
</script>
<div class="preview" use:observe style:min-height={`${minimum}px`} aria-label={`${name} preview`}>
  {#if visible}<Demo {name} />{:else}<p class="quiet">Preview loads when visible.</p>{/if}
</div>
<style>
  .preview { position:relative; margin-top:16px; min-width:0; max-height:1800px; overflow:auto; }
  .quiet { color:var(--muted); font-size:var(--text-sm); }
</style>
