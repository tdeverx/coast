<script lang="ts">
 import {page} from '$app/state';
 import FriendRoster from './FriendRoster.svelte';
 import {onDestroy,untrack} from 'svelte';
 import Dialog from './Dialog.svelte';
 import Heading from './Heading.svelte';
 import SegmentedControl from './SegmentedControl.svelte';

 import RowFilter from './RowFilter.svelte';
 import Button from './Button.svelte';
 import Avatar from './Avatar.svelte';
 import MediaCard from './MediaCard.svelte';
 import Icon from './Icon.svelte';

 import EmptyState from './EmptyState.svelte';
 import RowFeedback from './RowFeedback.svelte';
 import {useClient} from '$lib/ui/client-context';
 import {createResource,uniqueItems} from '$lib/ui/resource.svelte';
 import {createOperation} from '$lib/ui/operation.svelte';
 import {activityDateLabel} from '$lib/social/model';
 import {notificationKinds,notificationSegments,defaultNotificationFilters,type NotificationEntry,type NotificationResult,type NotificationFilters} from '$lib/notifications/model';
 let {open=$bindable(false),initialKind='all',initialFilters,onclose}:{open:boolean;initialKind?:string;initialFilters?:NotificationFilters;onclose?:()=>void}=$props();
 const {api,change,preview}=useClient();
 let criteria=$state<NotificationFilters>(untrack(()=>({...defaultNotificationFilters,kind:notificationKinds.some(k=>k.value===initialKind)?initialKind:'all',...initialFilters})));
 const resource=createResource<NotificationResult>({items:[],hasMore:false,next:null,unread:0,snapshot:''});
 const operation=createOperation();
 let clock=$state(Date.now());
 let seenAt=$state<Record<string,string>>({});
 const reading=new Set<string>();
 function readWhenVisible(node:HTMLElement,options:{items:NotificationEntry[];open:boolean}){
  let observer:IntersectionObserver|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  const pending=new Set<string>();
  let destroyed=false;
  async function flush(){
   timer=undefined;
   if(destroyed||!open||document.visibilityState!=='visible')return;
   const ids=[...pending].filter(id=>!reading.has(id)&&!seenAt[id]).slice(0,60);pending.clear();
   if(!ids.length)return;
   ids.forEach(id=>reading.add(id));
   try{
    const result=await change<{ids:string[]}>('notifications/seen',{ids});
    if(!destroyed)seenAt={...seenAt,...Object.fromEntries(result.ids.map(id=>[id,new Date().toISOString()]))};
   }catch(error){if(!destroyed)operation.error=error instanceof Error?error.message:'Could not mark notifications as read.';}
   finally{ids.forEach(id=>reading.delete(id));}
  }
  function connect(next:typeof options){
   observer?.disconnect();pending.clear();if(timer)clearTimeout(timer);timer=undefined;
   options=next;if(!next.open||preview)return;
   const unread=new Set(next.items.filter(item=>!item.readAt&&!seenAt[item.id]).map(item=>item.id));
   observer=new IntersectionObserver(entries=>{
    if(!open||document.visibilityState!=='visible')return;
    for(const entry of entries){const id=(entry.target as HTMLElement).dataset.notificationId!;if(entry.isIntersecting&&entry.intersectionRect.height>0&&unread.has(id)&&!seenAt[id]&&!reading.has(id))pending.add(id);else pending.delete(id);}
    if(pending.size&&!timer)timer=setTimeout(()=>void flush(),150);
   },{root:node.closest('.popover-content'),threshold:0});
   node.querySelectorAll<HTMLElement>('[data-notification-id]').forEach(article=>observer!.observe(article));
  }
  function visibility(){if(document.visibilityState==='visible')connect(options);}
  document.addEventListener('visibilitychange',visibility);connect(options);
  return {update:connect,destroy(){destroyed=true;observer?.disconnect();if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);}};
 }
 function parameters(){return new URLSearchParams(Object.entries(criteria).map(([key,value])=>[key,String(value)]));}
 async function load(more=false){
  const query=parameters();if(more&&resource.data.next){query.set('before',resource.data.next.before);query.set('beforeId',resource.data.next.beforeId);}
  await resource.load(signal=>api<NotificationResult>(`notifications?${query}`,undefined,'GET',{signal}),{merge:(previous,next)=>({...next,items:more?uniqueItems([...previous.items,...next.items],item=>item.id):next.items})});
 }
 $effect(()=>{if(!open){resource.cancel();return;}criteria.segment;criteria.kind;criteria.unread;criteria.category;criteria.period;void load();});
 async function act(notice:NotificationEntry,action:string){
  await operation.run(async()=>{
   if(action==='read'||action==='dismiss-notice'||action==='dismiss'&&!notice.subjectId)await change(`notifications/${notice.id}`,{action:action==='read'?'read':'dismiss'});
   else if(notice.kind==='synced-invite'&&action==='decline')await change(`synced/${notice.subjectId}/decline`,{});
   else await change(`social/${notice.kind==='friend-request'?'friends':'recommendations'}/${notice.subjectId}`,{action});
   await load();
  });
 }
 async function markAll(){await operation.run(async()=>{await change('notifications/read-all',{...criteria,snapshot:resource.data.snapshot});await load();});}
 $effect(()=>{if(!open||preview)return;const timer=setInterval(()=>{clock=Date.now();if(document.visibilityState==='visible'&&!resource.busy&&!operation.busy&&resource.data.items.length<=60)void load();},60000);return()=>clearInterval(timer);});
 onDestroy(resource.cancel);
 function availability(notice:NotificationEntry){return notice.media?.stale?'Last known availability':({available:'Available to you',partial:'Partly available',unavailable:'Not available to you',unknown:'Availability not confirmed'} as Record<string,string>)[notice.media?.availability??'unknown'];}
 function headline(notice:NotificationEntry){
  if(notice.actor)return notice.actor.username;
  if(notice.sourceLabel)return notice.sourceLabel.split(' · ')[0];
  return ({request:'Request',availability:'Library',sync:'Sync', 'external-action':'Connected service',administrator:'Coast',recommendation:'Recommendation',reaction:'Reaction','synced-invite':'Watch together','friend-accepted':'Friends'} as Record<string,string>)[notice.kind]??'Coast';
 }
 function detail(notice:NotificationEntry){
  const event=notice.kind==='recommendation'?'Recommended this to you.':
   notice.kind==='reaction'?`Reacted${notice.reaction?' '+notice.reaction:''} to your activity.`:
   notice.kind==='synced-invite'?'Invited you to watch together.':
   notice.kind==='friend-accepted'?'Accepted your friend request.':
   notice.kind==='availability'?'A title on your watchlist is now available.':
   notice.kind==='request'?({pending:'Your request is pending.',approved:'Approved and being prepared.',available:'Your request is ready to watch.',declined:'Your request was declined.',failed:'Your request could not be completed.'} as Record<string,string>)[notice.requestState??'']??notice.title:notice.title;
  const parts=[event,notice.body];
  if(notice.sessionState)parts.push(`Session ${notice.sessionState.toLowerCase()}`);
  if(notice.media&&['recommendation','availability','synced-invite'].includes(notice.kind))parts.push(availability(notice));
  if(notice.locked)parts.push('Important notice');
  return [...new Set(parts.filter(Boolean))].join(' · ');
 }



