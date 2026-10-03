<script lang="ts">
 import {enhance} from '$app/forms';
 import Brand from '$lib/ui/components/Brand.svelte';
 import Button from '$lib/ui/components/Button.svelte';
 import Field from '$lib/ui/components/Field.svelte';
 let {form}=$props();let busy=$state(false);
</script>
<svelte:head><title>Sign in · Coast</title></svelte:head>
<div class="auth-page"><div class="auth-card">
 <div class="row brand"><Brand /></div><h1>Welcome back.</h1><p>Pick up where you left off.</p>
 <form method="POST" class="stack" use:enhance={()=>{busy=true;return async({update})=>{try{await update();}finally{busy=false;}};}}>
  {#if form?.error}<p class="notice error" role="alert">{form.error}</p>{/if}
  <Field label="Username"><input name="username" autocomplete="username" required maxlength="32" /></Field>
  <Field label="Password"><input name="password" type="password" autocomplete="current-password" required maxlength="128" /></Field>
  <Button type="submit" disabled={busy}>{busy?'Signing in…':'Sign in'}</Button>
 </form><div class="auth-footer"><a href="/register">Create an account</a></div>
</div></div>
