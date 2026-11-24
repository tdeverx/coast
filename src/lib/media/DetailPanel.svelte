<script lang="ts">
  import { reportFailure } from '#lib/ui/client-context.js';
 import {player} from '#lib/playback/client.svelte.js';
 import {reader} from '#lib/reading/client.svelte.js';
 import {playbackVisible} from '#lib/playback/visibility.js';
 import { page } from '$app/state';
 import { preloadData } from '$app/navigation';
 import {backMediaDetails,closeMediaDetails,inviteProfileTarget,navigateMedia} from '#lib/ui/media-navigation.js';
 import {sectionTarget} from '#lib/ui/section-target.js';
 import {detailPanelHref,mediaDetailTarget,panelAddress} from '#lib/media/detail-target.js';
 import DetailOverlay from '#lib/ui/components/DetailOverlay.svelte';
 import {editionChoices,namedEdition} from '#lib/media/editions.js';
 import { contentRevisionKey } from '#lib/ui/content-revision.svelte.js';
 import { api,message,ApiError,isFeatureDisabled } from '#lib/ui/client.js';
 let open=$state(false),error=$state('');
 let loadedViewer:string|undefined;
 let editionName=$state<string>();
 type Profile=Awaited<ReturnType<typeof import('#lib/profile/details.server.js').loadProfileDetails>>;
 type Detail=Awaited<ReturnType<typeof import('#lib/application/work-details.server.js').mediaDetailData>>
   |{kind:'personalise'}
   |{kind:'row';data:{href:string;artwork?:string}}
   |{kind:'profile';data:Omit<Profile,'activity'>&{activity:Awaited<Profile['activity']>}};
 type EnhancedDetails=Awaited<Awaited<ReturnType<typeof import('#lib/application/media-details.server.js').loadMediaDetails>>['enhancement']>;
 let resolved=$state.raw<{href:string;depth:number;detail:Detail;enhancement?:Promise<EnhancedDetails>}|null>(null);
 const data=$derived(resolved?.detail);
 const shownHref=$derived(resolved?.href);
 const editions=$derived(data?.kind==='screen'?editionChoices(data.data.availability.map(source=>source.edition),data.data.item.title):[]);
 $effect(()=>{const choices=editions;if(!choices.some(option=>option.value===editionName))editionName=choices.length>1?choices[0].value:undefined;});
 let Details=$state<typeof import('#lib/media/Details.svelte').default>();
 let ReadingDetails=$state<typeof import('#lib/reading/Details.svelte').default>();
 let GameDetails=$state<typeof import('#lib/games/Details.svelte').default>();
 let MusicDetails=$state<typeof import('#lib/music/Details.svelte').default>();
 let GroupDetails=$state<typeof import('#lib/reading/GroupDetails.svelte').default>();
 let RemoteGameDetails=$state<typeof import('#lib/games/RemoteDetails.svelte').default>();
 let RowDetails=$state<typeof import('#lib/ui/pages/SectionDetails.svelte').default>();
 let PersonDetails=$state<typeof import('#lib/media/PersonDetails.svelte').default>();
 let ProfileDetails=$state<typeof import('#lib/profile/Details.svelte').default>();
 let PersonaliseEditor=$state<typeof import('#lib/ui/cards/editor/PersonaliseEditor.svelte').default>();
 const refreshKey=$derived(JSON.stringify([contentRevisionKey(page.data,['tracking']),page.data.capabilities]));
 const profileRevision=$derived(contentRevisionKey(page.data,['social']));
 const currentHref=$derived(detailPanelHref(panelAddress(page),page.state));
 async function publicProfile(href:string):Promise<Detail> {
   const result=await preloadData(href);
   if(result.type!=='loaded'||result.status!==200||!result.data.profile?.visibility.details)throw new ApiError('This profile is private or unavailable.',404);
   const profile:Profile=result.data.profile;
   return {kind:'profile',data:{...profile,activity:await profile.activity}};
 }
 function closed(){if(playbackVisible(player)||reader.visible)return;closeMediaDetails();}
 $effect(()=>{
  const href=currentHref,depth=page.state.mediaDetailDepth??1,viewer=page.data.user?.id,target=href?mediaDetailTarget(href,page.url)??sectionTarget(href,page.url):null;
  if(!href||viewer!==loadedViewer){open=false;resolved=null;editionName=undefined;}
  loadedViewer=viewer;error='';
  if(!href||!viewer&&!inviteProfileTarget(href))return;
  if(!target||'kind' in target&&target.kind==='profile'&&page.data.user?.access?.libraryOnly){
    void closeMediaDetails();
    return;
  }
  if ('kind' in target && target.kind === 'personalise' && page.data.capabilities?.cardLayouts !== true) {
    open=false;resolved=null;
    void closeMediaDetails();
    return;
  }
  refreshKey;
  const controller=new AbortController();
  if ('kind' in target && target.kind === 'profile') profileRevision;
  const response = !viewer ? publicProfile(target.href) : !('kind' in target) ? Promise.resolve<Detail>({kind:'row',data:{href:target.href}})
    : target.kind==='personalise' ? Promise.resolve<Detail>({kind:'personalise'})
    : api<Detail>(`${target.kind === 'profile' ? 'profile/presentation' : 'media/details'}?href=${encodeURIComponent(target.href)}`,
      undefined,'GET',{signal:controller.signal});
  void response
   .then(async result=>{
    if(controller.signal.aborted)return;
    let enhancement:Promise<EnhancedDetails>|undefined;
    if(result.kind==='screen'){
     Details=(await import('#lib/media/Details.svelte')).default;
     if(controller.signal.aborted)return;
     enhancement=api<{kind:string;data:EnhancedDetails}>(`media/details?href=${encodeURIComponent(target.href)}&enhance=true`,undefined,'GET',{signal:controller.signal})
      .then(enhanced=>{if(enhanced.kind!=='screen')throw new Error('This title changed. Open its details again.');return enhanced.data;})
      .catch(()=>({...result.data,requestable:false}));
    }else if(result.kind==='reading')ReadingDetails=(await import('#lib/reading/Details.svelte')).default;
    else if(result.kind==='game')GameDetails=(await import('#lib/games/Details.svelte')).default;
    else if(result.kind==='music')MusicDetails=(await import('#lib/music/Details.svelte')).default;
    else if(result.kind==='reading-group')GroupDetails=(await import('#lib/reading/GroupDetails.svelte')).default;
    else if(result.kind==='remote-game')RemoteGameDetails=(await import('#lib/games/RemoteDetails.svelte')).default;
    else if(result.kind==='row')RowDetails=(await import('#lib/ui/pages/SectionDetails.svelte')).default;
    else if(result.kind==='profile')ProfileDetails=(await import('#lib/profile/Details.svelte')).default;
    else if(result.kind==='personalise')PersonaliseEditor=(await import('#lib/ui/cards/editor/PersonaliseEditor.svelte')).default;
    else PersonDetails=(await import('#lib/media/PersonDetails.svelte')).default;
    if(!controller.signal.aborted){
     if(shownHref!==href)editionName=result.kind==='screen'&&'edition' in target&&target.edition!==null?namedEdition(target.edition,result.data.item.title).value:undefined;
     resolved={href,depth,detail:result,enhancement};open=true;
    }
   })
   .catch(cause=>{
     if(controller.signal.aborted)return;
     error=message(cause);
     // Unshared profile sections deliberately respond with 404. A refresh can revoke the visible one.
     const withdrawnProfile=cause instanceof ApiError && cause.status===404 && resolved?.detail.kind==='profile' && resolved.href===href;
     if(withdrawnProfile||isFeatureDisabled(cause)||cause instanceof ApiError&&[401,403].includes(cause.status)){resolved=null;open=false;}
     if(!resolved)void closeMediaDetails();
     else if(resolved.href!==href) {
       if(resolved.detail.kind==='profile'&&resolved.depth===depth)void navigateMedia(resolved.href,{replace:true});
       else void backMediaDetails();
     }
   });
  return ()=>controller.abort();
 });


  reportFailure(()=>error);
