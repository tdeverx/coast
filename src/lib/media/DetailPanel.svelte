<script lang="ts">
  import { reportFailure } from '$lib/ui/client-context';
 import {player} from '$lib/playback/client.svelte';
 import {reader} from '$lib/reading/client.svelte';
 import {playbackVisible} from '$lib/playback/visibility';
 import { page } from '$app/state';
 import {backMediaDetails,closeMediaDetails} from '$lib/ui/media-navigation';
 import {sectionTarget} from '$lib/ui/section-target';
 import {mediaDetailTarget} from '$lib/media/detail-target';
 import DetailOverlay from '$lib/ui/components/DetailOverlay.svelte';
 import {editionChoices,namedEdition} from '$lib/media/editions';
 import { contentRevisionKey } from '$lib/ui/content-revision.svelte';
 import { api,message,ApiError,isFeatureDisabled } from '$lib/ui/client';
 let open=$state(false),error=$state('');
 let shownHref=$state<string>(),loadedViewer:string|undefined;
 let editionName=$state<string>();
 type Detail=Awaited<ReturnType<typeof import('$lib/application/work-details.server').mediaDetailData>>|{kind:'row';data:{href:string}};
 let data=$state.raw<Detail|null>(null);
 const editions=$derived(data?.kind==='screen'?editionChoices(data.data.availability.map(source=>source.edition),data.data.item.title):[]);
 $effect(()=>{const choices=editions;if(!choices.some(option=>option.value===editionName))editionName=choices.length>1?choices[0].value:undefined;});
 let Details=$state<typeof import('$lib/media/Details.svelte').default>();
 let ReadingDetails=$state<typeof import('$lib/reading/Details.svelte').default>();
 let GameDetails=$state<typeof import('$lib/games/Details.svelte').default>();
 let MusicDetails=$state<typeof import('$lib/music/Details.svelte').default>();
 let GroupDetails=$state<typeof import('$lib/reading/GroupDetails.svelte').default>();
 let RemoteGameDetails=$state<typeof import('$lib/games/RemoteDetails.svelte').default>();
 let RowDetails=$state<typeof import('$lib/ui/pages/SectionDetails.svelte').default>();
 let PersonDetails=$state<typeof import('$lib/media/PersonDetails.svelte').default>();
 type EnhancedDetails=Awaited<Awaited<ReturnType<typeof import('$lib/application/media-details.server').loadMediaDetails>>['enhancement']>;
 let enhancement=$state.raw<Promise<EnhancedDetails>>();
 const refreshKey=$derived(JSON.stringify([contentRevisionKey(page.data,['tracking']),page.data.capabilities]));
 function closed(){if(playbackVisible(player)||reader.visible)return;closeMediaDetails();}
 $effect(()=>{
  const href=page.state.mediaDetailHref,viewer=page.data.user?.id,target=href?mediaDetailTarget(href,page.url)??sectionTarget(href,page.url):null;
  if(!href||viewer!==loadedViewer){open=false;data=null;shownHref=undefined;enhancement=undefined;editionName=undefined;}
  loadedViewer=viewer;error='';
  if(!target||!viewer||!href)return;
  refreshKey;
  const controller=new AbortController();
  const response=!('kind' in target)?Promise.resolve<Detail>({kind:'row',data:{href:target.href}}):api<Detail>(`media/details?href=${encodeURIComponent(target.href)}`,undefined,'GET',{signal:controller.signal});
  void response
   .then(async result=>{
    if(controller.signal.aborted)return;
    if(result.kind==='screen'){
     Details=(await import('$lib/media/Details.svelte')).default;
     if(controller.signal.aborted)return;
     enhancement=api<EnhancedDetails>(`media/${result.data.item.id}?enhance=true`,undefined,'GET',{signal:controller.signal}).catch(()=>({...result.data,requestable:false,refreshUnavailable:true}));
    }else if(result.kind==='reading')ReadingDetails=(await import('$lib/reading/Details.svelte')).default;
    else if(result.kind==='game')GameDetails=(await import('$lib/games/Details.svelte')).default;
    else if(result.kind==='music')MusicDetails=(await import('$lib/music/Details.svelte')).default;
    else if(result.kind==='reading-group')GroupDetails=(await import('$lib/reading/GroupDetails.svelte')).default;
    else if(result.kind==='remote-game')RemoteGameDetails=(await import('$lib/games/RemoteDetails.svelte')).default;
    else if(result.kind==='row')RowDetails=(await import('$lib/ui/pages/SectionDetails.svelte')).default;
    else PersonDetails=(await import('$lib/media/PersonDetails.svelte')).default;
    if(!controller.signal.aborted){
     if(shownHref!==href)editionName=result.kind==='screen'&&'edition' in target&&target.edition!==null?namedEdition(target.edition,result.data.item.title).value:undefined;
     shownHref=href;data=result;open=true;
    }
   })
   .catch(cause=>{if(!controller.signal.aborted){error=message(cause);if(isFeatureDisabled(cause)||cause instanceof ApiError&&[401,403].includes(cause.status)){data=null;open=false;}if(!data)closed();else if(shownHref!==href)backMediaDetails();}});
  return ()=>controller.abort();
 });


  reportFailure(()=>error);
</script>
<DetailOverlay sectionPage={data?.kind==='row'} open={open&&!playbackVisible(player)&&!reader.visible} {editions} bind:editionName onclose={closed} onback={(page.state.mediaDetailDepth??1)>1?backMediaDetails:undefined} contentKey={shownHref}>

 <div class="detail-content" inert={shownHref!==page.state.mediaDetailHref} aria-busy={shownHref!==page.state.mediaDetailHref}>
 {#if data}{#key shownHref}
  {#if data.kind==='row'&&RowDetails}<RowDetails href={data.data.href}/>
  {:else if data.kind==='reading'&&ReadingDetails}<ReadingDetails modal detailHref={shownHref} data={data.data}/>
  {:else if data.kind==='game'&&GameDetails}<GameDetails modal detailHref={shownHref} data={data.data}/>
  {:else if data.kind==='music'&&MusicDetails}<MusicDetails modal detailHref={shownHref} data={data.data}/>
  {:else if data.kind==='reading-group'&&GroupDetails}<GroupDetails detailHref={shownHref} data={data.data}/>
  {:else if data.kind==='remote-game'&&RemoteGameDetails}<RemoteGameDetails detailHref={shownHref} data={data.data}/>
  {:else if data.kind==='person'&&PersonDetails}<PersonDetails detailHref={shownHref} data={data.data}/>
  {:else if data.kind==='screen'&&Details&&enhancement}<Details modal detailHref={shownHref} {editionName} data={{...data.data,requestable:false,refreshUnavailable:false,enhancement}}/>{/if}
 {/key}{/if}
 </div>
</DetailOverlay>
<style>.detail-content {display:contents;}</style>
