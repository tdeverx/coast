<script lang="ts">
  import PageHeader from '$lib/ui/components/PageHeader.svelte';
  import { change, message } from '$lib/ui/client';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import Icon from '$lib/ui/components/Icon.svelte';
  let { data } = $props();
  let error = $state('');
</script>

<svelte:head><title>Notifications · Coast</title></svelte:head>
<div class="content page">
  <PageHeader title="Notifications" description="Updates from your connected services and Coast." />
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
            <h3>{notice.title}</h3>
            {#if notice.body}<p>{notice.body}</p>{/if}<small
              >{new Date(notice.createdAt).toLocaleString()}{notice.locked
                ? ' · Important notice'
                : ''}</small
            >
          </div>
          <div class="row">
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
    border-bottom: 1px solid var(--line-soft);
    align-items: flex-start;
  }
  .inbox article.unread {
    background: #b3c6ff05;
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
    font-size: 13px;
  }
  .inbox p {
    font-size: 11px;
    margin: 6px 0 9px;
  }
  .inbox small {
    font-size: 9px;
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
