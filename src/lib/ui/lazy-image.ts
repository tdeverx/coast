// One observer serves all card images; each horizontal rail owns its request queue.
const pending = new Map<HTMLImageElement, () => void>();
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
  let visible = false;
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
    if (destroyed || !currentSource) { finish(); return; }
    visible = true;
    // Visibility is managed here; native lazy loading must not defer the active queue slot.
    image.loading = 'eager';
    assign(currentSource);
  };
  const enqueue = () => {
    if (!queue || !job) { start(); return; }
    if (queue.active === job) { assign(currentSource); return; }
    if (!queue.waiting.includes(job)) queue.waiting.push(job);
    pump(queue);
  };
  const load = () => {
    unobserve(image);
    const rail = image.closest('.rail:not(.grid-layout)');
    if (!rail) { start(); return; }
    queue = queues.get(rail);
    if (!queue) { queue = { waiting: [], scheduled: false }; queues.set(rail, queue); }
    job = { image, start };
    enqueue();
  };
  image.addEventListener('load', completed);
  image.addEventListener('error', completed);
  if (typeof IntersectionObserver === 'undefined') load();
  else {
    observer ??= new IntersectionObserver(entries => {
      for (const entry of entries)
        if (entry.isIntersecting) pending.get(entry.target as HTMLImageElement)?.();
    }, { rootMargin: '300px 0px' });
    pending.set(image, load);
    observer.observe(image);
  }
  return {
    update(next: string) {
      if (next === currentSource) return;
      currentSource = next;
      if (visible && next) {
        image.style.visibility = 'hidden';
        // Fallbacks and artwork changes share the same rail slot as first loads.
        enqueue();
      }
    },
    destroy() {
      destroyed = true;
      unobserve(image);
      image.removeEventListener('load', completed);
      image.removeEventListener('error', completed);
      if (queue && job) {
        queue.waiting = queue.waiting.filter(candidate => candidate !== job);
        finish();
      }
    },
  };
}
