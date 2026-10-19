type Target = { near: boolean; change: (visible: boolean) => void };
const targets = new Map<HTMLElement, Target>();
let observer: IntersectionObserver | undefined;
let listening = false;
const publish = (target: Target) => target.change(target.near && document.visibilityState !== 'hidden');
function visibilityChanged() { for (const target of targets.values()) publish(target); }

/** One near-viewport observer owns optional card demand across every Shelf. */
export function observeVisibility(node: HTMLElement, change: (visible: boolean) => void) {
  const target: Target = { near: targets.get(node)?.near ?? false, change };
  targets.set(node, target);
  if (!listening) { document.addEventListener('visibilitychange', visibilityChanged); listening = true; }
  if (typeof IntersectionObserver === 'undefined') target.near = true;
  else {
    observer ??= new IntersectionObserver(entries => {
      for (const entry of entries) {
        const current = targets.get(entry.target as HTMLElement);
        if (current) { current.near = entry.isIntersecting; publish(current); }
      }
    }, { rootMargin: '300px 0px' });
    observer.observe(node);
  }
  publish(target);
  return () => {
    // An older owner cannot unregister a replacement using the same element.
    if (targets.get(node) !== target) return;
    targets.delete(node); observer?.unobserve(node);
    if (!targets.size) {
      observer?.disconnect(); observer = undefined;
      document.removeEventListener('visibilitychange', visibilityChanged); listening = false;
    }
  };
}
