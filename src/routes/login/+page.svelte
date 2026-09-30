<script lang="ts">
  import { page } from '$app/state';
  import { enhance } from '$app/forms';
  import Brand from '$lib/ui/components/Brand.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import { untrack } from 'svelte';
  let { data, form } = $props();
  let busy = $state(false);
  let service = $state(untrack(() => form?.service ?? 'coast'));
</script>

<svelte:head><title>Sign in · Coast</title></svelte:head>
<div class="auth-page">
  <div class="auth-card">
    <div class="row brand"><Brand /></div>
    <h1>Welcome back.</h1>
    <p>Pick up where you left off.</p>
    {#if page.url.searchParams.get('passwordChanged') === '1'}<p
        class="notice success"
        role="status"
      >
        Password updated. Sign in with your new password.
      </p>{/if}
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
      {#if form?.error}<div class="notice error" role="alert">
          {form.error}
        </div>{/if}
      {#if data.services.length}<label class="field"
          >Sign in with<select
            aria-label="Sign in with"
            name="service"
            bind:value={service}
            disabled={busy}
            ><option value="coast">Coast</option>{#each data.services as entry}<option
                value={entry.id}>{entry.name} · Jellyfin</option
              >{/each}</select
          ></label
        >{/if}
      {#if service !== 'coast'}<p class="small">
          Use your Jellyfin username and password. {data.autoCreateUsers
            ? 'Coast will create your account on first sign-in.'
            : 'Your Jellyfin account must already be linked to a Coast account.'}
        </p>{/if}
      <label class="field"
        >Username<input
          name="username"
          autocomplete="username"
          maxlength={service === 'coast' ? 32 : 250}
          required
        /></label
      ><label class="field"
        >Password<input
          name="password"
          type="password"
          autocomplete="current-password"
          required={service === 'coast'}
          maxlength={service === 'coast' ? 128 : 4096}
        /></label
      ><Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
    </form>
    <div class="auth-footer">
      <a href="/recovery">Administrator recovery</a>
    </div>
  </div>
</div>
