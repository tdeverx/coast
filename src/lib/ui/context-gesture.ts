export type MenuPoint = { x: number; y: number };

/** Native context click, keyboard menu key, and a stationary touch hold. */
export function contextGesture(node: HTMLElement, open: (point: MenuPoint) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin: MenuPoint | undefined;
  let suppressClick = false;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    origin = undefined;
    window.removeEventListener('scroll', cancel, true);
  };
  const insideMenu = (target: EventTarget | null) =>
    target instanceof Element && !!target.closest('[role="menu"], dialog');
  const context = (event: MouseEvent) => {
    if (insideMenu(event.target)) return;
    event.preventDefault();
    cancel();
    if (!suppressClick) open({ x: event.clientX, y: event.clientY });
    suppressClick = true;
  };
  const down = (event: PointerEvent) => {
    cancel();
    suppressClick = false;
    if (
      event.pointerType === 'mouse' ||
      insideMenu(event.target) ||
      (event.target instanceof Element && event.target.closest('button'))
    )
      return;
    origin = { x: event.clientX, y: event.clientY };
    window.addEventListener('scroll', cancel, true);
    timer = setTimeout(() => {
      if (!origin) return;
      suppressClick = true;
      open(origin);
      cancel();
    }, 550);
  };
  const move = (event: PointerEvent) => {
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) cancel();
  };
  const click = (event: MouseEvent) => {
    if (!suppressClick || insideMenu(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClick = false;
  };
  const key = (event: KeyboardEvent) => {
    if (
      insideMenu(event.target) ||
      !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
    )
      return;
    event.preventDefault();
    const rect = node.getBoundingClientRect();
    open({ x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height, 60) });
  };
  node.addEventListener('contextmenu', context);
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('pointerleave', cancel);
  node.addEventListener('click', click, true);
  node.addEventListener('keydown', key);
  return {
    update(callback: typeof open) {
      open = callback;
    },
    destroy() {
      cancel();
      node.removeEventListener('contextmenu', context);
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', cancel);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('pointerleave', cancel);
      node.removeEventListener('click', click, true);
      node.removeEventListener('keydown', key);
      window.removeEventListener('scroll', cancel, true);
    },
  };
}
