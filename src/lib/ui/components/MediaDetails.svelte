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
 let {view,model,section,detailHref,before=[],after=[],intro,hierarchy,heroActions:actions,children:content}:{view:DetailPage;model?:DetailRowsModel;section?:string|null;detailHref?:string;before?:DetailRow[];after?:DetailRow[];intro?:Snippet;hierarchy?:Snippet;heroActions?:Snippet;children?:Snippet}=$props();
 const activity=$derived(detailActivity(view.item));
 const destination=$derived(new URL(detailHref??(view.item&&'href' in view.item?view.item.href:`/media/${view.item?.id}`),page.url.href));
 const selectedSection=$derived(section??destination.searchParams.get('section'));
 const activityHref=$derived.by(()=>{const url=new URL(destination);url.searchParams.set('section','activity');return url.pathname+url.search;});
 const colours=$derived([...new Set([view.item?.backdrop,view.item?.artwork?.backdrop,view.item?.poster,view.item?.artwork?.primary,
  ...(view.parents??[]).flatMap(parent=>[parent.backdrop,parent.poster]),view.item?.artwork?.thumb,view.item?.artwork?.banner].filter((url):url is string=>!!url))]);
</script>
<div class="detail-presentation" use:artworkColour={colours}>
<MediaPage {...view} hero={selectedSection?false:view.hero??true} links={selectedSection?[]:view.links} heroAlignment={view.heroAlignment??'left'} details heroActions={actions}>
 {#snippet children()}
 {@render intro?.()}
 {@render hierarchy?.()}
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
<style>
 .detail-presentation {--detail-background:color-mix(in srgb,var(--canvas) 82%,var(--artwork-colour,var(--canvas)));background:var(--detail-background);min-height:var(--detail-viewport-height,100%);}
</style>
