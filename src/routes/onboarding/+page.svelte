<script lang="ts">
 import {enhance,deserialize} from '$app/forms';import {invalidate} from '$app/navigation';import {onMount,untrack} from 'svelte';
 import AvatarPicker from '$lib/ui/components/AvatarPicker.svelte';
 import Brand from '$lib/ui/components/Brand.svelte';import Button from '$lib/ui/components/Button.svelte';
 let {data,form}=$props();let busy=$state(false),deviceError=$state(''),avatar=$state<string|null>(untrack(()=>data.profile.avatar??null)),reading=$state(false);
 $effect(()=>{if(form&&'device' in form)deviceError='';});
 const device=$derived(form&&'device' in form?form.device:null);
 const canContinue=$derived(data.requiredProvider==='none'||data.requiredProvider==='jellyfin'&&data.linked||data.requiredProvider==='trakt'&&data.traktLinked||data.requiredProvider==='either'&&(data.linked||data.traktLinked));
 onMount(()=>{let pending=false,nextPoll=0;const timer=setInterval(async()=>{
  if(pending)return;pending=true;
  try{if(device&&!deviceError&&!data.traktLinked&&Date.now()>=nextPoll){nextPoll=Date.now()+device.interval*1000;const body=new FormData();body.set('instanceId',device.instanceId);const result=deserialize(await(await fetch('?/poll',{method:'POST',body,headers:{'x-sveltekit-action':'true'}})).text());if(result.type==='failure')deviceError=String(result.data?.error??'Could not connect Trakt.');if(result.type==='success'&&result.data?.pending===false)await invalidate('coast:onboarding');}
   if(data.phase==='importing')await invalidate('coast:onboarding');
  }catch{deviceError='Connection interrupted. Try connecting again.';}finally{pending=false;}
 },2000);return()=>clearInterval(timer);});
</script>
<svelte:head><title>Set up your account · Coast</title></svelte:head>
<div class="auth-page"><div class="auth-card"><div class="row brand"><Brand /></div>
 {#if data.picture&&data.phase==='connections'}
 <h1>Choose your profile picture.</h1><p>Upload an image, use one from a connected service, or continue without one.</p>
 <form method="POST" action="?/picture" class="stack" use:enhance={()=>{busy=true;return async({update})=>{try{await update();}finally{busy=false;}};}}>
 <AvatarPicker bind:avatar bind:reading name={data.profile.displayName??data.username} disabled={busy} choices={data.avatarChoices} />
 <input type="hidden" name="avatar" value={avatar??''} />
 <Button type="submit" disabled={reading||busy}>{reading?'Preparing image…':data.linked||data.traktLinked?'Import and continue':'Continue'}</Button>
 <a href="/onboarding">Back to connections</a>
 </form>
 {:else if data.phase==='connections'||data.reconnect||data.imports.some(item=>item.error==='Reconnect Trakt to continue.')}
 <h1>Connect your services.</h1><p>Import your history, progress, favourites and saved titles before you start browsing.</p>
 {#if data.requiredProvider!=='none'}<p>{data.requiredProvider==='either'?'Connect Jellyfin or Trakt to continue.':`Connect ${data.requiredProvider==='jellyfin'?'Jellyfin':'Trakt'} to continue.`}</p>{/if}
 {#if data.provisioning&&!data.linked}<form method="POST" action="?/provision" class="stack" use:enhance><p>Your invitation includes a new account on {data.provisioning.name}, using your Coast username.</p><label class="field">Jellyfin password<input type="password" name="password" minlength="8" maxlength="128" required autocomplete="new-password"/></label><label class="field">Confirm Jellyfin password<input type="password" name="passwordConfirmation" required autocomplete="new-password"/></label><p class="small">Use uppercase, lowercase and a special character. This password is sent to Jellyfin and is not stored by Coast.</p><Button type="submit" disabled={['creating','uncertain'].includes(data.provisioning.state)}>Create Jellyfin account</Button>{#if ['creating','uncertain'].includes(data.provisioning.state)}<p class="notice">Administrator review is needed before another creation attempt. You can connect an existing reviewed account below.</p>{/if}</form>{/if}
 {#if data.linked}<p role="status">Jellyfin connected.</p>{:else if data.services.length}
 <form method="POST" action="?/connect" class="stack" use:enhance={()=>{busy=true;return async({update})=>{try{await update();}finally{busy=false;}};}}>
 <label class="field">Jellyfin server<select name="instanceId">{#each data.services as service}<option value={service.id}>{service.name}</option>{/each}</select></label>
 <label class="field">Jellyfin username<input name="username" autocomplete="username" required maxlength="250" /></label>
 <label class="field">Jellyfin password<input name="password" type="password" autocomplete="current-password" maxlength="4096" /></label>
 <Button type="submit" disabled={busy}>Connect Jellyfin</Button></form>
 {:else if data.requiredProvider==='jellyfin'}<p class="notice">An administrator needs to enable a Jellyfin server.</p>{/if}
 {#if data.traktLinked}<p role="status">Trakt connected.</p>{:else if data.traktServices.length}
 {#if device}<p>Enter <strong>{device.userCode}</strong> on <a href={device.verificationUrl} target="_blank" rel="noreferrer">Trakt</a>. Waiting for authorization…</p>
 {/if}<form method="POST" action="?/trakt" class="stack" use:enhance><label class="field">Trakt service<select name="instanceId">{#each data.traktServices as service}<option value={service.id}>{service.name}</option>{/each}</select></label><Button type="submit">{device?'New Trakt code':'Connect Trakt'}</Button></form>
 {:else if data.requiredProvider==='trakt'}<p class="notice">An administrator needs to enable Trakt.</p>{/if}
 {#if data.phase==='connections'}<Button href="/onboarding?step=picture" disabled={!canContinue}>Continue</Button>{:else}<form method="POST" action="?/begin" use:enhance><Button type="submit" disabled={!canContinue}>Continue import</Button></form>{/if}
 {:else}<h1>Importing your data.</h1><p>You can leave this page and return later. Your account opens when these imports finish.</p>
 {#each data.imports as item}<div class="stack"><p role="status">{item.label}: {item.state==='succeeded'?'Complete':item.state==='running'?item.stage:['failed','cancelled'].includes(item.state)?'Needs attention':item.processed?'Waiting to resume':'Queued'}{item.state==='running'||item.processed?item.total!==null?` · ${item.processed} of ${item.total} items`:item.processed?` · ${item.processed} items`:'':''}</p>{#if item.total&&item.state!=='succeeded'}<progress value={item.processed} max={item.total} aria-label={`${item.label}: ${item.stage}`}></progress>{/if}{#if item.error}<p class="notice error">{item.error}</p>{/if}</div>{/each}
 {#if data.imports.some(item=>['failed','cancelled'].includes(item.state))}<form method="POST" action="?/retry" use:enhance><Button type="submit">Retry import</Button></form>{/if}
 {/if}
 {#if form&&'error' in form&&form.error}<p class="notice error" role="alert">{form.error}</p>{/if}{#if deviceError}<p class="notice error">{deviceError}</p>{/if}
 <div class="auth-footer"><form method="POST" action="/logout"><Button type="submit" emphasis="subtle">Sign out</Button></form></div>
</div></div>
