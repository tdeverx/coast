<script lang="ts">
  import Toggle from '#lib/ui/components/Toggle.svelte';

  let { label, description, name, checked = $bindable(), disabled, onchange }: {
    label: string;
    description?: string;
    name?: string;
    checked?: boolean;
    disabled?: boolean;
    onchange?: (checked: boolean) => void;
  } = $props();
</script>

<Toggle class="menu-row settings-switch" {label} {name} checked={checked ?? false} {disabled}
  onchange={next => { checked = next; onchange?.(next); }}>
  <span class="menu-row-copy">
    <span>{label}</span>
    {#if description}<small>{description}</small>{/if}
  </span>
</Toggle>

<style>
  :global(.settings-switch.menu-row) {
    justify-content: space-between;
    gap: var(--auth-gap);
    min-block-size: calc(var(--leading-menu) + 2 * var(--auth-action-gap));
    padding: var(--auth-action-gap);
  }
  .menu-row-copy { flex: 1; }
  small { line-height: var(--leading-normal); }
</style>
