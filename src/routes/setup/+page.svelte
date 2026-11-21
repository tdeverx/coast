<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
  import { enhance } from '$app/forms';
  import Brand from '#lib/ui/components/Brand.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import AccountFields from '#lib/ui/components/AccountFields.svelte';
  let { data, form } = $props();
  let busy = $state(false);
  reportFailure(()=>form?.error);
  const submit: NonNullable<Parameters<typeof enhance>[1]> = () => {
    busy = true;
    form = null;
    return async ({ update }) => {
      try { await update(); } finally { busy = false; }
    };
  };
</script>

<svelte:head><title>Welcome to Coast</title></svelte:head>
<div class="auth-page">
  <div class="auth-card">
    <div class="row brand"><Brand /></div>
    {#if data.accountRequired}
    <h1>A home for your stories.</h1>
    <p>
      Create your administrator account to start tracking what you love. Your data stays with you.
    </p>
    <form
      method="POST"
      action="?/account"
      class="stack"
      use:enhance={submit}
    >

      <AccountFields />
      <label class="field">Email <span class="quiet">Optional</span><input name="email" type="email" autocomplete="email" /></label>
      <Button type="submit" disabled={busy}>{busy ? 'Creating your account…' : 'Continue'}</Button>
    </form>
    <div class="auth-footer">Self-hosted. No telemetry. Yours to keep.</div>
    {:else if data.canConfigureTmdb}
      <h1>Connect TMDB</h1>
      <p>Coast uses TMDB to identify movies, shows, and episodes.</p>
      <form method="POST" action="?/tmdb" class="stack" use:enhance={submit}>
        <label class="field">TMDB API key or read access token
          <input name="tmdbCredential" type="password" autocomplete="off" maxlength="4096" required />
        </label>
        <a class="text-accent" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">Open your TMDB API settings</a>
        <Button type="submit" disabled={busy}>{busy ? 'Checking credentials…' : 'Connect TMDB'}</Button>
      </form>
    {:else}
      <h1>Coast setup is incomplete</h1>
      <p>Ask a Coast administrator to connect TMDB.</p>
    {/if}
    {#if !data.accountRequired}
      <div class="auth-footer"><form method="POST" action="/logout"><Button type="submit" emphasis="subtle">Sign out</Button></form></div>
    {/if}
  </div>
</div>
