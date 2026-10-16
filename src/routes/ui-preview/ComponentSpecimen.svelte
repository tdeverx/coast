<script lang="ts">
 import {createRawSnippet,untrack,type Component,type Snippet} from 'svelte';
 import Button from '$lib/ui/components/Button.svelte';
 import Avatar from '$lib/ui/components/Avatar.svelte';
 import Field from '$lib/ui/components/Field.svelte';
 import PlaybackTimeline from '$lib/ui/components/PlaybackTimeline.svelte';
 import {usePlayback} from '$lib/playback/context.svelte';
 import {contracts,defaultSlot,handlerMode,specimenDefaults,type Customisation,type SlotChoice} from './props';
 import {id,movie} from './demo/fixtures';
 let {name,custom,change,onevent}:{name:string;custom:Customisation;change:(key:string,value:unknown)=>void;onevent:(name:string,args:unknown[])=>void}=$props();
 const loaders=import.meta.glob<{default:Component<any>}>('/src/lib/ui/components/*.svelte');
 let Current=$state<Component<any>>(),failure=$state(''),instance=$state<any>();
 const {player}=usePlayback();
 const defaults=$derived(specimenDefaults(name));
 const customSlots=$derived(custom.slots);
 const customCallbacks=$derived(custom.callbacks);
 $effect(()=>{
  const selected=name;let cancelled=false;Current=undefined;failure='';
  void loaders[contracts[selected].path.replace(/^src\//,'/src/')]().then(module=>{if(!cancelled)Current=module.default;}).catch(()=>{if(!cancelled)failure='The component could not load. Select it again to retry.';});
  if(selected==='PersistentPlayer')untrack(()=>{
   player.session={id,mediaId:id,mediaType:'audio',title:'Preview track',detail:'Preview artist · Preview album',artwork:movie.poster,url:'',kind:'direct',startSeconds:0,durationSeconds:240,provider:'Preview',defaultSubtitleIndex:null,subtitlePrompt:false,subtitles:[],sources:[]};player.role='playback';player.paused=true;player.controlsVisible=true;
  });
  return()=>{cancelled=true;if(selected==='PersistentPlayer'){player.session=null;player.role='idle';}};
 });
 function update(key:string,value:unknown) {if(contracts[name].props.some(prop=>prop.name===key))change(key,value);}
 function callback(key:string,args:unknown[],mode:'example'|'record'|'off') {
  if(key==='pageUrl')return `#preview-page-${args[0]}`;
  onevent(key,args);
  if(mode==='record')return;
  if(key==='change'||key==='onchange')update(name==='Pagination'?'page':'value',args[0]);
  if(key==='onrated')update('value',args[0]);
  if(key==='onseek')update('current',args[0]);
  if(key==='onpage')update(name==='Shelf'?'pageNumber':'page',args[0]);
  if(key==='onclose'||key==='cancel')update('open',false);
 }
 function slot(choice:SlotChoice):Snippet|undefined {
  if(choice.kind==='hidden')return undefined;
  if(choice.kind==='text')return createRawSnippet(()=>({render:()=>`<span>${choice.text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!))}</span>`}));
  return ({actions:actionSlot,avatar:avatarSlot,field:fieldSlot,timeline:timelineSlot} as Record<string,Snippet>)[choice.kind];
 }
 const slotProps=$derived.by(()=>Object.fromEntries(contracts[name].props.filter(prop=>prop.kind==='snippet').map(prop=>[prop.name,slot(customSlots[prop.name]?.kind&&customSlots[prop.name].kind!=='example'?customSlots[prop.name]:defaultSlot(name,prop))])));
 const callbackProps=$derived.by(()=>Object.fromEntries(contracts[name].props.filter(prop=>prop.kind==='callback').map(prop=>{
  const mode=handlerMode(name,prop,{props:{},slots:{},callbacks:customCallbacks});
  return [prop.name,mode==='off'?undefined:(...args:unknown[])=>callback(prop.name,args,mode)];
 })));
 const resolvedProps=$derived.by(()=>{
  const values={...defaults,...custom.props,...slotProps,...callbackProps};
  // Structured callback contracts retain their presenter, with local updates.
  for(const key of ['groups','filterGroups'])if(Array.isArray(values[key]))values[key]=values[key].map((group:any,index:number)=>({...group,change:(value:string)=>{onevent(`${key}[${index}].change`,[value]);change(key,(values[key] as any[]).map((entry,i)=>i===index?{...entry,value}:entry));}}));
  if(values.selection&&typeof values.selection==='object')values.selection={...values.selection,change:(value:string)=>{onevent('selection.change',[value]);change('selection',{...values.selection as object,value});}};
  if(Array.isArray(values.commands))values.commands=values.commands.map((command:any)=>({...command,run:()=>onevent('commands.run',[command.label])}));
  return values;
 });
 // Only structural choices remount; ordinary text, color and number edits stay reactive.
 const structure=$derived(JSON.stringify([name,resolvedProps.menu,resolvedProps.mode,resolvedProps.source??null]));
 const bindings=$derived(contracts[name].props.filter(prop=>prop.bindable).map(prop=>prop.name));
</script>

{#snippet actionSlot()}{#if name==='FormActions'}<Button onclick={()=>onevent('slot.action',['Save'])}>Save</Button>{:else}<Button menu label="Preview actions"><Button item icon="heart" onclick={()=>onevent('slot.action',['Favourite'])}>Favourite</Button><Button item icon="bookmark" onclick={()=>onevent('slot.action',['Watchlist'])}>Watchlist</Button></Button>{/if}{/snippet}
{#snippet avatarSlot()}<Avatar name="Alice" size={48} status="online" />{/snippet}
{#snippet fieldSlot()}{#if name==='SettingsRow'}<input type="checkbox" aria-label="Preview enabled" />{:else if name==='Field'}<input placeholder="Your display name" oninput={event=>onevent('slot.input',[event.currentTarget.value])} />{:else}<Field label="Preview input"><input placeholder="Your display name" oninput={event=>onevent('slot.input',[event.currentTarget.value])} /></Field>{/if}{/snippet}
{#snippet timelineSlot()}<PlaybackTimeline mediaId={movie.id} title={movie.title} detail="2026 · Movie" artwork={movie.poster} current={1800} duration={6600} />{/snippet}

{#snippet component()}
 {#if Current}
  {#if bindings.includes('open')}<Current {...resolvedProps} bind:open={()=>Boolean(resolvedProps.open),value=>change('open',value)} bind:this={instance} />
  {:else if name==='AvatarPicker'}<Current {...resolvedProps} bind:avatar={()=>resolvedProps.avatar??null,value=>change('avatar',value)} bind:reading={()=>Boolean(resolvedProps.reading),value=>change('reading',value)} />
  {:else if name==='SegmentedControl'}<Current {...resolvedProps} bind:value={()=>resolvedProps.value,value=>change('value',value)} />
  {:else if name==='RowStyleMenu'}<Current {...resolvedProps} bind:this={instance} bind:overridePriority={()=>resolvedProps.overridePriority??null,value=>change('overridePriority',value)} bind:overrideShape={()=>resolvedProps.overrideShape??null,value=>change('overrideShape',value)} bind:overrideArtwork={()=>resolvedProps.overrideArtwork??null,value=>change('overrideArtwork',value)} bind:overrideOverlay={()=>resolvedProps.overrideOverlay??null,value=>change('overrideOverlay',value)} />
  {:else if name==='PlaybackTimeline'}<Current {...resolvedProps} bind:scrubbing={()=>Boolean(resolvedProps.scrubbing),value=>change('scrubbing',value)} />
  {:else if name==='Shelf'}<Current {...resolvedProps} bind:availableOnly={()=>Boolean(resolvedProps.availableOnly),value=>change('availableOnly',value)} />
  {:else}<Current {...resolvedProps} bind:this={instance} />{/if}
 {/if}
{/snippet}

<div class="component-specimen" class:wide={['MediaHero','MediaPage','Shelf','Header'].includes(name)} data-custom-component={name}>
 {#if failure}<p class="small text-danger" role="alert">{failure}</p>
 {:else if !Current}<p class="quiet" role="status">Loading component…</p>
 {:else}
  {#key structure}<svelte:boundary>
   {#if ['ChoiceGroup','WorkActions','WorkListActions','RecommendAction'].includes(name)}<Button menu label={`Preview ${name} menu`}>{@render component()}</Button>
   {:else if name==='ProgressBar'}<div class="passive-bar">{@render component()}</div>
   {:else if name==='MediaCard'}<div class="specimen-card">{@render component()}</div>
   {:else}{@render component()}{/if}
   {#snippet failed(error,reset)}<div class="stack"><p role="alert">This combination cannot render: {error instanceof Error?error.message:'Check the prop data.'}</p><p class="small quiet">Correct the props in the Customiser, then retry. The rest of the playground remains available.</p><Button emphasis="subtle" onclick={reset}>Retry preview</Button></div>{/snippet}
  </svelte:boundary>{/key}
  {#if name==='RowStyleMenu'}<Button onclick={()=>instance?.openAt?.({x:48,y:160})}>Open style menu</Button>{/if}
  {#if name==='SyncedControls'}<p class="small quiet">This controller has no attached live party in isolation. Explore PartyCard and PartyMenu to change their presentation.</p>{/if}
 {/if}
</div>
<style>
  .component-specimen {position:relative;contain:layout;min-width:0;min-height:320px;display:grid;align-content:safe center;justify-items:center;gap:16px;width:100%;}
 .component-specimen.wide {justify-items:stretch;}
 .component-specimen > :global(*) {max-width:100%;min-width:0;}
 .specimen-card {width:min(300px,100%);}
 .passive-bar {width:min(360px,100%);height:6px;}
</style>
