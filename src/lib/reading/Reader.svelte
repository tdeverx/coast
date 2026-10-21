<script lang="ts">
 import { reader as applicationReader, closeReading, recordReading, publishReading, setReadingNavigator, setReadingExit, retryReadingSave } from './client.svelte';
 import { useClient, reportFailure } from '#lib/ui/client-context.js';
 import { page } from '$app/state';
 import { untrack } from 'svelte';
 import { fade } from 'svelte/transition';
 import type { ReadingLocation, ReadingSessionView } from './model';
 import { readingFraction, readingLocationLabel, sameReadingLocation } from './model';
 import { syncedPlayer, canControlPlayback } from '#lib/playback/synced/client.svelte.js';
 import Dialog from '#lib/ui/components/Dialog.svelte';
 import Button from '#lib/ui/components/Button.svelte';
 import ProgressBar from '#lib/ui/components/ProgressBar.svelte';
 import OperationProgress from '#lib/ui/components/OperationProgress.svelte';
 import { api, message, isFeatureDisabled, ApiError } from '#lib/ui/client.js';
 import type { ReaderEngine } from './reader/engine';
 import type { ReaderProgress } from './reader/load';
 const { preview } = useClient();
 let { example }: { example?: { title: string; state?: 'ready'|'opening'|'error'|'unsaved'|'follower' } } = $props();
 const sample = $state({ visible:false, file:null as File|null, session:null as ReadingSessionView|null, location:{format:'cbz',page:1,total:8} as ReadingLocation|null, error:'',unsaved:false,rendering:false });
 const reader = $derived(preview ? sample : applicationReader);
 $effect(() => {
  const value=example;if(!preview||!value)return;
  untrack(()=>{sample.visible=false;sample.session={id:'preview-reader',workId:'preview-book',kind:'book',title:value.title,format:'cbz',edition:'Preview edition',location:{format:'cbz',page:1,total:8},url:null,source:'local'};sample.location=sample.session.location;sample.error=value.state==='error'?'The preview file could not be opened.':value.state==='unsaved'?'Your last bookmark could not be saved.':'';sample.unsaved=value.state==='unsaved';});
 });
 let host=$state<HTMLElement>();
 let engine:ReaderEngine|undefined,busy=$state(false),loading=$state(false);
 let loadProgress=$state<ReaderProgress>({phase:'prepare'});
 const loadingLabel=$derived(loadProgress.phase==='download'?`Downloading ${reader.session?.kind==='comic'?'comic':'book'}…`:loadProgress.phase==='inspect'?'Checking pages…':loadProgress.phase==='render'?'Preparing reader…':`Opening ${reader.session?.kind==='comic'?'comic':'book'}…`);
 const loadingTotal=$derived(Number.isFinite(loadProgress.total)&&loadProgress.total!>0?loadProgress.total!:null);
 const loadingDetail=$derived(loadProgress.phase==='download'?`${((loadProgress.loaded??0)/1_000_000).toFixed(1)}${loadingTotal===null?' MB downloaded':` of ${(loadingTotal/1_000_000).toFixed(1)} MB · ${Math.min(100,Math.round((loadProgress.loaded??0)/loadingTotal*100))}%`}`:loadProgress.phase==='inspect'?`${loadProgress.loaded??0} of ${loadingTotal??'unknown'} pages`:reader.session?.title??'');
 const following=$derived(!preview&&syncedPlayer.room?.mediaType==='reading'&&!!reader.session&&syncedPlayer.room.mediaId===reader.session.workId&&syncedPlayer.room.edition===reader.session.edition&&syncedPlayer.room.readingFormat===reader.session.format);
 const controlled=$derived(preview ? example?.state!=='follower' : !following||canControlPlayback());
 let external=false,minimizing=false,readerOwner=0;
 function backdropDuration(){return typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches?0:250;}
 function close(){if(preview){sample.visible=false;return;}void closeReading().catch(()=>{/* Keep the unsaved bookmark and its retry notice visible. */});}
 $effect(()=>{
  if(preview)return;
  const session=reader.session,file=reader.file;if(!session||!host||!reader.visible)return;
  const surface=host;
  const initialLocation=untrack(()=>reader.location??session.location);
  const sanitizeOddPages=untrack(()=>page.data.user?.settings?.sanitizeOddReadingPages!==false);
  const controller=new AbortController(),owner=++readerOwner;let current:ReaderEngine|undefined,resize:ResizeObserver|undefined,navigation=0;loadProgress={phase:'prepare'};loading=true;reader.rendering=true;
  let exiting=false;
  setReadingExit(()=>{exiting=true;navigation++;return current?.leave?.()??Promise.resolve();});
  let heartbeatPending=false;
  const heartbeat=setInterval(()=>{
   if(document.hidden||!reader.visible||controller.signal.aborted||heartbeatPending)return;
   heartbeatPending=true;
   void api(`reading/sessions/${session.id}/heartbeat`,{},'POST',{signal:controller.signal})
    .catch(cause=>{if(!controller.signal.aborted&&(isFeatureDisabled(cause)||cause instanceof ApiError&&cause.status===410)&&reader.session?.id===session.id)void closeReading(true,false).catch(()=>{});})
    .finally(()=>{heartbeatPending=false;});
  },60000);
  const ownsNavigation=(revision:number)=>!exiting&&!controller.signal.aborted&&revision===navigation&&reader.session?.id===session.id;
  void import('./reader/engine').then(module=>module.createReader({host:surface,source:file??session.url!,manifest:file?undefined:session.manifest,format:session.format,kind:session.kind,location:initialLocation,signal:controller.signal,sanitizeOddPages,progress:value=>{if(!controller.signal.aborted&&reader.session?.id===session.id)loadProgress=value;},dismiss:()=>{if(!controller.signal.aborted)close();},controlled:()=>controlled,failed:cause=>{if(!controller.signal.aborted&&reader.session?.id===session.id)reader.error=message(cause);},changed:location=>{
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
   }})).then(async result=>{
    if(controller.signal.aborted){result.destroy();return;}engine=current=result;
    if(result.resize){
     let width=surface.clientWidth,height=surface.clientHeight;
     resize=new ResizeObserver(()=>{const nextWidth=surface.clientWidth,nextHeight=surface.clientHeight;if(width===nextWidth&&height===nextHeight)return;width=nextWidth;height=nextHeight;
      void result.resize!().catch(cause=>{if(!controller.signal.aborted)reader.error=message(cause);});
     });resize.observe(surface);
    }
    const navigate=async(location:ReadingLocation)=>{
     if(exiting)return;
     const revision=++navigation;external=true;
     try{await result.go(location);if(!ownsNavigation(revision))return;reader.location=location;void recordReading(location);}
     catch(cause){if(ownsNavigation(revision))throw cause;}
     finally{if(ownsNavigation(revision))external=false;}
    };
    setReadingNavigator(navigate);
    const latest=reader.location;
    if(latest&&!sameReadingLocation(initialLocation,latest))await navigate(latest);
   }).catch(cause=>{if(!controller.signal.aborted)reader.error=message(cause);}).finally(()=>{if(!controller.signal.aborted){loading=false;reader.rendering=false;}});
  return ()=>{clearInterval(heartbeat);resize?.disconnect();controller.abort();navigation++;if(readerOwner===owner){readerOwner++;busy=false;setReadingExit(null);}external=false;current?.destroy();setReadingNavigator(null);engine=undefined;reader.rendering=false;};
 });
 async function turn(direction:'previous'|'next'){
  if(preview){if(!controlled||example?.state==='opening'||example?.state==='error')return;const location=sample.location;if(location&&location.format!=='epub')sample.location={...location,page:Math.min(location.total,Math.max(1,location.page+(direction==='next'?1:-1)))};return;}
  if(!controlled||!engine||busy&&!engine.canTurn?.(direction))return;
  const current=engine,owner=readerOwner,sessionId=reader.session?.id;busy=true;
  const ownsTurn=()=>readerOwner===owner&&engine===current&&reader.session?.id===sessionId&&reader.visible;
  try{await current[direction]();}catch(cause){if(ownsTurn())reader.error=message(cause);}finally{if(ownsTurn())busy=false;}
 }
  reportFailure(()=>({text:reader.error,retry:reader.unsaved ? ()=>{if(preview){sample.error='';sample.unsaved=false;}else return retryReadingSave();} : undefined}));
