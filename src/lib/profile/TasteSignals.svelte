<script lang="ts">
  import {page} from '$app/state';
  import {onDestroy,untrack} from 'svelte';
  import {useClient} from '#lib/ui/client-context.js';
  import {createResource} from '#lib/ui/resource.svelte.js';
  import type {personalSignalPage} from '#lib/social/taste-personal-display.server.js';
  import type {TasteMedium} from '#lib/social/taste-profile.js';
  import {tasteSignalLabel} from '#lib/social/taste.js';
  import DetailCard from '#lib/ui/components/DetailCard.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import FactList from '#lib/ui/components/FactList.svelte';
  import Pagination from '#lib/ui/components/Pagination.svelte';
  let {medium}:{medium:TasteMedium}=$props();
  const {api}=useClient();
  let dimension=$state('genres'),number=$state(1);
  const profile=createResource<Awaited<ReturnType<typeof personalSignalPage>>>(null);
  const data=$derived(profile.data);
  const label=(key:string)=>key==='creators'?'Show creators':tasteSignalLabel(key,medium);
  $effect(()=>{
    void page.data.tastePublication?.revision;
    void page.data.contentRevision?.tracking;
    const query=new URLSearchParams({medium,dimension,page:String(number)});
    untrack(()=>void profile.load(signal=>api('profile/taste-signals?'+query,undefined,'GET',{signal})));
    return ()=>profile.cancel();
  });
  onDestroy(profile.dispose);
</script>
<DetailCard title="Personal taste signals" description={data ? `${data.works} titles · ${data.ratings} ratings` : undefined}>
  {#if profile.error}<p role="alert">{profile.error}</p>
  {:else if data}
    <Button menu text={label(dimension)} label="Choose taste signal">
      {#each data.dimensions as field (field.key)}
        <Button item text={label(field.key)} disabled={!field.count} onclick={()=>{dimension=field.key;number=1;}}/>
      {/each}
    </Button>
    <FactList items={data.items.map(item=>({
      label:item.name,value:`${Math.round(item.affinity)}% fit`,
      detail:[`${item.works} titles · ${item.rated} rated · ${item.confidence}% evidence strength`,
        data.uses[item.id]?.join(' · ') || 'Observed in your history',
        item.supporting[0] && data.examples[item.supporting[0]] ? 'Supports · '+data.examples[item.supporting[0]] : '',
        item.contradicting[0] && data.examples[item.contradicting[0]] ? 'Counters · '+data.examples[item.contradicting[0]] : ''].filter(Boolean).join(' · ')
    }))}/>
    {#if !data.items.length}<p class="quiet">No personal evidence for this signal yet.</p>{/if}
    <Pagination page={number} pages={data.pages} label="Taste signal pages" onchange={value=>number=value}/>
  {:else}<p role="status">{profile.busy?'Loading personal evidence…':'Your signals will appear after your taste profile refreshes.'}</p>{/if}
</DetailCard>
