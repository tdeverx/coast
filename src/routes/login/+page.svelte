<script lang="ts">
  import { enhance } from '$app/forms';
  import Brand from '$lib/ui/components/Brand.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  let { form } = $props();
  let busy = $state(false);
</script>

<svelte:head><title>Sign in · Coast</title></svelte:head>
<div class="auth-page">
  <div class="auth-card">
    <div class="row brand"><Brand /></div>
    <h1>Welcome back.</h1>
    <p>Pick up where you left off.</p>
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
        class="field">Username<input name="username" autocomplete="username" required /></label
      ><label class="field"
        >Password<input
          name="password"
          type="password"
          autocomplete="current-password"
          required
        /></label
      ><Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
    </form>
    <div class="auth-footer"><a href="/recovery">Administrator recovery</a></div>
  </div>
</div>
