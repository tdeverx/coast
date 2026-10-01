<script lang="ts">
  import type { InsightContent } from '$lib/ui/insights/types';
  import BarChart from './BarChart.svelte';
  import BreakdownChart from './BreakdownChart.svelte';
  import ProgressChart from './ProgressChart.svelte';
  import FactList from './FactList.svelte';
  import MetricGrid from './MetricGrid.svelte';
  import type { Snippet } from 'svelte';
  let { title, description, children, footer, content, footerText, footerLink }: {
    content?: InsightContent;
    footerText?: string;
    footerLink?: {href:string;label:string;external?:boolean};
    title: string;
    description?: string;
    children?: Snippet;
    footer?: Snippet;
  } = $props();
</script>

<section class="detail-card" aria-label={title}>
  <header>
    <h3>{title}</h3>
    {#if description}<p class="description">{description}</p>{/if}
  </header>
  {#if children || content}<div class="body">
    {#if content?.kind === 'bar'}<BarChart {...content.props} />
    {:else if content?.kind === 'breakdown'}<BreakdownChart {...content.props} />
    {:else if content?.kind === 'progress'}<ProgressChart {...content.props} />
    {:else if content?.kind === 'facts'}<FactList {...content.props} />
    {:else if content?.kind === 'metrics'}<MetricGrid {...content.props} />
    {:else if content?.kind === 'text'}<p class:muted={content.muted}>{content.text}</p>
    {:else}{@render children?.()}{/if}
  </div>{/if}
  {#if footer || footerText || footerLink}<footer>
    {#if footer}{@render footer()}{:else}{footerText ?? ''}{#if footerLink}<a href={footerLink.href}
      target={footerLink.external ? '_blank' : undefined} rel={footerLink.external ? 'noreferrer' : undefined}>{footerLink.label}</a>{/if}{/if}
  </footer>{/if}
</section>

<style>
  .detail-card {
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-width: 0;
    min-height: 148px;
    margin: 0;
    padding: 24px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--white) 5%, transparent);
    color: var(--ink);
    scroll-snap-align: start;
    overflow-wrap: anywhere;
  }
  .detail-card::before {
    content: '';
    position: absolute;
    inset: 0;
    border: 1.5px solid color-mix(in srgb, var(--white) 50%, transparent);
    border-radius: inherit;
    mix-blend-mode: overlay;
    pointer-events: none;
  }
  h3 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-normal);
  }
  .description,
  footer {
    color: var(--muted);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
  }
  .description {
    margin: 6px 0 0;
  }
  .body {
    min-width: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
  }
  footer {
    margin-top: auto;
  }
  @media (max-width: 600px) {
    .detail-card {
      padding: 20px;
    }
  }
</style>
