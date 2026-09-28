<script lang="ts">
  let { items }: { items: { label: string; value: string }[] } = $props();
</script>

<dl>
  {#each items as item}<div>
      <dt>{item.label}</dt>
      <dd>{item.value}</dd>
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
    border-bottom: 1px solid #ffffff0d;
  }
  dl > div:first-child {
    padding-top: 0;
  }
  dl > div:last-child {
    padding-bottom: 0;
    border-bottom: 0;
  }
  dt {
    font-size: 11px;
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-size: 12px;
    font-weight: 550;
    text-align: right;
    overflow-wrap: anywhere;
  }
</style>
