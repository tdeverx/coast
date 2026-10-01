<script lang="ts">
 import {goto} from '$app/navigation';
 import {page} from '$app/state';
 import Heading from '$lib/ui/components/Heading.svelte';
 import Shelf from '$lib/ui/components/Shelf.svelte';
 import ReactionActions from '$lib/ui/components/ReactionActions.svelte';
 import Button from '$lib/ui/components/Button.svelte';
 import EmptyState from '$lib/ui/components/EmptyState.svelte';
 import MetricGrid from '$lib/ui/components/MetricGrid.svelte';
 import RowFilter from '$lib/ui/components/RowFilter.svelte';
 import {change,message} from '$lib/ui/client';
 let {data}=$props();let username=$state(''),failure=$state(''),busy=$state(false);
 const options=[{value:'activity',label:'Activity'},{value:'friends',label:'Friends'},{value:'recommendations',label:'Recommendations'},{value:'insights',label:'Insights'}];
 async function act(path:string,body:unknown){if(busy)return;busy=true;failure='';try{await change(path,body);}catch(error){failure=message(error);}finally{busy=false;}}
</script>
<svelte:head><title>Friends · Coast</title></svelte:head>
<div class="content page">
 <Heading variant="page" title="Friends" selection={{label:'Friends view',value:data.view,options,change:value=>goto(`/friends?view=${value}`)}}>
  {#snippet actions()}<Button variant="ghost" href="/settings/privacy">Privacy & social</Button>{/snippet}
 </Heading>
 {#if data.ownCheckin}<div class="row section"><p class="small">Your check-in ends {new Date(data.ownCheckin.expiresAt).toLocaleTimeString()}.</p><Button variant="ghost" disabled={busy} onclick={()=>act(`social/checkins/${data.ownCheckin.id}`,{action:'cancel'})}>Cancel check-in</Button></div>{/if}
 {#if data.presence.length}<section class="section"><Heading title="Watching & listening now" /><div class="row">{#each data.presence as person}<Button variant="ghost" href={`/profile/${encodeURIComponent(person.username)}`}>{person.username} · {person.source==='checkin'?'Checked in':person.source==='trakt'?'Watching on Trakt':'Playing now'}</Button><Button variant="ghost" href={person.href}>{person.title}</Button>{/each}</div></section>{/if}
 {#if failure}<p class="notice error" role="alert">{failure}</p>{/if}
 {#if data.view==='activity'}
  <RowFilter label="Activity media" value={page.url.searchParams.get('category')??'all'} options={[{value:'all',label:'All media'},{value:'screen',label:'Film & TV'},...(page.data.experimentalFeatures?[{value:'music',label:'Music'},{value:'game',label:'Games'}]:[])]} onchange={value=>goto(`/friends?view=activity&category=${value}`)} />
  {#if data.feed}{#key page.url.search}<Shelf source={{type:'social',layout:'grid',initial:data.feed,category:page.url.searchParams.get('category')??'all'}}>{#snippet details(item)}{#if item.entryId}<ReactionActions targetId={item.entryId} targetKind="activity" />{/if}{/snippet}</Shelf>{/key}{/if}
 {:else if data.view==='friends'}
  <form class="row" onsubmit={event=>{event.preventDefault();void act('social/friends',{username});}}><label class="field">Add by username<input bind:value={username} required maxlength="100" autocomplete="off" /></label><Button type="submit" disabled={busy||!username.trim()}>Send friend request</Button></form>
  <p class="small">Use their exact username. Capitalization does not matter.</p>
  {#each data.roster as friend}<section class="section row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:20px">
   <div><a href={`/profile/${encodeURIComponent(friend.username)}`}>{friend.username}</a><p class="small">{friend.state==='accepted'?'Friends':friend.requestedBy===page.data.user?.id?'Request sent':'Wants to be friends'}</p></div>
   <div class="row">{#if friend.state==='accepted'}<Button variant="ghost" href={`/friends?view=insights&friendId=${friend.userId}`}>Compare</Button><Button variant="ghost" disabled={busy} onclick={()=>act(`social/friends/${friend.id}`,{action:'remove'})}>Remove</Button>
   {:else if friend.requestedBy===page.data.user?.id}<Button variant="ghost" disabled={busy} onclick={()=>act(`social/friends/${friend.id}`,{action:'cancel'})}>Cancel</Button>
   {:else}<Button disabled={busy} onclick={()=>act(`social/friends/${friend.id}`,{action:'accept'})}>Accept</Button><Button variant="ghost" disabled={busy} onclick={()=>act(`social/friends/${friend.id}`,{action:'decline'})}>Decline</Button>{/if}</div>
  </section>{/each}
  {#if !data.roster.length}<EmptyState title="Add your first friend" description="Exchange usernames to share activity and recommendations." icon="user" />{/if}
 {:else if data.view==='recommendations'}
  <RowFilter label="Recommendation availability" value={page.url.searchParams.get('available')==='true'?'available':'all'} options={[{value:'all',label:'All recommendations'},{value:'available',label:'Available to you'}]} onchange={value=>goto(`/friends?view=recommendations${value==='available'?'&available=true':''}`)} />
  <Shelf title="Recommendations" items={data.recommendationItems} layout="grid">
   {#snippet details(item)}{#each data.recommendations.filter((r:{workId:string})=>r.workId===('workId' in item?item.workId??item.id:item.id)) as rec}<p class="small">{rec.username} · {rec.state}</p>{#if rec.recipientId===page.data.user?.id&&rec.state==='pending'}<div class="row"><Button variant="ghost" disabled={busy} onclick={()=>act(`social/recommendations/${rec.id}`,{action:'save'})}>Save for later</Button><Button variant="ghost" disabled={busy} onclick={()=>act(`social/recommendations/${rec.id}`,{action:'dismiss'})}>Dismiss</Button></div>{/if}{/each}{/snippet}
  </Shelf>
 {:else}
  <RowFilter label="Compare with friend" value={page.url.searchParams.get('friendId')??''} options={[{value:'',label:'Choose a friend'},...data.roster.filter((f:{state:string})=>f.state==='accepted').map((f:{userId:string;username:string})=>({value:f.userId,label:f.username}))]} onchange={value=>goto(`/friends?view=insights${value?'&friendId='+value:''}`)} />
  {#if data.comparison}<Heading title="Taste & overlap" /><MetricGrid items={[{label:'Overall taste',value:data.comparison.score===null?'Not enough data':`${data.comparison.score}%`,detail:'Median across qualifying media'}]} />
   {#each data.comparison.media as medium}<section class="section"><Heading title={medium.medium} /><MetricGrid items={[{label:'Taste score',value:medium.score===null?'Not enough data':`${Math.round(medium.score)}%`},...Object.entries(medium.signals).map(([name,signal])=>({label:name,value:signal.score===null?'Not enough data':`${Math.round(signal.score)}%`,detail:`${signal.shared?signal.shared+' shared · ':''}${signal.left} yours · ${signal.right} theirs`})),{label:'Completed · you / friend',value:`${medium.stats.you.completed} / ${medium.stats.friend.completed}`},{label:'In progress · you / friend',value:`${medium.stats.you.active} / ${medium.stats.friend.active}`},{label:'Planned · you / friend',value:`${medium.stats.you.planned} / ${medium.stats.friend.planned}`},{label:'Shared items',value:medium.overlap.shared.length},{label:'Only you',value:medium.overlap.onlyYou.length},{label:'Only your friend',value:medium.overlap.onlyFriend.length}]} /></section>{/each}
   <Shelf title="Overlap & progress" items={data.overlapItems} layout="grid" pageNumber={data.page} pages={data.overlapPages} pageUrl={number=>{const url=new URL(page.url);url.searchParams.set('page',String(number));return url.pathname+url.search;}}>
    {#snippet filters()}<RowFilter label="Overlap medium" value={data.medium} options={[{value:'all',label:'All media'},{value:'movies',label:'Movies'},{value:'tv',label:'TV'},...(page.data.experimentalFeatures?[{value:'music',label:'Music'},{value:'game',label:'Games'}]:[])]} onchange={value=>{const url=new URL(page.url);url.searchParams.set('medium',value);url.searchParams.delete('page');void goto(url);}} />
    <RowFilter label="Overlap relationship" value={data.overlap} options={[{value:'shared',label:'Shared items'},{value:'onlyYou',label:'Only you'},{value:'onlyFriend',label:'Only your friend'}]} onchange={value=>{const url=new URL(page.url);url.searchParams.set('overlap',value);url.searchParams.delete('page');void goto(url);}} />{/snippet}
    {#snippet details(item)}{@const progress=data.comparison?.media.flatMap(m=>m.progressComparisons).find(p=>p.workId===('workId' in item?item.workId??item.id:item.id))}{#if progress}<p class="small">Progress · You: {progress.you===null?'Unknown':`${Math.round(progress.you)}%`} · Friend: {progress.friend===null?'Unknown':`${Math.round(progress.friend)}%`}</p>{/if}{/snippet}
   </Shelf>
  {/if}<Shelf title="Popular with friends" items={data.popularItems} />
 {/if}
 {#if data.page>1||data.moreFriends&&data.view==='friends'||data.moreRecommendations&&data.view==='recommendations'}<div class="row"><Button variant="ghost" href={`/friends?view=${data.view}&page=${Math.max(1,data.page-1)}`} disabled={data.page===1}>Previous</Button>{#if data.moreFriends||data.moreRecommendations}<Button variant="ghost" href={`/friends?view=${data.view}&page=${data.page+1}`}>Next</Button>{/if}</div>{/if}
</div>
