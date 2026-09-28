<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  let {
    open = $bindable(false),
    title,
    children,
    wide = false,
    onclose,
  }: {
    open: boolean;
    title: string;
    children: Snippet;
    wide?: boolean;
    onclose?: () => void;
  } = $props();
  let dialog: HTMLDialogElement;
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  class="solid-surface"
  aria-label={title}
  bind:this={dialog}
  onclose={() => {
    open = false;
    onclose?.();
  }}
  class:wide
  onclick={(e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        open = false;
    }
  }}
  onkeydown={() => {}}
>
  <div class="spread heading">
    <h2>{title}</h2>
    <button class="icon-button" aria-label="Close dialog" onclick={() => (open = false)}
      ><Icon name="close" /></button
    >
  </div>
  {@render children()}
</dialog>

<style>
  dialog {
    color: var(--ink);
    border-radius: 12px;
    padding: 24px;
    width: min(512px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
    margin: auto;
  }
  dialog.wide {
    border-radius: 16px;
    width: min(864px, calc(100vw - 32px));
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 75%);
  }
  .heading {
    margin-bottom: 22px;
  }
</style>
