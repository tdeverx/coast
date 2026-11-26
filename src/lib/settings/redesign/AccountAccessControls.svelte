<script lang="ts">
  import SettingsChoice from '#lib/settings/SettingsChoice.svelte';
  import {onDestroy} from 'svelte';
  import { message } from '#lib/ui/client.js';
  import { useClient } from '#lib/ui/client-context.js';
  const { api, feedback:actionFeedback } = useClient('current-viewer');
  import {createResource} from '#lib/ui/resource.svelte.js';
  import type {accountDetails,changeMemberAccess} from '#lib/server/auth/account-management.server.js';
  import type {listInvitePresets} from '#lib/server/auth/invites.server.js';
  import Dialog from '#lib/ui/components/Dialog.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import Heading from '#lib/ui/components/Heading.svelte';
  import {emptyInviteDefaults,type InviteDefaults} from '#lib/auth/invites.js';
  import InviteDefaultsFields from './InviteDefaultsFields.svelte';

  let {userId,selection=[],inline=false,onclose,onchange}:{userId?:string;selection?:string[];inline?:boolean;onclose:()=>void;onchange:()=>void}=$props();
  const detail=createResource<Awaited<ReturnType<typeof accountDetails>>|null>(null);
  const presets=createResource<Awaited<ReturnType<typeof listInvitePresets>>>([]);
  type Preview=Extract<Awaited<ReturnType<typeof changeMemberAccess>>,{versions:unknown}>;
  let preview=$state<Preview|null>(null);
  let opened=true;
  let busy=$state(false),expiry=$state(''),remoteId=$state(''),preset=$state(''),memberPreset=$state(''),quota=$state(3);
  const target=$derived(detail.data);
  let draft=$state<InviteDefaults>(structuredClone(emptyInviteDefaults));
  let custom=$state(false);
  type AccessInput={users:string[];presetId?:string;defaults?:InviteDefaults};
  let reviewed=$state<AccessInput|null>(null);
  const draftSignature=$derived(JSON.stringify(draft));
  const reviewMatches=$derived(!custom || JSON.stringify(reviewed?.defaults)===draftSignature);

  function editDirectly() {
    if(!target)return;
    draft=structuredClone($state.snapshot(target.defaults??emptyInviteDefaults));
    draft.access=structuredClone($state.snapshot(target.access));
    draft.sharingGrant=target.sharingGranted&&target.access.sharing!==false&&!target.access.libraryOnly ? true : undefined;
    if(target.provisioning==='complete'&&target.authority){
      draft.account='managed';
      draft.connectionId=target.authority;
    }
    preview=null;
    custom=true;
  }

  function accessChanges(before:Record<string,unknown>,after:Record<string,unknown>) {
    return [...new Set([...Object.keys(before),...Object.keys(after)])]
      .filter(key=>JSON.stringify(before[key])!==JSON.stringify(after[key]))
      .map(key=>({key,before:before[key],after:after[key]}));
  }

  const displayValue=(value:unknown)=>value==null?'Default':Array.isArray(value)?value.map(item=>
    typeof item==='object'?JSON.stringify(item):String(item)).join(', ')||'None':String(value);
  const load=async (id:string) => {
    const result=await detail.load(signal=>api('admin/members/'+id,undefined,'GET',{signal}));
    if(!result)return;
    const date=result.expiresAt ? new Date(result.expiresAt) : null;
    expiry=date ? new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
    memberPreset=result.memberPreset??'';quota=result.quota??3;
  };
  $effect(()=>{
    if(userId)void load(userId);
    void presets.load(signal=>api('admin/invites/presets',undefined,'GET',{signal}));
    return ()=>{detail.cancel();presets.cancel();};
  });
  onDestroy(()=>{opened=false;detail.dispose();presets.dispose();});
  async function mutate(work:()=>Promise<unknown>,text:string,refresh=true) {
    if(busy)return;
    busy=true;
    try {
      await work();actionFeedback.notify(text);
      if(refresh && opened){if(userId)await load(userId);onchange();}
    } catch(cause){actionFeedback.failure(message(cause));}
    finally{busy=false;}
  }
  function action(value:string,expiresAt?:string|null){
    return mutate(()=>api('admin/members/'+userId,{action:value,expiresAt},'POST'),'Account updated.');
  }
  async function previewAccess(){
    if(busy)return;
    busy=true;preview=null;
    const input:AccessInput={users:userId?[userId]:[...selection],
      ...(custom ? {defaults:$state.snapshot(draft)} : {presetId:preset})};
    try{
      preview=await api<Preview>('admin/members/access',input,'POST');
      reviewed=input;
    }
    catch(cause){actionFeedback.failure(message(cause));}
    finally{busy=false;}
  }
