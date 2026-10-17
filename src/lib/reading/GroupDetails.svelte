<script lang="ts">
 import {page} from '$app/state';
 import MediaPage from '$lib/ui/components/MediaPage.svelte';
 import Shelf from '$lib/ui/components/Shelf.svelte';
 import Button from '$lib/ui/components/Button.svelte';
 let {data}:{data:{group:{id:string;title:string};cover:string|null}}=$props();
</script>
<svelte:head><title>{data.group.title} · Coast</title></svelte:head>
<MediaPage details item={{id:`reading-group:${data.group.id}`,kind:'collection',title:data.group.title,
 href:`/media/reading-collection/${data.group.id}`,poster:data.cover,captionSubtitle:'Comic volume'}}>
 {#snippet heroActions()}<Button emphasis="subtle" href="/library?view=read" icon="left">Library</Button>{/snippet}
 <Shelf source={{type:'detail',title:'Issues',path:`reading/collections/${data.group.id}`,layout:'grid',
  mediaKind:'reading',page:Number(page.url.searchParams.get('page')??1)}} />
</MediaPage>
