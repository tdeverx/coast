<script lang="ts">
  import { enhance } from '$app/forms';
  import Brand from '$lib/ui/components/Brand.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  let { form } = $props();
</script>

<div class="auth-page">
  <div class="auth-card">
    <div class="row brand"><Brand /></div>
    <h1>Recover administrator access.</h1>
    <p>Use the single-use credential loaded from your Coast data directory at startup.</p>
    {#if form?.success}<div class="stack">
        <div class="notice success">
          Password updated. The recovery credential has been consumed.
        </div>
        <Button href="/login">Sign in</Button>
      </div>{:else}<form method="POST" class="stack" use:enhance>
        {#if form?.error}<div class="notice error" role="alert">{form.error}</div>{/if}<label
          class="field"
          >Recovery credential<input
            name="credential"
            type="password"
            autocomplete="off"
            required
          /></label
        ><label class="field">Administrator username<input name="username" required /></label><label
          class="field"
          >New password<input
            name="password"
            type="password"
            minlength="12"
            autocomplete="new-password"
            required
          /></label
        ><Button type="submit">Reset password</Button><Button variant="ghost" href="/login"
          >Back to sign in</Button
        >
      </form>{/if}
  </div>
</div>
