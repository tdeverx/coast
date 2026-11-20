<script lang="ts">
 import {page} from '$app/state';
 import {workFriendFilters} from '#lib/social/model.js';
 import {detailActivity} from '../pages/detail';
 import type {Snippet} from 'svelte';
 import MediaPage from './MediaPage.svelte';
 import Shelf from './Shelf.svelte';
 import MediaDetailRows from './MediaDetailRows.svelte';
 import type {DetailPage,DetailRow} from '../pages/detail';
 import type {DetailRowsModel} from '../pages/detail-rows';
 import {artworkColour} from '../artwork-colour';
 import TasteMatch from '#lib/profile/TasteMatch.svelte';
 let {view,model,section,detailHref,artwork=[],before=[],after=[],intro,hierarchy,heroActions:actions,children:content}:{view:DetailPage;model?:DetailRowsModel;section?:string|null;detailHref?:string;artwork?:(string|null|undefined)[];before?:DetailRow[];after?:DetailRow[];intro?:Snippet;hierarchy?:Snippet;heroActions?:Snippet;children?:Snippet}=$props();
 const activity=$derived(detailActivity(view.item));
 const destination=$derived(new URL(detailHref??(view.item&&'href' in view.item?view.item.href:`/media/${view.item?.id}`),page.url.href));
 const selectedSection=$derived(section??destination.searchParams.get('section'));
 const tasteId=$derived.by(()=>{
  if(!view.item||!['movie','show','season','episode','album','track','artist','game','book','comic'].includes(view.item.kind))return;
  const id='href' in view.item?view.item.workId:view.item.id;
  if(id&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))return id;
 });
 const activityHref=$derived.by(()=>{const url=new URL(destination);url.searchParams.set('section','activity');return url.pathname+url.search;});
 const colours=$derived([...new Set([...artwork,view.item?.backdrop,view.item?.artwork?.backdrop,view.item?.poster,view.item?.artwork?.primary,
  ...(view.parents??[]).flatMap(parent=>[parent.backdrop,parent.poster]),view.item?.artwork?.thumb,view.item?.artwork?.banner].filter((url):url is string=>!!url))]);
</script>
<div class="detail-presentation" use:artworkColour={colours}>
<MediaPage {...view} hero={selectedSection?false:view.hero??true} links={selectedSection?[]:view.links} heroAlignment={view.heroAlignment??'left'} details heroActions={actions}>
 {#snippet children()}
 {@render intro?.()}
 {@render hierarchy?.()}
 {#if tasteId&&!selectedSection&&page.data.user&&page.data.capabilities.personalisation}
  {#key `${page.data.user.id}:${tasteId}`}<TasteMatch workId={tasteId}/>{/key}
 {/if}
 {#each before as row(row.key)}<Shelf {...row.shelf} />{/each}
 {#if model&&selectedSection!=='activity'}<MediaDetailRows {model} section={selectedSection}/>{/if}
 {#if activity&&page.data.user&&page.data.capabilities?.social!==false&&(!selectedSection||selectedSection==='activity')}
  <Shelf source={{type:'social',title:'Activity',...activity,relationship:workFriendFilters.find(value=>value===destination.searchParams.get('relationship'))??'all',relationshipKind:activity.category==='reading'&&view.item?.kind==='collection'?'comic':view.item?.kind,href:activityHref,layout:selectedSection?'grid':'row'}} availability={false} enrichSocial={false} hideEmpty={false}/>
 {/if}
 {#each after as row(row.key)}<Shelf {...row.shelf} />{/each}
 {@render content?.()}
 {/snippet}
</MediaPage>
</div>
