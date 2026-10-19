<script lang="ts">
  import { useRetention } from '$lib/ui/retention';
  import { reportFailure } from '$lib/ui/client-context';
  import {page} from '$app/state';
  import { createOperation } from '$lib/ui/operation.svelte';
  import FormActions from './FormActions.svelte';
  import { useClient } from '$lib/ui/client-context';
  import { getContext, setContext } from 'svelte';
  import type { MenuContext } from '$lib/ui/controls/menu.svelte';

  import Dialog from './Dialog.svelte';
  import RowFilter from './RowFilter.svelte';
  import Button from './Button.svelte';

  const { change } = useClient();
  const parentMenu = getContext<MenuContext | undefined>('coast-context-menu');
  // Dialog pickers close their own menus, without unmounting this dialog's owner.
  setContext('coast-context-menu', undefined);
  const operation = createOperation(useRetention());

  let {workId,disabled=false}:{workId:string;disabled?:boolean}=$props();
  import { createFriendsResource } from '$lib/ui/friends.svelte';
  const friends = createFriendsResource();
  let open=$state(false),failure=$state(''),recipient=$state('');
  const busy=$derived(operation.busy || friends.busy);
  async function load(reset=false){
    if(page.data.capabilities?.social===false)return;
    if(reset){open=true;recipient='';}
    await friends.load(reset);
  }
  async function send(){
    if(busy||!recipient)return;
    failure='';
    if (!await operation.run(async () => { await change('social/recommendations',{recipientId:recipient,workId});open=false; })) failure=operation.error;
  }

  reportFailure(()=>failure || friends.error);
</script>
<!-- Retain this owner until its dialog closes; closing the menu unmounts its children. -->
{#if page.data.capabilities?.social!==false}<Button item icon="user" disabled={disabled||busy} keepOpen onclick={()=>load(true)}>Recommend to a friend…</Button>
<Dialog bind:open title="Recommend to a friend" onclose={()=>parentMenu?.closeAll(true)}>
  <RowFilter selection groups={[{label:"Friend", value:recipient, options:[{value:'',label:'Choose a friend'},...friends.items.map(friend=>({value:friend.userId,label:friend.username}))], change:value=>recipient=value}]} />
  {#if !friends.items.length&&!busy}<p class="small">Add a friend to send recommendations.</p>{/if}
  {#if friends.more}<Button emphasis="subtle" disabled={busy} onclick={()=>load()}>Load more friends</Button>{/if}

  <FormActions cancel={()=>open=false}><Button disabled={!recipient||busy} onclick={send}>Send recommendation</Button></FormActions>
</Dialog>{/if}
