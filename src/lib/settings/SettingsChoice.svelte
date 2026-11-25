<script lang="ts" generics="Value extends string">
  import PreviewSelect from '#lib/ui/cards/editor/PreviewSelect.svelte';
  import type { IconName } from '#lib/ui/components/Icon.svelte';
  import './settings-surface.css';

  let { label, value = $bindable(), options, icon, hint, disabled = false, onchange }: {
    label: string;
    value: Value;
    options: readonly { id: Value; label: string; icon?: IconName }[];
    icon?: IconName;
    hint?: string;
    disabled?: boolean;
    onchange?: (value: Value) => void;
  } = $props();
</script>

<div class="settings-choice">
  <PreviewSelect topLayer {label} bind:value {options} {icon} {hint} {disabled} {onchange} />
  {#if hint}<p class="small muted" aria-hidden="true">{hint}</p>{/if}
</div>

<style>
  .settings-choice { display: grid; gap: var(--auth-action-gap); min-inline-size: 0; }
</style>
