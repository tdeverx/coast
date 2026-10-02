<script lang="ts">
  import { onMount } from 'svelte';
  import Heading from '../components/Heading.svelte';
  import Button from '../components/Button.svelte';
  import SegmentedControl from '../components/SegmentedControl.svelte';
  import { liquidGlass } from './glass';
  import { experimentalMaterial, experimentalDefaults, effectGroups, readExperimentalEffects } from './experimental';
  import { defaultMaterialDrafts, readMaterialDrafts, materialNames, sliderGroups, colorControls } from './tuning';
  import type { GlassSurface, GlassVariant } from './presets';
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
  let background = $state('pattern');
  let radius = $state(24);
  const surface = $derived(selected[layer]);
  const title = $derived(experimental ? 'Temporary experiment' : materialNames.find(item => item.value === variant)?.label ?? 'Glass');
  const source = $derived(JSON.stringify(experimental ? { temporary: { ...experiment, effects } } : drafts, null, 2));
  onMount(() => {
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
    effects = { ...experimentalDefaults, sheenAmount: 16, vignetteAmount: 12, edgeAmount: 28, frostAmount: 65, interactionAmount: 20 };
    experiment.materials.noiseOpacity = 4; experiment.fallbacks.noiseOpacity = 4;
    message = 'Non-approved combination. Tune or disable each effect below.';
  }
  function setColor(key: keyof GlassSurface, value: string) {
    if (CSS.supports('color', value)) { (surface[key] as string) = value; message = ''; }
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
  async function copy() {
    exported = true;
    try { await navigator.clipboard.writeText(source); message = experimental ? 'Copied the temporary experiment.' : 'Copied all six materials and fallbacks.'; }
    catch { message = 'Clipboard unavailable. Select the export below to copy it.'; }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([source], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = experimental ? 'coast-material-experiment.json' : 'coast-materials.json'; link.click(); URL.revokeObjectURL(url);
    message = experimental ? 'Downloaded the temporary experiment.' : 'Downloaded all six materials and fallbacks.';
  }
</script>

<Heading title="Material tweaker" description="Non-approved drafts · saved in this browser. Current app presets stay unchanged."
  selection={{ label: 'Glass treatment', value: variant, options: choices, change: value => { variant = value as typeof variant; } }}>
  {#snippet actions()}
    {#if experimental}<Button variant="secondary" onclick={tryTogether}>Try together</Button>{/if}
    <Button variant="ghost" onclick={() => reset()}>Reset selected</Button>
    <Button variant="ghost" onclick={() => reset(true)}>{experimental ? 'Reset experiment' : 'Reset all'}</Button>
    <Button variant="secondary" onclick={copy}>Copy presets</Button>
    <Button variant="secondary" onclick={download}>Download</Button>
  {/snippet}
</Heading>
<div class="tweaker">
  <div class="preview-column">
    <div class="preview" class:plain={background === 'plain'} style:--preview-radius={`${radius}px`}>
      <div class="scene" aria-hidden="true"><span>COAST</span><div></div><span>Glass / light / motion</span></div>
      {#each previewModes as mode}
        <div class="sample glass" class:light={variant === 'glassLight' || variant === 'blurLight'}
          data-material-sample={mode}
          role={experimental ? 'group' : undefined}
          aria-label={experimental ? `${mode === 'materials' ? 'Native' : 'Fallback'} experimental material sample` : undefined}
          use:experimentalMaterial={{ enabled: experimental, effects }}
          use:liquidGlass={{ variant: baseVariant, preview: true, surface: selected.materials, fallback: mode === 'materials' && selected.materials.refraction === 0 ? selected.materials : selected.fallbacks, renderer: mode === 'fallbacks' ? 'css' : 'auto' }}>
          <strong>{title}</strong><span>{mode === 'materials' ? 'Material · native where supported' : 'Fallback · CSS blur'}</span>
          <span class="sample-detail">{experimental ? 'Non-approved · hover or focus to test interaction light' : 'Artwork, controls and content beneath the surface'}</span>
          {#if experimental}<Button variant="secondary">Focus highlight</Button>{/if}
        </div>
      {/each}
    </div>
    <div class="preview-options">
      <SegmentedControl label="Preview background" value={background} options={[{ value: 'pattern', label: 'Pattern' }, { value: 'plain', label: 'Plain' }]} onchange={value => background = value} />
      <label class="field">Preview corner radius · {radius}px<input type="range" min="0" max="80" step="1" aria-valuetext={`${radius} pixels`} bind:value={radius} /></label>
    </div>
    <p class="quiet">Both previews update live. Native refraction depends on your browser; CSS fallback has no refraction. Preview radius and background do not change presets.</p>
    <p role="status" class="quiet">{message}</p>
  </div>
  <div class="controls">
    {#if experimental}
      <p class="quiet">Temporary material only. Effects are shared by both previews for comparison; base surfaces remain independently editable. No app presets are changed.</p>
      {#each effectGroups as group}
        <section><Heading title={group.title} level={3} description={group.description} />
          <div class="control-grid">
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
          <div class="field"><label for={`material-${control.key}`}>{control.label}</label><div class="color-control"><span class="swatch" style:background={surface[control.key]}></span><input id={`material-${control.key}`} value={surface[control.key]} onchange={event => setColor(control.key, event.currentTarget.value)} /><input type="color" aria-label={`${control.label} picker`} value={/^#[0-9a-f]{6}$/i.test(surface[control.key]) ? surface[control.key] : '#ffffff'} oninput={event => setColor(control.key, event.currentTarget.value)} /></div></div>
        {/each}
        <label class="field">Stroke alignment<select bind:value={surface.strokeAlignment}><option value="internal">Internal</option><option value="external">External</option></select></label>
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
            <label class="field">Grain blend<select aria-label="Grain blend" bind:value={surface.noiseBlend}><option value="soft-light">Soft light</option><option value="normal">Normal</option></select></label>
            <label class="field">Grain coverage<select aria-label="Grain coverage" bind:value={surface.noiseCoverage}><option value="uniform">Uniform</option><option value="edges">Stronger at edges</option></select></label>
          </div>
        {/if}
        <div class="control-grid">
          {#each group.controls as control}
            <label class="field slider">
              <span>{control.label} <output>{surface[control.key]}{control.unit}</output></span>
              <input type="range" aria-label={`${group.title}: ${control.label}`} min={control.min} max={control.max} step={control.step} aria-valuetext={`${surface[control.key]}${control.unit}`} bind:value={surface[control.key]} disabled={group.title === 'Refraction' && layer === 'fallbacks'} />
            </label>
          {/each}
        </div>
      </section>
    {/each}
  </div>
</div>
{#if exported}<section class="export"><Heading title="Preset export" description={experimental ? 'Temporary experiment, effects and both base surfaces.' : 'All material and fallback drafts. Copy this configuration when you want it applied to the app.'} /><textarea aria-label="Preset export" readonly value={source} rows="12"></textarea></section>{/if}

<style>
  .tweaker { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 32px; align-items: start; }
  .preview-column { position: sticky; top: 100px; min-width: 0; }
  .preview { position: relative; overflow: hidden; border-radius: 24px; min-height: 440px; padding: 40px 24px; display: grid; align-content: center; gap: 40px; background: linear-gradient(135deg, var(--surface), var(--accent), var(--canvas)); }
  .preview.plain { background: var(--surface); }
  .scene { position: absolute; inset: 0; display: grid; align-content: space-evenly; text-align: center; color: var(--white); font-size: var(--text-2xl); font-weight: var(--weight-bold); transform: rotate(-15deg); }
  .scene div { height: 70px; background: repeating-linear-gradient(90deg, var(--white) 0 5px, transparent 5px 30px); }
  .plain .scene { display: none; }
  .sample { border-radius: var(--preview-radius); padding: 24px; min-height: 140px; display: grid; align-content: center; gap: 8px; color: var(--white); }
  .sample.light { color: var(--canvas); }
  .sample strong { font-size: var(--text-xl); font-weight: var(--weight-bold); }
  .sample span { font-size: var(--text-md); }
  .sample .sample-detail { font-size: var(--text-sm); }
  .preview-options { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 20px; align-items: center; }
  .preview-options .field { flex: 1; min-width: 160px; }
  .controls { min-width: 0; }
  section { padding-top: 24px; margin-top: 24px; border-top: 1px solid var(--line); }
  .control-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
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
  @media (max-width: 900px) { .tweaker { grid-template-columns: 1fr; } .preview-column { position: static; } .preview { min-height: 360px; padding: 24px; gap: 24px; } }
  @media (max-width: 480px) { .control-grid { grid-template-columns: 1fr; } }
</style>
