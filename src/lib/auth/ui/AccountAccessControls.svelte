<script lang="ts">
  import {onDestroy} from 'svelte';
  import {api,message} from '#lib/ui/client.js';
  import {actionFeedback} from '#lib/ui/action-feedback.svelte.js';
  import {createResource} from '#lib/ui/resource.svelte.js';
  import type {accountDetails,changeMemberAccess} from '#lib/server/auth/account-management.server.js';
  import type {listInvitePresets} from '#lib/server/auth/invites.server.js';
  import Button from '#lib/ui/components/Button.svelte';
  import Dialog from '#lib/ui/components/Dialog.svelte';
  import Heading from '#lib/ui/components/Heading.svelte';

  let {userId,selection=[],onclose,onchange}:{userId?:string;selection?:string[];onclose:()=>void;onchange:()=>void}=$props();
  const detail=createResource<Awaited<ReturnType<typeof accountDetails>>|null>(null);
  const presets=createResource<Awaited<ReturnType<typeof listInvitePresets>>>([]);
  type Preview=Extract<Awaited<ReturnType<typeof changeMemberAccess>>,{versions:unknown}>;
  let preview=$state<Preview|null>(null);
  let opened=$state(true),busy=$state(false),expiry=$state(''),remoteId=$state(''),preset=$state(''),memberPreset=$state(''),quota=$state(3);
  const target=$derived(detail.data);
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
  onDestroy(()=>{detail.dispose();presets.dispose();});
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
    try{preview=await api<Preview>('admin/members/access',{users:userId?[userId]:selection,presetId:preset},'POST');}
    catch(cause){actionFeedback.failure(message(cause));}
    finally{busy=false;}
  }
</script>

<Dialog bind:open={opened} title={userId ? target?.username??'Account details' : 'Apply access preset'} {onclose}>
  {#if target}
    <div class="stack">
      <p>{target.source}{target.inviter? ' · Invited by '+target.inviter : ''} · {target.role} · {target.disabled?'Suspended':target.expired?'Expired':'Active'}</p>
      <p>Last active {target.lastActiveAt ? new Date(target.lastActiveAt).toLocaleString() : 'unknown'}</p>
      {#if target.setupStarted}<p>Onboarding {target.readyAt?'complete':'in progress'}</p>{/if}
      {#if target.provisioning}
        <p>Managed Jellyfin · {target.remoteFailure ? 'Action failed' : target.remoteState||target.provisioning}</p>
      {/if}
      {#each target.connections as connection}
        <p>{connection.name} · {connection.username??'Unlinked'} · {connection.status}</p>
      {/each}
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
          <label class="field">Preset<select bind:value={memberPreset}>
            <option value="">Member invites disabled</option>{#each presets.data as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
          </select></label>
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
      <form class="row" onsubmit={event=>{event.preventDefault();void previewAccess();}}>
        <label class="field">Preset<select bind:value={preset} onchange={()=>preview=null} required>
          <option value="">Choose a preset</option>{#each presets.data as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
        </select></label>
        <Button type="submit" disabled={busy||!preset}>Preview changes</Button>
      </form>
      {#if preview}
        <ul>
        {#each preview.changes as item (item.id)}
          <li><strong>{item.username}</strong>
            <ul>
              {#each [...new Set([...Object.keys(item.before),...Object.keys(item.after)])] as key}
                {@const permission=key as keyof typeof item.before}
                {#if item.before[permission]!==item.after[permission]}<li>{key} · {String(item.before[permission]??'default')} → {String(item.after[permission]??'default')}</li>{/if}
              {/each}
              {#if item.jellyfin}
                {#if JSON.stringify(item.jellyfin.foldersBefore)!==JSON.stringify(item.jellyfin.foldersAfter)}
                  <li>Library IDs · {item.jellyfin.foldersBefore.join(', ')||'default'} → {item.jellyfin.foldersAfter.join(', ')}</li>
                {/if}
                {#each [...new Set([...Object.keys(item.jellyfin.before),...Object.keys(item.jellyfin.after)])] as key}
                  {@const field=key as keyof typeof item.jellyfin.before}
                  {#if JSON.stringify(item.jellyfin.before[field])!==JSON.stringify(item.jellyfin.after[field])}
                    <li>{key} · {JSON.stringify(item.jellyfin.before[field])??'default'} → {JSON.stringify(item.jellyfin.after[field])??'default'}</li>
                  {/if}
                {/each}
              {/if}
            </ul>
          </li>
        {/each}
        </ul>
        <div class="row"><Button disabled={busy} onclick={()=>mutate(async()=>{
          const current=preview;if(!current)return;
          await api('admin/members/access',{users:current.changes.map(item=>item.id),presetId:preset,confirm:current.versions},'POST');
          preview=null;
        },'Access changes saved.')}>Apply changes</Button></div>
      {/if}
    </div>
  {/if}
</Dialog>
