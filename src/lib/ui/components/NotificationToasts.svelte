<script lang="ts">
  import { actionFeedback, undoAction } from '$lib/ui/action-feedback.svelte';
  import { onMount } from 'svelte';
  import { useClient } from '$lib/ui/client-context';
  import Icon from './Icon.svelte';

  const { preview, change } = useClient();

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
  const feedback = $derived(preview ? null : actionFeedback.current);
  onMount(() => {
    hidden = notifications
      .filter((n) => n.level === 'normal' && Date.now() - new Date(n.createdAt).getTime() > 30000)
      .map((n) => n.id);
    mounted = true;
    return () => {
      if (!preview) actionFeedback.current = null;
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

{#if visible.length || feedback}<div class="toasts" aria-live="polite">
    {#if feedback}<div class="toast solid-surface" role="status">
        <div class="action-message">
          <p>{feedback.text}</p>
          {#if feedback.error}<p role="alert">{feedback.error}</p>{/if}
          {#if feedback.undo}<button
              class="button ghost"
              disabled={feedback.busy}
              onclick={undoAction}>Undo</button
            >{/if}
        </div>
        <button
          class="icon-button"
          aria-label="Dismiss action feedback"
          disabled={feedback.busy}
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
