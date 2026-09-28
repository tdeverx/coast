<script lang="ts">
  let {
    items,
  }: { items: { label: string; value: string | number; detail?: string; text?: boolean }[] } =
    $props();
</script>

<dl class="metrics">
  {#each items as item}<div>
      <dt>{item.label}</dt>
      <dd class:copy={item.text}>
        {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
      </dd>
      {#if item.detail}<p>{item.detail}</p>{/if}
    </div>{/each}
</dl>

<style>
  .metrics {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px 20px;
    margin: 0;
  }
  .metrics > div {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  dt {
    order: 1;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.4;
  }
  dd {
    margin: 0;
    font-size: var(--detail-value-size, 28px);
    font-weight: 650;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.025em;
    overflow-wrap: anywhere;
  }
  dd.copy {
    font-size: 18px;
    letter-spacing: -0.015em;
    line-height: 1.4;
  }
  p {
    order: 2;
    margin: 0;
    color: var(--quiet);
    font-size: 10px;
    line-height: 1.4;
  }
</style>
