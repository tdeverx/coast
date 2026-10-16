<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Dialog from '$lib/ui/components/Dialog.svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import type { WorkspaceParts } from './workspace';
  let { title, canvas, inspector, browser, categories, open = $bindable(false), pinned = $bindable(false) }: WorkspaceParts & {
    categories: Snippet; open?: boolean; pinned?: boolean;
  } = $props();
  const id = $props.id();
  let inspectorNode = $state<HTMLElement>();
  let mobile = $state(false);
  onMount(() => {
    const query = matchMedia('(max-width: 800px)');
    const update = () => mobile = query.matches;
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  });
  function close() {
    open=false;
    void tick().then(()=>document.getElementById(`${id}-customise`)?.querySelector('button')?.focus({preventScroll:true}));
  }
  function pin() {
    pinned=!pinned;
    if(pinned)void tick().then(()=>{if(inspectorNode?.isConnected)inspectorNode.querySelector('button')?.focus({preventScroll:true});});
  }
</script>

<div class="workspace" class:studio={open && pinned && !mobile}>
  <section class="canvas-column" aria-label={`${title} preview`}>
    <Heading {title} level={2}>
      {#snippet actions()}<div id={`${id}-customise`}><Button emphasis="subtle" icon="settings" pressed={open} onclick={() => open = !open}>Customise</Button></div>{/snippet}
    </Heading>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (The bounded preview canvas must be keyboard-scrollable.) -->
    <div class="preview-canvas" role="region" aria-label={`${title} preview canvas`} tabindex="0">{@render canvas()}</div>
  </section>
  {#if open && pinned && !mobile}
    <aside bind:this={inspectorNode} class="inspector solid-surface" aria-label="Customiser">
      {@render inspectorHeading()}
      <div class="inspector-content">{@render inspector()}</div>
    </aside>
  {:else if open}
    <div class="floating-inspector" class:mobile>
      <Dialog bind:open title="Customiser" popover={!mobile} popoverWidth={360} anchor={`#${id}-customise`}>
        {#snippet heading()}{@render inspectorHeading()}{/snippet}
        <div class="inspector-content">{@render inspector()}</div>
      </Dialog>
    </div>
  {/if}
  <section class="browser solid-surface" aria-label="UI browser">
    <div class="categories">{@render categories()}</div>
    {@render browser()}
  </section>
</div>

{#snippet inspectorHeading()}
  <Heading title="Customiser" level={3}>
    {#snippet actions()}
      {#if !mobile}<Button emphasis="subtle" pressed={pinned} onclick={pin}>{pinned ? 'Unpin' : 'Pin'}</Button>{/if}
      <Button size="icon" icon="close" label="Close customiser" onclick={close} />
    {/snippet}
  </Heading>
{/snippet}

<style>
  .workspace {display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) auto;gap:24px;align-items:start;min-width:0;height:max(560px,calc(100dvh - 220px));}
  .workspace.studio {grid-template-columns:minmax(0,1fr) 340px;}
  .canvas-column {min-width:0;min-height:0;height:100%;display:flex;flex-direction:column;}
  .preview-canvas {border:1px solid var(--line);border-radius:20px;min-height:0;min-width:0;position:relative;flex:1;display:flex;flex-direction:column;overflow:auto;overscroll-behavior:contain;}
  .inspector {padding:20px;border:1px solid var(--line);border-radius:20px;min-width:0;min-height:0;height:100%;max-height:100%;overflow:auto;overscroll-behavior:contain;}
  .inspector-content {min-width:0;}
  .inspector :global(.row-header) {gap:8px;}
  .inspector-content :global(.field) {min-width:0;}
  .inspector-content :global(input:not([type=checkbox]):not([type=radio])),.inspector-content :global(select),.inspector-content :global(textarea) {max-width:100%;min-width:0;width:100%;}
  .inspector-content :global(input[type=range]) {padding:0;accent-color:var(--accent);}
  .browser {grid-column:1/-1;position:sticky;bottom:16px;z-index:15;border:1px solid var(--line);border-radius:20px;padding:16px;box-shadow:var(--elevation-raised);min-width:0;}
  .categories {margin-bottom:12px;min-width:0;}
  .floating-inspector {position:absolute;}
  .floating-inspector :global(.popover-content) {padding:20px;}
  .floating-inspector :global(.popover-heading) {padding:12px 20px;}
  .floating-inspector :global(.row-header) {margin-bottom:0;}
  .floating-inspector.mobile :global(.dialog) {margin:auto auto 0;width:100%;max-height:80dvh;border-radius:20px 20px 0 0;padding:20px;}
  .floating-inspector.mobile :global(.inspector-content) {margin-top:20px;}
  @media(max-width:800px) {.browser {bottom:calc(84px + env(safe-area-inset-bottom));padding:12px;}.workspace {gap:16px;height:max(460px,calc(100dvh - 300px - env(safe-area-inset-bottom)));}}
</style>
