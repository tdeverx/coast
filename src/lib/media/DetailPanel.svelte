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
 let loadedViewer:string|undefined;
 let editionName=$state<string>();
 type Detail=Awaited<ReturnType<typeof import('$lib/application/work-details.server').mediaDetailData>>|{kind:'row';data:{href:string}};
 type EnhancedDetails=Awaited<Awaited<ReturnType<typeof import('$lib/application/media-details.server').loadMediaDetails>>['enhancement']>;
 let resolved=$state.raw<{href:string;detail:Detail;enhancement?:Promise<EnhancedDetails>}|null>(null);
 const data=$derived(resolved?.detail);
 const shownHref=$derived(resolved?.href);
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
 const refreshKey=$derived(JSON.stringify([contentRevisionKey(page.data,['tracking']),page.data.capabilities]));
 function closed(){if(playbackVisible(player)||reader.visible)return;closeMediaDetails();}
 $effect(()=>{
  const href=page.state.mediaDetailHref,viewer=page.data.user?.id,target=href?mediaDetailTarget(href,page.url)??sectionTarget(href,page.url):null;
  if(!href||viewer!==loadedViewer){open=false;resolved=null;editionName=undefined;}
  loadedViewer=viewer;error='';
  if(!target||!viewer||!href)return;
  refreshKey;
  const controller=new AbortController();
  const response=!('kind' in target)?Promise.resolve<Detail>({kind:'row',data:{href:target.href}}):api<Detail>(`media/details?href=${encodeURIComponent(target.href)}`,undefined,'GET',{signal:controller.signal});
  void response
   .then(async result=>{
    if(controller.signal.aborted)return;
    let enhancement:Promise<EnhancedDetails>|undefined;
    if(result.kind==='screen'){
     Details=(await import('$lib/media/Details.svelte')).default;
     if(controller.signal.aborted)return;
     enhancement=api<{kind:string;data:EnhancedDetails}>(`media/details?href=${encodeURIComponent(target.href)}&enhance=true`,undefined,'GET',{signal:controller.signal})
      .then(enhanced=>{if(enhanced.kind!=='screen')throw new Error('This title changed. Open its details again.');return enhanced.data;})
      .catch(()=>({...result.data,requestable:false,refreshUnavailable:true}));
    }else if(result.kind==='reading')ReadingDetails=(await import('$lib/reading/Details.svelte')).default;
    else if(result.kind==='game')GameDetails=(await import('$lib/games/Details.svelte')).default;
    else if(result.kind==='music')MusicDetails=(await import('$lib/music/Details.svelte')).default;
    else if(result.kind==='reading-group')GroupDetails=(await import('$lib/reading/GroupDetails.svelte')).default;
    else if(result.kind==='remote-game')RemoteGameDetails=(await import('$lib/games/RemoteDetails.svelte')).default;
    else if(result.kind==='row')RowDetails=(await import('$lib/ui/pages/SectionDetails.svelte')).default;
    else PersonDetails=(await import('$lib/media/PersonDetails.svelte')).default;
    if(!controller.signal.aborted){
     if(shownHref!==href)editionName=result.kind==='screen'&&'edition' in target&&target.edition!==null?namedEdition(target.edition,result.data.item.title).value:undefined;
     resolved={href,detail:result,enhancement};open=true;
    }
   })
   .catch(cause=>{if(!controller.signal.aborted){error=message(cause);if(isFeatureDisabled(cause)||cause instanceof ApiError&&[401,403].includes(cause.status)){resolved=null;open=false;}if(!data)closeMediaDetails();else if(shownHref!==href)backMediaDetails();}});
  return ()=>controller.abort();
 });


  reportFailure(()=>error);
</script>
<DetailOverlay sectionPage={data?.kind==='row'} open={open&&!playbackVisible(player)&&!reader.visible} {editions} bind:editionName onclose={data?closed:undefined} onback={(page.state.mediaDetailDepth??1)>1?backMediaDetails:undefined} contentKey={shownHref}>

 <div class="detail-content" inert={shownHref!==page.state.mediaDetailHref} aria-busy={shownHref!==page.state.mediaDetailHref}>
 <!-- Each keyed item owns its payload until disposal, including outgoing section chrome reads. -->
 {#each resolved?[resolved]:[] as view (`${view.href}:${view.detail.kind}`)}
  {#if view.detail.kind==='row'&&RowDetails}<RowDetails href={view.detail.data.href}/>
  {:else if view.detail.kind==='reading'&&ReadingDetails}<ReadingDetails modal detailHref={view.href} data={view.detail.data}/>
  {:else if view.detail.kind==='game'&&GameDetails}<GameDetails modal detailHref={view.href} data={view.detail.data}/>
  {:else if view.detail.kind==='music'&&MusicDetails}<MusicDetails modal detailHref={view.href} data={view.detail.data}/>
  {:else if view.detail.kind==='reading-group'&&GroupDetails}<GroupDetails detailHref={view.href} data={view.detail.data}/>
  {:else if view.detail.kind==='remote-game'&&RemoteGameDetails}<RemoteGameDetails detailHref={view.href} data={view.detail.data}/>
  {:else if view.detail.kind==='person'&&PersonDetails}<PersonDetails detailHref={view.href} data={view.detail.data}/>
  {:else if view.detail.kind==='screen'&&Details&&view.enhancement}<Details modal detailHref={view.href} {editionName} data={{...view.detail.data,requestable:false,refreshUnavailable:false,enhancement:view.enhancement}}/>{/if}
 {/each}
 </div>
</DetailOverlay>
<style>.detail-content {display:contents;}</style>