</script>

{#if inline}
  <section class="stack" aria-label={userId ? 'Account details' : 'Apply access preset'}>
    {@render accessEditor()}
    {#if !userId}<Button size="segment" emphasis="subtle" onclick={onclose}>Close access review</Button>{/if}
  </section>
{:else}
  <Dialog open={true} title={userId ? target?.username ?? 'Account details' : 'Apply access preset'} {onclose}>
    {@render accessEditor()}
  </Dialog>
{/if}

{#snippet accessEditor()}
  {#if target}
    <div class="stack">
      <p>{target.source}{target.inviter? ' · Invited by '+target.inviter : ''} · {target.role} · {target.disabled?'Suspended':target.expired?'Expired':'Active'}</p>
      {#if target.presetName}<p>Issued with {target.presetName}</p>{/if}
      <p>Last active {target.lastActiveAt ? new Date(target.lastActiveAt).toLocaleString() : 'unknown'}</p>
      {#if target.setupStarted}<p>Onboarding {target.readyAt?'complete':'in progress'}</p>{/if}
      {#if target.provisioning}
        <p>Managed Jellyfin · {target.remoteFailure ? 'Action failed' : target.remoteState||target.provisioning}</p>
      {/if}
      {#each target.connections as connection}
        <p>{connection.name} · {connection.username??'Unlinked'} · {connection.status}</p>
      {/each}
      {#if target.defaults}
        <details><summary>Jellyfin settings applied in Coast</summary>
          <p>{target.defaults.jellyfin.EnableAllFolders?'All libraries':target.defaults.folders.length+' assigned libraries'}</p>
          <ul>{#each Object.entries(target.defaults.jellyfin) as [key,value] (key)}<li>{key} · {displayValue(value)}</li>{/each}</ul>
        </details>
      {/if}
      {#if Object.keys(target.access).length}<p>Coast access · {Object.entries(target.access).map(([key,value])=>key+' '+(value?'on':'off')).join(', ')}</p>{/if}
      <div class="row"><Button emphasis="subtle" disabled={busy} onclick={()=>action('revoke-sessions')}>Revoke Coast sessions and tokens</Button></div>
      {#if target.role==='user'}
        <form class="row" onsubmit={event=>{event.preventDefault();void action('membership',expiry?new Date(expiry).toISOString():null);}}>
          <label class="field">Membership expiry<input type="datetime-local" bind:value={expiry} /></label>
          <Button type="submit" disabled={busy}>Save expiry</Button>
        </form>
        {#if target.remote && target.provisioning==='complete'}
          <div class="row">
            <Button emphasis="subtle" disabled={busy} onclick={()=>action('jellyfin-disable')}>Suspend Jellyfin and revoke sessions</Button>
            <Button emphasis="subtle" disabled={busy||target.expired} onclick={()=>action('jellyfin-restore')}>Restore Jellyfin</Button>
          </div>
        {:else if !target.remote && ['creating','uncertain'].includes(target.provisioning??'')}
          <form class="stack" onsubmit={event=>{event.preventDefault();void mutate(()=>api('admin/members/'+userId+'/review',{remoteId},'POST'),'Account confirmed. The member can finish setup.');}}>
            <p>Check the creation on Jellyfin, then confirm its exact user ID.</p>
            <label class="field">Reviewed Jellyfin user ID<input bind:value={remoteId} required maxlength="36" /></label>
            <div class="row"><Button type="submit" disabled={busy}>Confirm and allow retry</Button>
              <Button emphasis="subtle" disabled={busy} onclick={()=>mutate(()=>api('admin/members/'+userId+'/review',{verifiedAbsent:true},'POST'),
                'Creation retry approved.')}>I verified no account was created</Button>
            </div>
          </form>
        {/if}
        <Heading title="Member invites" />
        <form class="row" onsubmit={event=>{event.preventDefault();void mutate(()=>api('admin/invites/grant/'+userId,{presetId:memberPreset||null,limit:quota},'POST'),'Invite grant updated.');}}>
          <SettingsChoice label="Preset" icon="ticket" bind:value={memberPreset}
            options={[{ id: '', label: 'Member invites disabled' }, ...presets.data.map(item => ({ id: item.id, label: item.name }))]} disabled={busy} />
          <label class="field">Quota per 30 days<input type="number" min="1" max="50" bind:value={quota} required /></label>
          <Button type="submit" disabled={busy}>Save grant</Button>
        </form>
      {/if}
      {#if target.audit.length}<details><summary>Recent account activity</summary><ul>{#each target.audit as item (item.id)}
        <li>{new Date(item.createdAt).toLocaleString()} · {item.event}</li>{/each}</ul></details>{/if}
    </div>
  {:else if userId}<p role="status">{detail.error||'Loading account…'}</p>{/if}
  {#if !userId || target?.role==='user'}
    <div class="stack">
      <Heading title="Apply access" />
      {#if !userId}<p>{selection.length} selected accounts</p>{/if}
      {#if userId}
        <div class="row">
          {#if custom}<Button emphasis="subtle" onclick={()=>{custom=false;preview=null;}}>Use a preset</Button>
          {:else}<Button emphasis="subtle" onclick={editDirectly}>Edit access directly</Button>{/if}
        </div>
      {/if}
      <form class="stack" onsubmit={event=>{event.preventDefault();void previewAccess();}}>
        {#if custom}
          <InviteDefaultsFields bind:defaults={draft} accessOnly />
        {:else}
          <SettingsChoice label="Preset" icon="ticket" bind:value={preset} onchange={()=>preview=null}
            options={[{ id: '', label: 'Choose a preset' }, ...presets.data.map(item => ({ id: item.id, label: item.name }))]} disabled={busy} />
        {/if}
        <div class="row"><Button type="submit" disabled={busy||!custom&&!preset}>Preview changes</Button></div>
      </form>
      {#if preview}
        {#if preview.changes.some(item=>item.jellyfin)}<p>Jellyfin access changes take effect after verification.</p>{/if}
        <ul>
          {#each preview.changes as item (item.id)}
            <li><strong>{item.username}</strong>
              {@render changesList({...item.before,'Playback sharing grant':item.sharing.before},{...item.after,'Playback sharing grant':item.sharing.after})}
              {#if item.jellyfin}
                {@render changesList({...item.jellyfin.before,Libraries:item.jellyfin.foldersBefore},{...item.jellyfin.after,Libraries:item.jellyfin.foldersAfter})}
                {@render changesList(item.jellyfin.preferencesBefore,item.jellyfin.preferencesAfter)}
              {/if}
            </li>
          {/each}
        </ul>
        <div class="row"><Button disabled={busy||!reviewMatches} onclick={()=>mutate(async()=>{
          if(!preview||!reviewed||!reviewMatches)return;
          await api('admin/members/access',{...$state.snapshot(reviewed),confirm:preview.versions},'POST');
          preview=null;
        },'Access changes saved.')}>Apply reviewed changes</Button></div>
      {/if}
    </div>
  {/if}
{/snippet}


{#snippet changesList(before:Record<string,unknown>,after:Record<string,unknown>)}
  {@const changes=accessChanges(before,after)}
  {#if changes.length}
    <ul>{#each changes as change (change.key)}
      <li>{change.key} · {displayValue(change.before)} → {displayValue(change.after)}</li>
    {/each}</ul>
  {/if}
{/snippet}
