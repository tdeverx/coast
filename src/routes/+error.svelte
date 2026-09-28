<script lang="ts">
  import { page } from '$app/state';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Button from '$lib/ui/components/Button.svelte';
</script>

<svelte:head><title>{page.status === 404 ? 'Page not found' : 'Error'} · Coast</title></svelte:head>
<div class="content page">
  <EmptyState
    level={1}
    title={page.status === 404 ? 'Page not found' : 'Something went wrong'}
    description={page.error?.message ?? 'Please try again in a moment.'}
  >
    <Button href="/for-you">Back to For You</Button>
  </EmptyState>
</div>
