<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
 import OperationProgress from '#lib/ui/components/OperationProgress.svelte';
 import {enhance,deserialize} from '$app/forms';import {refreshRouteDependencies} from '#lib/ui/client.js';import {onMount,untrack} from 'svelte';
 import AvatarPicker from '#lib/ui/components/AvatarPicker.svelte';
 import AccessFields from '#lib/providers/trakt/AccessFields.svelte';
 import {defaultTraktAccess} from '#lib/providers/trakt/access.js';
 import {createResource} from '#lib/ui/resource.svelte.js';
 import Brand from '#lib/ui/components/Brand.svelte';import Button from '#lib/ui/components/Button.svelte';
 let {data,form}=$props();let busy=$state(false),deviceError=$state(''),avatar=$state<string|null>(untrack(()=>data.profile.avatar??null)),reading=$state(false);
 $effect(()=>{if(form&&'device' in form)deviceError='';});
 const device=$derived(form&&'device' in form?form.device:null);
 let access=$state({...defaultTraktAccess});
 const canContinue=$derived(data.requiredProvider==='none'||data.requiredProvider==='jellyfin'&&data.linked||data.requiredProvider==='trakt'&&data.traktLinked||data.requiredProvider==='either'&&(data.linked||data.traktLinked));
 onMount(()=>{let pending=false,nextPoll=0,stopped=false;const poll=createResource<ReturnType<typeof deserialize>|null>(null);
  const refresh=async()=>{
   if(stopped||pending)return;pending=true;
   try{const currentDevice=device;
    if(currentDevice&&!deviceError&&!data.traktLinked&&Date.now()>=nextPoll){
     nextPoll=Date.now()+currentDevice.interval*1000;const body=new FormData();body.set('instanceId',currentDevice.instanceId);body.set('challengeId',currentDevice.challengeId);
     const result=await poll.load(async signal=>{
      const response=await fetch('?/poll',{method:'POST',body,headers:{'x-sveltekit-action':'true'},signal});signal.throwIfAborted();
      const text=await response.text();signal.throwIfAborted();return deserialize(text);
     });
     if(stopped)return;
     if(device===currentDevice){
      if(result===undefined&&poll.error)throw Error(poll.error);
      if(result?.type==='failure')deviceError=String(result.data?.error??'Could not connect Trakt.');
      if(result?.type==='success'&&result.data?.pending===false)await refreshRouteDependencies(['onboarding']);
     }
    }
    if(!stopped&&!document.hidden&&(data.phase==='importing'||data.background&&data.imports.some(item=>item.state==='running'||item.state==='pending')))await refreshRouteDependencies(['onboarding']);
   }catch{if(!stopped)deviceError='Connection interrupted. Try connecting again.';}finally{pending=false;}
  };
  const visible=()=>{if(!document.hidden)void refresh();};
  const timer=setInterval(()=>void refresh(),2000);document.addEventListener('visibilitychange',visible);
  return()=>{stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',visible);poll.dispose();};
 });
  reportFailure(()=>(form && 'error' in form ? form.error : '') || deviceError);
  reportFailure(() => data.imports.map(item => item.error).filter(Boolean).join(' '));
</script>
<svelte:head><title>{data.background?'Initial imports':'Set up your account'} · Coast</title></svelte:head>
<div class="auth-page"><div class="auth-card"><div class="row brand"><Brand /></div>
 {#if data.background}
 <h1>Initial imports</h1>
 {#if !data.imports.length}<p>No initial imports are available for this account.</p>{/if}
 {@render importRows()}
 {#if data.imports.some(item=>'canRetry' in item&&item.canRetry)}
   <form method="POST" action="?step=imports&/retryBackground" use:enhance><Button type="submit">Retry imports</Button></form>
 {/if}
 <Button href="/library" emphasis="subtle">Back to Library</Button>
 {:else if data.picture&&data.phase==='connections'}
 <h1>Choose your profile picture.</h1><p>Upload an image, use one from a connected service, or continue without one.</p>
 <form method="POST" action="?/picture" class="stack" use:enhance={()=>{busy=true;return async({update})=>{try{await update();}finally{busy=false;}};}}>
 <AvatarPicker bind:avatar bind:reading name={data.profile.displayName??data.username} disabled={busy} choices={data.avatarChoices} />
 <input type="hidden" name="avatar" value={avatar??''} />
 <Button type="submit" disabled={reading||busy}>{reading?'Preparing image…':'Continue'}</Button>
 <a href="/onboarding">Back to connections</a>
 </form>
 {:else if data.phase==='connections'||data.reconnect||data.imports.some(item=>item.error==='Reconnect Trakt to continue.')}
 <h1>Connect your services.</h1><p>Import your history, progress, favourites and saved titles before you start browsing.</p>
 {#if data.requiredProvider!=='none'}<p>{data.requiredProvider==='either'?'Connect Jellyfin or Trakt to continue.':`Connect ${data.requiredProvider==='jellyfin'?'Jellyfin':'Trakt'} to continue.`}</p>{/if}
 {#if data.provisioning&&!data.linked}<form method="POST" action="?/provision" class="stack" use:enhance><p>Your invitation includes a new account on {data.provisioning.name}, using your Coast username.</p><label class="field">Coast password<input type="password" name="password" minlength="8" maxlength="128" required autocomplete="current-password"/></label><Button type="submit" disabled={!data.provisioning.canRetry&&['creating','uncertain'].includes(data.provisioning.state)}>{data.provisioning.state==='configuring'?'Finish Jellyfin setup':data.provisioning.failed?'Retry Jellyfin setup':'Create Jellyfin account'}</Button>{#if !data.provisioning.canRetry&&['creating','uncertain'].includes(data.provisioning.state)}<p class="small">Contact an administrator to review this account before retrying.</p>{/if}</form>{/if}
 {#if data.linked}<p role="status">Jellyfin connected.</p>{:else if data.services.length}
 <form method="POST" action="?/connect" class="stack" use:enhance={()=>{busy=true;return async({update})=>{try{await update();}finally{busy=false;}};}}>
 <label class="field">Jellyfin server<select name="instanceId">{#each data.services as service}<option value={service.id}>{service.name}</option>{/each}</select></label>
 <label class="field">Jellyfin username<input name="username" autocomplete="username" required maxlength="250" /></label>
 <label class="field">Jellyfin password<input name="password" type="password" autocomplete="current-password" maxlength="4096" /></label>
 <Button type="submit" disabled={busy}>Connect Jellyfin</Button></form>
 {:else if data.requiredProvider==='jellyfin'}<p class="small">An administrator needs to enable a Jellyfin server.</p>{/if}
 {#if data.traktLinked}<p role="status">Trakt connected.</p>{:else if data.traktServices.length}
 {#if device}<p>Enter <strong>{device.userCode}</strong> on <a href={device.verificationUrl} target="_blank" rel="noreferrer">Trakt</a>. Waiting for authorization…</p>
   <a href="/onboarding" data-sveltekit-reload>Start again</a>
 {:else}
   <form method="POST" action="?/trakt" class="stack" use:enhance={() => { busy=true; return async ({update}) => { try { await update(); } finally { busy=false; } }; }}>
     <label class="field">Trakt service<select name="instanceId">{#each data.traktServices as service}<option value={service.id}>{service.name}</option>{/each}</select></label>
     <AccessFields bind:access disabled={busy} />
     <Button type="submit" disabled={busy}>Connect Trakt</Button>
   </form>
 {/if}
 {:else if data.requiredProvider==='trakt'}<p class="small">An administrator needs to enable Trakt.</p>{/if}
 {#if data.phase==='connections'}<Button href="/onboarding?step=picture" disabled={!canContinue}>Continue</Button>{:else}<form method="POST" action="?/begin" use:enhance><Button type="submit" disabled={!canContinue}>Continue import</Button></form>{/if}
 {:else}<h1>Importing your data.</h1><p>You can leave this page and return later. Library opens when your account is ready. Some imports can continue in the background.</p>
 {@render importRows()}
 {#if data.imports.some(item=>['failed','cancelled'].includes(item.state))}<form method="POST" action="?/retry" use:enhance><Button type="submit">Retry import</Button></form>{/if}
 {/if}

 <div class="auth-footer"><form method="POST" action="/logout"><Button type="submit" emphasis="subtle">Sign out</Button></form></div>
</div></div>

{#snippet importRows()}
 {#each data.imports as item}<div class="stack"><p role="status">{item.label}: {item.state==='succeeded'?'Complete':item.state==='reconnect'?'Reconnect this account to continue':item.state==='running'?item.stage:['failed','cancelled'].includes(item.state)?'Needs attention':item.processed?'Waiting to resume':'Queued'}{item.state==='running'||item.processed?item.total!==null?` · ${item.processed} of ${item.total} items`:item.processed?` · ${item.processed} items`:'':''}</p>{#if item.state==='running'}<OperationProgress processed={item.processed} total={item.total} label={`${item.label}: ${item.stage}`} />{/if}</div>{/each}
{/snippet}
