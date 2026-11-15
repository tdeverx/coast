<script lang="ts">
  import {onMount} from 'svelte';
  import { api, message } from '#lib/ui/client.js';
  import { actionFeedback } from '#lib/ui/action-feedback.svelte.js';
  import { createResource } from '#lib/ui/resource.svelte.js';
  import { emptyInviteDefaults, inviteBatchLimit, type InviteDefaults } from '#lib/auth/invites.js';
  import type { inviteClaims, inviteOverview, listInvitePresets, listInvites } from '#lib/server/auth/invites.server.js';
  import Button from '#lib/ui/components/Button.svelte';
  import Dialog from '#lib/ui/components/Dialog.svelte';
  import Heading from '#lib/ui/components/Heading.svelte';
  import InviteDefaultsFields from './InviteDefaultsFields.svelte';
  import InviteSecret from './InviteSecret.svelte';

  let {view,connections}:{view:'invites'|'defaults';connections:{id:string;name:string}[]}=$props();
  const presets=createResource<Awaited<ReturnType<typeof listInvitePresets>>>([]);
  const invites=createResource<Awaited<ReturnType<typeof listInvites>>>({items:[],next:null});
  const claims=createResource<Awaited<ReturnType<typeof inviteClaims>>>({items:[],next:null});
  const summary=createResource<Awaited<ReturnType<typeof inviteOverview>>|null>(null);
  let defaults=$state<InviteDefaults>(structuredClone(emptyInviteDefaults));
  let activeClaim=$state(''),claimOpen=$state(false),busy=$state(false);
  let label=$state(''),days=$state(7),maxUses=$state(1),count=$state(1),presetId=$state(''),name=$state(''),codes=$state<string[]>([]);
  let expiry=$state(''),status=$state(''),issuer=$state(''),filterPreset=$state(''),before=$state(''),cursorStack=$state<string[]>([]);
  let requestPreset=$state(''),showOverrides=$state(false);
  const loadPresets=()=>presets.load(signal=>api('admin/invites/presets',undefined,'GET',{signal}));
  const loadSummary=()=>summary.load(signal=>api('admin/invites/overview',undefined,'GET',{signal}));
  const loadInvites=()=>invites.load(signal=>api('admin/invites?'+new URLSearchParams({status,issuer,expiry,preset:filterPreset,before}),undefined,'GET',{signal}));
  onMount(()=>{
    void loadPresets();
    if(view==='invites'){void loadInvites();void loadSummary();}
    return ()=>{presets.dispose();invites.dispose();summary.dispose();claims.dispose();};
  });
  function select(id:string){
    const selected=presets.data.find(item=>item.id===id);
    presetId=id;
    defaults=structuredClone(selected?.defaults??emptyInviteDefaults);
    name=selected?.name??'';
  }
  async function mutate(operation:()=>Promise<void>,success:string){
    if(busy)return;
    busy=true;
    try {await operation();actionFeedback.notify(success);}
    catch(cause){actionFeedback.failure(message(cause));}
    finally{busy=false;}
  }
  function showClaims(id:string,after=''){
    if(activeClaim!==id)claims.replace({items:[],next:null});
    activeClaim=id;claimOpen=true;
    void claims.load(signal=>api(`admin/invites/${id}/claims?before=${after}`,undefined,'GET',{signal}));
  }
  function go(cursor:string) {before=cursor;void loadInvites();}
  function refresh(){before='';cursorStack=[];void loadInvites();void loadSummary();}
</script>

