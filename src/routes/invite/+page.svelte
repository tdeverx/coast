<script lang="ts">
  import AccountAccess from '#lib/auth/ui/AccountAccess.svelte';
  import type { PageProps } from './$types';
  let {form}: PageProps = $props();
</script>
<svelte:head><title>Join Coast by invitation</title></svelte:head>
<AccountAccess registering gated verified={form && 'invite' in form ? form.invite : undefined} error={form && 'error' in form ? form.error : undefined} />
