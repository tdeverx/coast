/** Activate once for shelves; observe repeatedly for an infinite-scroll sentinel. */
export function lazyContent(node: HTMLElement, options: { load: () => void; enabled?: () => boolean; repeat?: boolean }) {
  let activated = false;
  const activate = () => {
    if ((!options.repeat && activated) || options.enabled?.() === false) return;
    activated = true;
    if (!options.repeat) observer?.disconnect();
    options.load();
  };
  let observer: IntersectionObserver | undefined;
  if (typeof IntersectionObserver === 'undefined') activate();
  else {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) activate();
    }, { rootMargin: '300px' });
    observer.observe(node);
  }
  return { destroy() { observer?.disconnect(); } };
}
