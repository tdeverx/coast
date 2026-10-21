<script lang="ts">
 import {page} from '$app/state';
 import {setContext} from 'svelte';
 import MediaDetails from '#lib/ui/components/MediaDetails.svelte';
 import WorkMenu from '#lib/ui/components/WorkMenu.svelte';
 import {createMusicPage,type MusicPageData} from '#lib/ui/pages/music.svelte.js';
 import {musicCard} from './presentation';
 let {data,modal=false,detailHref}:{data:MusicPageData;modal?:boolean;detailHref?:string}=$props();
 const detailUrl=$derived(modal?new URL(detailHref??`/music/work/${data.item.workId??data.item.id}`,page.url.href):page.url);
 setContext('profile-read-only',()=>!page.data.user);
 const view=createMusicPage(()=>data,()=>detailUrl,()=>!!page.data.user);
 const section=$derived(detailUrl.searchParams.get('section'));
 const workId=$derived(data.item.workId);
</script>
<svelte:head><title>{data.item.title} · Music · Coast</title></svelte:head>
<MediaDetails {detailHref} view={{...view.page,back:modal?undefined:view.page.back}} model={view.model} before={view.rows} {section}>
 {#snippet heroActions()}{#if page.data.user&&(workId||data.item.artistId)}<WorkMenu item={musicCard(data.item,data.connectionId)} showTrigger hero menuOnly />{/if}{/snippet}
</MediaDetails>
