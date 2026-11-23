<script lang="ts">
  import AccountAccess from '#lib/auth/ui/AccountAccess.svelte';
  import type { PageProps } from './$types';
  let {form}: PageProps = $props();
</script>
<svelte:head><title>Sign in · Coast</title></svelte:head>
<AccountAccess  error={form && 'error' in form ? form.error : undefined} />
