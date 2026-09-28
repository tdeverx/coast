// One observer serves all card images; detached images unregister their callbacks.
const pending = new Map<HTMLImageElement, () => void>();
let observer: IntersectionObserver | undefined;
function unobserve(image: HTMLImageElement) {
  observer?.unobserve(image);
  pending.delete(image);
  if (!pending.size) {
    observer?.disconnect();
    observer = undefined;
  }
}
/** Keep off-screen artwork out of the request queue until it approaches the viewport. */
export function lazyImage(image: HTMLImageElement, source: string) {
  let currentSource = source;
  let visible = false;
  const load = () => {
    visible = true;
    if (currentSource) image.src = currentSource;
    unobserve(image);
  };
  if (typeof IntersectionObserver === 'undefined') load();
  else {
    observer ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) pending.get(entry.target as HTMLImageElement)?.();
      },
      { rootMargin: '300px' }
    );
    pending.set(image, load);
    observer.observe(image);
  }
  return {
    update(next: string) {
      currentSource = next;
      if (visible && next) image.src = next;
    },
    destroy() {
      unobserve(image);
    },
  };
}
