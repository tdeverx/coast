<script lang="ts">
  import AccountAccess from '#lib/auth/ui/AccountAccess.svelte';
  import type { PageProps } from './$types';
  let {data, form}: PageProps = $props();
</script>
<svelte:head><title>Sign up · Coast</title></svelte:head>
<AccountAccess registering gated={data.registrationMode === 'invite'} error={form && 'error' in form ? form.error : undefined} />
