<script lang="ts">
  import Button from './Button.svelte';
  import { untrack, type Snippet } from 'svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import { liquidGlass } from '$lib/ui/materials/glass';
  import type { GlassVariant } from '$lib/ui/materials/presets';
  import { createMenuController } from '$lib/ui/controls/menu.svelte';
  import { notifyAction } from '$lib/ui/action-feedback.svelte';

  type ButtonProps = {

    children?: Snippet; text?: string; icon?: IconName;
    onclick?: (event: MouseEvent) => void;
    emphasis?: 'standard' | 'subtle'; size?: 'standard' | 'hero' | 'icon'; fallback?: boolean;
    disabled?: boolean; type?: 'button' | 'submit'; label?: string; title?: string;
    pressed?: boolean; compact?: boolean;
 trigger?: Snippet; hideTrigger?: boolean;
    align?: 'start' | 'end'; upward?: boolean; triggerClass?: string; onopen?: () => void;
    panel?: boolean; disabledReason?: string; danger?: boolean; branch?: boolean;
    checked?: boolean; showCheckmark?: boolean; selection?: 'checkbox' | 'radio'; keepOpen?: boolean;
    material?: GlassVariant; class?: string; iconSize?: number;
  } & (
    | { menu: true; item?: false; href?: never }
    | { menu?: false; item: true; href?: string }
    | { menu?: false; item?: false; href?: string }
  );
  let {
    children, text, icon, href, onclick, emphasis = 'standard', size = 'standard', fallback = false, disabled = false,
    type = 'button', label, title, pressed, compact = false,
    menu = false, item = false, trigger, hideTrigger = false,
    align = 'end', upward = false, triggerClass, onopen, panel = false,
    disabledReason, danger = false, branch = false, checked, showCheckmark = true,
    selection = 'checkbox', keepOpen = true, material, class: className = '', iconSize,
  }: ButtonProps = $props();
  const id = $props.id();
  let root = $state<HTMLDivElement>(null!), triggerNode = $state<HTMLButtonElement>(null!), surface = $state<HTMLDivElement>(null!);
  // Mode is structural, fixed for the lifetime of this control. Values/callbacks remain live.
  const controller = untrack(() => menu ? createMenuController({
    root: () => root, triggerNode: () => triggerNode, surface: () => surface,
    disabled: () => disabled, align: () => align, upward: () => upward, onopen: () => onopen?.(),
  }) : null);
  export function openAt(position: { x: number; y: number }) { controller?.openAt(position); }
  export function focusFirst(last = false) { return controller?.focusFirst(last); }
  const nested = $derived(controller?.nested ?? false);
  const usesMaterial = $derived(!menu && !item && !compact && size !== 'icon' && emphasis === 'standard');
  const controlMaterial = $derived(material ?? (size === 'hero' ? 'clear' : 'glassDark'));
  const controlClass = $derived(`${menu ? triggerClass ?? (nested ? 'menu-row' : text ? 'button control-subtle' : 'icon-button')
    : item ? 'menu-row' : size === 'icon' ? 'icon-button' : compact ? 'availability-toggle' : `button control-${emphasis}${size === 'hero' ? ' hero' : ''}`} ${className}`);
  const role = $derived(item ? (checked === undefined ? 'menuitem' : selection === 'radio' ? 'menuitemradio' : 'menuitemcheckbox') : menu && nested ? 'menuitem' : undefined);
  function surfaceMaterial(node: HTMLElement, options: {enabled: boolean; variant: GlassVariant; blur: boolean}) {
    let action: ReturnType<typeof liquidGlass> | undefined;
    let applied = '';
    const update = (next: typeof options) => {
      const key = `${next.enabled}/${next.variant}/${next.blur}`;
      if (key === applied) return;
      applied = key;
      action?.destroy?.();
      action = next.enabled ? liquidGlass(node, {variant: next.variant, renderer: next.blur ? 'css' : 'auto'}) : undefined;
    };
    update(options);
    return {update, destroy() {action?.destroy?.();}};
  }
  function activate(event: MouseEvent) {
    if (disabled) {event.preventDefault(); if (disabledReason) notifyAction(disabledReason); return;}
    if (controller) {if (controller.open && !nested) controller.close(); else controller.openMenu(event.detail === 0);}
    else onclick?.(event);
  }
</script>

