<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
  import type { Snippet } from 'svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import Heading from '#lib/ui/components/Heading.svelte';
  import Field from '#lib/ui/components/Field.svelte';
  import SegmentedControl from '#lib/ui/components/SegmentedControl.svelte';
  import type { CanvasSettings, WorkspaceParts } from './workspace';
  let { title, canvas, inspector, browser, categories, canvasSettings, updateCanvas, setBackgroundImage, backgroundError }: WorkspaceParts & {
    categories:Snippet; canvasSettings: CanvasSettings; updateCanvas:(values:Partial<Pick<CanvasSettings,'background'|'color'>>)=>void; setBackgroundImage:(file?:File)=>void; backgroundError:string;
  } = $props();
  let backgroundImageInput = $state<HTMLInputElement>();
  function removeBackgroundImage() {
    setBackgroundImage();
    if (backgroundImageInput) backgroundImageInput.value = '';
  }
  reportFailure(()=>backgroundError);
</script>

<div class="workspace">
  <section class="canvas-column" aria-label={`${title} preview`}>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (The bounded preview canvas must be keyboard-scrollable.) -->
    <div class="preview-canvas" role="region" aria-label={`${title} preview canvas`} tabindex="0">
      <div class="canvas-content">{@render canvas()}</div>
    </div>
  </section>
    <aside class="inspector solid-surface" aria-label="Customiser">
      <Heading title="Customiser" level={3} />
      <div class="inspector-content">{@render inspector()}{@render canvasControls()}</div>
    </aside>
  <section class="browser solid-surface" aria-label="UI browser">

    {@render browser({heading:categories})}
  </section>
</div>

{#snippet canvasControls()}
  <section class="canvas-controls" aria-label="Preview background">
    <Heading title="Canvas background" level={3} />
    <SegmentedControl label="Preview background" value={canvasSettings.background} options={[{value:'theme',label:'App'},{value:'pattern',label:'Pattern'},{value:'color',label:'Color'},{value:'image',label:'Image'}]} onchange={value=>updateCanvas({background:value})} />
    {#if canvasSettings.background === 'color'}
      <Field label="Preview background color"><input type="color" value={canvasSettings.color} oninput={event=>updateCanvas({color:event.currentTarget.value})} /></Field>
      <div class="row"><Button emphasis="subtle" onclick={()=>updateCanvas({color:'#ffffff'})}>White</Button><Button emphasis="subtle" onclick={()=>updateCanvas({color:'#000000'})}>Black</Button></div>
    {:else if canvasSettings.background === 'image'}
      <Field label="Preview background image"><input bind:this={backgroundImageInput} type="file" accept="image/*" onchange={event=>setBackgroundImage(event.currentTarget.files?.[0])} /></Field>
      {#if canvasSettings.image}<Button emphasis="subtle" onclick={removeBackgroundImage}>Remove image</Button>{/if}
    {/if}

    <p class="small quiet">Preview only. Images stay in this browser.</p>
  </section>
{/snippet}

<style>
  .workspace {--preview-stage-height:max(360px,calc(100dvh - 104px - var(--gutter) * 2 - 180px));display:grid;grid-template-columns:minmax(0,1fr) 340px;grid-template-rows:minmax(var(--preview-stage-height),auto) auto;gap:var(--preview-gap);align-items:start;min-width:0;}
  .canvas-column {min-width:0;min-height:0;height:100%;display:flex;flex-direction:column;}
  .preview-canvas {min-height:0;min-width:0;position:relative;flex:1;display:flex;flex-direction:column;overflow:visible;}
  .canvas-content {position:relative;display:flex;flex-direction:column;justify-content:safe center;align-items:safe center;flex:1;min-width:0;min-height:0;padding:var(--preview-inset);}
  .canvas-content > :global(*) {width:100%;min-width:0;}
  .canvas-content :global(.reference-example > .demo) {padding:0;}
  .canvas-controls {border-top:1px solid var(--line);padding-top:var(--preview-inset);margin-top:var(--preview-gap);display:grid;gap:16px;}
  .inspector {padding:var(--preview-inset);border:1px solid var(--line);border-radius:20px;min-width:0;min-height:0;height:var(--preview-stage-height);overflow-x:hidden;overflow-y:auto;overscroll-behavior-y:contain;}
  .inspector-content {min-width:0;}
  .inspector :global(.row-header) {gap:8px;}
  .inspector-content :global(.field) {min-width:0;}
  .inspector-content :global(input:not([type=checkbox]):not([type=radio])),.inspector-content :global(select),.inspector-content :global(textarea) {max-width:100%;min-width:0;width:100%;}
  .inspector-content :global(input[type=range]) {padding:0;accent-color:var(--accent);}
  .browser {grid-column:1/-1;position:sticky;bottom:var(--preview-inset);z-index:15;border:1px solid var(--line);border-radius:20px;padding:var(--preview-inset);box-shadow:var(--elevation-raised);min-width:0;}
  @media(max-width:800px) {.workspace {grid-template-columns:minmax(0,1fr);}.canvas-column {height:auto;min-height:420px;}.inspector {height:min(560px,calc(100dvh - 180px));}.browser {bottom:calc(84px + env(safe-area-inset-bottom));}}
</style>
