<script lang="ts">
  import Button from '#lib/ui/components/Button.svelte';
  import Icon, { type IconName } from '#lib/ui/components/Icon.svelte';
  import Toggle from '#lib/ui/components/Toggle.svelte';

  let { label, icon, checked, onchange, onreset }: {
    label: string;
    icon: IconName;
    checked: boolean;
    onchange: (checked: boolean) => void;
    onreset?: () => void;
  } = $props();

  let control: HTMLDivElement;
</script>

<div class="toggle-control" bind:this={control}>
  <Toggle class="menu-row toggle-row" {label} {checked} {onchange}>
    <Icon name={icon} />
    <span class="toggle-label">{label}</span>
  </Toggle>
  {#if onreset}
    <div class="reset-action">
      <Button size="icon" emphasis="subtle" icon="retry" danger
        label={`Reset ${label} to default`} title={`Reset ${label} to default`}
        onclick={() => { onreset?.(); control.querySelector('input')?.focus({ preventScroll: true }); }} />
    </div>
  {/if}
</div>

<style>
  .toggle-control { position:relative; }
  .toggle-control > :global(.toggle-row) {
    --toggle-off-fill:var(--inset-control-fill);
    --toggle-on-tint:color-mix(in srgb, var(--toggle-off-fill), var(--white) 24%);
    --toggle-thumb-fill:var(--white);
    min-block-size:var(--editor-row-height);
    padding-block:calc(var(--menu-item-inset) - var(--menu-inset));
  }
  .toggle-control > :global(.toggle-row:is(:hover, :has(:focus-visible))) {
    --toggle-off-fill:var(--inset-control-hover-fill);
    background:var(--control-hover-fill);
    color:var(--ink);
  }
  .toggle-label { flex:1; min-inline-size:0; }
  .reset-action {
    position:absolute;
    inset-inline-start:calc(100% + var(--editor-menu-frame) + var(--editor-side-action-offset));
    inset-block-start:50%;
    translate:0 -50%;
  }
</style>
