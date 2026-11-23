<script lang="ts">
  import { onMount, type ComponentProps } from 'svelte';
  import { createResource } from '#lib/ui/resource.svelte.js';
  import Button from '#lib/ui/components/Button.svelte';
  import Dialog from '#lib/ui/components/Dialog.svelte';
  import type TasteMatch from './TasteMatch.svelte';

  type Props = ComponentProps<typeof TasteMatch>;
  let { inspect, onclose, ...target }: Omit<Props, 'inspect'> & {inspect: NonNullable<Props['inspect']>} = $props();
  const component = createResource<typeof TasteMatch | undefined>(undefined);
  const Inspector = $derived(component.data);
  let opener: HTMLElement | null = null;
  function load() { return component.load(async () => (await import('./TasteMatch.svelte')).default); }
  function close() {
    onclose?.();
    if (opener?.isConnected) opener.focus({preventScroll:true});
  }
  onMount(() => {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void load();
    return component.dispose;
  });
</script>

{#if Inspector}
  <Inspector {...target} {inspect} onclose={close} />
{:else if component.busy || component.error}
  <Dialog open wide title={`Taste score · ${inspect.title}`} onclose={close}>
    {#if component.error}
      <p role="alert">The taste score could not load.</p><Button onclick={load}>Retry</Button>
    {:else}<p role="status">Opening your taste score…</p>{/if}
  </Dialog>
{/if}
