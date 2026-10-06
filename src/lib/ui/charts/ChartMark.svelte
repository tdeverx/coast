<script lang="ts">
  import type { Snippet } from 'svelte';
  let { label, index, selected, onselect, children }: { label: string; index: number; selected: number; onselect: (index: number) => void; children: Snippet } = $props();
  function keyboard(event:KeyboardEvent) {
    if(event.key==='Enter'||event.key===' '){event.preventDefault();onselect(index);return;}
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    const marks=[...((event.currentTarget as SVGGElement).closest('svg')?.querySelectorAll<SVGGElement>('.chart-mark')??[])];
    const unique=[...new Map(marks.map(mark=>[Number(mark.dataset.chartIndex),mark])).entries()].sort(([a],[b])=>a-b);
    const current=unique.findIndex(([key])=>key===index);
    const next=event.key==='Home'?0:event.key==='End'?unique.length-1:Math.max(0,Math.min(unique.length-1,current+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)));
    if(unique[next]){event.preventDefault();onselect(unique[next][0]);unique[next][1].focus({preventScroll:true});}
  }
</script>

<g class="chart-mark" data-chart-index={index} role="button" tabindex={selected === index ? 0 : -1} aria-label={label} aria-pressed={selected === index}
  onpointerenter={() => onselect(index)} onfocus={() => onselect(index)} onclick={() => onselect(index)}
  onkeydown={keyboard}>
  <title>{label}</title>
  {@render children()}
</g>

<style>
  g { cursor: pointer; }
  g:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
</style>
