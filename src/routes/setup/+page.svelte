<script lang="ts">
  import { enhance } from '$app/forms';
  import Brand from '$lib/ui/components/Brand.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  let { form } = $props();
  let busy = $state(false);
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
        return async ({ update }) => {
          await update();
          busy = false;
        };
      }}
    >
      {#if form?.error}<div class="notice error" role="alert">{form.error}</div>{/if}<label
        class="field"
        >Username<input
          name="username"
          autocomplete="username"
          minlength="3"
          maxlength="32"
          required
        /></label
      ><label class="field"
        >Password<input
          name="password"
          type="password"
          autocomplete="new-password"
          minlength="12"
          required
        /><small>Use at least 12 characters.</small></label
      ><label class="field"
        >Email <span class="quiet">Optional</span><input
          name="email"
          type="email"
          autocomplete="email"
        /></label
      ><Button type="submit" disabled={busy}
        >{busy ? 'Creating your Coast…' : 'Create your Coast'}</Button
      >
    </form>
    <div class="auth-footer">Self-hosted. No telemetry. Yours to keep.</div>
  </div>
</div>
