<script lang="ts">
  import { getContext, onMount, setContext, tick, type Snippet } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { liquidGlass } from '$lib/ui/materials/glass';
  import Icon, { type IconName } from './Icon.svelte';

  type MenuContext = {
    closeAll: (focus?: boolean) => void;
    surface: () => HTMLDivElement;
    side: () => 'left' | 'right';
    showChild: (close: (() => void) | null, drill: boolean) => void;
  };
  const parent = getContext<MenuContext | undefined>('coast-context-menu');
  const id = $props.id();
  let {
    label = 'More options',
    icon,
    children,
    trigger,
    hideTrigger = false,
    align = 'end',
    upward = false,
    triggerClass = parent ? 'menu-row' : 'icon-button',
    onopen,
    panel = false,
    disabled = false,
  }: {
    label?: string;
    icon?: IconName;
    hideTrigger?: boolean;
    children: Snippet;
    trigger?: Snippet;
    align?: 'start' | 'end';
    upward?: boolean;
    triggerClass?: string;
    onopen?: () => void;
    panel?: boolean;
    disabled?: boolean;
  } = $props();
  let root: HTMLDivElement;
  let triggerNode: HTMLButtonElement;
  let surface: HTMLDivElement;
  let open = $state(false);
  let compact = $state(false);
  let childHidden = $state(false);
  let childClose: (() => void) | null = null;
  let frame = 0;
  let side: 'left' | 'right' = 'right';
  let search = '';
  let lastTyped = 0;
  let point: { x: number; y: number } | undefined;
  let returnFocus: HTMLElement | null = null;
  export function openAt(position: { x: number; y: number }) {
    point = position;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openMenu(true);
    place();
  }

  function closeMenu(focus = false) {
    if (!open) return;
    for (const child of root.querySelectorAll<HTMLElement>('[popover]:popover-open'))
      child.hidePopover();
    open = false;
    childClose = null;
    childHidden = false;
    parent?.showChild(null, false);
    if (focus) (returnFocus?.isConnected ? returnFocus : triggerNode)?.focus({ preventScroll: true });
    point = undefined;
    returnFocus = null;
  }
  function closeAll(focus = false) {
    if (parent) parent.closeAll(focus);
    else closeMenu(focus);
  }
  setContext<MenuContext>('coast-context-menu', {
    closeAll,
    surface: () => surface,
    side: () => side,
    showChild(close, drill) {
      if (close && childClose && childClose !== close) childClose();
      childClose = close;
      childHidden = !!close && drill;
    },
  });
  const closeFromParent = () => closeMenu();

  function place() {
    if (!open || !surface.matches(':popover-open')) return;
    const anchor = triggerNode.getBoundingClientRect();
    const menu = surface.getBoundingClientRect();
    const gap = 8;
    if (parent) {
      const parentBounds = parent.surface().getBoundingClientRect();
      const right = parentBounds.right + 4;
      const leftEdge = parentBounds.left - menu.width - 4;
      side =
        parent.side() === 'left'
          ? leftEdge >= gap
            ? 'left'
            : 'right'
          : right + menu.width <= window.innerWidth - gap
            ? 'right'
            : 'left';
      const left = compact ? parentBounds.left : side === 'right' ? right : leftEdge;
      const top = compact ? parentBounds.top : anchor.top - 4;
      surface.style.left = `${Math.round(Math.max(gap, Math.min(window.innerWidth - menu.width - gap, left)))}px`;
      surface.style.top = `${Math.round(Math.max(gap, Math.min(window.innerHeight - menu.height - gap, top)))}px`;
      return;
    }
    const left = Math.max(
      gap,
      Math.min(
        window.innerWidth - menu.width - gap,
        point ? point.x : align === 'start' ? anchor.left : anchor.right - menu.width
      )
    );
    const preferred = point
      ? point.y
      : upward
        ? anchor.top - menu.height - gap
        : anchor.bottom + gap;
    const alternate = point
      ? point.y - menu.height
      : upward
        ? anchor.bottom + gap
        : anchor.top - menu.height - gap;
    const top =
      preferred >= gap && preferred + menu.height <= window.innerHeight - gap
        ? preferred
        : Math.max(gap, Math.min(window.innerHeight - menu.height - gap, alternate));
    surface.style.left = `${Math.round(left)}px`;
    surface.style.top = `${Math.round(top)}px`;
  }
  function schedulePlace() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(place);
  }
  function controls() {
    return [
      ...surface.querySelectorAll<HTMLElement>('[role^="menuitem"], [data-menu-focus]'),
    ].filter(
      (node) =>
        node.closest('[role="menu"]') === surface &&
        !node.matches(':disabled') &&
        node.getClientRects().length > 0 &&
        getComputedStyle(node).visibility !== 'hidden'
    );
  }
  export async function focusFirst(last = false) {
    await tick();
    focusItem(last);
    schedulePlace();
  }
  function focusItem(last = false) {
    const items = controls();
    (last ? items.at(-1) : items[0])?.focus({ preventScroll: true });
  }
  function openMenu(focus = false, last = false) {
    if (disabled) return;
    if (!open) {
      parent?.showChild(closeFromParent, compact);
      surface.showPopover();
      open = true;
      place();
      onopen?.();
    }
    if (focus || (parent && compact)) void focusFirst(last);
  }
  function triggerKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      (parent && event.key === 'ArrowRight')
    ) {
      event.preventDefault();
      event.stopPropagation();
      openMenu(true, event.key === 'ArrowUp');
    }
  }
  function menuKey(event: KeyboardEvent) {
    if (!(event.target instanceof Element) || event.target.closest('[role="menu"]') !== surface)
      return;
    if (
      event.key === 'Escape' ||
      (parent && event.key === 'ArrowLeft' && !event.target.closest('[data-menu-interactive]'))
    ) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (event.target.matches('input, select, textarea')) return;
    if (event.key === 'Tab') {
      closeAll(true);
      return;
    }
    if (event.key === 'ArrowRight' && event.target.closest('[aria-haspopup="menu"]')) {
      event.preventDefault();
      (event.target.closest('[aria-haspopup="menu"]') as HTMLElement).click();
      return;
    }
    if (
      event.key.length === 1 &&
      /\S/.test(event.key) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.target.closest('[data-menu-interactive]')
    ) {
      const now = Date.now();
      search = (now - lastTyped < 700 ? search : '') + event.key.toLowerCase();
      lastTyped = now;
      const items = controls();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const ordered = [...items.slice(current + 1), ...items.slice(0, current + 1)];
      const match = ordered.find((item) =>
        item.textContent?.trim().toLowerCase().startsWith(search)
      );
      if (match) {
        event.preventDefault();
        match.focus({ preventScroll: true });
        match.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const items = controls();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus({ preventScroll: true });
      items[next]?.scrollIntoView({ block: 'nearest' });
    }
  }
  function action(event: MouseEvent) {
    const control = event.target instanceof Element ? event.target.closest('a,button') : null;
    if (
      !control ||
      control.closest('[role="menu"]') !== surface ||
      control.hasAttribute('data-menu-keep-open')
    )
      return;
    queueMicrotask(() => closeAll(root.contains(document.activeElement)));
  }
  afterNavigate(() => closeMenu());
  onMount(() => {
    const query = window.matchMedia('(max-width: 640px), (hover: none)');
    const updateMode = () => {
      compact = query.matches;
      if (open && parent) parent.showChild(closeFromParent, compact);
      schedulePlace();
    };
    updateMode();
    query.addEventListener('change', updateMode);
    const outside = (event: Event) => {
      if (open && event.target instanceof Node && !root.contains(event.target)) closeMenu();
    };
    const observer = new ResizeObserver(schedulePlace);
    observer.observe(surface);
    observer.observe(triggerNode);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    window.addEventListener('resize', schedulePlace);
    window.addEventListener('scroll', schedulePlace, true);
    return () => {
      closeMenu();
      query.removeEventListener('change', updateMode);
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('resize', schedulePlace);
      window.removeEventListener('scroll', schedulePlace, true);
    };
  });
</script>

<div bind:this={root} class="context" class:external-trigger={hideTrigger} class:submenu={!!parent}>
  <button
    bind:this={triggerNode}
    id={`${id}-trigger`}
    type="button"
    hidden={hideTrigger}
    class={triggerClass}
    {disabled}
    role={parent ? 'menuitem' : undefined}
    aria-label={label}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls={`${id}-menu`}
    data-menu-keep-open
    onkeydown={triggerKey}
    onpointerenter={(event) => {
      if (parent && !compact && event.pointerType === 'mouse') openMenu();
    }}
    onclick={(event) => (open && !parent ? closeMenu() : openMenu(event.detail === 0))}
    >{#if trigger}{@render trigger()}{:else if parent}{#if icon}<Icon name={icon} />{/if}<span
        class="menu-action-label">{label}</span
      ><span class="menu-chevron"><Icon name="right" /></span>{:else}<Icon
        name={icon ?? 'more'}
      />{/if}</button
  >
  <div
    bind:this={surface}
    id={`${id}-menu`}
    use:liquidGlass={{ variant: 'glassDark' }}
    class="menu-surface glass"
    class:menu-panel={panel}
    class:drill-hidden={childHidden}
    role="menu"
    aria-label={label}
    popover="manual"
    tabindex="-1"
    onclick={action}
    onkeydown={menuKey}
    ontoggle={(event) => {
      open = event.newState === 'open';
      if (open) schedulePlace();
    }}
  >
    {#if parent && compact}<button
        type="button"
        class="menu-row"
        role="menuitem"
        data-menu-keep-open
        onclick={() => closeMenu(true)}
        ><Icon name="left" /><span class="menu-action-label">Back · {label}</span></button
      >{/if}
    {#if open}{@render children()}{/if}
  </div>
</div>

<style>
  .menu-surface {
    visibility: visible;
    pointer-events: auto;
  }
  .menu-surface.drill-hidden {
    visibility: hidden;
    pointer-events: none;
  }
  .context.external-trigger {
    display: contents;
  }
  .context > button[hidden] {
    display: none;
  }
  .context {
    display: inline-flex;
  }
  .context.submenu {
    display: block;
    width: 100%;
  }
</style>
