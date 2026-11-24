<script lang="ts">
  import type { Snippet } from 'svelte';

  let { label, name, checked = $bindable(false), disabled = false, class: className, children, onchange }: {
    label: string;
    name?: string;
    checked?: boolean;
    disabled?: boolean;
    class?: string;
    children?: Snippet;
    onchange?: (checked: boolean) => void;
  } = $props();
</script>

<label class={['toggle', className]} class:disabled title={label}>
  {@render children?.()}
  <span class="switch">
    <input type="checkbox" role="switch" aria-label={label} {name} {disabled} bind:checked
      onchange={event => onchange?.(event.currentTarget.checked)} />
    <span class="track" aria-hidden="true"></span>
  </span>
</label>

<style>
  .toggle { cursor: pointer; }
  .toggle:not(:global(.menu-row)) { display: inline-grid; flex: none; }
  .switch {
    --toggle-inset: 2px;
    --toggle-thumb-size: var(--icon-control);
    position: relative;
    display: inline-grid;
    flex: none;
    inline-size: calc(2 * var(--toggle-thumb-size));
    block-size: calc(var(--toggle-thumb-size) + 2 * var(--toggle-inset));
  }
  .toggle.disabled { cursor: default; opacity: var(--control-disabled-opacity); }
  input {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }
  .track {
    position: relative;
    border-radius: 999px;
    background: var(--toggle-off-fill, var(--control-hover-fill));
    transition: background var(--fast);
    pointer-events: none;
  }
  .track::before {
    content: '';
    position: absolute;
    inset-block-start: var(--toggle-inset);
    inset-inline-start: var(--toggle-inset);
    inline-size: var(--toggle-thumb-size);
    block-size: var(--toggle-thumb-size);
    border-radius: 50%;
    background: var(--toggle-thumb-fill, var(--ink));
    transition: inset-inline-start var(--motion) var(--ease);
  }
  input:checked + .track { background: var(--toggle-on-tint, color-mix(in srgb, var(--success) 56%, var(--canvas))); }
  input:checked + .track::before { inset-inline-start: calc(100% - var(--toggle-thumb-size) - var(--toggle-inset)); }
  input:focus-visible + .track { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) {
    .track, .track::before { transition: none; }
  }
  @media (forced-colors: active) {
    .track { border: 1px solid ButtonText; }
    .track::before { background: ButtonText; forced-color-adjust: none; }
    input:checked + .track { background: Highlight; forced-color-adjust: none; }
    input:checked + .track::before { background: HighlightText; }
    input:focus-visible + .track { outline-color: Highlight; }
  }
</style>
