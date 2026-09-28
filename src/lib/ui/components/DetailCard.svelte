<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    title,
    description,
    value,
    unit,
    textValue = false,
    href,
    children,
    footer,
  }: {
    title: string;
    description?: string;
    value?: string;
    unit?: string;
    textValue?: boolean;
    href?: string;
    children?: Snippet;
    footer?: Snippet;
  } = $props();
</script>

{#snippet content()}
  <header>
    <h3>{title}</h3>
    {#if description}<p class="description">{description}</p>{/if}
  </header>
  {#if value !== undefined}<p class="value" class:text-value={textValue}>
      {value}{#if unit}<span class="unit">{unit}</span>{/if}
    </p>{/if}
  {#if children}<div class="body">{@render children()}</div>{/if}
  {#if footer}<footer>{@render footer()}</footer>{/if}
{/snippet}

{#if href}<a class="detail-card" {href} target="_blank" rel="noreferrer" aria-label={title}
    >{@render content()}</a
  >
{:else}<section class="detail-card" aria-label={title}>{@render content()}</section>{/if}

<style>
  .detail-card {
    --detail-value-size: 28px;
    --detail-value-weight: 650;
    --detail-copy-size: 12px;
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
    background: rgb(255 255 255 / 5%);
    color: var(--ink);
    scroll-snap-align: start;
    overflow-wrap: anywhere;
  }
  .detail-card::before {
    content: '';
    position: absolute;
    inset: 0;
    border: 1.5px solid rgb(255 255 255 / 50%);
    border-radius: inherit;
    mix-blend-mode: overlay;
    pointer-events: none;
  }
  a.detail-card {
    transition: background var(--fast);
  }
  a.detail-card:hover,
  a.detail-card:focus-visible {
    background: rgb(255 255 255 / 8%);
  }
  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 650;
    line-height: 1.4;
  }
  .description,
  footer {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.6;
  }
  .description {
    margin: 6px 0 0;
  }
  .value {
    margin: 0;
    font-size: var(--detail-value-size);
    font-weight: var(--detail-value-weight);
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.025em;
  }
  .text-value {
    font-size: 18px;
    line-height: 1.4;
    letter-spacing: -0.015em;
  }
  .unit {
    margin-left: 6px;
    font-size: 12px;
    font-weight: 500;
    color: var(--muted);
    letter-spacing: normal;
  }
  .body {
    min-width: 0;
    font-size: var(--detail-copy-size);
    line-height: 1.6;
  }
  footer {
    margin-top: auto;
  }
  @media (max-width: 600px) {
    .detail-card {
      padding: 20px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    a.detail-card {
      transition: none;
    }
  }
</style>
