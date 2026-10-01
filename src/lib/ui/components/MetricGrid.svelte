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
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }
  dd {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
    font-variant-numeric: tabular-nums;
    letter-spacing: var(--tracking-tight);
    overflow-wrap: anywhere;
  }
  dd.copy {
    font-size: var(--text-xl);
    letter-spacing: var(--tracking-tight);
    line-height: var(--leading-normal);
  }
  p {
    order: 2;
    margin: 0;
    color: var(--quiet);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }
</style>
