<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
 import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
 import SegmentPanels from '#lib/auth/ui/SegmentPanels.svelte';
 import ProfileFields from '#lib/auth/ui/ProfileFields.svelte';
 import ImportRow from '#lib/auth/ui/ImportRow.svelte';
 import SegmentedControl from '#lib/ui/components/SegmentedControl.svelte';
 import Services from './Services.svelte';
 import {enhance,deserialize} from '$app/forms';
 import {refreshRouteDependencies} from '#lib/ui/client.js';
 import {untrack} from 'svelte';
 import {createResource} from '#lib/ui/resource.svelte.js';
 import Button from '#lib/ui/components/Button.svelte';
 let {data,form}=$props();let busy=$state(false),deviceError=$state('');
 $effect(()=>{if(form&&'device' in form)deviceError='';});
 const device=$derived(form&&'device' in form?form.device??null:null);
 let displayName=$state(untrack(()=>data.profile.displayName===data.username?'':data.profile.displayName??''));
 let bio=$state(untrack(()=>data.profile.bio??''));
 const options=$derived([
   {value:'services',label:'Services',href:'/onboarding?step=services',disabled:data.skipServices||data.step==='imports'&&!data.reconnect},
   {value:'profile',label:'Profile',href:'/onboarding?step=profile',disabled:!data.canContinue||data.background||data.phase==='importing'},
   {value:'imports',label:'Imports',href:'/onboarding?step=imports',disabled:!data.background&&data.phase!=='importing'},
 ]);
 const importPolling = $derived(data.phase==='importing' || data.background && data.imports.some(item=>item.state==='running'||item.state==='pending'));
 const polling = $derived(Boolean(device && !deviceError && !data.traktLinked || importPolling));
 $effect(()=>{
  if (!polling) return;
  let pending=false,nextPoll=0,stopped=false;
  const poll=createResource<ReturnType<typeof deserialize>|null>(null);
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
      if(result?.type==='success'&&result.data?.pending===false){await refreshRouteDependencies(['onboarding']);return;}
     }
    }
    if(!stopped&&!document.hidden&&importPolling)await refreshRouteDependencies(['onboarding']);
   }catch{if(!stopped)deviceError='Connection interrupted. Try connecting again.';}finally{pending=false;}
  };
  const visible=()=>{if(!document.hidden)void refresh();};
  const timer=setInterval(()=>void refresh(),2000);document.addEventListener('visibilitychange',visible);
  return()=>{stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',visible);poll.dispose();};
 });
  reportFailure(()=>(form && 'error' in form ? form.error : '') || deviceError);
  reportFailure(() => data.imports.map(item => item.error).filter(Boolean).join(' '));
</script>
<svelte:head><title>{data.step==='imports'?'Initial imports':'Set up your account'} · Coast</title></svelte:head>
<div class="auth-stack auth-with-side-actions" class:invite-accent={data.invited}>
  <SegmentPanels index={options.findIndex(option=>option.value===data.step)}>
    {#snippet children(index)}
      {@const step=options[index].value}
      <div class="stage">
        <h1 class="sr-only">{options[index].label}</h1>
        {#if step==='services'}
          {#if data.serviceSetup}<Services {data} setup={data.serviceSetup} {device} manualPoll={form && 'manualPoll' in form ? form.manualPoll : undefined} bind:busy/>{/if}
        {:else if step==='profile'}
          <form id="onboarding-profile" action="?/picture" method="POST" use:enhance={({cancel})=>{
            if(busy){cancel();return;}busy=true;return async({update})=>{try{await update({reset:false});}finally{busy=false;}};
          }}><AuthSurface><ProfileFields bind:displayName bind:bio/></AuthSurface></form>
        {:else}
          <AuthSurface>
            {#each data.imports as item (item.kind)}
              {@const reconnect=item.state==='reconnect'||item.error?.startsWith('Reconnect')}
              <ImportRow label={item.label==='Jellyfin'?'Jellyfin library':item.label==='Trakt tracking'?'Trakt activity':item.label}
                provider={item.label==='Jellyfin'?'jellyfin':'trakt'} state={reconnect?'reconnect':item.state} processed={item.processed} total={item.total} stage={item.stage}>
                {#snippet recovery()}
                  {#if reconnect}<Button emphasis="subtle" href={data.background ? (data.libraryOnly ? '/settings/account' : '/settings/connections') : '/onboarding?step=services'} label={'Reconnect '+item.label}>Reconnect</Button>
                  {:else if !('canRetry' in item)||item.canRetry}
                    <form method="POST" action={data.background?'?step=imports&/retryBackground':'?step=imports&/retry'} use:enhance>
                      <input type="hidden" name="kind" value={item.kind}/><Button emphasis="subtle" type="submit" label={'Retry '+item.label}>Retry</Button>
                    </form>
                  {:else}<span class="menu-row-note">Needs attention</span>{/if}
                {/snippet}
              </ImportRow>
            {:else}<div class="menu-row">No imports selected</div>{/each}
          </AuthSurface>
        {/if}
      </div>
    {/snippet}
  </SegmentPanels>
  {#if form && 'error' in form && form.error}<p class="small" role="alert">{form.error}</p>{/if}
  {#if deviceError}<p class="small" role="alert">{deviceError}</p>{/if}
  <nav class="onboarding-nav" aria-label="Onboarding navigation">
    {#if data.step==='profile' && !data.skipServices}
      <AuthSurface anchor><Button href="/onboarding?step=services" size="segment" icon="arrowLeft" label="Back to services" title="Back to services"/></AuthSurface>
    {:else}
      <form method="POST" action="/logout"><AuthSurface anchor><Button size="segment" type="submit" icon="arrowLeft" label="Sign out" title="Sign out"/></AuthSurface></form>
    {/if}
    <AuthSurface anchor><SegmentedControl label="Onboarding progress" options={options} value={data.step} material="clear"/></AuthSurface>
    <AuthSurface anchor>
      {#if data.step==='profile'}
        <Button size="segment" icon="arrow" label="Continue" title="Continue" form="onboarding-profile" type="submit" disabled={busy}/>
      {:else if data.step==='imports'}
        <Button size="segment" icon="arrow" label="Open library" title="Open library" href={data.complete ? '/library' : undefined} disabled={!data.complete}/>
      {:else}
        <Button size="segment" icon="arrow" label="Continue" title="Continue" href={data.canContinue ? (data.phase==='importing'?'/onboarding?step=imports':'/onboarding?step=profile') : undefined} disabled={!data.canContinue}/>
      {/if}
    </AuthSurface>
  </nav>
</div>
<style>
  .stage { display:grid;gap:var(--auth-gap); }
</style>
