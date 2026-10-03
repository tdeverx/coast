import { getContext, onMount, setContext, tick } from 'svelte';
import { afterNavigate } from '$app/navigation';

const outsideWatchers = new Set<(event: Event) => void>();
function dispatchOutside(event: Event) { for (const watcher of [...outsideWatchers]) watcher(event); }
function watchOutside(watcher: (event: Event) => void) {
  if (!outsideWatchers.size) {
    document.addEventListener('pointerdown', dispatchOutside);
    document.addEventListener('focusin', dispatchOutside);
  }
  outsideWatchers.add(watcher);
  return () => {
    outsideWatchers.delete(watcher);
    if (!outsideWatchers.size) {
      document.removeEventListener('pointerdown', dispatchOutside);
      document.removeEventListener('focusin', dispatchOutside);
    }
  };
}

type MenuOptions = {
  root: () => HTMLDivElement;
  triggerNode: () => HTMLElement;
  surface: () => HTMLDivElement;
  disabled: () => boolean;
  align: () => 'start' | 'end';
  upward: () => boolean;
  onopen?: () => void;
};
/** One controller for focus, popover positioning, keyboard navigation and nested drill-down. */
export function createMenuController(options: MenuOptions) {
  type MenuContext = {
    closeAll: (focus?: boolean) => void;
    surface: () => HTMLDivElement;
    side: () => 'left' | 'right';
    showChild: (close: (() => void) | null, drill: boolean) => void;
  };
  const parent = getContext<MenuContext | undefined>('coast-context-menu');
  let stopWatching: (() => void) | undefined;
  let startWatching = () => {};
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
  function openAt(position: { x: number; y: number }) {
    point = position;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openMenu(true);
    place();
  }

  function closeMenu(focus = false) {
    if (!open) return;
    for (const child of options.root().querySelectorAll<HTMLElement>('[popover]:popover-open'))
      child.hidePopover();
    open = false;
    stopWatching?.();
    stopWatching = undefined;
    childClose = null;
    childHidden = false;
    parent?.showChild(null, false);
    if (focus) (returnFocus?.isConnected ? returnFocus : options.triggerNode())?.focus({ preventScroll: true });
    point = undefined;
    returnFocus = null;
  }
  function closeAll(focus = false) {
    if (parent) parent.closeAll(focus);
    else closeMenu(focus);
  }
  setContext<MenuContext>('coast-context-menu', {
    closeAll,
    surface: () => options.surface(),
    side: () => side,
    showChild(close, drill) {
      if (close && childClose && childClose !== close) childClose();
      childClose = close;
      childHidden = !!close && drill;
    },
  });
  const closeFromParent = () => closeMenu();

  function place() {
    if (!open || !options.surface().matches(':popover-open')) return;
    const anchor = options.triggerNode().getBoundingClientRect();
    const menu = options.surface().getBoundingClientRect();
    const gap = 16;
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
      options.surface().style.left = `${Math.round(Math.max(gap, Math.min(window.innerWidth - menu.width - gap, left)))}px`;
      options.surface().style.top = `${Math.round(Math.max(gap, Math.min(window.innerHeight - menu.height - gap, top)))}px`;
      return;
    }
    const left = Math.max(
      gap,
      Math.min(
        window.innerWidth - menu.width - gap,
        point ? point.x : options.align() === 'start' ? anchor.left : anchor.right - menu.width
      )
    );
    const preferred = point
      ? point.y
      : options.upward()
        ? anchor.top - menu.height - gap
        : anchor.bottom + gap;
    const alternate = point
      ? point.y - menu.height
      : options.upward()
        ? anchor.bottom + gap
        : anchor.top - menu.height - gap;
    const top =
      preferred >= gap && preferred + menu.height <= window.innerHeight - gap
        ? preferred
        : Math.max(gap, Math.min(window.innerHeight - menu.height - gap, alternate));
    options.surface().style.left = `${Math.round(left)}px`;
    options.surface().style.top = `${Math.round(top)}px`;
  }
  function schedulePlace() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(place);
  }
  function controls() {
    return [
      ...options.surface().querySelectorAll<HTMLElement>('[role^="menuitem"], [data-menu-focus]'),
    ].filter(
      (node) =>
        node.closest('[role="menu"]') === options.surface() &&
        !node.matches(':disabled') &&
        node.getClientRects().length > 0 &&
        getComputedStyle(node).visibility !== 'hidden'
    );
  }
  async function focusFirst(last = false) {
    await tick();
    focusItem(last);
    schedulePlace();
  }
  function focusItem(last = false) {
    const items = controls();
    (last ? items.at(-1) : items[0])?.focus({ preventScroll: true });
  }
  function openMenu(focus = false, last = false) {
    if (options.disabled()) return;
    if (!open) {
      parent?.showChild(closeFromParent, compact);
      options.surface().showPopover();
      open = true;
      startWatching();
      place();
      options.onopen?.();
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
    if (!(event.target instanceof Element) || event.target.closest('[role="menu"]') !== options.surface())
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
      control.closest('[role="menu"]') !== options.surface() ||
      control.hasAttribute('data-menu-keep-open')
    )
      return;
    queueMicrotask(() => closeAll(options.root().contains(document.activeElement)));
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
      if (open && event.target instanceof Node && !options.root().contains(event.target)) closeMenu();
    };
    startWatching = () => {
      if (stopWatching) return;
      const observer = new ResizeObserver(schedulePlace);
      observer.observe(options.surface());
      observer.observe(options.triggerNode());
      const releaseOutside = watchOutside(outside);
      window.addEventListener('resize', schedulePlace);
      window.addEventListener('scroll', schedulePlace, true);
      stopWatching = () => {
        observer.disconnect();
        releaseOutside();
        cancelAnimationFrame(frame);
        window.removeEventListener('resize', schedulePlace);
        window.removeEventListener('scroll', schedulePlace, true);
      };
    };
    if (open) startWatching();
    return () => {
      closeMenu();
      query.removeEventListener('change', updateMode);
      cancelAnimationFrame(frame);
      stopWatching?.();
      startWatching = () => {};
    };
  });

  return {
    get open() { return open; },
    get nested() { return !!parent; },
    get compact() { return compact; },
    get childHidden() { return childHidden; },
    openAt, focusFirst, close: closeMenu, openMenu, triggerKey, menuKey, action,
    toggle(event: ToggleEvent) { if (event.newState === 'closed') closeMenu(); else { open = true; startWatching(); schedulePlace(); } },
  };
}
