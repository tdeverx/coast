<script lang="ts">
  import {goto} from '$app/navigation';
  import {page} from '$app/state';
  import RowFilter from '$lib/ui/components/RowFilter.svelte';
  import Heading from '$lib/ui/components/Heading.svelte';
  import { change, message } from '$lib/ui/client';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Icon from '$lib/ui/components/Icon.svelte';
  let { data } = $props();
  let error = $state('');
</script>

<svelte:head><title>Notifications · Coast</title></svelte:head>
<div class="content page">
  <Heading variant="page" title="Notifications" description="Updates from your connected services and Coast." />
  <RowFilter label="Notification type" value={page.url.searchParams.get('kind')??'all'} options={[{value:'all',label:'All notifications'},{value:'friend-request',label:'Friend requests'},{value:'friend-accepted',label:'Friend accepted'},{value:'recommendation',label:'Recommendations'},{value:'reaction',label:'Reactions'},{value:'synced-invite',label:'Synced sessions'},{value:'request',label:'Requests'},{value:'administrator',label:'Administrator'}]} onchange={kind=>goto('/notifications?kind='+kind)} />
  {#if error}<div class="notice error" role="alert">{error}</div>{/if}{#if data.inbox.length}<div
      class="inbox"
    >
      {#each data.inbox as notice}<article class:unread={!notice.readAt}>
          <div class="notification-icon">
            <Icon
              name={notice.kind === 'request'
                ? 'request'
                : notice.kind === 'administrator'
                  ? 'shield'
                  : 'bell'}
            />
          </div>
          <div class="notification-copy">
            <h3>{#if notice.data}<a href={notice.data.destination}>{notice.title}</a>{:else}{notice.title}{/if}</h3>
            {#if notice.body}<p>{notice.body}</p>{/if}<small
              >{new Date(notice.createdAt).toLocaleString()}{notice.locked
                ? ' · Important notice'
                : ''}</small
            >
          </div>
          <div class="row">
            {#if notice.data?.actions}{#each notice.data.actions as action}<Button variant="ghost" onclick={()=>change(`social/${notice.kind==='friend-request'?'friends':'recommendations'}/${notice.data!.subjectId}`,{action}).catch(e=>error=message(e))}>{action==='save'?'Save for later':action[0].toUpperCase()+action.slice(1)}</Button>{/each}{/if}
            {#if !notice.readAt}<Button
                variant="ghost"
                onclick={() =>
                  change(`notifications/${notice.id}`, { action: 'read' }).catch(
                    (e) => (error = message(e))
                  )}>Mark as read</Button
              >{/if}<button
              class="icon-button"
              aria-label={`Dismiss ${notice.title}`}
              onclick={() =>
                change(`notifications/${notice.id}`, { action: 'dismiss' }).catch(
                  (e) => (error = message(e))
                )}><Icon name="close" size={18} /></button
            >
          </div>
        </article>{/each}
    </div>{:else}<EmptyState
      title="You’re all caught up."
      description="Request updates, newly available titles, and important notices will appear here."
      icon="bell"
    />{/if}
</div>

<style>
  .inbox {
    max-width: 1000px;
  }
  .inbox article {
    display: flex;
    gap: 20px;
    padding: 24px 18px;
    border-bottom: 1px solid var(--line);
    align-items: flex-start;
  }
  .inbox article.unread {
    background: color-mix(in srgb, var(--accent) calc(5 / 255 * 100%), transparent);
  }
  .notification-copy {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .notification-icon {
    color: var(--muted);
    padding: 2px;
  }
  .inbox h3 {
    font-size: var(--text-sm);
  }
  .inbox p {
    font-size: var(--text-sm);
    margin: 6px 0 9px;
  }
  .inbox small {
    font-size: var(--text-sm);
  }
  @media (max-width: 600px) {
    .inbox article {
      flex-wrap: wrap;
      padding-inline: 0;
    }
    .inbox .row {
      margin-left: auto;
    }
  }
</style>
