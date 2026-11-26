<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
 import { onMount, untrack } from 'svelte';
 import { page } from '$app/state';
 import Heading from '#lib/ui/components/Heading.svelte';
 import Button from '#lib/ui/components/Button.svelte';
 import { playMedia, player, alignPlayback, stopPlayback } from '#lib/playback/client.svelte.js';
 import { attachReading, closeReading, reader } from '#lib/reading/client.svelte.js';
 import type { ReadingSessionView } from '#lib/reading/model.js';
 import { ApiError, message, setPlaybackApi } from '#lib/ui/client.js';
 import type { PageData } from './$types';
 let { data }: { data: PageData } = $props();
 let shared = $state<PageData['shared']>(untrack(()=>data.shared)), token = $state(''), busy = $state(false), error = $state('');
 let polling = false;
 let readingSessionId:string|undefined;
 let readingOpening:AbortController|undefined;
 const lifetime=new AbortController();
 let preparation:Promise<void>=Promise.resolve();
 async function request<T>(path:string,body?:unknown,signal=lifetime.signal):Promise<T> {
  signal.throwIfAborted();
  const response = await fetch(`/api/share/${path}`,{signal,method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const value = await response.json().catch(() => undefined);
  if (!response.ok || !value || typeof value !== 'object') {
   const hasMessage = typeof value?.error === 'string';
   throw new ApiError(hasMessage ? value.error : 'Playback status could not be checked. Please try again.', hasMessage ? response.status : 502);
  }
  return value;
 }
 async function open() {
  if(lifetime.signal.aborted||busy)return;
  busy=true;error='';try {
   await preparation;
   lifetime.signal.throwIfAborted();
   if(!shared){await request('claim',token?{token}:{id:page.url.searchParams.get('id')});const next=await request<PageData['shared']>('state');lifetime.signal.throwIfAborted();shared=next;token='';}
   lifetime.signal.throwIfAborted();
   if(shared?.mediaType==='reading'){
    if(readingSessionId&&reader.session?.id===readingSessionId){reader.visible=true;return;}
    const controller=new AbortController(),signal=AbortSignal.any([lifetime.signal,controller.signal]),shareId=shared.id;
    readingOpening=controller;
    const current=()=>!signal.aborted&&shared?.id===shareId&&shared?.mediaType==='reading';
    try{
     const session=await request<ReadingSessionView>('reading',{},signal);
     if(!current())controller.abort();
     else readingSessionId=session.id;
     // attachReading retires a late prepared session through its scoped shared close endpoint.
     await attachReading(session,signal);
    }finally{if(readingOpening===controller)readingOpening=undefined;}
   }else if(shared)await playMedia(shared.workId,{fromStart:true});
  } catch(cause){if(!lifetime.signal.aborted&&!(cause instanceof DOMException&&cause.name==='AbortError')){error=message(cause);if(cause instanceof ApiError&&(cause.status===401||cause.status===410)){await stopSharedReading();shared=null;}}}finally{if(!lifetime.signal.aborted)busy=false;}
 }
 async function stopSharedReading(){
  readingOpening?.abort();readingOpening=undefined;
  const id=readingSessionId;
  readingSessionId=undefined;
  if(id&&reader.session?.id===id)await closeReading(true,false);
 }
 onMount(()=>{
  let releasePlaybackApi:(()=>void)|undefined;
  preparation=stopPlayback().then(()=>{if(!lifetime.signal.aborted)releasePlaybackApi=setPlaybackApi(true);});
  token=new URLSearchParams(location.hash.slice(1)).get('invite')??'';
  if(token||page.url.searchParams.has('id'))shared=null;
  if(location.hash)history.replaceState(history.state,'',location.pathname+location.search);
  const timer=setInterval(async()=>{
   if (lifetime.signal.aborted || !shared || polling) return;
   const shareId=shared.id;
   polling = true;
   try {
    const next = await request<PageData['shared']>('state');
    if (lifetime.signal.aborted || !shared || shared.id!==shareId) return;
    shared = next;
    if (shared?.together && !shared.host && player.session) {
     const elapsed = shared.paused ? 0 : Math.max(0, (Date.now() - Date.parse(String(shared.updatedAt))) / 1000);
     alignPlayback({positionSeconds:Math.min(shared.durationSeconds,shared.positionSeconds+elapsed),paused:shared.paused});
    }
   } catch (cause) {
    // A temporary status failure leaves the granted stream and its buffer usable.
    if (lifetime.signal.aborted || !(cause instanceof ApiError) || !(cause.status===401||cause.status===410||shared?.mediaType==='reading'&&[403,404,409].includes(cause.status))) return;
    error = message(cause);
    await Promise.all([stopPlayback(),stopSharedReading()]);
    if (!lifetime.signal.aborted) shared = null;
   } finally {
    polling = false;
   }
  },2000);
  return ()=>{lifetime.abort();clearInterval(timer);void Promise.all([stopPlayback(),stopSharedReading()]).finally(()=>releasePlaybackApi?.());};
 });
  reportFailure(()=>error);
</script>
<svelte:head><title>{shared?.mediaType==='reading'?'Reading invitation':'Playback invitation'} — Coast</title><meta name="referrer" content="no-referrer" /></svelte:head>
<div class="content page">
  <Heading title={shared?.title ?? 'Shared invitation'} variant="page"
    description={shared?.mediaType === 'reading' ? 'Read this shared item. Your reading position stays separate from its owner.'
      : shared?.together ? 'Watch or listen together.' : 'Play this shared item. You control your own playback.'} />
  <Button onclick={open} disabled={busy}>
    {busy ? 'Preparing…' : shared ? shared.mediaType === 'reading' ? 'Read' : 'Play' : 'Open invitation'}
  </Button>
</div>
