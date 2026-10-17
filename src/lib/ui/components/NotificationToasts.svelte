<script lang="ts">
  import {openNotifications} from '$lib/ui/panels/notifications.svelte';
  import { onMount } from 'svelte';
  import { useClient } from '$lib/ui/client-context';
  import Toast from './Toast.svelte';

  const { preview, change, feedback:delivery } = useClient();

  type InboxNotification = {
    id: string;
    title: string;
    body: string | null;
    level: 'silent' | 'normal' | 'persistent';
    readAt: Date | string | null;
    createdAt: Date | string;
  };
  let { notifications, initialFailure }: { notifications: InboxNotification[]; initialFailure?:string } = $props();
  let hidden = $state<string[]>([]),
    mounted = $state(false);
  const observed = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const feedback = $derived(delivery.activeHost === null ? delivery.current : null);
  const serverFailure = $derived(!mounted ? initialFailure : undefined);
  onMount(() => {
    hidden = notifications
      .filter((n) => n.level === 'normal' && Date.now() - new Date(n.createdAt).getTime() > 30000)
      .map((n) => n.id);
    mounted = true;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      delivery.clear();
    };
  });
  const visible = $derived(
    mounted
      ? notifications
          .filter((n) => !n.readAt && !hidden.includes(n.id) && n.level !== 'silent')
          .slice(0, 3)
      : []
  );
  $effect(() => {
    for (const n of visible) {
      if (n.level === 'normal' && !observed.has(n.id)) {
        observed.add(n.id);
        timers.set(n.id,setTimeout(() => {
          timers.delete(n.id);
          hidden = [...hidden, n.id];
        }, 7000));
      }
    }
  });
</script>

{#if visible.length || feedback || serverFailure}<div class="toasts" aria-live="polite">
    {#if feedback}<Toast text={feedback.text} kind={feedback.kind} error={feedback.error} busy={feedback.busy} actionLabel={feedback.undo ? 'Undo' : 'Retry'} onaction={feedback.undo || feedback.retry ? delivery.act : undefined} ondismiss={()=>delivery.clear()} dismissLabel="Dismiss action feedback" />{/if}
    {#if serverFailure&&!feedback}<Toast text={serverFailure} kind="error" />{/if}
    {#each visible as n (n.id)}<Toast text={n.title} description={n.body} onopen={()=>{if(!preview)openNotifications();}} dismissLabel={`Dismiss notification: ${n.title}`} ondismiss={()=>{
      hidden=[...hidden,n.id];
      if(n.level==='persistent')void change(`notifications/${n.id}`,{action:'dismiss'}).catch(()=>{hidden=hidden.filter(id=>id!==n.id);});
    }} />{/each}
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
