<script lang="ts">
  import {openNotifications} from '#lib/ui/panels/notifications.svelte.js';
  import { onMount, tick } from 'svelte';
  import { useClient } from '#lib/ui/client-context.js';
  import { ApiError, refreshAfterChange } from '#lib/ui/client.js';
  import { temporaryFeedback } from '#lib/ui/action-feedback.svelte.js';
  import { createNotificationToasts, raiseToastStack, type ToastNotification } from '#lib/ui/controls/notification-toasts.js';
  import Toast from './Toast.svelte';

  const { preview, api, feedback:delivery } = useClient();

  let { notifications, initialFailure, rich = false }: { notifications: ToastNotification[]; initialFailure?:string; rich?:boolean } = $props();
  let mounted = $state(false), visible = $state.raw<ToastNotification[]>([]);
  const owner = Symbol('notification toast persistence');
  const toasts = createNotificationToasts({
    preview,
    frontOnly: true,
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
  const feedback = $derived(delivery.current);
  const serverFailure = $derived(!mounted ? initialFailure : undefined);
  const count = $derived(visible.length + Number(!!feedback));
  const activeNotice = $derived(feedback ? undefined : visible[0]);

  async function dismiss(perform: () => void) {
    const restore = document.activeElement?.matches('.toast-dismiss:focus-visible');
    perform();
    if (!restore) return;
    await tick();
    document.querySelector<HTMLElement>('.toasts:popover-open .toast-dismiss:not(:disabled)')?.focus({preventScroll:true});
  }
  onMount(() => {
    const visibility = () => toasts.setForeground(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', visibility);
    visibility();
    toasts.mount(notifications);
    mounted = true;
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      toasts.dispose();
      delivery.clearAll();
    };
  });
  $effect(() => { toasts.update(notifications); });
  $effect(() => { toasts.present(activeNotice?.id, rich); });
  const hasToasts = $derived(count > 0);
  $effect(() => {
    if (hasToasts && delivery.activeHost !== null) return delivery.showNotifications(inboxToasts);
  });
</script>

{#snippet noticeToast(n: ToastNotification)}
  {@const media = rich ? n.media : undefined}
  {@const actor = rich ? n.actor : undefined}
  {@const metadata = [media?.captionSubtitle, media?.year, media?.durationLabel].filter(Boolean).join(' · ')}
  {@const description = [n.body, media?.title && !n.title.includes(media.title) ? media.title : '', metadata].filter(Boolean).join(' · ')}
  <Toast {rich} text={actor ? `${actor.username} · ${n.title}` : n.title} {description} {actor} {media} stampId={n.id}
    category={n.kind} persistent={n.locked || n.level === 'persistent'}
    onopen={()=>{if(!preview)openNotifications(n.kind);}} actionLabel="View" dismissLabel={`Dismiss notification: ${n.title}`}
    ondismiss={()=>void dismiss(()=>toasts.dismiss(n))} onpause={paused=>toasts.pause(n.id,paused)} />
{/snippet}

{#snippet feedbackToast()}
  {#if feedback}{#key feedback}
    <Toast {rich} text={feedback.text} kind={feedback.kind} error={feedback.error} busy={feedback.busy} persistent={!temporaryFeedback(feedback)}
      autoDismiss={temporaryFeedback(feedback)} actionLabel={feedback.undo ? 'Undo' : feedback.retry ? feedback.actionLabel ?? 'Retry' : undefined}
      onaction={feedback.undo || feedback.retry ? delivery.act : undefined} ondismiss={()=>void dismiss(()=>delivery.clear())} dismissLabel="Dismiss action feedback" />
  {/key}{/if}
{/snippet}

{#snippet inboxToasts()}
  {#if rich}
    <div class="toast-deck" data-depth={Math.max(0, Math.min(count - 1, 2))}>
      {#if activeNotice}{#key activeNotice.id}{@render noticeToast(activeNotice)}{/key}
      {:else}{@render feedbackToast()}{/if}
    </div>
  {:else}
    {@render feedbackToast()}
    {#each visible as notice (notice.id)}{@render noticeToast(notice)}{/each}
  {/if}
{/snippet}

{#if delivery.activeHost === null && (hasToasts || serverFailure)}<div class="toasts" popover={mounted ? 'manual' : undefined} use:raiseToastStack>
    {#if hasToasts}{@render inboxToasts()}
    {:else if serverFailure}<Toast {rich} text={serverFailure} kind="error" />{/if}
  </div>{/if}

<style>
  .toast-deck { position: relative; isolation: isolate; }
  .toast-deck[data-depth='1'] { margin-block-end: 8px; }
  .toast-deck[data-depth='2'] { margin-block-end: 16px; }
  .toast-deck[data-depth='1']::before,
  .toast-deck[data-depth='2']::before,
  .toast-deck[data-depth='2']::after {
    content: '';
    position: absolute;
    inset-block-start: 20px;
    border: 1px solid var(--line);
    border-radius: var(--toast-radius);
    background: var(--surface);
    box-shadow: var(--elevation-raised);
    pointer-events: none;
  }
  .toast-deck::before { inset-inline: 12px; inset-block-end: -8px; clip-path: inset(calc(100% - 8px) -24px -24px); z-index: -1; }
  .toast-deck::after { inset-inline: 26px; inset-block-end: -16px; clip-path: inset(calc(100% - 16px) -24px -24px); z-index: -2; }
</style>
