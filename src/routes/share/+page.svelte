<script lang="ts">
 import { onMount, untrack } from 'svelte';
 import { page } from '$app/state';
 import Heading from '$lib/ui/components/Heading.svelte';
 import Button from '$lib/ui/components/Button.svelte';
 import { playMedia, player, alignPlayback, stopPlayback } from '$lib/playback/client.svelte';
 import { message, setPlaybackApi } from '$lib/ui/client';
 import type { PageData } from './$types';
 let { data }: { data: PageData } = $props();
 let shared = $state<PageData['shared']>(untrack(()=>data.shared)), token = $state(''), busy = $state(false), error = $state('');
 let polling = false;
 let preparation:Promise<void>=Promise.resolve();
 async function request<T>(path:string,body?:unknown):Promise<T> {
  const response = await fetch(`/api/share/${path}`,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json(); if(!response.ok)throw new Error(value.error); return value;
 }
 async function open() {
  busy=true;error='';try {
   await preparation;
   if(!shared){await request('claim',token?{token}:{id:page.url.searchParams.get('id')});shared=await request('state');token='';}
   if(shared)await playMedia(shared.workId,{fromStart:true});
  } catch(cause){error=message(cause);}finally{busy=false;}
 }
 onMount(()=>{
  preparation=stopPlayback().then(()=>setPlaybackApi(true));
  token=new URLSearchParams(location.hash.slice(1)).get('invite')??'';
  if(token||page.url.searchParams.has('id'))shared=null;
  if(location.hash)history.replaceState(history.state,'',location.pathname+location.search);
  const timer=setInterval(async()=>{
   if(!shared||polling)return;polling=true;
   try {shared=await request('state');if(shared?.together&&!shared.host&&player.session){const elapsed=shared.paused?0:Math.max(0,(Date.now()-Date.parse(String(shared.updatedAt)))/1000);alignPlayback({positionSeconds:Math.min(shared.durationSeconds,shared.positionSeconds+elapsed),paused:shared.paused});}}
   catch(cause){error=message(cause);await stopPlayback();shared=null;}finally{polling=false;}
  },2000);
  return ()=>{clearInterval(timer);void stopPlayback().finally(()=>setPlaybackApi(false));};
 });
</script>
<svelte:head><title>Playback invitation — Coast</title><meta name="referrer" content="no-referrer" /></svelte:head>
<Heading title={shared?.title??'Playback invitation'} />
<p>{shared?.together?'Watch or listen together.':'A single-use invitation to this item.'}</p>
<Button onclick={open} disabled={busy}>{busy?'Preparing…':shared?'Play':'Open invitation'}</Button>
{#if error}<p role="alert">{error}</p>{/if}
