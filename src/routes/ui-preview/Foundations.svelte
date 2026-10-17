<script lang="ts">
  import {useClient} from '$lib/ui/client-context';
  const delivery=useClient().feedback;
  import { onMount, untrack, type Snippet } from 'svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Field from '$lib/ui/components/Field.svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import Browser from './Browser.svelte';
  import type { WorkspaceParts } from './workspace';
  let {section,layout}: {section:'typography'|'colors';layout:Snippet<[WorkspaceParts]>} = $props();
  const sizes = ['--text-sm','--text-md','--text-xl','--text-2xl','--text-hero-mobile','--text-hero'];
  const weights = ['--weight-regular','--weight-semibold','--weight-bold'];
  const colors = ['--canvas','--white','--surface','--ink','--muted','--accent','--danger','--success','--rating','--surface-hover','--quiet','--line'];
  const options = $derived((section === 'typography' ? [...sizes,...weights] : colors).map(value=>({value,label:value,detail:section==='typography'?(value.includes('weight')?'Font weight':'Text size'):'Theme token'})));
  let selected = $state(untrack(()=>section === 'typography' ? '--text-xl' : '--accent'));
  let values = $state<Record<string,string>>({});
  let pickerValues = $state<Record<string,string>>({});
  let text = $state('The stories you love');
  let colorDraft = $state('');
  let showExport = $state(false);
  onMount(() => {
    const style = getComputedStyle(document.documentElement);
    values = Object.fromEntries([...sizes,...weights,...colors,'--font-sans'].map(token=>[token,style.getPropertyValue(token).trim()]));
    // Native colour inputs require six-digit sRGB, including for shorthand and color-mix tokens.
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    if(context)pickerValues=Object.fromEntries(colors.map(token=>{
      context.clearRect(0,0,1,1);context.fillStyle=values[token];context.fillRect(0,0,1,1);
      const rgb=context.getImageData(0,0,1,1).data;
      return [token,`#${Array.from(rgb.slice(0,3),value=>value.toString(16).padStart(2,'0')).join('')}`];
    }));
  });
  const tokenValue = $derived(section==='colors' && colorDraft ? colorDraft : values[selected] ?? '');
  const configuration = $derived(JSON.stringify({token:selected,value:tokenValue,scope:'preview-only'},null,2));
  function change(value:string) {selected=value;colorDraft='';}
  async function copy() {
    showExport=true;
    try {await navigator.clipboard.writeText(configuration);delivery.notify('Token configuration copied.');}
    catch {delivery.failure('Select the configuration below to copy it.');}
  }
</script>

{@render layout({title:section==='typography'?'Typography':'Colors',canvas,inspector,browser})}
{#snippet canvas()}
  <div class="foundation-stage">
    {#if section === 'typography'}
      <span class="small quiet">{selected} · {values[selected] ?? '…'}</span>
      <div class="type-sample" style:font-size={sizes.includes(selected)?`var(${selected})`:'var(--text-2xl)'} style:font-weight={weights.includes(selected)?`var(${selected})`:undefined}>{text || 'Aa 0123456789'}</div>
      <p class="small quiet">{values['--font-sans']}</p>
      <div class="native-styles"><Heading variant="title" title="Heading" /><p>Supporting paragraph and body text.</p><small>Caption and metadata text.</small></div>
    {:else}
      <div class="swatch" style:background={colorDraft || `var(${selected})`} aria-label={`${selected} colour swatch`}></div>
      <Heading variant="title" title={selected} /><code>{tokenValue}</code>
    {/if}
  </div>
{/snippet}
{#snippet inspector()}
  <div class="stack">
    <Field label="Token"><select value={selected} onchange={event=>change(event.currentTarget.value)}>{#each options as option}<option value={option.value}>{option.label}</option>{/each}</select></Field>
    {#if section === 'typography'}<Field label="Sample text"><textarea rows="3" bind:value={text}></textarea></Field>
    {:else}<Field label="Try a colour"><input type="color" value={colorDraft || pickerValues[selected] || '#000000'} oninput={event=>colorDraft=event.currentTarget.value} /></Field>{/if}
    <p class="small quiet">Source: <code>src/app.css</code></p>
    <p class="small quiet">These controls change this preview. App tokens stay unchanged.</p>
    <div class="row"><Button emphasis="subtle" onclick={()=>{text='The stories you love';colorDraft='';}}>Reset</Button><Button emphasis="subtle" onclick={copy}>Copy configuration</Button></div>

    {#if showExport}<Field label="Configuration"><textarea readonly rows="6" value={configuration}></textarea></Field>{/if}
  </div>
{/snippet}
{#snippet browser({heading}:{heading:Snippet})}<Browser title={section==='typography'?'Browse text tokens':'Browse colours'} {heading} {options} value={selected} change={change}>
  {#snippet thumbnail(option)}{#if section==='colors'}<span class="token-dot" style:background={`var(${option.value})`}></span>{:else}<span class="token-letters">Aa</span>{/if}{/snippet}
</Browser>{/snippet}
<style>
  .foundation-stage {min-height:100%;display:grid;align-content:safe center;justify-items:center;gap:var(--preview-gap);padding:0;min-width:0;text-align:center;}
  .type-sample {overflow-wrap:anywhere;max-width:100%;}
  .native-styles {display:grid;gap:8px;}
  .swatch {width:min(100%,320px);height:200px;border-radius:20px;border:1px solid var(--line);}
  .token-dot {width:100%;height:36px;border:1px solid var(--line);border-radius:8px;}
  .token-letters {font-size:var(--text-xl);font-weight:var(--weight-semibold);}
  code {font-size:var(--text-sm);overflow-wrap:anywhere;}
  .row {flex-wrap:wrap;gap:8px;}
</style>
