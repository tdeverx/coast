<script lang="ts">
  import {onMount} from 'svelte';
  import {useClient} from '#lib/ui/client-context.js';
  import {message} from '#lib/ui/client.js';
  import {createResource} from '#lib/ui/resource.svelte.js';
  import type {memberInviteOverview} from '#lib/server/auth/invites.server.js';
  import Button from '#lib/ui/components/Button.svelte';
  import EmptyState from '#lib/ui/components/EmptyState.svelte';
  import Heading from '#lib/ui/components/Heading.svelte';
  import InviteSecret from './InviteSecret.svelte';

  const {api,feedback}=useClient();
  const invites=createResource<Awaited<ReturnType<typeof memberInviteOverview>>>({items:[],next:null,grant:null,request:null});
  let busy=$state(false),label=$state(''),note=$state(''),codes=$state<string[]>([]);
  const load=(before='')=>invites.load(signal=>api('member-invites?'+new URLSearchParams({before}),undefined,'GET',{signal}));
  onMount(()=>{void load();return invites.dispose;});
  async function apply(operation:()=>Promise<unknown>,success:string){
    if(busy)return;
    busy=true;
    try{await operation();feedback.notify(success);await load();}
    catch(cause){feedback.failure(message(cause));}
    finally{busy=false;}
  }
</script>

<Heading title="Invite someone" />
{#if invites.error}<p role="status">{invites.error}</p>
{:else if invites.busy&&!invites.ready}<p role="status">Loading invites…</p>
{:else}
  <div class="stack">
    {#if invites.data.grant}
      <p>{invites.data.grant.remaining} of {invites.data.grant.quota} invites available in your rolling 30-day allowance.</p>
    {:else if invites.data.request!=='approved'}<p>An administrator can give you access to invite people.</p>{/if}
    {#if (invites.data.grant?.remaining??0)>0||invites.data.request==='approved'}
        <form class="row" onsubmit={event=>{event.preventDefault();void apply(async()=>{
          const result=await api<{code:string}>('member-invites',{label},'POST');
          codes=[result.code];label='';
        },'Invite created.');}}>
          <label class="field">Private label<input bind:value={label} maxlength="120" /></label>
          <Button type="submit" disabled={busy}>Create invite</Button>
        </form>
    {/if}
    {#if invites.data.request==='pending'}<p role="status">Your request is waiting for an administrator.</p>
    {:else if invites.data.request==='approved'}<p>One additional invite was approved.</p>
    {:else if !invites.data.grant||!invites.data.grant.remaining}
      <form class="row" onsubmit={event=>{event.preventDefault();void apply(()=>api('member-invites/request',{note},'POST'),'Invite request sent.');}}>
        <label class="field">Note for the administrator<input bind:value={note} maxlength="120" /></label>
        <Button type="submit" disabled={busy}>Request {invites.data.grant?'an extra invite':'an invite'}</Button>
      </form>
    {/if}
    <InviteSecret {codes} />
    {#each invites.data.items as invite (invite.id)}
      <div class="spread">
        <span>{invite.label||'Invitation'} · {invite.status} · {new Date(invite.expiresAt).toLocaleDateString()}</span>
        {#if invite.status==='active'}<Button emphasis="subtle" disabled={busy} onclick={()=>apply(()=>api('member-invites/'+invite.id,undefined,'DELETE'),'Invite revoked.')}>Revoke</Button>{/if}
      </div>
    {:else}
      {#if invites.data.grant}<EmptyState title="No issued invites" description="Your invitations appear here after you create them." icon="user" />{/if}
    {/each}
    {#if invites.data.next}<div class="row"><Button emphasis="subtle" disabled={invites.busy} onclick={()=>void load(invites.data.next??'')}>Next</Button></div>{/if}
  </div>
{/if}
