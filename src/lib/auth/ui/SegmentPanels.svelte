<script lang="ts">
  import { cubicInOut } from 'svelte/easing';
  import { untrack, type Snippet } from 'svelte';

  let { index, vertical = false, children }: { index: number; vertical?: boolean; children: Snippet<[number]> } = $props();
  let viewport: HTMLDivElement;
  let previous = untrack(() => index), direction = 1, startHeight = 0;
  $effect.pre(() => {
    if (index === previous) return;
    startHeight = viewport.getBoundingClientRect().height;
    direction = index > previous ? 1 : -1;
    previous = index;
  });

  function push(node: HTMLElement, entering: boolean) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return { duration: 0 };
    const side = entering ? direction : -direction;
    const height = node.offsetHeight;
    const from = startHeight || height;
    return {
      duration: 300, easing: cubicInOut,
      // Position offsets keep the glass artwork anchored to the viewport during the push.
      css: (t: number, u: number) => `${vertical ? `top:${side * u * height}px` : `left:${side * u * 100}%`};opacity:${t};${entering
        ? `height:${from * u + height * t}px;`
        : `position:absolute;${vertical ? 'left' : 'top'}:0;width:100%;`}`,
    };
  }
</script>

<div class="viewport" bind:this={viewport}>
  {#each [index] as panel (panel)}
    <fieldset in:push={true} out:push={false}
      onoutrostart={event => { event.currentTarget.disabled = true; }}
      onintrostart={event => { event.currentTarget.disabled = false; }}>
      {@render children(panel)}
    </fieldset>
  {/each}
</div>

<style>
  .viewport { position: relative; min-width: 0; }
  fieldset { position: relative; min-inline-size: 0; padding: 0; margin: 0; border: 0; }
</style>
