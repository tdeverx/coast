<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import { liquidGlass } from '$lib/ui/materials/glass';
  function heroGlass(node: HTMLElement, enabled: boolean) {
    let material = enabled ? liquidGlass(node) : undefined;
    return {
      update(next: boolean) {
        if (next === enabled) return;
        enabled = next;
        material?.destroy?.();
        material = enabled ? liquidGlass(node) : undefined;
      },
      destroy() {
        material?.destroy?.();
      },
    };
  }
  let {
    children,
    icon,
    href,
    onclick,
    variant = 'primary',
    disabled = false,
    type = 'button',
    label,
  }: {
    children?: Snippet;
    icon?: IconName;
    href?: string;
    onclick?: (e: MouseEvent) => void;
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'hero';
    disabled?: boolean;
    type?: 'button' | 'submit';
    label?: string;
  } = $props();
</script>

{#if href}<a
    use:heroGlass={variant === 'hero'}
    class="button {variant}"
    class:glass={variant === 'hero'}
    href={disabled ? undefined : href}
    role={disabled ? 'link' : undefined}
    aria-disabled={disabled || undefined}
    tabindex={disabled ? -1 : undefined}
    onclick={(event) => {
      if (disabled) event.preventDefault();
      else onclick?.(event);
    }}
    aria-label={label}
    >{#if icon}<Icon name={icon} size={18} />{/if}{@render children?.()}</a
  >{:else}<button
    use:heroGlass={variant === 'hero'}
    class="button {variant}"
    class:glass={variant === 'hero'}
    {type}
    {disabled}
    {onclick}
    aria-label={label}
    >{#if icon}<Icon name={icon} size={18} />{/if}{@render children?.()}</button
  >{/if}
