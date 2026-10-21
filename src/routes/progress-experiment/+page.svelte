<script lang="ts">
  import Shelf from '#lib/ui/components/Shelf.svelte';
  let {data}=$props();
</script>
<svelte:head><title>Progress · Coast</title></svelte:head>
<div class="content page"><Shelf source={{type:'progress-experiment',username:data.username,layout:'grid',initial:data.progress}} hideEmpty={false} /></div>
