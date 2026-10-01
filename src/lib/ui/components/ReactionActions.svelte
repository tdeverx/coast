<script lang="ts">
 import ContextMenu from './ContextMenu.svelte';
 import MenuAction from './MenuAction.svelte';
 import {api,change,message} from '$lib/ui/client';
 import {emojis} from '$lib/social/model';
 let {targetId,targetKind='work',disabled=false}:{targetId:string;targetKind?:'work'|'activity';disabled?:boolean}=$props();
 let selected=$state<string|null>(null),counts=$state<Record<string,number>>({}),busy=$state(false),failure=$state('');
 async function load(){
  busy=true;failure='';
  try{
   const response=await api<Record<string,{emoji:string;count:number;mine:boolean}[]>>(`social/reactions?targetKind=${targetKind}&ids=${targetId}`,undefined,'GET');
   const rows=response[targetId]??[];selected=rows.find(r=>r.mine)?.emoji??null;
   counts=Object.fromEntries(rows.map(r=>[r.emoji,r.count]));
  }catch(cause){failure=message(cause);}finally{busy=false;}
 }
 async function react(emoji:typeof emojis[number]){
  if(busy)return;busy=true;failure='';
  try{await change('social/reactions',{targetKind,targetId,emoji:selected===emoji?null:emoji});await load();}
  catch(cause){failure=message(cause);}finally{busy=false;}
 }
</script>
<ContextMenu label="Reactions" icon="heart" panel disabled={disabled} onopen={load}>
 {#each emojis as emoji}<MenuAction checked={selected===emoji} disabled={busy} keepOpen onclick={()=>react(emoji)}>{emoji}{counts[emoji]?` · ${counts[emoji]}`:''}</MenuAction>{/each}
 {#if failure}<p class="notice error small" role="alert">{failure}</p>{/if}
</ContextMenu>