</script>
{#snippet loadingNotice()}
 {#if loading&&loadProgress.phase!=='render'&&!reader.error}
  <div class="reader-loading">
   <p role="status">{loadingLabel}</p>
   <OperationProgress label={loadingLabel} processed={loadProgress.loaded??0} total={loadingTotal} valueText={loadingDetail} />
   <span>{loadingDetail}</span>
  </div>
 {/if}
{/snippet}
{#if preview}<Button onclick={()=>sample.visible=true}>Open reader example</Button>{/if}
<svelte:window onkeydown={event=>{
 if(!reader.visible||event.defaultPrevented)return;
 const target=event.target;
 if(target instanceof HTMLElement&&(target.closest('input,textarea,select,button,a,[contenteditable="true"]')||!preview&&target.closest('dialog')))return;
 if(event.key==='Escape'&&!preview){event.preventDefault();close();return;}
 if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();void turn(event.key==='ArrowLeft'?'previous':'next');}
}} />
{#if preview||reader.session?.format==='epub'}
<Dialog bind:open={reader.visible} title={reader.session?.title??'Reader'} wide edgeToEdge onclose={()=>{if(minimizing){minimizing=false;return;}if(!reader.visible&&reader.session)close();}}>
 {#snippet heading()}<div class="reader-heading spread"><strong>{reader.session?.title}</strong><div class="row"><Button emphasis="subtle" onclick={()=>{minimizing=true;reader.visible=false;}}>Show UI</Button><Button size="icon" icon="close" label="Close reader" onclick={close} /></div></div>{/snippet}

 <div class="reader-surface"><div class="reading-view" bind:this={host} aria-busy={loading || preview && example?.state==='opening'}>{#if preview}<p>{example?.state==='opening'?'Opening preview…':'Preview document surface · no file or reader engine is loaded.'}</p>{/if}</div>{@render loadingNotice()}</div>
 <div class="reader-controls"><Button icon="left" label="Previous page" disabled={loading||busy||!controlled||preview&&(example?.state==='opening'||example?.state==='error')} onclick={()=>void turn('previous')} /><span aria-live="polite">{loading||preview&&example?.state==='opening'?'Opening…':readingLocationLabel(reader.location)}</span><Button icon="right" label="Next page" disabled={loading||busy||!controlled||preview&&(example?.state==='opening'||example?.state==='error')} onclick={()=>void turn('next')} /></div>
 <div class="reader-progress"><ProgressBar progress={readingFraction(reader.location)} label="Reading progress" /></div>
</Dialog>
{:else if reader.visible}
 <!-- svelte-ignore a11y_no_noninteractive_tabindex (The physical canvas is a keyboard-controlled reading surface.) -->
 <div class="physical-reader" bind:this={host} onpointerup={event=>{if(event.target===host&&!host?.querySelector('canvas'))close();}} role="application" aria-roledescription="book reader" tabindex="0" aria-label={reader.session?.title??'Book reader'} aria-describedby="physical-reader-help" aria-busy={loading}>
  <div class="reader-dim" aria-hidden="true" transition:fade|global={{duration:backdropDuration()}}></div>
  {#if loadProgress.phase==='render'}<div class="reader-blur" aria-hidden="true" transition:fade|global={{duration:backdropDuration()}}></div>{/if}
 </div>
 <span id="physical-reader-help" class="sr-only">Click to focus. Click or drag a page to turn it. Double click to read a single page. Drag outside the book to rotate, or click outside to dismiss. Use left and right arrow keys to turn pages, Escape to close, or the reading button in navigation to show the app.</span>
 <span class="sr-only" role="status">{loading?'Opening…':readingLocationLabel(reader.location)}</span>
 {@render loadingNotice()}
{/if}
<style>
 .physical-reader{position:fixed;inset:0;z-index:70;overflow:hidden;touch-action:none;outline:none;}
 .physical-reader :global(canvas){display:block;width:100%;height:100%;}
 .reader-dim,.reader-blur{position:absolute;inset:0;pointer-events:none;}
 .reader-dim{z-index:-1;background:color-mix(in srgb,var(--canvas) 75%,transparent);}
 .reader-blur{z-index:-2;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);}
 .reader-loading{position:fixed;inset:0;z-index:71;display:flex;flex-direction:column;justify-content:center;gap:12px;width:min(320px,calc(100% - 48px));margin:auto;pointer-events:none;text-align:center;color:var(--ink);}
 .reader-loading p{margin:0;font-weight:var(--weight-semibold);}.reader-loading span{font-size:var(--text-sm);overflow-wrap:anywhere;}
 .reader-surface{position:relative;}.reader-surface .reader-loading{position:absolute;z-index:1;}
 .reader-heading{padding:16px;gap:16px;}.reader-heading strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .reading-view{height:max(0px,calc(85dvh - 150px));min-height:0;display:flex;align-items:center;justify-content:center;overflow:auto;background:var(--white);color:var(--black);}
 .reading-view :global(canvas),.reading-view :global(img){max-width:100%;max-height:100%;object-fit:contain;}
 .reader-controls{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px;}.reader-controls span{font-size:var(--text-sm);}
 .reader-progress{height:6px;}
</style>
