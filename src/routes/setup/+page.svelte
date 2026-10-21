<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
  import { enhance } from '$app/forms';
  import Brand from '#lib/ui/components/Brand.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import AccountFields from '#lib/ui/components/AccountFields.svelte';
  let { form } = $props();
  let busy = $state(false);
  reportFailure(()=>form?.error);
</script>

<svelte:head><title>Welcome to Coast</title></svelte:head>
<div class="auth-page">
  <div class="auth-card">
    <div class="row brand"><Brand /></div>
    <h1>A home for your stories.</h1>
    <p>
      Create your administrator account to start tracking what you love. Your data stays with you.
    </p>
    <form
      method="POST"
      class="stack"
      use:enhance={() => {
        busy = true;
        form = null;
        return async ({ update }) => {
          try { await update(); } finally { busy = false; }
        };
      }}
    >

      <AccountFields />
      <label class="field">Email <span class="quiet">Optional</span><input name="email" type="email" autocomplete="email" /></label>
      <Button type="submit" disabled={busy}
        >{busy ? 'Creating your Coast…' : 'Create your Coast'}</Button
      >
    </form>
    <div class="auth-footer">Self-hosted. No telemetry. Yours to keep.</div>
  </div>
</div>
