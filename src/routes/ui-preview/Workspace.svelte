<script lang="ts">
  import '#lib/ui/cards/editor/editor-options.css';
  import { reportFailure } from '#lib/ui/client-context.js';
  import type { Snippet } from 'svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
  import SettingsCarousel from '#lib/ui/cards/editor/SettingsCarousel.svelte';
  import SettingsPanels from '#lib/ui/cards/editor/SettingsPanels.svelte';
  import Field from '#lib/ui/components/Field.svelte';
  import PreviewSelect from '#lib/ui/cards/editor/PreviewSelect.svelte';
  import type { CanvasSettings, WorkspaceParts } from './workspace';
  let { title, specimenKey = title, canvas, inspector, browser, categories, canvasSettings, updateCanvas, setBackgroundImage, backgroundError }: WorkspaceParts & {
    categories:Snippet; canvasSettings: CanvasSettings; updateCanvas:(values:Partial<Pick<CanvasSettings,'background'|'color'>>)=>void; setBackgroundImage:(file?:File)=>void; backgroundError:string;
  } = $props();
  const panels = [{value:'browse',label:'Browse'}, {value:'controls',label:'Controls'}, {value:'canvas',label:'Canvas'}];
  let panel = $state('browse');
  let direction = $state<-1 | 1>(1);
  let canvasViewport: HTMLDivElement;
  $effect(() => {
    specimenKey;
    canvasViewport?.scrollTo({top:0, left:0, behavior:'instant'});
  });
  let carousel: SettingsCarousel;
  let backgroundImageInput = $state<HTMLInputElement>();
  function removeBackgroundImage() {
    setBackgroundImage();
    if (backgroundImageInput) backgroundImageInput.value = '';
  }
  reportFailure(()=>backgroundError);
</script>

<div class="workspace">
  <section class="canvas-column" data-background={canvasSettings.background}
    style:background-color={canvasSettings.background === 'color' ? canvasSettings.color : undefined} aria-label={`${title} preview`}>
    {#if canvasSettings.background === 'image' && canvasSettings.image}<img class="canvas-image" src={canvasSettings.image} alt="" />{/if}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (The bounded preview canvas must be keyboard-scrollable.) -->
    <div class="preview-canvas" bind:this={canvasViewport} role="region" aria-label={`${title} preview canvas`} tabindex="0">
      <div class="canvas-content">{@render canvas()}</div>
    </div>
  </section>
  <section class="editor-options" aria-label="Reference editor">
    <div class="editor-options-viewport"><SettingsPanels section={panel} {direction}>
      {#snippet children(active)}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (Panels scroll independently of the specimen.) -->
        <div class="editor-options-scroll" class:browsing={active === 'browse'} role="region" aria-label={panels.find(item => item.value === active)?.label} tabindex="0">
          <div class="editor-options-body">
            {#if active === 'browse'}{@render browser({heading:categories})}
            {:else if active === 'controls'}<h2>{title}</h2>{@render inspector()}
            {:else}{@render canvasControls()}{/if}
          </div>
        </div>
      {/snippet}
    </SettingsPanels></div>
    <footer class="editor-options-footer">
      <AuthSurface anchor><Button size="segment" icon="arrowLeft" label="Previous section" onclick={() => carousel.step(-1)} /></AuthSurface>
      <div class="editor-options-rail"><AuthSurface anchor><SettingsCarousel bind:this={carousel} options={panels} value={panel}
        onchange={(next, step) => { direction = step; panel = next; }} /></AuthSurface></div>
      <AuthSurface anchor><Button size="segment" icon="arrow" label="Next section" onclick={() => carousel.step(1)} /></AuthSurface>
    </footer>
  </section>
</div>

{#snippet canvasControls()}
  <section class="canvas-controls" aria-label="Preview background">
    <h2>Canvas background</h2>
    <PreviewSelect topLayer label="Background" value={canvasSettings.background} options={[{id:'theme',label:'App'},{id:'pattern',label:'Pattern'},{id:'color',label:'Color'},{id:'image',label:'Image'}]} onchange={value=>updateCanvas({background:value})} />
    {#if canvasSettings.background === 'color'}
      <Field label="Preview background color"><input type="color" value={canvasSettings.color} oninput={event=>updateCanvas({color:event.currentTarget.value})} /></Field>
      <div class="row"><Button emphasis="subtle" onclick={()=>updateCanvas({color:'#ffffff'})}>White</Button><Button emphasis="subtle" onclick={()=>updateCanvas({color:'#000000'})}>Black</Button></div>
    {:else if canvasSettings.background === 'image'}
      <Field label="Preview background image"><input bind:this={backgroundImageInput} type="file" accept="image/png,image/jpeg,image/webp" onchange={event=>setBackgroundImage(event.currentTarget.files?.[0])} /></Field>
      {#if canvasSettings.image}<Button emphasis="subtle" onclick={removeBackgroundImage}>Remove image</Button>{/if}
    {/if}

    {#if canvasSettings.background === 'image'}<p class="small quiet">Images stay in this browser.</p>{/if}
  </section>
{/snippet}

<style>
  .workspace {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:minmax(0,1fr);gap:var(--auth-gap);min-height:0;}
  .canvas-column {min-width:0;min-height:0;}
  .canvas-column {position:relative;}
  .canvas-column[data-background=pattern] {background:repeating-linear-gradient(90deg,transparent 0 28px,color-mix(in srgb,var(--white) 15%,transparent) 28px 33px),linear-gradient(135deg,var(--surface),var(--accent),var(--canvas));}
  .canvas-image {position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
  .preview-canvas {position:relative;height:100%;overflow:auto;overscroll-behavior:contain;}
  .canvas-content {min-height:100%;min-width:0;display:grid;grid-template-columns:minmax(0,1fr);align-content:safe center;justify-items:center;padding:var(--preview-inset);}
  .canvas-content > :global(*) {width:100%;min-width:0;}
  .canvas-content :global(.reference-example > .demo) {padding:0;}
  h2,.editor-options-body :global(h2) {font-size:var(--text-sm);color:var(--menu-row-ink);line-height:var(--leading-menu);font-weight:var(--weight-semibold);margin:0;}
  .browsing {align-content:stretch;}
  .browsing .editor-options-body {min-block-size:0;align-self:safe center;max-height:100%;grid-template-rows:auto auto minmax(0,1fr);}
  .canvas-controls {display:grid;gap:var(--auth-gap);}
  .editor-options-body :global(.field),.editor-options-body :global(input),.editor-options-body :global(select),.editor-options-body :global(textarea) {min-width:0;max-width:100%;}
  .editor-options-body :global(input[type=range]) {padding:0;accent-color:var(--accent);}
  @media(max-width:767px) {
    .workspace {grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr);gap:var(--auth-gap);}
    .canvas-content {padding:var(--auth-gap);}
  }
</style>