</script>
{#snippet inboxFilters()}<RowFilter label="Notification options" icon="filter" submenus groups={[
    {label:'Read status',value:criteria.unread?'unread':'all',options:[{value:'all',label:'All'},{value:'unread',label:'Unread'}],change:value=>criteria.unread=value==='unread'},
    {label:'Type',value:criteria.kind,options:[...notificationKinds],change:value=>criteria.kind=value},
    {label:'Medium',value:criteria.category,options:[{value:'all',label:'All media'},{value:'screen',label:'Watching'},{value:'game',label:'Playing'},{value:'music',label:'Listening'}],change:value=>criteria.category=value as NotificationFilters['category']},
    {label:'Date',value:criteria.period,options:[{value:'all',label:'Any time'},{value:'week',label:'Past week'},{value:'month',label:'Past month'}],change:value=>criteria.period=value as NotificationFilters['period']}
   ]}>{#snippet actions()}<Button item icon="refresh" text="Refresh notifications" disabled={resource.busy||operation.busy} keepOpen={false} onclick={()=>void load()} /><Button item icon="check" text="Mark all as read" disabled={operation.busy||resource.busy||!resource.data.snapshot||!resource.data.unread} title="Mark all matching notifications as read" keepOpen={false} onclick={markAll}/>{/snippet}</RowFilter>{/snippet}

{#snippet inboxHeading()}
  <Heading title="Notifications">
   {#snippet heading()}<SegmentedControl label="Notification category" value={criteria.segment} options={[...notificationSegments]} onchange={value=>criteria.segment=value as NotificationFilters['segment']}/>{/snippet}
   {#snippet actions()}<div class="notification-header-actions">{@render inboxFilters()}<Button size="icon" icon="close" label="Close notifications" onclick={()=>{open=false;onclose?.();}} /></div>{/snippet}
  </Heading>
 {/snippet}
 {#snippet inboxContent()}
 {#if preview}<p class="small quiet" data-design-status="non-approved">Non-approved · Notification popover treatment</p>{/if}
 <RowFeedback error={resource.error} retry={()=>void load()} tag="div" /><RowFeedback error={operation.error} tag="div" />
 {#if resource.busy&&!resource.ready}<div class="loading" aria-label="Loading notifications">{#each [1,2,3,4] as _}<div class="skeleton"></div>{/each}</div>
 {:else if !resource.data.items.length&&!resource.error}<EmptyState title="You’re all caught up." description={criteria.unread?'No unread notifications match these criteria.':'No notifications match these criteria.'} icon="bell" />
 {:else}<div class="notification-inbox" use:readWhenVisible={{items:resource.data.items,open}} data-design-status="non-approved" aria-busy={resource.busy}>
 {#each resource.data.items as notice(notice.id)}
  <article data-notification-id={notice.id} class:unread={!notice.readAt&&!seenAt[notice.id]}>
   <div class="notice-row">
    <div class="notice-copy">
     <div class="notice-heading">
      <div class="notice-text"><h3>{#if notice.actor}<a class="notice-prefix" href={`/profile/${encodeURIComponent(notice.actor.username)}`} aria-label={`${notice.actor.username}'s profile`}><Avatar name={notice.actor.username} src={notice.actor.avatar} status={notice.actor.status} size={20}/></a>{:else}<span class="notice-prefix" title={notice.sourceLabel??'Coast'}><Icon name={notice.kind==='administrator'?'shield':notice.kind==='request'?'request':'bell'} size={18}/></span>{/if}{#if notice.actor}<a href={`/profile/${encodeURIComponent(notice.actor.username)}`}>{headline(notice)}</a>{:else}{headline(notice)}{/if}</h3>
     {#if detail(notice)}<p>{detail(notice)}</p>{/if}
      </div>
      <time class:unread-time={!notice.readAt&&!seenAt[notice.id]} datetime={notice.createdAt}>{activityDateLabel(notice.createdAt,clock)}</time>
     </div>

     <div class="notice-content" class:has-media={!!(notice.activity||notice.media)} class:has-friend={!!notice.friend}>
      <div class="notice-actions">
      {#if notice.destination&&notice.kind!=='recommendation'&&notice.kind!=='reaction'&&!(notice.kind==='friend-accepted'&&notice.friend)}<Button emphasis="subtle" href={notice.destination}>{notice.kind==='synced-invite'?'Join':notice.kind==='sync'||notice.kind==='external-action'?'Review':'View'}</Button>{/if}
      {#each notice.actions.filter(action=>action!=='dismiss'&&action!=='decline') as action}<Button emphasis="subtle" disabled={operation.busy||!notice.subjectId} onclick={()=>void act(notice,action)}>{action==='save'?'Save':action[0].toUpperCase()+action.slice(1)}</Button>{/each}
      </div>
     {#if notice.activity||notice.media}<div class="notice-media"><MediaCard item={notice.activity??notice.media!.card} showActivityContext={!notice.activity} shape="fanart" artworkStyle="thumb" /></div>{/if}
     {#if notice.friend&&page.data.user}<div class="notice-friend"><FriendRoster friends={[notice.friend]} userId={page.data.user.id} busy={operation.busy} act={(path,body)=>void operation.run(async()=>{await change(path,body);await load();})}/></div>{/if}
      <div class="notice-dismiss"><Button emphasis="subtle" disabled={operation.busy} onclick={()=>void act(notice,notice.kind==='synced-invite'&&notice.subjectId?'decline':notice.actions.includes('dismiss')?'dismiss':'dismiss-notice')}>{notice.kind==='synced-invite'?'Decline':'Dismiss'}</Button></div>
     </div>
    </div>
   </div>
  </article>
 {/each}
 </div>{#if resource.data.hasMore}<Button emphasis="subtle" disabled={resource.busy} onclick={()=>void load(true)}>{resource.busy?'Loading…':'Load older notifications'}</Button>{/if}{/if}

{/snippet}
<Dialog bind:open title="Notifications" popover={true} anchor="#notification-trigger" onclose={()=>onclose?.()}>{#snippet heading()}{@render inboxHeading()}{/snippet}{@render inboxContent()}</Dialog>
<style>
 .notification-header-actions{display:flex;align-items:center;gap:0;}
 article{margin-inline:calc(-1 * var(--popover-inset));padding:12px var(--popover-inset);border-top:1px solid var(--line);}
 article:first-child{border-top:0;padding-top:0;}
 article:last-child{padding-bottom:0;}
 .notice-row{display:flex;align-items:flex-start;gap:12px;}
 .notice-prefix{display:inline-flex;flex:none;color:var(--muted);}
 .notice-heading{display:flex;align-items:flex-start;gap:12px;}
 .notice-text{flex:1;min-width:0;}
 .notice-heading time{flex:none;padding-top:2px;}
 .unread-time{color:var(--ink);}
 .notice-content{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:end;gap:8px;}
 .notice-content.has-media{grid-template-columns:minmax(72px,1fr) minmax(0,2fr) minmax(72px,1fr);}
 .notice-content.has-media .notice-actions{grid-column:1;grid-row:1;}
 .notice-content.has-media .notice-media{grid-column:2;grid-row:1;justify-self:center;}
 .notice-content.has-media .notice-dismiss{grid-column:3;grid-row:1;}
 .notice-dismiss{justify-self:end;}
 .notice-friend{grid-column:1/-1;grid-row:1;min-width:0;padding-block:4px;}
 .notice-content.has-friend .notice-actions,.notice-content.has-friend .notice-dismiss{grid-row:2;}
 .notice-content :global(.button){padding-inline:8px;}
 .notice-media :global(.caption),.notice-media :global(.activity-details){text-align:center;}
 .notice-media :global(.meta){justify-content:center;}
 .notice-media{min-width:0;width:min(240px,100%);padding-block:4px;}
 .notice-copy{display:grid;gap:8px;flex:1;min-width:0;overflow-wrap:anywhere;}
 h3{display:flex;align-items:center;gap:6px;font-size:var(--text-md);font-weight:var(--weight-semibold);margin:0;}
 h3 a{color:inherit;}
 p{margin:6px 0 0;font-size:var(--text-sm);color:var(--muted);}
 .notice-actions{display:flex;flex-direction:column;align-items:flex-start;gap:0;min-width:0;}

 time{white-space:nowrap;color:var(--quiet);font-size:var(--text-sm);}

 .loading{display:grid;gap:12px;}
 .skeleton{height:112px;border-radius:8px;background:var(--surface);animation:pulse 1.5s ease-in-out infinite alternate;}
 @keyframes pulse{to{opacity:.5;}}
 @media(prefers-reduced-motion:reduce){.skeleton{animation:none;}}
 @media(max-width:479px){.notice-row{gap:8px;}}
</style>
