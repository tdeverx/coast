<script module lang="ts">
  export type PreviewValueEditor = {
    value: string;
    defaultValue?: string;
    placeholder: string;
    inputmode?: 'text' | 'decimal';
    update: (value: string) => void;
  };
</script>

<script lang="ts">
  import Button from '#lib/ui/components/Button.svelte';
  import Icon from '#lib/ui/components/Icon.svelte';

  let { label, value, defaultValue = '', placeholder, inputmode = 'text', update, onfocus, resettable = false }: PreviewValueEditor & {
    label: string;
    onfocus?: () => void;
    resettable?: boolean;
  } = $props();
  let input: HTMLInputElement;
</script>

<div class="value-control">
  <label class="menu-row value-input">
    <Icon name="list" size={16} />
    <input type="text" aria-label={label} maxlength={200} {value} {placeholder} {inputmode} {onfocus} bind:this={input}
      oninput={event => update(event.currentTarget.value)} />
  </label>
  {#if resettable && value !== defaultValue}
    <div class="reset-action">
      <Button size="icon" emphasis="subtle" icon="retry" danger
        label={`Reset ${label} to default`} title={`Reset ${label} to default`}
        onclick={() => { update(defaultValue); input.focus({ preventScroll: true }); }} />
    </div>
  {/if}
</div>

<style>
  .value-control { position:relative; }
  .reset-action {
    position:absolute;
    inset-inline-start:calc(100% + var(--editor-menu-frame) + var(--editor-side-action-offset));
    inset-block-start:50%;
    translate:0 -50%;
  }
  .value-input { min-block-size:var(--editor-row-height); }
</style>
