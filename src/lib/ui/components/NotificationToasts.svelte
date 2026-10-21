<script lang="ts">
  import {openNotifications} from '#lib/ui/panels/notifications.svelte.js';
  import { onMount } from 'svelte';
  import { useClient } from '#lib/ui/client-context.js';
  import { ApiError, refreshAfterChange } from '#lib/ui/client.js';
  import { createNotificationToasts, type ToastNotification } from '#lib/ui/controls/notification-toasts.js';
  import Toast from './Toast.svelte';

  const { preview, api, feedback:delivery } = useClient();

  let { notifications, initialFailure }: { notifications: ToastNotification[]; initialFailure?:string } = $props();
  let mounted = $state(false), visible = $state.raw<ToastNotification[]>([]);
  const owner = Symbol('notification toast persistence');
  const toasts = createNotificationToasts({
    preview,
    hide: (ids,signal) => api('notifications/toast-hidden', {ids}, 'POST', {signal}),
    dismiss: async (id,signal) => {
      try { await api(`notifications/${id}`, {action:'dismiss'}, 'POST', {signal}); }
      catch (cause) {
        // A lost acknowledgement can leave the notice dismissed, deleted or no longer visible.
        // The existing API's 404 is terminal unavailability, not proof of a new successful write.
        if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
      }
    },
    refresh: () => refreshAfterChange('notifications'),
    refreshFailure: () => delivery.notify('The page could not refresh; reload to see the latest data.'),
    changed: () => { visible = toasts.visible; },
    failure: (text,retry) => delivery.failure(text,retry,owner),
    recovered: () => delivery.clear(owner),
  });
  const feedback = $derived(delivery.activeHost === null ? delivery.current : null);
  const serverFailure = $derived(!mounted ? initialFailure : undefined);
  onMount(() => {
    toasts.mount(notifications);
    mounted = true;
    return () => { toasts.dispose(); delivery.clear(); };
  });
  $effect(() => { toasts.update(notifications); });
</script>

{#if visible.length || feedback || serverFailure}<div class="toasts" aria-live="polite">
    {#if feedback}<Toast text={feedback.text} kind={feedback.kind} error={feedback.error} busy={feedback.busy} actionLabel={feedback.undo ? 'Undo' : feedback.actionLabel ?? 'Retry'} onaction={feedback.undo || feedback.retry ? delivery.act : undefined} ondismiss={()=>delivery.clear()} dismissLabel="Dismiss action feedback" />{/if}
    {#if serverFailure&&!feedback}<Toast text={serverFailure} kind="error" />{/if}
    {#each visible as n (n.id)}<Toast text={n.title} description={n.body} onopen={()=>{if(!preview)openNotifications();}} dismissLabel={`Dismiss notification: ${n.title}`} ondismiss={()=>toasts.dismiss(n)} />{/each}
  </div>{/if}

<style>
  .toasts {
    position: fixed;
    z-index: 100;
    right: 24px;
    bottom: 24px;
    width: min(390px, calc(100vw - 32px));
    display: grid;
    gap: 12px;
  }
  :global(.player-active) .toasts {bottom:calc(96px + env(safe-area-inset-bottom));}
  @media (max-width: 600px) {
    .toasts {
      right: 16px;
      bottom: 18px;
    }
  }
  @media (max-width: 639px) {
    :global(.player-active) .toasts {
      bottom: calc(148px + env(safe-area-inset-bottom));
    }
  }
  @media (max-width: 479px) {
    :global(.player-active) .toasts {
      bottom: calc(208px + env(safe-area-inset-bottom));
    }
  }
</style>
