<script lang="ts">
  import { enhance } from '$app/forms';
  import { onMount, untrack } from 'svelte';
  type SubmitFunction = NonNullable<Parameters<typeof enhance>[1]>;
  import type { ActionData, PageData } from './$types';
  import JellyfinFields from '#lib/auth/ui/JellyfinFields.svelte';
  import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
  import ServiceDisclosure from '#lib/auth/ui/ServiceDisclosure.svelte';
  import ServiceHeader from '#lib/auth/ui/ServiceHeader.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import Icon from '#lib/ui/components/Icon.svelte';
  import Field from '#lib/ui/components/Field.svelte';
  import PairingCode from '#lib/providers/trakt/PairingCode.svelte';
  import AccessFields from '#lib/providers/trakt/AccessFields.svelte';
  import { beginTraktActivation, traktActivationUrl } from '#lib/providers/trakt/activation.js';
  let {data,setup,device,manualPoll,busy=$bindable(false)}:{
    manualPoll?:{instanceId:string;challengeId:string};
    data:PageData;setup:NonNullable<PageData['serviceSetup']>;device:NonNullable<Extract<NonNullable<ActionData>,{device:unknown}>['device']>|null;busy?:boolean;
  }=$props();
  let hydrated=$state(false), jellyfinOpen=$state(false), traktOpen=$state(false), creating=$state(false);
  let name=$state(''), url=$state(''), traktForm=$state<HTMLFormElement>();
  let sync=$state(untrack(()=>structuredClone(setup.connections.sync)));
  let server=$state(untrack(()=>setup.services[0]?.id ?? ''));
  const assigned=$derived(setup.provisioning?.state==='complete');
  const canCreate=$derived(setup.provisioning && !data.linked && !assigned);
  const existing=$derived(setup.services.length>0 && (!canCreate || setup.connections.inviteAccount==='choice'));
  const showJellyfin=$derived(data.linked ? !assigned : canCreate || existing || data.requiredProvider==='jellyfin');
  const required=(service:'jellyfin'|'trakt')=>data.requiredProvider===service?'Required':data.requiredProvider==='either'&&!data.canContinue?'One required':'Optional';
  const validUrl=$derived(/^https?:\/\//i.test(url)&&URL.canParse(url));
  const useUrl=$derived(setup.allowServerUrl && server==='url');
  let wasTraktLinked=untrack(()=>data.traktLinked);
  $effect(()=>{
    const linked=data.traktLinked;
    if(linked===wasTraktLinked)return;
    wasTraktLinked=linked;
    traktOpen=linked;
  });
  onMount(()=>{hydrated=true;jellyfinOpen=data.reconnect&&!data.linked||!!setup.provisioning?.failed;});
  const submit:SubmitFunction=({cancel})=>{
    if(busy){cancel();return;}busy=true;
    return async({update})=>{try{await update({reset:false});}finally{busy=false;}};
  };
  const pair:SubmitFunction=({cancel,controller})=>{
    if(busy){cancel();return;}busy=true;
    const activate=beginTraktActivation();
    const abandon=()=>{void activate(null);};controller.signal.addEventListener('abort',abandon,{once:true});
    return async({result,update})=>{
      try{void activate(result.type==='success'&&result.data?.device ? result.data.device as NonNullable<typeof device> : null);await update({reset:false,invalidateAll:false});}
      finally{controller.signal.removeEventListener('abort',abandon);busy=false;}
    };
  };
</script>

{#snippet unlink(service:'jellyfin'|'trakt',id:string)}
  <form class="auth-side-action centered" method="POST" action="?/disconnect" use:enhance={submit}>
    <input type="hidden" name="service" value={service}/><input type="hidden" name="connectionId" value={id}/>
    <Button type="submit" size="icon" emphasis="subtle" icon="minusCircle" danger disabled={busy} label={'Disconnect '+(service==='jellyfin'?'Jellyfin':'Trakt')}/>
  </form>
{/snippet}
{#if showJellyfin}
  <section aria-label="Jellyfin">
    <div class="auth-action-frame">
      <ServiceHeader provider="jellyfin" note={data.linked?'Connected':required('jellyfin')} username={setup.connections.jellyfinName}
        expanded={data.linked?undefined:jellyfinOpen} controls={data.linked?undefined:'service-jellyfin'}
        onactivate={data.linked?undefined:()=>jellyfinOpen=!jellyfinOpen}/>
      {#if data.linked && !assigned && setup.connections.jellyfinId}{@render unlink('jellyfin',setup.connections.jellyfinId)}{/if}
    </div>
    {#if !data.linked}
      <ServiceDisclosure id="service-jellyfin" expanded={!hydrated||jellyfinOpen}>
        {#if canCreate && setup.provisioning}
          {#if setup.connections.inviteAccount==='choice' && !creating && hydrated && !setup.provisioning.failed}
            <AuthSurface><button class="menu-row" onclick={()=>creating=true}><Icon name="user"/>Create one for me</button></AuthSurface>
          {:else}
            <form class="auth-action-frame" method="POST" action="?/provision" use:enhance={submit}>
              <AuthSurface><Field label="Coast password" hideLabel class="menu-row" validation={{state:'info',message:'Confirm your Coast password to set up your invited Jellyfin account.'}}>
                <Icon name="key"/><input name="password" type="password" placeholder="Coast password" autocomplete="current-password" required maxlength="128"/>
              </Field></AuthSurface>
              <div class="auth-side-action"><AuthSurface anchor><Button type="submit" size="segment" icon="link" label="Set up Jellyfin" disabled={busy||(!setup.provisioning.canRetry&&['creating','uncertain'].includes(setup.provisioning.state))}/></AuthSurface></div>
            </form>
            {#if !setup.provisioning.canRetry&&['creating','uncertain'].includes(setup.provisioning.state)}<p class="small">An administrator needs to review the previous setup attempt.</p>{/if}
          {/if}
        {/if}
        {#if existing}
          <form class="fields" method="POST" action="?/connect" use:enhance={submit}>
            {#if setup.services.length>1 || setup.allowServerUrl}
              <AuthSurface><Field class="menu-row" label="Jellyfin server" hideLabel>
                <Icon name="server"/><select aria-label="Jellyfin server" name={useUrl?undefined:'instanceId'} bind:value={server}>
                  {#each setup.services as service}<option value={service.id}>{service.name}</option>{/each}
                  {#if setup.allowServerUrl}<option value="url">Enter server URL</option>{/if}
                </select>
              </Field></AuthSurface>
            {:else}<input type="hidden" name="instanceId" value={setup.services[0]?.id}/>{/if}
            {#if useUrl}<AuthSurface><JellyfinFields mode="server" bind:serverUrl={url}/></AuthSurface>{/if}
            <div class="auth-action-frame"><AuthSurface>
              <JellyfinFields mode="credentials" bind:jellyfinName={name}/>
            </AuthSurface><div class="auth-side-action"><AuthSurface anchor>
              <Button size="segment" type="submit" icon="link" iconSize={16} label="Connect Jellyfin" disabled={busy||hydrated&&(!name.trim()||useUrl&&!validUrl)}/>
            </AuthSurface></div></div>
          </form>
        {:else if !canCreate}<p class="small">Ask an administrator to enable your Jellyfin server.</p>{/if}
      </ServiceDisclosure>
    {/if}
  </section>
{/if}

{#if !data.libraryOnly && (setup.traktServices.length || data.traktLinked)}
  <section aria-label="Trakt">
    <div class="auth-action-frame">
      {#if device && !data.traktLinked}
        <ServiceHeader provider="trakt" note="" activateLabel="Waiting for approval" activationUrl={traktActivationUrl(device.verificationUrl)}>
          {#snippet trailing()}<PairingCode code={device.userCode}/>{/snippet}
        </ServiceHeader>
        <div class="auth-side-action centered"><Button size="icon" icon="retry" label="Retry Trakt connection" disabled={busy} onclick={()=>traktForm?.requestSubmit()}/></div>
      {:else}
        <ServiceHeader provider="trakt" activateLabel={data.traktLinked?'Trakt':'Connect Trakt'} note={data.traktLinked?'Connected':required('trakt')}
          expanded={data.traktLinked?traktOpen:undefined} controls={data.traktLinked?'trakt-preferences':undefined} username={setup.connections.traktName}
          onactivate={()=>{if(data.traktLinked)traktOpen=!traktOpen;else traktForm?.requestSubmit();}}/>
      {/if}
      {#if data.traktLinked && setup.connections.traktId}{@render unlink('trakt',setup.connections.traktId)}{/if}
    </div>
    {#if !data.traktLinked && (device || manualPoll)}
      {@const pending=device ?? manualPoll!}
      <noscript><form method="POST" action="?/poll">
        <input type="hidden" name="manual" value="1"/>
        <input type="hidden" name="instanceId" value={pending.instanceId}/>
        <input type="hidden" name="challengeId" value={pending.challengeId}/>
        <Button type="submit">Check approval</Button>
      </form></noscript>
    {/if}
    {#if !data.traktLinked}
      <form bind:this={traktForm} method="POST" action="?/trakt" use:enhance={pair}>
        {#if !device && setup.traktServices.length>1}
          <AuthSurface><Field label="Trakt service" class="menu-row"><select name="instanceId">{#each setup.traktServices as service}<option value={service.id}>{service.name}</option>{/each}</select></Field></AuthSurface>
        {:else}<input type="hidden" name="instanceId" value={device?.instanceId ?? setup.traktServices[0]?.id}/>{/if}
        <div hidden><AccessFields bind:sync form/></div>
        <noscript><Button type="submit">Connect Trakt</Button></noscript>
      </form>
    {/if}
    <ServiceDisclosure id="trakt-preferences" expanded={data.traktLinked && (!hydrated||traktOpen)}>
      {#if data.traktLinked}
        <form class="preferences" method="POST" action="?/preferences" use:enhance={submit}>
          <input type="hidden" name="generation" value={setup.connections.traktGeneration}/>
          <AccessFields bind:sync form disabled={busy}>
            {#snippet group(rows)}<AuthSurface>{@render rows()}</AuthSurface>{/snippet}
          </AccessFields>
          <div class="preferences-action"><AuthSurface anchor><Button type="submit" size="segment" disabled={busy}>Save preferences</Button></AuthSurface></div>
        </form>
      {/if}
    </ServiceDisclosure>
  </section>
{:else if data.requiredProvider==='trakt'}<p class="small">An administrator needs to enable Trakt.</p>{/if}
<style>
  .fields { display:grid; gap:var(--auth-gap); }
  .preferences { display: grid; gap: var(--auth-gap); }
  .preferences-action { justify-self: end; }
  select { flex:1; min-width:0; color:inherit; font:inherit; }
</style>
