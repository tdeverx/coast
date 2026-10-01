<script lang="ts">
  import { actionFeedback, undoAction } from '$lib/ui/action-feedback.svelte';
  import { onMount } from 'svelte';
  import { change } from '$lib/ui/client';
  import Icon from './Icon.svelte';
  type InboxNotification = {
    id: string;
    title: string;
    body: string | null;
    level: 'silent' | 'normal' | 'persistent';
    readAt: Date | string | null;
    createdAt: Date | string;
  };
  let { notifications }: { notifications: InboxNotification[] } = $props();
  let hidden = $state<string[]>([]),
    mounted = $state(false);
  const observed = new Set<string>();
  onMount(() => {
    hidden = notifications
      .filter((n) => n.level === 'normal' && Date.now() - new Date(n.createdAt).getTime() > 30000)
      .map((n) => n.id);
    mounted = true;
    return () => {
      actionFeedback.current = null;
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
        setTimeout(() => {
          hidden = [...hidden, n.id];
        }, 7000);
      }
    }
  });
</script>

{#if visible.length || actionFeedback.current}<div class="toasts" aria-live="polite">
    {#if actionFeedback.current}<div class="toast solid-surface" role="status">
        <div class="action-message">
          <p>{actionFeedback.current.text}</p>
          {#if actionFeedback.current.error}<p role="alert">{actionFeedback.current.error}</p>{/if}
          {#if actionFeedback.current.undo}<button
              class="button ghost"
              disabled={actionFeedback.current.busy}
              onclick={undoAction}>Undo</button
            >{/if}
        </div>
        <button
          class="icon-button"
          aria-label="Dismiss action feedback"
          disabled={actionFeedback.current.busy}
          onclick={() => (actionFeedback.current = null)}><Icon name="close" size={17} /></button
        >
      </div>{/if}
    {#each visible as n (n.id)}<div class="toast solid-surface">
        <a href="/notifications"
          ><h3>{n.title}</h3>
          {#if n.body}<p>{n.body}</p>{/if}</a
        ><button
          class="icon-button"
          aria-label={`Dismiss notification: ${n.title}`}
          onclick={() => {
            hidden = [...hidden, n.id];
            if (n.level === 'persistent')
              void change(`notifications/${n.id}`, { action: 'dismiss' }).catch(() => {
                hidden = hidden.filter((id) => id !== n.id);
              });
          }}><Icon name="close" size={17} /></button
        >
      </div>{/each}
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
  .toast {
    border-radius: 16px;
    padding: 16px;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    animation: appear var(--motion);
  }
  :global(.player-active) .toasts {
    bottom: calc(96px + env(safe-area-inset-bottom));
  }
  .action-message,
  .toast > a {
    flex: 1;
  }
  .toast h3 {
    font-size: var(--text-sm);
  }
  .toast p {
    font-size: var(--text-sm);
    margin-top: 5px;
  }
  .toast .icon-button {
    width: 28px;
    height: 28px;
  }
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
