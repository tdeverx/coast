<script lang="ts">
 import { reader, closeReading, recordReading, publishReading, setReadingNavigator, retryReadingSave } from './client.svelte';
 import { readingFraction, readingLocationLabel, sameReadingLocation } from './model';
 import { syncedPlayer, canControlPlayback } from '$lib/playback/synced/client.svelte';
 import Dialog from '$lib/ui/components/Dialog.svelte';
 import Button from '$lib/ui/components/Button.svelte';
 import ProgressBar from '$lib/ui/components/ProgressBar.svelte';
 import { api, message, isFeatureDisabled, ApiError } from '$lib/ui/client';
 import type { ReaderEngine } from './reader/engine';
 let host:HTMLElement,engine:ReaderEngine|undefined,busy=$state(false),loading=$state(false);
 const following=$derived(syncedPlayer.room?.mediaType==='reading'&&!!reader.session&&syncedPlayer.room.mediaId===reader.session.workId&&syncedPlayer.room.edition===reader.session.edition&&syncedPlayer.room.readingFormat===reader.session.format);
 const controlled=$derived(!following||canControlPlayback());
 let external=false,minimizing=false,readerOwner=0;
 function close(){void closeReading().catch(()=>{/* Keep the unsaved bookmark and its retry notice visible. */});}
 $effect(()=>{
  const session=reader.session,file=reader.file;if(!session||!host||!reader.visible)return;
  const heartbeat=setInterval(()=>{if(!document.hidden&&reader.visible)void api(`reading/sessions/${session.id}/heartbeat`,{}).catch(cause=>{if((isFeatureDisabled(cause)||cause instanceof ApiError&&cause.status===410)&&reader.session?.id===session.id)void closeReading(true,false).catch(()=>{});});},60000);
  const controller=new AbortController(),owner=++readerOwner;let current:ReaderEngine|undefined,resize:ResizeObserver|undefined,navigation=0;loading=true;reader.rendering=true;
  const ownsNavigation=(revision:number)=>!controller.signal.aborted&&revision===navigation&&reader.session?.id===session.id;
  void import('./reader/engine').then(module=>module.createReader({host,source:file??session.url!,format:session.format,location:session.location,signal:controller.signal,changed:location=>{
    if(controller.signal.aborted)return;
    const room=syncedPlayer.room;
    // EPUB links are navigation too: viewers follow the room's location.
    if(!external&&!controlled&&room?.reading&&current&&!sameReadingLocation(room.reading,location)){
     const revision=++navigation;external=true;
     void current.go(room.reading).catch(cause=>{if(ownsNavigation(revision))reader.error=message(cause);}).finally(()=>{if(ownsNavigation(revision))external=false;});return;
    }
    const previous=reader.location;reader.location=location;
    if(external||sameReadingLocation(previous,location))return;
    void recordReading(location);
    if(syncedPlayer.room?.mediaType==='reading'&&syncedPlayer.room.mediaId===session.workId&&syncedPlayer.room.edition===session.edition&&canControlPlayback()&&!syncedPlayer.changing)publishReading(syncedPlayer.room.id,location);
   }})).then(result=>{
    if(controller.signal.aborted){result.destroy();return;}engine=current=result;
    if(result.resize){
     let width=host.clientWidth,height=host.clientHeight;
     resize=new ResizeObserver(()=>{const nextWidth=host.clientWidth,nextHeight=host.clientHeight;if(width===nextWidth&&height===nextHeight)return;width=nextWidth;height=nextHeight;
      void result.resize!().catch(cause=>{if(!controller.signal.aborted)reader.error=message(cause);});
     });resize.observe(host);
    }
    setReadingNavigator(async location=>{
     const revision=++navigation;external=true;
     try{await result.go(location);if(!ownsNavigation(revision))return;reader.location=location;void recordReading(location);}
     catch(cause){if(ownsNavigation(revision))throw cause;}
     finally{if(ownsNavigation(revision))external=false;}
    });
   }).catch(cause=>{if(!controller.signal.aborted)reader.error=message(cause);}).finally(()=>{if(!controller.signal.aborted){loading=false;reader.rendering=false;}});
  return ()=>{clearInterval(heartbeat);resize?.disconnect();controller.abort();navigation++;if(readerOwner===owner){readerOwner++;busy=false;}external=false;current?.destroy();setReadingNavigator(null);engine=undefined;reader.rendering=false;};
 });
 async function turn(direction:'previous'|'next'){
  if(busy||!controlled||!engine)return;
  const current=engine,owner=readerOwner,sessionId=reader.session?.id;busy=true;
  const ownsTurn=()=>readerOwner===owner&&engine===current&&reader.session?.id===sessionId&&reader.visible;
  try{await current[direction]();}catch(cause){if(ownsTurn())reader.error=message(cause);}finally{if(ownsTurn())busy=false;}
 }
</script>
<svelte:window onkeydown={event=>{if(!reader.visible||event.target instanceof HTMLInputElement)return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();void turn(event.key==='ArrowLeft'?'previous':'next');}}} />
<Dialog bind:open={reader.visible} title={reader.session?.title??'Reader'} wide edgeToEdge onclose={()=>{if(minimizing){minimizing=false;return;}if(!reader.visible&&reader.session)close();}}>
 {#snippet heading()}<div class="reader-heading spread"><strong>{reader.session?.title}</strong><div class="row"><Button emphasis="subtle" onclick={()=>{minimizing=true;reader.visible=false;}}>Show UI</Button><Button size="icon" icon="close" label="Close reader" onclick={close} /></div></div>{/snippet}
 {#if reader.error}<div role="alert" class="notice error">{reader.error}{#if reader.unsaved}<Button emphasis="subtle" onclick={()=>void retryReadingSave()}>Retry save</Button>{/if}</div>{/if}
 <div class="reading-view" bind:this={host} aria-busy={loading}></div>
 <div class="reader-controls"><Button icon="left" label="Previous page" disabled={loading||busy||!controlled} onclick={()=>void turn('previous')} /><span aria-live="polite">{loading?'Opening…':readingLocationLabel(reader.location)}</span><Button icon="right" label="Next page" disabled={loading||busy||!controlled} onclick={()=>void turn('next')} /></div>
 <div class="reader-progress"><ProgressBar progress={readingFraction(reader.location)} label="Reading progress" /></div>
</Dialog>
<style>
 .reader-heading{padding:16px;gap:16px;}.reader-heading strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .reading-view{height:max(0px,calc(85dvh - 150px));min-height:0;display:flex;align-items:center;justify-content:center;overflow:auto;background:var(--white);color:var(--black);}
 .reading-view :global(canvas),.reading-view :global(img){max-width:100%;max-height:100%;object-fit:contain;}
 .reader-controls{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px;}.reader-controls span{font-size:var(--text-sm);}
 .reader-progress{height:6px;}
</style>
