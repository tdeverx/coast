<script lang="ts">
 import Button from '#lib/ui/components/Button.svelte';
 import { openReading } from '#lib/reading/client.svelte.js';
 import { playMedia } from '#lib/playback/client.svelte.js';
 import { reportFailure } from '#lib/ui/client-context.js';
 import { message } from '#lib/ui/client.js';
 let failure=$state('');
 reportFailure(()=>failure);
 import Details from '#lib/media/Details.svelte';
 import ReadingDetails from '#lib/reading/Details.svelte';
 let {data}=$props();
</script>
<svelte:head>{#if 'scoped' in data && data.scoped}<title>{data.scoped.work.title} · Coast</title>{/if}</svelte:head>
{#if 'scoped' in data && data.scoped}
  {@const model=data.scoped}
  <div class="content page route-content stack">
    <a href="/library">Library</a>
    <h1>{model.work.title}</h1>
    {#if model.work.year}<p>{model.work.year}</p>{/if}
    {#if model.work.overview}<p>{model.work.overview}</p>{/if}
    {#if model.work.kind==='movie'||model.work.kind==='episode'||model.work.kind==='track'}
      <div class="row"><Button icon="play" onclick={()=>{failure='';void playMedia(model.work.id,{mediaType:model.work.kind==='track'?'audio':'video'}).catch(cause=>failure=message(cause));}}>{model.work.position>0?'Resume':'Play'}</Button></div>
    {:else if model.work.kind==='book'||model.work.kind==='comic'}
      <div class="row"><Button icon="library" onclick={()=>{failure='';void openReading(model.work.id).catch(cause=>failure=message(cause));}}>Read</Button></div>
    {:else if model.work.kind==='album'}
      <h2>Tracks</h2>
      <ul>{#each model.tracks as track (track.id)}<li><a href={'/media/'+track.id}>{track.title}</a></li>{/each}</ul>
      {#if model.next}<div class="row"><Button href={'/media/'+model.work.id+'?after='+model.next}>Next page</Button></div>{/if}
    {:else}
      <h2>Episodes</h2>
      <ul>{#each model.episodes as episode (episode.id)}<li><a href={'/media/'+episode.id}>S{episode.season} E{episode.episode} · {episode.title}</a></li>{/each}</ul>
      {#if model.next}<div class="row"><Button href={'/media/'+model.work.id+'?after='+model.next}>Next page</Button></div>{/if}
    {/if}
  </div>
{:else if 'reading' in data && data.reading}<ReadingDetails data={data.reading}/>
{:else}<Details {data}/>{/if}
