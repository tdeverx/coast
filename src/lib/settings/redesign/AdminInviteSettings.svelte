<script lang="ts">
  import {onMount} from 'svelte';
  import { message } from '#lib/ui/client.js';
  import { useClient } from '#lib/ui/client-context.js';
  const { api, feedback:actionFeedback } = useClient('current-viewer');
  import { createResource } from '#lib/ui/resource.svelte.js';
  import { emptyInviteDefaults, inviteBatchLimit, type InviteDefaults } from '#lib/auth/invites.js';
  import type { inviteClaims, inviteOverview, listInvitePresets, listInvites } from '#lib/server/auth/invites.server.js';
  import Button from '#lib/ui/components/Button.svelte';
  import Dialog from '#lib/ui/components/Dialog.svelte';
  import Heading from '#lib/ui/components/Heading.svelte';
  import SettingsChoice from '#lib/settings/SettingsChoice.svelte';
  import Icon from '#lib/ui/components/Icon.svelte';
  import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
  import GlassSeparator from '#lib/auth/ui/GlassSeparator.svelte';
  import ServiceDisclosure from '#lib/auth/ui/ServiceDisclosure.svelte';
  import InviteDefaultsFields from './InviteDefaultsFields.svelte';
  import InviteSecret from '#lib/auth/ui/InviteSecret.svelte';

  let {view,connections,inline=false}:{view:'invites'|'defaults';connections:{id:string;name:string}[];inline?:boolean}=$props();
  const presets=createResource<Awaited<ReturnType<typeof listInvitePresets>>>([]);
  const invites=createResource<Awaited<ReturnType<typeof listInvites>>>({items:[],next:null});
  const claims=createResource<Awaited<ReturnType<typeof inviteClaims>>>({items:[],next:null});
  const summary=createResource<Awaited<ReturnType<typeof inviteOverview>>|null>(null);
  let defaults=$state<InviteDefaults>(structuredClone(emptyInviteDefaults));
  let activeClaim=$state(''),claimOpen=$state(false),busy=$state(false);
  let label=$state(''),days=$state(7),maxUses=$state(1),count=$state(1),presetId=$state(''),name=$state(''),codes=$state<string[]>([]);
  let expiry=$state(''),status=$state(''),issuer=$state(''),filterPreset=$state(''),before=$state(''),cursorStack=$state<string[]>([]);
  let requestPreset=$state(''),showOverrides=$state(false);
  let creating = $state(false);
  const inviteFormId = $props.id();
  const presetOptions = $derived(presets.data.map(preset => ({ id: preset.id, label: preset.name })));
  const statuses = [
    { id: '', label: 'All' }, ...['active', 'claimed', 'setup-failed', 'expired', 'revoked'].map(id => ({
      id, label: id === 'setup-failed' ? 'Setup failed' : id[0].toUpperCase() + id.slice(1),
    })),
  ];
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
  function closeClaims() {
    claimOpen=false; activeClaim=''; claims.cancel();
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
    <SettingsChoice label="Preset" icon="ticket" value={presetId} onchange={select} options={[{ id: '', label: 'New preset' }, ...presetOptions]} disabled={busy} />
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
  <section class="invite-create form-width">
    <AuthSurface invite>
      <button type="button" class="menu-row invite-trigger" aria-controls={inviteFormId} aria-expanded={creating}
        onclick={() => creating = !creating}>
        <Icon name="ticket" size={16} />
        <span>Create invite</span>
        <span class="menu-chevron" class:expanded={creating}><Icon name="right" size={16} /></span>
      </button>
    </AuthSurface>
    <ServiceDisclosure id={inviteFormId} expanded={creating}>
      <div class="panel stack">
    <form class="stack" onsubmit={event=>{event.preventDefault();void mutate(async()=>{
      const result=await api<{issued:{code:string}[]}>('admin/invites',{days,count,maxUses,label,presetId:presetId||undefined,defaults:$state.snapshot(defaults)},'POST');
      codes=result.issued.map(item=>item.code);refresh();
    },'Invites created.');}}>
      <SettingsChoice label="Preset" icon="ticket" value={presetId} onchange={select} options={[{ id: '', label: 'Custom' }, ...presetOptions]} disabled={busy} />
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
    </ServiceDisclosure>
  </section>
  <GlassSeparator />
  <div class="stack">
    <Heading title="Invitations" />
    <form class="invite-filters" onsubmit={event=>{event.preventDefault();before='';cursorStack=[];void loadInvites();}}>
      <SettingsChoice label="Status" icon="checkCircle" bind:value={status} options={statuses} />
      <label class="field">Issuer<input bind:value={issuer} maxlength="60" /></label>
      <SettingsChoice label="Preset" icon="ticket" bind:value={filterPreset} options={[{ id: '', label: 'All' }, ...presetOptions]} />
      <SettingsChoice label="Expiry" icon="calendar" bind:value={expiry} options={[{ id: '', label: 'Any date' }, { id: 'week', label: 'Next seven days' }]} />
      <Button type="submit" emphasis="subtle" disabled={invites.busy}>Filter</Button>
    </form>
    <div class="overflow"><table class="table">
      <thead><tr><th>Invite</th><th>Issued by</th><th>Status</th><th>Uses</th><th>Expiry</th><th>Actions</th></tr></thead>
      <tbody>{#each invites.data.items as item (item.id)}
        <tr><td>{item.label||item.presetName||'Invitation'}</td><td>{item.issuer??'—'}</td><td>{item.hasSetupFailure?'Setup failed':item.status}</td>
          <td>{item.claimCount} / {item.maxUses}</td><td>{new Date(item.expiresAt).toLocaleDateString()}</td>
          <td>
            {#if item.claimCount}<Button emphasis="subtle" onclick={()=>{if(inline&&claimOpen&&activeClaim===item.id)closeClaims();else showClaims(item.id);}}>Claims</Button>{/if}
            {#if item.status==='active'}
              <Button emphasis="subtle" disabled={busy} onclick={()=>mutate(async()=>{await api('admin/invites/'+item.id,undefined,'DELETE');refresh();},'Invite revoked.')}>Revoke</Button>
              <Button emphasis="subtle" disabled={busy} onclick={()=>mutate(async()=>{
                const value=await api<{code:string}>(`admin/invites/${item.id}/regenerate`,{},'POST');codes=[value.code];refresh();
              },'Replacement invite created.')}>Regenerate</Button>
            {/if}
          </td></tr>
        {#if inline && claimOpen && activeClaim === item.id}
          <tr><td colspan="6"><div class="stack">{@render claimRows()}</div></td></tr>
        {/if}
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
      <details><summary>Recent changes</summary><ul>{#each summary.data.audit as row (row.id)}<li>{new Date(row.createdAt).toLocaleString()} · {row.actor??'Coast'} · {row.event}{row.subjectName?' · '+row.subjectName:''}
        {#if row.details}<details><summary>Changes</summary><pre class="wrap">{JSON.stringify(row.details,null,2)}</pre></details>{/if}</li>{/each}</ul></details>
      <Heading title="Member invite requests" />
      {#if summary.data.requests.length}<SettingsChoice label="Preset for the approved invite" icon="ticket" bind:value={requestPreset}
        options={[{ id: '', label: 'Choose a preset' }, ...presetOptions]} disabled={busy} />{/if}
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
  {#if !inline}<Dialog bind:open={claimOpen} title="Invite claims" onclose={closeClaims}>
    {@render claimRows()}
  </Dialog>{/if}
{/if}

{#snippet claimRows()}
  {#if claims.busy}<p class="small" role="status">Loading claims…</p>{/if}
    <ul>{#each claims.data.items as claim (claim.id)}<li>{claim.username} · {claim.readyAt?'Ready':claim.provisioning==='uncertain'?'Needs review':claim.failed?'Setup failed':claim.userId?'Setting up':'Account removed'}</li>{/each}</ul>
    {#if claims.data.next}<Button emphasis="subtle" onclick={()=>showClaims(activeClaim,claims.data.next??'')}>Next</Button>{/if}
  {#if inline}<Button size="segment" emphasis="subtle" onclick={closeClaims}>Close claims</Button>{/if}
{/snippet}

<style>
  .invite-filters {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 208px), 1fr));
    align-items: end;
    gap: var(--auth-action-gap);
  }
  .invite-filters > :global(button) { justify-self: start; }
  .invite-trigger { min-block-size: calc(var(--leading-menu) + 20px); }
  .invite-trigger > .menu-chevron { transition: transform var(--motion) var(--ease); }
  .invite-trigger > .menu-chevron.expanded { transform: rotate(90deg); }
  @media (prefers-reduced-motion: reduce) { .invite-trigger > .menu-chevron { transition: none; } }
</style>