</script>
<DetailOverlay sectionPage={data?.kind==='row'} preserveHero={data?.kind==='profile'} customControls={data?.kind==='personalise'} title={data?.kind==='personalise'?'Personalise':undefined} open={open&&!playbackVisible(player)&&!reader.visible} {editions} bind:editionName onclose={data?closed:undefined} onback={(page.state.mediaDetailDepth??1)>1?backMediaDetails:undefined} contentKey={shownHref}>

 <div class="detail-content" inert={shownHref!==currentHref} aria-busy={shownHref!==currentHref}>
 <!-- Each keyed item owns its payload until disposal, including outgoing section chrome reads. -->
 {#each resolved?[resolved]:[] as view (`${view.href}:${view.detail.kind}`)}
  {#if view.detail.kind==='personalise'&&PersonaliseEditor}<PersonaliseEditor onclose={closed}/>
  {:else if view.detail.kind==='row'&&RowDetails}<RowDetails href={view.detail.data.href} artwork={view.detail.data.artwork}/>
  {:else if view.detail.kind==='reading'&&ReadingDetails}<ReadingDetails modal detailHref={view.href} data={view.detail.data}/>
  {:else if view.detail.kind==='game'&&GameDetails}<GameDetails modal detailHref={view.href} data={view.detail.data}/>
  {:else if view.detail.kind==='music'&&MusicDetails}<MusicDetails modal detailHref={view.href} data={view.detail.data}/>
  {:else if view.detail.kind==='reading-group'&&GroupDetails}<GroupDetails detailHref={view.href} data={view.detail.data}/>
  {:else if view.detail.kind==='remote-game'&&RemoteGameDetails}<RemoteGameDetails detailHref={view.href} data={view.detail.data}/>
  {:else if view.detail.kind==='person'&&PersonDetails}<PersonDetails detailHref={view.href} data={view.detail.data}/>
  {:else if view.detail.kind==='profile'&&ProfileDetails}<ProfileDetails modal detailHref={view.href}
    data={{...view.detail.data,activity:Promise.resolve(view.detail.data.activity)}}/>
  {:else if view.detail.kind==='screen'&&Details&&view.enhancement}<Details modal detailHref={view.href} {editionName} data={{...view.detail.data,requestable:false,enhancement:view.enhancement}}/>{/if}
 {/each}
 </div>
</DetailOverlay>
<style>.detail-content {display:contents;}</style>
