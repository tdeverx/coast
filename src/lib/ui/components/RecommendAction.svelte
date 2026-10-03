<script lang="ts">
  import RowFeedback from './RowFeedback.svelte';
  import { createOperation } from '$lib/ui/operation.svelte';
  import FormActions from './FormActions.svelte';
  import { useClient } from '$lib/ui/client-context';

  import Dialog from './Dialog.svelte';
  import RowFilter from './RowFilter.svelte';
  import Button from './Button.svelte';

  const { change } = useClient();
  const operation = createOperation();

  let {workId,disabled=false}:{workId:string;disabled?:boolean}=$props();
  import { createFriendsResource } from '$lib/ui/friends.svelte';
  const friends = createFriendsResource();
  let open=$state(false),failure=$state(''),recipient=$state('');
  const busy=$derived(operation.busy || friends.busy);
  async function load(reset=false){
    if(reset){open=true;recipient='';}
    await friends.load(reset);
  }
  async function send(){
    if(busy||!recipient)return;
    failure='';
    if (!await operation.run(async () => { await change('social/recommendations',{recipientId:recipient,workId});open=false; })) failure=operation.error;
  }
</script>
<Button item icon="user" disabled={disabled||busy} keepOpen={false} onclick={()=>load(true)}>Recommend to a friend…</Button>
<Dialog bind:open title="Recommend to a friend">
  <RowFilter selection groups={[{label:"Friend", value:recipient, options:[{value:'',label:'Choose a friend'},...friends.items.map(friend=>({value:friend.userId,label:friend.username}))], change:value=>recipient=value}]} />
  {#if !friends.items.length&&!busy}<p class="small">Add a friend to send recommendations.</p>{/if}
  {#if friends.more}<Button emphasis="subtle" disabled={busy} onclick={()=>load()}>Load more friends</Button>{/if}
  {#if failure || friends.error}<RowFeedback error={failure || friends.error} tag="p" class="notice error" />{/if}
  <FormActions cancel={()=>open=false}><Button disabled={!recipient||busy} onclick={send}>Send recommendation</Button></FormActions>
</Dialog>
