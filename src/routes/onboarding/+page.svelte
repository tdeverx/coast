<script lang="ts">
  import {enhance} from '$app/forms'; import {invalidate} from '$app/navigation'; import {onMount} from 'svelte';
  import Brand from '$lib/ui/components/Brand.svelte'; import Button from '$lib/ui/components/Button.svelte';
  let {data,form}=$props(); let busy=$state(false);
  onMount(()=>{let pending=false;const timer=setInterval(()=>{if(!pending){pending=true;void invalidate('coast:onboarding').finally(()=>pending=false);}},2000);return()=>clearInterval(timer);});
</script>
<svelte:head><title>Set up your account · Coast</title></svelte:head>
<div class="auth-page"><div class="auth-card"><div class="row brand"><Brand /></div>
  {#if !data.linked||data.reconnect}
    <h1>Connect Jellyfin.</h1><p>Use your existing Jellyfin account. Coast will securely save your connection and import your progress.</p>
    {#if !data.services.length}<p class="notice" role="status">An administrator needs to enable a Jellyfin server before you can continue.</p>{:else}
      <form method="POST" action="?/connect" class="stack" use:enhance={()=>{busy=true;return async({update})=>{await update();busy=false;};}}>
        <label class="field">Server<select name="instanceId">{#each data.services as service}<option value={service.id}>{service.name}</option>{/each}</select></label>
        <label class="field">Jellyfin username<input name="username" autocomplete="username" required maxlength="250" /></label>
        <label class="field">Jellyfin password<input name="password" type="password" autocomplete="current-password" maxlength="4096" /></label>
        <Button type="submit" disabled={busy}>{busy?'Connecting…':'Connect and import'}</Button>
      </form>
    {/if}
  {:else}
    <h1>Importing your progress.</h1><p>You can leave this page and return later. Your account will be ready when the initial import finishes.</p>
    {#if data.progress}
    <p role="status">{data.progress.state==='running'?'Import running':data.progress.state==='pending'?'Waiting for import':data.progress.state==='failed'?'Import needs attention':'Finishing import'} · {data.progress.processed} items{data.progress.total!==null?` of ${data.progress.total}`:''}</p>
    {#if data.progress.total}<progress value={data.progress.processed} max={data.progress.total} aria-label="Import progress"></progress>{/if}
    {#if data.progress.error}<p class="notice error" role="alert">{data.progress.error}</p>{/if}
    {#if ['failed','cancelled'].includes(data.progress.state)}<form method="POST" action="?/retry" use:enhance><Button type="submit">Retry import</Button></form><a href="/onboarding?reconnect=1">Reconnect Jellyfin</a>{/if}
    {:else}<p role="status">Waiting for the active Jellyfin task to finish before starting your import.</p>{/if}
  {/if}
  {#if form?.error}<p class="notice error" role="alert">{form.error}</p>{/if}
  <div class="auth-footer"><form method="POST" action="/logout"><Button type="submit" variant="ghost">Sign out</Button></form></div>
</div></div>
