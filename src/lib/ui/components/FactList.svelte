<script lang="ts">
  let { items }: { items: { label: string; value: string | null; detail?: string }[] } = $props();
</script>

<dl>
  {#each items as item}<div>
      <dt>{item.label}</dt>
      <dd class="row-text-stack" class:missing={item.value === null}>
        {item.value ?? 'No data'}
        {#if item.detail}<small>{item.detail}</small>{/if}
      </dd>
    </div>{/each}
</dl>

<style>
  dl {
    display: grid;
    gap: 0;
    margin: 0;
  }
  dl > div {
    display: grid;
    grid-template-columns: minmax(70px, 1fr) minmax(0, 1.8fr);
    gap: 20px;
    padding: 12px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--white) calc(13 / 255 * 100%), transparent);
  }
  dl > div:first-child {
    padding-top: 0;
  }
  dl > div:last-child {
    padding-bottom: 0;
    border-bottom: 0;
  }
  dt {
    font-size: var(--text-sm);
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    text-align: right;
    overflow-wrap: anywhere;
  }
  .missing, small { color: var(--muted); }
  .missing { font-weight: var(--weight-regular); }
  small {
    display: block;
    font-size: inherit;
    font-weight: var(--weight-regular);
  }
</style>
