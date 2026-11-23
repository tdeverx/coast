<script lang="ts">
  import Button from '#lib/ui/components/Button.svelte';
  import Icon from '#lib/ui/components/Icon.svelte';
  import { useClient } from '#lib/ui/client-context.js';
  import { copyTraktCode } from './activation.js';

  let { code, oncopied }: { code: string; oncopied?: (copiedCode: string) => void } = $props();
  const { feedback } = useClient();
  async function copy() {
    const copiedCode = code;
    if (await copyTraktCode(copiedCode)) {
      feedback.notify('Trakt code copied.');
      oncopied?.(copiedCode);
    } else feedback.failure('Select the Trakt code and copy it manually.');
  }
</script>

<div class="pairing-code">
  <Button class="inset-row-action" emphasis="subtle" label={`Copy Trakt code ${code}`} title="Copy Trakt code" onclick={copy}>
    <code>{code}</code>
    <Icon name="copy" size={16} />
  </Button>
</div>

<style>
  .pairing-code { display: grid; align-self: stretch; }
  .pairing-code :global(.button) { justify-content:space-between; }
  code { letter-spacing: var(--tracking-wide); user-select: all; }
</style>
