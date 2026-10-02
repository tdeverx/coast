<script lang="ts">
  import {enhance} from '$app/forms';
  import Brand from '$lib/ui/components/Brand.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  let {form}=$props(); let busy=$state(false);
</script>
<svelte:head><title>Join Coast</title></svelte:head>
<div class="auth-page"><div class="auth-card">
  <div class="row brand"><Brand /></div><h1>Join Coast.</h1><p>Create your account, then connect Jellyfin to import your progress.</p>
  <form method="POST" class="stack" use:enhance={()=>{busy=true;return async({update})=>{await update();busy=false;};}}>
    {#if form?.error}<p class="notice error" role="alert">{form.error}</p>{/if}
    <label class="field">Invite code<input name="code" required maxlength="43" autocomplete="off" /></label>
    <label class="field">Username<input name="username" required minlength="3" maxlength="32" autocomplete="username" /></label>
    <label class="field">Password<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password" /></label>
    <Button type="submit" disabled={busy}>{busy?'Creating account…':'Create account'}</Button>
  </form><div class="auth-footer"><a href="/login">Already have an account? Sign in</a></div>
</div></div>