{#if view==='defaults'}
  <div class="panel stack form-width">
    <Heading title="Account defaults" description="Save presets for administrators and member-issued invitations." />
    <label class="field">Preset<select value={presetId} onchange={event=>select(event.currentTarget.value)}>
      <option value="">New preset</option>{#each presets.data as preset (preset.id)}<option value={preset.id}>{preset.name}</option>{/each}
    </select></label>
    <form class="stack" onsubmit={event=>{event.preventDefault();void mutate(async()=>{
      const saved=await api<{id:string}>('admin/invites/presets',{id:presetId||undefined,name,defaults:$state.snapshot(defaults)},'POST');
      await loadPresets();select(saved.id);
    },'Preset saved.');}}>
      <label class="field">Preset name<input bind:value={name} required maxlength="80" /></label>
      <InviteDefaultsFields bind:defaults {connections} />
      <div class="row"><Button type="submit" disabled={busy}>Save preset</Button></div>
    </form>
  </div>
{:else}
  <div class="panel stack form-width">
    <Heading title="Issue invites" />
    <form class="stack" onsubmit={event=>{event.preventDefault();void mutate(async()=>{
      const result=await api<{issued:{code:string}[]}>('admin/invites',{days,count,maxUses,label,presetId:presetId||undefined,defaults:$state.snapshot(defaults)},'POST');
      codes=result.issued.map(item=>item.code);refresh();
    },'Invites created.');}}>
      <label class="field">Preset<select value={presetId} onchange={event=>select(event.currentTarget.value)}>
        <option value="">Custom</option>{#each presets.data as preset (preset.id)}<option value={preset.id}>{preset.name}</option>{/each}
      </select></label>
      <details class="stack" ontoggle={event=>showOverrides=event.currentTarget.open}><summary>Review or override defaults</summary>
        {#if showOverrides}<InviteDefaultsFields bind:defaults {connections} />{/if}
      </details>
      <label class="field">Private label<input bind:value={label} maxlength="120" /></label>
      <div class="row">
        <label class="field">Expires in (days)<input type="number" min="1" max="30" required bind:value={days} /></label>
        <label class="field">Number of codes<input type="number" min="1" max={inviteBatchLimit} required bind:value={count} /></label>
        <label class="field">Uses per code<input type="number" min="1" max="50" required bind:value={maxUses} /></label>
      </div>
      <div class="row"><Button type="submit" disabled={busy}>Create invites</Button></div>
    </form>
    <InviteSecret {codes} />
  </div>
  <div class="stack">
    <Heading title="Invitations" />
    <form class="row" onsubmit={event=>{event.preventDefault();before='';cursorStack=[];void loadInvites();}}>
      <label class="field">Status<select bind:value={status}><option value="">All</option><option value="active">Active</option><option value="claimed">Claimed</option><option value="expired">Expired</option><option value="revoked">Revoked</option></select></label>
      <label class="field">Issuer<input bind:value={issuer} maxlength="60" /></label>
      <label class="field">Preset<select bind:value={filterPreset}><option value="">All</option>{#each presets.data as preset (preset.id)}<option value={preset.id}>{preset.name}</option>{/each}</select></label>
      <label class="field">Expiry<select bind:value={expiry}><option value="">Any date</option><option value="week">Next seven days</option></select></label>
      <Button type="submit" emphasis="subtle" disabled={invites.busy}>Filter</Button>
    </form>
    <div class="overflow"><table class="table">
      <thead><tr><th>Invite</th><th>Issued by</th><th>Status</th><th>Uses</th><th>Expiry</th><th>Actions</th></tr></thead>
      <tbody>{#each invites.data.items as item (item.id)}
        <tr><td>{item.label||item.presetName||'Invitation'}</td><td>{item.issuer??'—'}</td><td>{item.status}</td>
          <td>{item.claimCount} / {item.maxUses}</td><td>{new Date(item.expiresAt).toLocaleDateString()}</td>
          <td>
            {#if item.claimCount}<Button emphasis="subtle" onclick={()=>showClaims(item.id)}>Claims</Button>{/if}
            {#if item.status==='active'}
              <Button emphasis="subtle" disabled={busy} onclick={()=>mutate(async()=>{await api('admin/invites/'+item.id,undefined,'DELETE');refresh();},'Invite revoked.')}>Revoke</Button>
              <Button emphasis="subtle" disabled={busy} onclick={()=>mutate(async()=>{
                const value=await api<{code:string}>(`admin/invites/${item.id}/regenerate`,{},'POST');codes=[value.code];refresh();
              },'Replacement invite created.')}>Regenerate</Button>
            {/if}
          </td></tr>
      {:else}<tr><td colspan="6">{invites.busy?'Loading invites…':'No invites found.'}</td></tr>{/each}</tbody>
    </table></div>
    {#if before||invites.data.next}<div class="row">
      {#if before}<Button emphasis="subtle" disabled={invites.busy} onclick={()=>{const previous=cursorStack.at(-1)??'';cursorStack=cursorStack.slice(0,-1);go(previous);}}>Previous</Button>{/if}
      {#if invites.data.next}<Button emphasis="subtle" disabled={invites.busy} onclick={()=>{cursorStack=[...cursorStack,before];go(invites.data.next??'');}}>Next</Button>{/if}
    </div>{/if}
  </div>
  {#if summary.data}
    <div class="stack">
      <Heading title="Invite activity" description="Last 30 days" />
      <p>{summary.data.funnel.find(row=>row.event==='invite.issued')?.total??0} issued · {summary.data.funnel.find(row=>row.event==='invite.claimed')?.total??0} claimed · {summary.data.funnel.find(row=>row.event==='invite.ready')?.total??0} ready · {summary.data.funnel.find(row=>row.event==='invite.provisioning-failed')?.total??0} failed attempts</p>
      <details><summary>Recent changes</summary><ul>{#each summary.data.audit as row (row.id)}<li>{new Date(row.createdAt).toLocaleString()} · {row.actor??'Coast'} · {row.event}</li>{/each}</ul></details>
      <Heading title="Member invite requests" />
      {#if summary.data.requests.length}<label class="field">Preset for approved requests<select bind:value={requestPreset}><option value="">Choose a preset</option>
        {#each presets.data as preset (preset.id)}<option value={preset.id}>{preset.name}</option>{/each}</select></label>{/if}
      {#each summary.data.requests as request (request.id)}
        <div class="row"><span>{request.username} {request.note}</span>
          <Button emphasis="subtle" disabled={!requestPreset||busy} onclick={()=>mutate(async()=>{await api('admin/invites/grant/'+request.userId,
            {presetId:requestPreset,requestId:request.id,decision:'approved'},'POST');void loadSummary();},'Request approved.')}>Approve</Button>
          <Button emphasis="subtle" disabled={busy} onclick={()=>mutate(async()=>{await api('admin/invites/grant/'+request.userId,
            {requestId:request.id,decision:'denied'},'POST');void loadSummary();},'Request declined.')}>Decline</Button>
        </div>
      {:else}<p class="small">No pending requests.</p>{/each}
    </div>
  {/if}
  <Dialog bind:open={claimOpen} title="Invite claims" onclose={()=>claims.cancel()}>
    <ul>{#each claims.data.items as claim (claim.id)}<li>{claim.username} · {claim.readyAt?'Ready':claim.provisioning==='uncertain'?'Needs review':claim.userId?'Setting up':'Account removed'}</li>{/each}</ul>
    {#if claims.data.next}<Button emphasis="subtle" onclick={()=>showClaims(activeClaim,claims.data.next??'')}>Next</Button>{/if}
  </Dialog>
{/if}
