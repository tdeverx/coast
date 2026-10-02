<script lang="ts">
  import { message } from '$lib/ui/client';
  import { useClient } from '$lib/ui/client-context';
  import MenuAction from './MenuAction.svelte';
  import Dialog from './Dialog.svelte';
  import RowFilter from './RowFilter.svelte';
  import Button from './Button.svelte';

  const { change } = useClient();

  let {workId,disabled=false}:{workId:string;disabled?:boolean}=$props();
  import { createFriendsResource } from '$lib/ui/friends.svelte';
  const friends = createFriendsResource();
  let open=$state(false),sending=$state(false),failure=$state(''),recipient=$state('');
  const busy=$derived(sending || friends.busy);
  async function load(reset=false){
    if(reset){open=true;recipient='';}
    await friends.load(reset);
  }
  async function send(){
    if(busy||!recipient)return;
    sending=true;failure='';
    try{await change('social/recommendations',{recipientId:recipient,workId});open=false;}
    catch(cause){failure=message(cause);}finally{sending=false;}
  }
</script>
<MenuAction icon="user" disabled={disabled||busy} keepOpen={false} onclick={()=>load(true)}>Recommend to a friend…</MenuAction>
<Dialog bind:open title="Recommend to a friend">
  <RowFilter label="Friend" value={recipient} options={[{value:'',label:'Choose a friend'},...friends.items.map(friend=>({value:friend.userId,label:friend.username}))]} onchange={value=>recipient=value} />
  {#if !friends.items.length&&!busy}<p class="small">Add a friend to send recommendations.</p>{/if}
  {#if friends.more}<Button variant="ghost" disabled={busy} onclick={()=>load()}>Load more friends</Button>{/if}
  {#if failure || friends.error}<p class="notice error" role="alert">{failure || friends.error}</p>{/if}
  <div class="row"><Button disabled={!recipient||busy} onclick={send}>Send recommendation</Button><Button variant="ghost" onclick={()=>open=false}>Cancel</Button></div>
</Dialog>
