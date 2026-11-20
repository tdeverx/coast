<script module lang="ts">
  import type { Snippet } from 'svelte';

  export type BackgroundPosition = { x: number; y: number };
  export type ProfileEditFields = {
    avatar: Snippet;
    title: Snippet;
    bio: Snippet;
    actions: Snippet;
    backgroundPosition?: BackgroundPosition;
    moveBackground: (position: BackgroundPosition) => void;
    clearBackground: () => void;
  };
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { reportFailure, useClient } from '#lib/ui/client-context.js';
  import { createOperation } from '#lib/ui/operation.svelte.js';
  import { useRetention } from '#lib/ui/retention.js';
  import type { ProfileSettings } from '#lib/server/db/schema.js';
  import AvatarPicker from './AvatarPicker.svelte';
  import Button from './Button.svelte';

  let {
    open = $bindable(false), backgroundCleared = $bindable(false), profile, username, avatarPreview, children,
  }: {
    open: boolean;
    backgroundCleared?: boolean;
    profile: ProfileSettings;
    username: string;
    avatarPreview?: Snippet<[string | null, Snippet]>;
    children: Snippet<[ProfileEditFields | undefined]>;
  } = $props();

  const { api, change } = useClient();
  const operation = createOperation(useRetention());
  let displayName = $state(''), bio = $state(''), avatar = $state<string | null>(null);
  let reading = $state(false), nameInput = $state<HTMLInputElement>();
  let backgroundMediaId: string | null | undefined;
  let backgroundPosition = $state<BackgroundPosition>();
  let iconChoices = $state<{id: string; provider: string; name: string}[]>([]);

  $effect.pre(() => {
    backgroundCleared = false;
    if (!open) return;
    const saved = untrack(() => profile);
    displayName = saved.displayName ?? '';
    bio = saved.bio ?? '';
    avatar = saved.avatar ?? null;
    backgroundMediaId = saved.backgroundMediaId;
    backgroundPosition = undefined;
    iconChoices = [];
    operation.error = '';
    const controller = new AbortController();
    void api<typeof iconChoices>('profile/avatars', undefined, 'GET', { signal: controller.signal })
      .then(choices => { if (!controller.signal.aborted) iconChoices = choices; })
      .catch(() => {});
    return () => controller.abort();
  });

  $effect(() => {
    if (open) nameInput?.focus({ preventScroll: true });
  });

  function save(event: SubmitEvent) {
    event.preventDefault();
    if (!open || reading || operation.busy) return;
    void operation.run(async () => {
      const position = backgroundCleared ? null : backgroundPosition;
      const background = backgroundMediaId && position !== undefined
        ? { mediaId: backgroundMediaId, position }
        : undefined;
      await change('profile', { action: 'edit', displayName, bio, avatar, background });
      open = false;
    });
  }

  reportFailure(() => open ? operation.error : '');

  function moveBackground(position: BackgroundPosition) {
    if (!operation.busy) backgroundPosition = position;
  }

  function clearBackground() {
    if (!operation.busy) backgroundCleared = true;
  }
</script>

{#snippet avatarField()}
  <AvatarPicker bind:avatar bind:reading name={profile.displayName || username}
    disabled={operation.busy} choices={iconChoices} preview={avatarPreview} />
{/snippet}

{#snippet titleField()}
  <input class="display-name" aria-label="Display name" bind:this={nameInput}
    bind:value={displayName} maxlength="60" placeholder={username} autocomplete="nickname"
    disabled={operation.busy} />
{/snippet}

{#snippet bioField()}
  <textarea aria-label="Bio" bind:value={bio} maxlength="240" rows="1"
    placeholder="Write a bio" disabled={operation.busy}></textarea>
{/snippet}

{#snippet editActions()}
  <Button size="hero" type="submit" disabled={operation.busy || reading}>
    {reading ? 'Preparing avatar…' : operation.busy ? 'Saving…' : 'Save'}
  </Button>
  <Button size="icon" icon="close" danger label="Cancel profile edit" title="Cancel profile edit"
    disabled={operation.busy} onclick={() => open = false} />
{/snippet}

<form class="hero-editor" onsubmit={save}>
  {@render children(open ? {
    avatar: avatarField, title: titleField, bio: bioField, actions: editActions,
    backgroundPosition, moveBackground, clearBackground,
  } : undefined)}
</form>

<style>
  input, textarea {
    field-sizing: content;
    width: auto;
    min-width: 4ch;
    max-width: 100%;
    min-height: 0;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  :is(input, textarea)::placeholder {
    color: var(--muted);
  }
  .display-name {
    font-size: var(--text-hero);
    font-weight: var(--weight-bold);
    line-height: var(--leading-solid);
    letter-spacing: var(--tracking-tight);
  }
  @media (max-width: 639px) {
    .display-name { font-size: var(--text-hero-mobile); }
  }
  textarea {
    display: block;
    resize: none;
    max-width: 100%;
    font-size: var(--text-md);
    line-height: var(--leading-relaxed);
  }
</style>
