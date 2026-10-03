<script lang="ts">
  import {enhance} from '$app/forms';
  import Brand from '$lib/ui/components/Brand.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import AccountFields from '$lib/ui/components/AccountFields.svelte';
  let {data,form}=$props(); let busy=$state(false);
</script>
<svelte:head><title>Join Coast</title></svelte:head>
<div class="auth-page"><div class="auth-card">
  <div class="row brand"><Brand /></div><h1>Join Coast.</h1><p>Create your account, then connect your services to import your progress.</p>
  <form method="POST" class="stack" use:enhance={()=>{busy=true;return async({update})=>{try{await update();}finally{busy=false;}};}}>
    {#if form?.error}<p class="notice error" role="alert">{form.error}</p>{/if}
    {#if data.registrationMode==='invite'}<label class="field">Invite code<input name="code" required maxlength="43" autocomplete="off" /></label>{/if}
    <AccountFields />
    <Button type="submit" disabled={busy}>{busy?'Creating account…':'Create account'}</Button>
  </form><div class="auth-footer"><a href="/login">Already have an account? Sign in</a></div>
</div></div>
