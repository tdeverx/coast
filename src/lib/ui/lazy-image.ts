// One observer serves all pending artwork; each horizontal rail owns its request queue.
const pending = new Map<HTMLImageElement, (intersecting: boolean) => void>();
let observer: IntersectionObserver | undefined;
type Job = { image: HTMLImageElement; start: () => void };
type Queue = { active?: Job; waiting: Job[]; scheduled: boolean };
const queues = new WeakMap<Element, Queue>();
function pump(queue: Queue) {
  if (queue.active || queue.scheduled) return;
  queue.scheduled = true;
  queueMicrotask(() => {
    queue.scheduled = false;
    if (queue.active) return;
    // Observer delivery order is not guaranteed; the DOM defines left-to-right card order.
    queue.waiting.sort((a, b) => a.image.compareDocumentPosition(b.image) & 4 ? -1 : 1);
    const job = queue.waiting.shift();
    if (job) { queue.active = job; job.start(); }
  });
}
function unobserve(image: HTMLImageElement) {
  observer?.unobserve(image);
  pending.delete(image);
  if (!pending.size) { observer?.disconnect(); observer = undefined; }
}
/** Lazy artwork loads sequentially within a horizontal shelf, independently of other shelves. */
export function lazyImage(image: HTMLImageElement, source: string) {
  let currentSource = source;
  let activated = false;
  let destroyed = false;
  let queue: Queue | undefined;
  let job: Job | undefined;
  const finish = () => {
    if (queue && job && queue.active === job) { queue.active = undefined; pump(queue); }
  };
  const completed = (event: Event) => {
    image.style.visibility = event.type === 'load' ? '' : 'hidden';
    finish();
  };
  const assign = (value: string) => {
    image.style.visibility = 'hidden';
    image.src = value;
  };
  image.style.visibility = 'hidden';
  const start = () => {
    unobserve(image);
    if (destroyed || !currentSource) { finish(); return; }
    activated = true;
    // Native lazy loading must not defer the active queue slot.
    image.loading = 'eager';
    assign(currentSource);
  };
  const removeWaiting = () => {
    if (queue && job) queue.waiting = queue.waiting.filter(candidate => candidate !== job);
  };
  const intersect = (visible: boolean) => {
    if (!visible || !currentSource) { removeWaiting(); return; }
    const rail = image.closest('.rail:not(.grid-layout)');
    if (!rail) { start(); return; }
    queue ??= queues.get(rail);
    if (!queue) { queue = { waiting: [], scheduled: false }; queues.set(rail, queue); }
    job ??= { image, start };
    if (!queue.waiting.includes(job)) queue.waiting.push(job);
    pump(queue);
  };
  const observe = () => {
    if (typeof IntersectionObserver === 'undefined') { intersect(true); return; }
    observer ??= new IntersectionObserver(entries => {
      for (const entry of entries)
        pending.get(entry.target as HTMLImageElement)?.(entry.isIntersecting);
    }, { rootMargin: '300px 0px' });
    pending.set(image, intersect);
    observer.observe(image);
  };
  image.addEventListener('load', completed);
  image.addEventListener('error', completed);
  observe();
  return {
    update(next: string) {
      if (next === currentSource) return;
      currentSource = next;
      if (!next) { removeWaiting(); unobserve(image); return; }
      if (activated) {
        image.style.visibility = 'hidden';
        // An in-flight fallback retains its slot; later changes re-check current demand.
        if (queue && job && queue.active === job) assign(next);
        else observe();
      } else if (!pending.has(image)) observe();
    },
    destroy() {
      destroyed = true;
      unobserve(image);
      image.removeEventListener('load', completed);
      image.removeEventListener('error', completed);
      removeWaiting();
      finish();
    },
  };
}
