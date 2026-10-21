<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
 import { onMount, untrack } from 'svelte';
 import { page } from '$app/state';
 import Heading from '#lib/ui/components/Heading.svelte';
 import Button from '#lib/ui/components/Button.svelte';
 import { playMedia, player, alignPlayback, stopPlayback } from '#lib/playback/client.svelte.js';
 import { message, setPlaybackApi } from '#lib/ui/client.js';
 import type { PageData } from './$types';
 let { data }: { data: PageData } = $props();
 let shared = $state<PageData['shared']>(untrack(()=>data.shared)), token = $state(''), busy = $state(false), error = $state('');
 let polling = false;
 const lifetime=new AbortController();
 let preparation:Promise<void>=Promise.resolve();
 async function request<T>(path:string,body?:unknown):Promise<T> {
  lifetime.signal.throwIfAborted();
  const response = await fetch(`/api/share/${path}`,{signal:lifetime.signal,method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json(); lifetime.signal.throwIfAborted(); if(!response.ok)throw new Error(value.error); return value;
 }
 async function open() {
  if(lifetime.signal.aborted)return;
  busy=true;error='';try {
   await preparation;
   lifetime.signal.throwIfAborted();
   if(!shared){await request('claim',token?{token}:{id:page.url.searchParams.get('id')});const next=await request<PageData['shared']>('state');lifetime.signal.throwIfAborted();shared=next;token='';}
   lifetime.signal.throwIfAborted();
   if(shared)await playMedia(shared.workId,{fromStart:true});
  } catch(cause){if(!lifetime.signal.aborted)error=message(cause);}finally{if(!lifetime.signal.aborted)busy=false;}
 }
 onMount(()=>{
  let releasePlaybackApi:(()=>void)|undefined;
  preparation=stopPlayback().then(()=>{if(!lifetime.signal.aborted)releasePlaybackApi=setPlaybackApi(true);});
  token=new URLSearchParams(location.hash.slice(1)).get('invite')??'';
  if(token||page.url.searchParams.has('id'))shared=null;
  if(location.hash)history.replaceState(history.state,'',location.pathname+location.search);
  const timer=setInterval(async()=>{
   if(lifetime.signal.aborted||!shared||polling)return;polling=true;
   try {const next=await request<PageData['shared']>('state');if(lifetime.signal.aborted)return;shared=next;if(shared?.together&&!shared.host&&player.session){const elapsed=shared.paused?0:Math.max(0,(Date.now()-Date.parse(String(shared.updatedAt)))/1000);alignPlayback({positionSeconds:Math.min(shared.durationSeconds,shared.positionSeconds+elapsed),paused:shared.paused});}}
   catch(cause){if(lifetime.signal.aborted)return;error=message(cause);await stopPlayback();if(!lifetime.signal.aborted)shared=null;}finally{polling=false;}
  },2000);
  return ()=>{lifetime.abort();clearInterval(timer);void stopPlayback().finally(()=>releasePlaybackApi?.());};
 });
  reportFailure(()=>error);
</script>
<svelte:head><title>Playback invitation — Coast</title><meta name="referrer" content="no-referrer" /></svelte:head>
<Heading title={shared?.title??'Playback invitation'} />
<p>{shared?.together?'Watch or listen together.':'Play this shared item. You control your own playback.'}</p>
<Button onclick={open} disabled={busy}>{busy?'Preparing…':shared?'Play':'Open invitation'}</Button>
