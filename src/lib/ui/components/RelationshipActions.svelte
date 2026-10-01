<script lang="ts">
  import MenuAction from './MenuAction.svelte';
  import type { IconName } from './Icon.svelte';
  import type { Relationship } from '$lib/ui/relationships';
  let { items, disabled = false, onchange }: {
    items: { kind: Relationship; value: boolean; label: string; icon: IconName; showCheckmark?: boolean }[];
    disabled?: boolean;
    onchange: (kind: Relationship) => void;
  } = $props();
</script>

{#each items as item (item.kind)}<MenuAction icon={item.icon} checked={item.value}
  showCheckmark={item.showCheckmark ?? true} {disabled} onclick={() => onchange(item.kind)}>
  {item.label}
</MenuAction>{/each}
