<script lang="ts">
  import {api,change,message} from '$lib/ui/client';
  import MenuAction from './MenuAction.svelte';
  import Dialog from './Dialog.svelte';
  import RowFilter from './RowFilter.svelte';
  import Button from './Button.svelte';
  let {workId,disabled=false}:{workId:string;disabled?:boolean}=$props();
  let open=$state(false),busy=$state(false),failure=$state(''),recipient=$state('');
  let friends=$state<{userId:string;username:string}[]>([]),page=$state(1),more=$state(false);
  async function load(reset=false){
    if(busy)return;
    if(reset){open=true;friends=[];recipient='';page=1;}
    busy=true;failure='';
    try{
      const rows=await api<{userId:string;username:string;state:string}[]>(`social/friends?page=${page}`,undefined,'GET');
      friends=[...friends,...rows.slice(0,60).filter(friend=>friend.state==='accepted')];
      more=rows.length>60;page++;
    }catch(cause){failure=message(cause);}finally{busy=false;}
  }
  async function send(){
    if(busy||!recipient)return;
    busy=true;failure='';
    try{await change('social/recommendations',{recipientId:recipient,workId});open=false;}
    catch(cause){failure=message(cause);}finally{busy=false;}
  }
</script>
<MenuAction icon="user" disabled={disabled||busy} keepOpen={false} onclick={()=>load(true)}>Recommend to a friend…</MenuAction>
<Dialog bind:open title="Recommend to a friend">
  <RowFilter label="Friend" value={recipient} options={[{value:'',label:'Choose a friend'},...friends.map(friend=>({value:friend.userId,label:friend.username}))]} onchange={value=>recipient=value} />
  {#if !friends.length&&!busy}<p class="small">Add a friend to send recommendations.</p>{/if}
  {#if more}<Button variant="ghost" disabled={busy} onclick={()=>load()}>Load more friends</Button>{/if}
  {#if failure}<p class="notice error" role="alert">{failure}</p>{/if}
  <div class="row"><Button disabled={!recipient||busy} onclick={send}>Send recommendation</Button><Button variant="ghost" onclick={()=>open=false}>Cancel</Button></div>
</Dialog>
