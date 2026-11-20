<script lang="ts">
  import Button from './Button.svelte';
  let { owner = false, editing = false, copyLink, clearBackground }: {
    owner?: boolean;
    editing?: boolean;
    copyLink?: () => unknown;
    clearBackground?: () => void;
  } = $props();
</script>

<Button menu label="Profile actions">
  {#if editing}
    <Button item icon="close" disabled={!clearBackground} onclick={clearBackground}>Clear background</Button>
  {:else}
    <Button item icon="link" onclick={copyLink}>Copy profile link</Button>
    {#if owner}<Button item icon="shield" href="/settings/privacy">Profile privacy</Button>{/if}
  {/if}
</Button>
