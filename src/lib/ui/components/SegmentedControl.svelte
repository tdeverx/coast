<script lang="ts">
  import { slidingPill } from '#lib/ui/materials/sliding-pill.js';
  import {liquidGlass} from '#lib/ui/materials/glass.js';
  import type {GlassVariant} from '#lib/ui/materials/presets.js';
  let {
    options,
    value = $bindable(),
    onchange,
    label,material,presentation='standard',
  }: {
    label?: string;material?:GlassVariant;presentation?:'standard'|'navigation';
    options: { value: string; label: string }[];
    value: string;
    onchange?: (value: string) => void;
  } = $props();
  // liquidGlass's disabled renderer still supplies CSS fallback; plain controls must not mount it.
  function materialSurface(node:HTMLElement,options:{enabled:boolean;variant:GlassVariant}){
    let action:ReturnType<typeof liquidGlass>|undefined,key='';
    function update(next:typeof options){
      const nextKey=`${next.enabled}:${next.variant}`;if(nextKey===key)return;key=nextKey;
      action?.destroy();action=next.enabled?liquidGlass(node,{variant:next.variant}):undefined;
    }
    update(options);return {update,destroy(){action?.destroy();}};
  }
</script>

<div class="picker-container" class:navigation={presentation==='navigation'} class:glass={!!material} use:materialSurface={{variant:material??'glassDark',enabled:!!material}}>
 <div class="control-viewport">
  <div class="segmented-control" role="group" aria-label={label} use:slidingPill>
    {#each options as option}<button
        type="button"
        aria-pressed={value === option.value}
        onclick={() => {
          value = option.value;
          onchange?.(value);
        }}>{option.label}</button
      >{/each}
  </div>
 </div>
</div>

<style>
  .picker-container {
    min-width: 0;
    max-width: 100%;
    width: max-content;
    border-radius: 999px;
    background: color-mix(in srgb, var(--white) 5%, transparent);
  }
  .segmented-control {
    width: max-content;
    background: transparent;
  }
  button {
    flex: none;
    white-space: nowrap;
  }
  .control-viewport {max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none;border-radius:inherit;}
  .picker-container.glass {background:var(--coast-glass-fill);}
  .navigation button {padding-inline:18px;}
</style>
