function itemFrom(target: EventTarget | null, root: HTMLElement) {
  const element = target instanceof Element ? target.closest<HTMLElement>('a, button') : null;
  return element?.parentElement === root ? element : null;
}

/** One measured selection surface shared by navigation and segmented controls. */
export function slidingPill(root: HTMLElement) {
  const indicator = document.createElement('span');
  indicator.className = 'sliding-pill-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  root.prepend(indicator);
  let frame = 0;

  function selected() {
    return Array.from(root.children).find((child) => child instanceof HTMLElement
      && (child.getAttribute('aria-current') === 'page' || child.getAttribute('aria-pressed') === 'true')) as HTMLElement | undefined;
  }

  function move(target = selected()) {
    if (!target) {
      indicator.style.opacity = '0';
      return;
    }
    indicator.style.width = `${target.offsetWidth}px`;
    indicator.style.height = `${target.offsetHeight}px`;
    indicator.style.transform = `translate3d(${target.offsetLeft}px, ${target.offsetTop}px, 0)`;
    indicator.style.opacity = '1';
  }

  function schedule(target?: HTMLElement) {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => move(target));
  }

  const pointerOver = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    const item = itemFrom(event.target, root);
    if (item) schedule(item);
  };
  const focusIn = (event: FocusEvent) => {
    const item = itemFrom(event.target, root);
    if (item) schedule(item);
  };
  const restore = () => schedule();
  const focusOut = (event: FocusEvent) => {
    if (!root.contains(event.relatedTarget as Node | null)) restore();
  };
  const mutation = new MutationObserver(() => schedule());
  const resize = new ResizeObserver(() => schedule());
  mutation.observe(root, { subtree: true, attributes: true, attributeFilter: ['aria-current', 'aria-pressed'] });
  resize.observe(root);
  root.addEventListener('pointerover', pointerOver);
  root.addEventListener('pointerleave', restore);
  root.addEventListener('focusin', focusIn);
  root.addEventListener('focusout', focusOut);
  schedule();

  return { destroy() {
    cancelAnimationFrame(frame);
    mutation.disconnect();
    resize.disconnect();
    root.removeEventListener('pointerover', pointerOver);
    root.removeEventListener('pointerleave', restore);
    root.removeEventListener('focusin', focusIn);
    root.removeEventListener('focusout', focusOut);
    indicator.remove();
  } };
}
