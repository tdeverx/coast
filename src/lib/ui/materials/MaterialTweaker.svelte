<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  let { layout, picker }: { layout: Snippet<[{title:string;canvas:Snippet;inspector:Snippet;browser:Snippet<[{heading:Snippet}]>}]>; picker:Snippet<[{options:{value:string;label:string}[];value:string;change:(value:string)=>void;heading?:Snippet}]> } = $props();
  import Heading from '../components/Heading.svelte';
  import Button from '../components/Button.svelte';
  import SegmentedControl from '../components/SegmentedControl.svelte';
  import { liquidGlass } from './glass';
  import { experimentalMaterial, experimentalDefaults, effectGroups, readExperimentalEffects } from './experimental';
  import { blendOptions } from './presets';
  import { exportMaterialPreset } from './export';
  import { defaultMaterialDrafts, readMaterialDrafts, materialNames, sliderGroups, colorControls } from './tuning';
  import type { GlassVariant } from './presets';
  const previewModes = ['materials', 'fallbacks'] as const;
  const storageKey = 'coast.material-drafts.v1';
  let drafts = $state(defaultMaterialDrafts());
  const experimentKey = 'coast.material-experiment.v1';
  const choices = [...materialNames, { value: 'temporary', label: 'Temporary experiment' }];
  let variant = $state<GlassVariant | 'temporary'>('clear');
  let experiment = $state({ materials: { ...defaultMaterialDrafts().materials.clear }, fallbacks: { ...defaultMaterialDrafts().fallbacks.clear } });
  let effects = $state({ ...experimentalDefaults });
  const experimental = $derived(variant === 'temporary');
  const baseVariant = $derived(variant === 'temporary' ? 'clear' : variant);
  const selected = $derived(experimental ? experiment : { materials: drafts["materials"][baseVariant], fallbacks: drafts["fallbacks"][baseVariant] });
  let layer = $state<'materials' | 'fallbacks'>('materials');
  let loaded = $state(false);
  let message = $state('');
  let exported = $state(false);
  let radius = $state(24);
  const surface = $derived(selected[layer]);
  const title = $derived(experimental ? 'Temporary experiment' : materialNames.find(item => item.value === variant)?.label ?? 'Glass');
  let source = $state('');
  let supportedBlends = $state(blendOptions.map(option => option.value));
  let supportedTintBlends = $state(blendOptions.map(option => option.value));
  onMount(() => {
    supportedBlends = blendOptions.filter(option => CSS.supports('mix-blend-mode', option.value)).map(option => option.value);
    supportedTintBlends = blendOptions.filter(option => CSS.supports('background-blend-mode', option.value)).map(option => option.value);
    try { const saved = localStorage.getItem(storageKey); if (saved) drafts = readMaterialDrafts(JSON.parse(saved)); }
    catch { message = 'Saved drafts could not be loaded.'; }
    try {
      const saved = localStorage.getItem(experimentKey);
      if (saved) {
        const data = JSON.parse(saved);
        const validated = readMaterialDrafts({ materials: { clear: data.materials }, fallbacks: { clear: data.fallbacks } });
        experiment = { materials: validated.materials.clear, fallbacks: validated.fallbacks.clear };
        effects = readExperimentalEffects(data.effects);
      }
    } catch { message = 'Temporary experiment could not be loaded.'; }
    loaded = true;
  });
  $effect(() => {
    const current = JSON.stringify(drafts);
    if (loaded) try { localStorage.setItem(storageKey, current); } catch { message = 'Browser storage is unavailable. Export your draft to keep it.'; }
  });
  $effect(() => {
    const current = JSON.stringify({ ...experiment, effects });
    if (loaded) try { localStorage.setItem(experimentKey, current); } catch { message = 'Browser storage is unavailable. Export your experiment to keep it.'; }
  });
  function tryTogether() {
    effects = { ...experimentalDefaults, sheenAmount: 16, vignetteAmount: 12, edgeAmount: 28, interactionAmount: 20 };
    experiment.materials.noiseOpacity = 4; experiment.fallbacks.noiseOpacity = 4;
    message = 'Non-approved combination. Tune or disable each effect below.';
  }
  function setColor(value: string, change: (value: string) => void) {
    if (CSS.supports('color', value)) { change(value); message = ''; }
    else message = 'Enter a valid CSS color or theme token.';
  }
  function reset(all = false) {
    if (experimental) {
      effects = { ...experimentalDefaults };
      if (all) experiment = { materials: { ...defaultMaterialDrafts().materials.clear }, fallbacks: { ...defaultMaterialDrafts().fallbacks.clear } };
      else experiment[layer] = { ...defaultMaterialDrafts()[layer].clear };
    } else if (all) drafts = defaultMaterialDrafts();
    else drafts[layer][baseVariant] = defaultMaterialDrafts()[layer][baseVariant];
    message = all ? 'All drafts reset.' : `${title} ${layer === 'materials' ? 'material' : 'fallback'} reset.`;
  }
  function prepareExport() {
    const probe = document.createElement('span');
    probe.hidden = true;
    document.body.append(probe);
    try {
      source = JSON.stringify(exportMaterialPreset(variant, selected, value => {
        if (!CSS.supports('color', value)) throw new Error('A draft contains an invalid color. Correct it before exporting.');
        probe.style.color = value;
        return getComputedStyle(probe).color;
      }, experimental ? effects : undefined), null, 2);
    } catch (error) {
      message = error instanceof Error ? error.message : 'The preset could not be exported.';
      return false;
    } finally { probe.remove(); }
    exported = true;
    return true;
  }
  async function copy() {
    if (!prepareExport()) return;
    try { await navigator.clipboard.writeText(source); message = `Copied ${title} with its fallback${experimental ? ' and effects' : ''}. All colors are resolved.`; }
    catch { message = 'Clipboard unavailable. Select the export below to copy it.'; }
  }
  function download() {
    if (!prepareExport()) return;
    const url = URL.createObjectURL(new Blob([source], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `coast-material-${variant}.json`; link.click(); URL.revokeObjectURL(url);
    message = `Downloaded ${title} with its fallback${experimental ? ' and effects' : ''}. All colors are resolved.`;
  }
</script>

{#snippet canvas()}
<div class="preview-column">
    <div class="preview" style:--preview-radius={`${radius}px`}>
      {#each previewModes as mode}
        <div class="sample glass" class:light={variant === 'glassLight'}
          data-material-sample={mode}
          role={experimental ? 'group' : undefined}
          aria-label={experimental ? `${mode === 'materials' ? 'Native' : 'Fallback'} experimental material sample` : undefined}
          use:experimentalMaterial={{ enabled: experimental, effects }}
          use:liquidGlass={{ variant: baseVariant, preview: true, surface: selected.materials, fallback: mode === 'materials' && selected.materials.refraction === 0 ? selected.materials : selected.fallbacks, renderer: mode === 'fallbacks' ? 'css' : 'auto' }}>
          <strong>{title}</strong><span>{mode === 'materials' ? 'Material · native where supported' : 'Fallback · CSS blur'}</span>
          <span class="sample-detail">{experimental ? 'Non-approved · hover or focus to test interaction light' : 'Artwork, controls and content beneath the surface'}</span>
          {#if experimental}<Button >Focus highlight</Button>{/if}
        </div>
      {/each}
    </div>
    <p role="status" class="quiet">{message}</p>
  </div>
{/snippet}
{#snippet inspector()}
<Heading title="Material tweaker" description="Non-approved drafts · saved in this browser. Current app presets stay unchanged.">
  {#snippet actions()}
    {#if experimental}<Button  onclick={tryTogether}>Try together</Button>{/if}
    <Button emphasis="subtle" onclick={() => reset()}>Reset selected</Button>
    <Button emphasis="subtle" onclick={() => reset(true)}>{experimental ? 'Reset experiment' : 'Reset all'}</Button>
    <Button  onclick={copy}>Copy preset</Button>
    <Button  onclick={download}>Download</Button>
  {/snippet}
</Heading>
<div class="controls">
    <label class="field">Preview corner radius · {radius}px<input type="range" min="0" max="80" step="1" aria-valuetext={`${radius} pixels`} bind:value={radius} /></label>
    <p class="quiet">Native refraction depends on your browser. The CSS fallback has no refraction. Radius and canvas settings do not change presets.</p>
    {#if experimental}
      <p class="quiet">Temporary material only. Effects are shared by both previews for comparison; base surfaces remain independently editable. No app presets are changed.</p>
      {#each effectGroups as group}
        <section><Heading title={group.title} level={3} description={group.description} />
          <div class="control-grid">
            {@render colorControl(`effect-${group.color}`, `${group.title} color`, effects[group.color], value => effects[group.color] = value)}
            <label class="field">Blend mode<select aria-label={`${group.title} blend`} bind:value={effects[group.blend]}>
              {#each blendOptions as option}<option value={option.value} disabled={!supportedBlends.includes(option.value)}>{option.label}</option>{/each}
            </select></label>
            {#each group.controls as control}
              <label class="field slider"><span>{control.label}<output>{effects[control.key]}{control.unit}</output></span>
                <input type="range" aria-label={`${group.title}: ${control.label}`} min={control.min} max={control.max} step={control.step} aria-valuetext={`${effects[control.key]}${control.unit}`} bind:value={effects[control.key]} />
              </label>
            {/each}
          </div>
        </section>
      {/each}
      <section><Heading title="Base surface" level={3} /></section>
    {/if}
    <SegmentedControl label="Edit material or fallback" value={layer} options={[{ value: 'materials', label: 'Material' }, { value: 'fallbacks', label: 'Fallback' }]} onchange={value => layer = value as typeof layer} />
    <section>
      <Heading title="Colors" level={3} />
      <div class="control-grid">
        {#each colorControls as control}
          {@render colorControl(`material-${control.key}`, control.label, surface[control.key], value => surface[control.key] = value)}
        {/each}
        <label class="field">Stroke alignment<select bind:value={surface.strokeAlignment}><option value="internal">Internal</option><option value="external">External</option></select></label>
        <label class="field">Stroke blend<select aria-label="Stroke blend" bind:value={surface.strokeBlend}>{#each blendOptions as option}<option value={option.value} disabled={!supportedBlends.includes(option.value)}>{option.label}</option>{/each}</select></label>
        <label class="field">Shadow position<select bind:value={surface.shadowPosition}><option value="outer">Outer</option><option value="inner">Inner</option></select></label>
      </div>
      <p class="quiet">Use any CSS color, including var(--white), var(--canvas), var(--surface) and color-mix().</p>
    </section>
    {#each sliderGroups as group}
      <section>
        <Heading title={group.title} level={3} />
        {#if group.title === 'Refraction' && layer === 'fallbacks'}<p class="quiet">Retained for export; the CSS fallback does not use these optical parameters.</p>{/if}
        {#if group.title === 'Texture'}
          <p class="quiet">Non-approved · static monochrome grain sits beneath content. Amount zero keeps the current clean glass.</p>
          <div class="control-grid texture-options">
            <label class="field">Grain blend<select aria-label="Grain blend" bind:value={surface.noiseBlend}>{#each blendOptions as option}<option value={option.value} disabled={!supportedBlends.includes(option.value)}>{option.label}</option>{/each}</select></label>
            <label class="field">Grain tint blend<select aria-label="Grain tint blend" bind:value={surface.noiseTintBlend}>{#each blendOptions as option}<option value={option.value} disabled={!supportedTintBlends.includes(option.value)}>{option.label}</option>{/each}</select></label>
            <label class="field">Grain coverage<select aria-label="Grain coverage" bind:value={surface.noiseCoverage}><option value="uniform">Uniform</option><option value="edges">Stronger at edges</option></select></label>
          </div>
        {/if}
        <div class="control-grid">
          {#each group.controls as control}
            <label class="field slider">
              <span>{control.label} <output>{surface[control.key]}{control.unit}</output></span>
              <input type="range" aria-label={`${group.title}: ${control.label}`} min={control.min} max={control.max} step={control.step} aria-valuetext={`${surface[control.key]}${control.unit}`} bind:value={surface[control.key]} disabled={(group.title === 'Refraction' && layer === 'fallbacks') || (control.key === 'noiseEdgeStart' && surface.noiseCoverage !== 'edges')} />
            </label>
          {/each}
        </div>
      </section>
    {/each}
  </div>
{#if exported}<section class="export"><Heading title="Preset export" description="Complete snapshot of the selected treatment and its fallback, with resolved colors. Copy again after further edits." /><textarea aria-label="Preset export" readonly value={source} rows="12"></textarea></section>{/if}
{/snippet}
{#snippet browser({heading}:{heading:Snippet})}
  {@render picker({heading,options:choices,value:variant,change:value=>variant=value as typeof variant})}
{/snippet}
{@render layout({title,canvas,inspector,browser})}

{#snippet colorControl(id: string, label: string, value: string, change: (value: string) => void)}
  <div class="field"><label for={id}>{label}</label><div class="color-control"><span class="swatch" style:background={value}></span><input {id} {value} onchange={event => setColor(event.currentTarget.value, change)} />{#if loaded}<input type="color" aria-label={`${label} picker`} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} oninput={event => setColor(event.currentTarget.value, change)} />{/if}</div></div>
{/snippet}

<style>
  .preview-column {position:static;padding:0;min-width:0;}
  .controls .control-grid {grid-template-columns:1fr;}
  .preview { position: relative; overflow: visible; border-radius: 24px; min-height: 440px; padding: 0; display: grid; align-content: center; gap: var(--preview-gap,24px); }
  .sample { border-radius: var(--preview-radius); padding: 24px; min-height: 140px; display: grid; align-content: center; gap: 8px; color: var(--white); }
  .sample.light { color: var(--canvas); }
  .sample strong { font-size: var(--text-xl); font-weight: var(--weight-bold); }
  .sample span { font-size: var(--text-md); }
  .sample .sample-detail { font-size: var(--text-sm); }
  .controls { min-width: 0; }
  section { padding-top: 24px; margin-top: 24px; border-top: 1px solid var(--line); }
  .control-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .texture-options { margin-bottom: 20px; }
  .field { min-width: 0; }
  .color-control { display: flex; gap: 8px; align-items: center; }
  .color-control input:not([type='color']) { flex: 1; }
  .color-control input[type='color'] { width: 32px; height: 32px; padding: 2px; flex: none; cursor: pointer; }
  .swatch { width: 16px; height: 16px; border: 1px solid var(--line); border-radius: 50%; flex: none; }
  input { min-width: 0; width: 100%; }
  input[type='range'] { accent-color: var(--accent); padding: 0; height: 24px; cursor: pointer; }
  .slider span { display: flex; justify-content: space-between; gap: 8px; }
  output { color: var(--muted); white-space: nowrap; }
  .quiet { font-size: var(--text-sm); color: var(--muted); line-height: var(--leading-normal); }
  .export textarea { width: 100%; font-size: var(--text-sm); }
  @media (max-width: 900px) { .preview-column { position: static; } .preview { min-height: 360px; gap: var(--preview-gap,24px); } }
  @media (max-width: 480px) { .control-grid { grid-template-columns: 1fr; } }
</style>
