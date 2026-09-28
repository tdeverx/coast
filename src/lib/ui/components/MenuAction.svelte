<script lang="ts">
  import type { Snippet } from 'svelte';
  import { notifyAction } from '$lib/ui/action-feedback.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  const reasonId = $props.id();
  let {
    children,
    icon,
    href,
    onclick,
    disabled = false,
    disabledReason,
    danger = false,
    branch = false,
    checked,
    showCheckmark = true,
    selection = 'checkbox',
    keepOpen = true,
  }: {
    children: Snippet;
    icon?: IconName;
    href?: string;
    onclick?: () => void;
    disabled?: boolean;
    disabledReason?: string;
    danger?: boolean;
    branch?: boolean;
    checked?: boolean;
    showCheckmark?: boolean;
    selection?: 'checkbox' | 'radio';
    keepOpen?: boolean;
  } = $props();
</script>

{#snippet content()}
  {#if icon}<Icon name={icon} filled={checked} />{/if}<span class="menu-action-label"
    >{@render children()}</span
  >
  {#if branch}<span class="menu-chevron"><Icon name="right" /></span
    >{:else if checked && showCheckmark}<span class="menu-chevron"><Icon name="check" /></span>{/if}
{/snippet}
{#if href}<a
    class="menu-row"
    class:menu-row-danger={danger}
    role="menuitem"
    href={disabled ? undefined : href}
    tabindex={disabled ? -1 : undefined}
    aria-disabled={disabled || undefined}
    title={disabled ? disabledReason : undefined}
    aria-describedby={disabled && disabledReason ? reasonId : undefined}
    onclick={(event) => {
      if (disabled) {
        event.preventDefault();
        if (disabledReason) notifyAction(disabledReason);
      } else onclick?.();
    }}>{@render content()}</a
  >
{:else}<button
    type="button"
    class="menu-row"
    class:menu-row-danger={danger}
    role={checked === undefined
      ? 'menuitem'
      : selection === 'radio'
        ? 'menuitemradio'
        : 'menuitemcheckbox'}
    aria-checked={checked}
    aria-haspopup={branch ? 'menu' : undefined}
    data-menu-keep-open={keepOpen ? true : undefined}
    disabled={disabled && !disabledReason}
    aria-disabled={disabled || undefined}
    title={disabled ? disabledReason : undefined}
    aria-describedby={disabled && disabledReason ? reasonId : undefined}
    onclick={() => {
      if (disabled) {
        if (disabledReason) notifyAction(disabledReason);
      } else onclick?.();
    }}>{@render content()}</button
  >{/if}

{#if disabled && disabledReason}<span id={reasonId} class="sr-only">{disabledReason}</span>{/if}