{#snippet content()}
  {#if menu && trigger}{@render trigger()}
  {:else}
    {#if icon || menu && !nested && !text}<Icon name={icon ?? 'more'} size={iconSize ?? (menu || item ? 20 : 18)} filled={checked ?? pressed} />{/if}
    {#if item || menu && nested}<span class="menu-action-label">{text ?? (menu ? label : '')}{#if !menu}{@render children?.()}{/if}</span>
    {:else}{text}{#if !menu}{@render children?.()}{/if}{/if}
    {#if branch || menu && nested}<span class="menu-chevron"><Icon name="right" /></span>
    {:else if item && checked && showCheckmark}<span class="menu-chevron"><Icon name="check" /></span>{/if}
  {/if}
{/snippet}
{#snippet control()}
  {#if href && !menu}<a class={controlClass} class:glass={usesMaterial} class:light-material={usesMaterial && controlMaterial === 'glassLight'} class:menu-row-danger={item && danger} class:control-danger={!item && danger}
    use:surfaceMaterial={{enabled:usesMaterial,variant:controlMaterial,blur:fallback}}
    href={disabled ? undefined : href} role={role ?? (disabled ? 'link' : undefined)} tabindex={disabled ? -1 : undefined}
    aria-label={label} aria-disabled={disabled || undefined} aria-describedby={disabled && disabledReason ? `${id}-reason` : undefined}
    {title} onclick={activate}>{@render content()}</a>
  {:else}<button bind:this={triggerNode} class={controlClass} class:glass={usesMaterial} class:light-material={usesMaterial && controlMaterial === 'glassLight'} class:active={pressed} class:menu-row-danger={item && danger} class:control-danger={!item && danger}
    use:surfaceMaterial={{enabled:usesMaterial,variant:controlMaterial,blur:fallback}}
    id={menu ? `${id}-trigger` : undefined} {type} hidden={hideTrigger} disabled={disabled && !(item && disabledReason)}
    {role} aria-label={label ?? (menu ? 'More options' : undefined)} aria-pressed={pressed} aria-checked={checked}
    aria-disabled={disabled || undefined} aria-describedby={disabled && disabledReason ? `${id}-reason` : undefined}
    aria-haspopup={menu || branch ? 'menu' : undefined} aria-expanded={controller?.open} aria-controls={menu ? `${id}-menu` : undefined}
    title={title ?? (disabled ? disabledReason : undefined)} data-menu-keep-open={menu || item && keepOpen ? true : undefined}
    onkeydown={controller?.triggerKey} onpointerenter={event=>{if(controller?.nested && !controller.compact && event.pointerType==='mouse')controller.openMenu();}}
    onclick={activate}>{@render content()}</button>{/if}
{/snippet}
{#if controller}<div bind:this={root} class="context" class:external-trigger={hideTrigger} class:submenu={nested}>
  {@render control()}
  <div bind:this={surface} id={`${id}-menu`} use:liquidGlass={{variant:'glassDark'}} class="menu-surface glass"
    class:menu-panel={panel} class:drill-hidden={controller.childHidden} role="menu" aria-label={label ?? 'More options'} popover="manual" tabindex="-1"
    onclick={controller.action} onkeydown={controller.menuKey} ontoggle={controller.toggle}>
    {#if nested && controller.compact}<Button item icon="left" text={`Back · ${label}`} onclick={()=>controller.close(true)} />{/if}
    {#if controller.open}{@render children?.()}{/if}
  </div>
</div>{:else}{@render control()}{/if}
{#if disabled && disabledReason}<span id={`${id}-reason`} class="sr-only">{disabledReason}</span>{/if}

<style>
  .context {display:inline-flex;}
  .context.external-trigger {display:contents;}
  .context.submenu {display:block;width:100%;}
  .context > button[hidden] {display:none;}
  .menu-surface {visibility:visible;pointer-events:auto;}
  .menu-surface.drill-hidden {visibility:hidden;pointer-events:none;}
  .button.control-standard {color:var(--ink);background:var(--coast-glass-fill);border:0;}
  .button.control-standard:hover {background:color-mix(in srgb,var(--coast-glass-fill),var(--white) 5%);}
  .button.control-standard.hero:hover {background:var(--coast-glass-fill);}
  .button.control-subtle {color:var(--muted);background:transparent;border-color:transparent;}
  .button.control-subtle:hover {color:var(--ink);background:color-mix(in srgb,var(--white) 5%,transparent);}
  .button.control-danger, .button.control-danger:hover, .icon-button.control-danger, .icon-button.control-danger:hover {color:var(--danger);}
  .button.light-material {color:var(--canvas);}
  .availability-toggle {display:grid;place-items:center;flex:0 0 auto;width:var(--control-compact-height);height:var(--control-compact-height);padding:0;border:0;background:transparent;color:var(--muted);cursor:pointer;transition:color 150ms ease;}
  .availability-toggle:hover,.availability-toggle:focus-visible,.availability-toggle.active {color:var(--ink);}
</style>
