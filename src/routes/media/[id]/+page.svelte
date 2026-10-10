<script lang="ts">
 import Details from '$lib/media/Details.svelte';
 import ReadingDetails from '$lib/reading/Details.svelte';
 let {data}=$props();
</script>
{#if 'reading' in data && data.reading}<ReadingDetails data={data.reading}/>
{:else}<Details {data}/>{/if}
