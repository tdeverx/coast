<script lang="ts">
 import {page} from '$app/state';
 import {onDestroy,untrack,setContext} from 'svelte';
 import MediaPage from '$lib/ui/components/MediaPage.svelte';
 import Shelf from '$lib/ui/components/Shelf.svelte';
 import DetailCard from '$lib/ui/components/DetailCard.svelte';
 import Button from '$lib/ui/components/Button.svelte';
 import WorkMenu from '$lib/ui/components/WorkMenu.svelte';
 import {createMusicPage,type MusicPageData} from '$lib/ui/pages/music.svelte';
 import {musicCard,musicHref} from './presentation';
 import {createResource} from '$lib/ui/resource.svelte';
 import {lazyContent} from '$lib/ui/lazy-content';
 import {useClient} from '$lib/ui/client-context';
 let {data}:{data:MusicPageData}=$props();
 const {api}=useClient();
 setContext('profile-read-only',()=>!page.data.user);
 const view=createMusicPage(()=>data,()=>page.url,()=>!!page.data.user);
 const history=createResource<Awaited<ReturnType<typeof import('./history.server').musicHistory>>>({items:[],page:1,pages:1,total:0});
 onDestroy(history.dispose);
 const section=$derived(page.url.searchParams.get('section'));
 const workId=$derived(data.item.workId);
 $effect(()=>{const target=workId;untrack(()=>{target;history.cancel();history.replace({items:[],page:1,pages:1,total:0});});});
 async function loadHistory(number=1){if(workId)await history.load(signal=>api(`music/${workId}/history?page=${number}`,undefined,'GET',{signal}));}
</script>
<svelte:head><title>{data.item.title} · Music · Coast</title></svelte:head>
<MediaPage {...view.page}>
 {#snippet heroActions()}{#if page.data.user&&(workId||data.item.artistId)}<WorkMenu item={musicCard(data.item,data.connectionId)} showTrigger hero menuOnly onchanged={()=>{if(history.activated)void loadHistory();}} />{/if}{/snippet}
 {#if page.data.user&&workId&&data.item.kind!=='artist'&&(!section||section==='activity')}
  {#key workId}<div use:lazyContent={{load:()=>void loadHistory()}}>
   <Shelf title="Your activity" href={!section?`${musicHref(data.connectionId,data.item.id)}?section=activity`:undefined} size="panel" artworkOptions={false} layout={section?'grid':'row'}
    hideEmpty={false} itemCount={history.data.items.length} busy={!history.ready&&!history.error||history.busy} error={history.error} retry={()=>void loadHistory(history.data.page)}
    pageNumber={history.data.page} pages={history.data.pages} onpage={number=>void loadHistory(number)}>
    {#each history.data.items as event(event.id)}<DetailCard title={event.title} description={event.dateKnown?new Date(event.occurredAt).toLocaleString():'Date unknown'}>
     <Button emphasis="subtle" href={`/music/work/${event.workId}`}>View track</Button>
    </DetailCard>{/each}
   </Shelf>
  </div>{/key}
 {/if}
</MediaPage>
