export const notificationToastDuration = 7000;

/** Manual popovers sit above fixed UI and can live inside the active native dialog. */
export function raiseToastStack(node: HTMLElement) {
  let frame = 0;
  function raise() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!node.isConnected || !node.hasAttribute('popover')) return;
      const focus = document.activeElement;
      const restore = focus instanceof HTMLElement && node.contains(focus);
      if (node.matches(':popover-open')) node.hidePopover();
      node.showPopover();
      if (restore) focus.focus({preventScroll:true});
    });
  }
  function onToggle(event: Event) {
    if ((event as ToggleEvent).newState !== 'open') return;
    const target = event.target;
    if (target instanceof HTMLElement && !target.classList.contains('toasts') &&
      (target.matches(':popover-open') || target.matches('dialog:modal'))) raise();
  }
  document.addEventListener('toggle', onToggle, true);
  document.addEventListener('fullscreenchange', raise);
  raise();
  return {destroy() {
    cancelAnimationFrame(frame);
    document.removeEventListener('toggle', onToggle, true);
    document.removeEventListener('fullscreenchange', raise);
  }};
}

export type ToastArtwork = Pick<import('#lib/ui/types.js').MediaView, 'id' | 'title' | 'poster' | 'backdrop'> &
  Pick<import('#lib/ui/types.js').WorkSummary, 'kind'>;
export type ToastNotification = {
  id: string;
  title: string;
  body: string | null;
  kind?: string;
  locked?: boolean;
  level: 'silent' | 'normal' | 'persistent';
  readAt: Date | string | null;
  toastHiddenAt: Date | string | null;
  createdAt: Date | string;
  actor?: { username: string; avatar: string | null };
  media?: ToastArtwork & { year?: number | null; captionSubtitle?: string | null; durationLabel?: string | null };
};
type Timer = ReturnType<typeof setTimeout> | number;
type Ports = {
  preview: boolean;
  hide: (ids: string[], signal: AbortSignal) => Promise<unknown>;
  dismiss: (id: string, signal: AbortSignal) => Promise<unknown>;
  refresh: () => Promise<void>;
  refreshFailure: () => void;
  changed: () => void;
  failure: (text: string, retry: () => Promise<boolean>) => void;
  recovered: () => void;
  frontOnly?: boolean;
  delay?: (run: () => void, ms: number) => Timer;
  cancel?: (timer: Timer) => void;
};

/** One viewer's bounded toast window and durable write lifetime. Inbox read state is independent. */
export function createNotificationToasts(ports: Ports) {
  let current: ToastNotification[] = [], mounted = false, disposed = false, failed = false, foreground = true;
  let presented: string | undefined;
  let frontOnly = !!ports.frontOnly;
  const hidden = new Set<string>(), observed = new Set<string>();
  const levels = new Map<string, boolean>();
  const timers = new Map<string, Timer>();
  const paused = new Set<string>();
  const pending = new Map<string, 'normal' | 'persistent'>();
  let flight: [string, 'normal' | 'persistent'][] = [];
  const normalFlightIds = new Set<string>();
  let request: AbortController | undefined, requestTimer: Timer | undefined;
  let refreshing = false, refreshAgain = false;
  const delay = ports.delay ?? setTimeout, cancel = ports.cancel ?? clearTimeout;
  const persistent = (notice: ToastNotification) => notice.locked || notice.level === 'persistent';
  const visible = () => {
    if (!mounted) return [];
    const eligible = current.filter(n => !n.readAt && !n.toastHiddenAt && !hidden.has(n.id) &&
      (persistent(n) || pending.get(n.id) !== 'normal' && !normalFlightIds.has(n.id)));
    const window = eligible.slice(0, 3);
    // Keep one slot moving when persistent notices occupy the stack.
    const temporary = eligible.find(n => !persistent(n));
    if (temporary && window.length === 3 && window.every(persistent)) window[2] = temporary;
    return window;
  };
  function sync() {
    const ids = new Set(current.map(n => n.id));
    for (const id of hidden) if (!ids.has(id)) hidden.delete(id);
    for (const id of observed) if (!ids.has(id)) observed.delete(id);
    for (const id of paused) if (!ids.has(id)) paused.delete(id);
    const timed = foreground ? visible().filter(n => !persistent(n) && (!frontOnly || n.id === presented)) : [];
    for (const [id, timer] of timers) if (!timed.some(n => n.id === id)) {
      cancel(timer); timers.delete(id); observed.delete(id);
    }
    for (const n of timed) if (!paused.has(n.id) && !observed.has(n.id)) {
      observed.add(n.id);
      timers.set(n.id, delay(() => { timers.delete(n.id); if (!hide(n)) observed.delete(n.id); }, notificationToastDuration));
    }
    ports.changed();
  }
  function replace(notifications: ToastNotification[]) {
    for (const n of notifications) {
      const important = !!persistent(n);
      if (important && levels.get(n.id) === false) hidden.delete(n.id);
      levels.set(n.id, important);
    }
    const ids = new Set(notifications.map(n => n.id));
    for (const id of levels.keys()) if (!ids.has(id)) levels.delete(id);
    current = notifications;
  }
  async function refresh() {
    if (disposed) return;
    if (refreshing) { refreshAgain = true; return; }
    refreshing = true;
    try { await ports.refresh(); }
    catch { if (!disposed) ports.refreshFailure(); }
    finally {
      refreshing = false;
      const followup = refreshAgain;
      refreshAgain = false;
      if (!disposed && followup) void refresh();
    }
  }
  async function flush(): Promise<boolean> {
    if (disposed || flight.length || failed || !pending.size) return false;
    const first = pending.entries().next().value!;
    flight = first[1] === 'persistent' ? [first] : [...pending].filter(([, kind]) => kind === 'normal');
    normalFlightIds.clear();
    for (const [id,kind] of flight) { pending.delete(id); if (kind === 'normal') normalFlightIds.add(id); }
    const batch = flight, controller = new AbortController();
    request = controller;
    const timer = delay(() => controller.abort(new DOMException('Notification dismissal timed out.', 'TimeoutError')), 15000);
    requestTimer = timer;
    try {
      if (batch[0][1] === 'persistent') await ports.dismiss(batch[0][0], controller.signal);
      else await ports.hide(batch.map(([id]) => id), controller.signal);
      if (disposed) return false;
      cancel(timer); if (requestTimer === timer) requestTimer = undefined;
      const ids = new Set(current.map(n => n.id));
      for (const [id, kind] of batch) if (ids.has(id) && (kind === 'persistent' || !levels.get(id))) hidden.add(id);
      // Acknowledged writes release their lane even while the optional refresh is held.
      flight = []; normalFlightIds.clear();
      ports.recovered();
      // Acknowledged normal notices stay hidden while a refresh carrying the timestamp is pending.
      sync();
      void refresh();
      void flush();
      return true;
    } catch {
      if (disposed) return false;
      flight = []; normalFlightIds.clear();
      for (const [id, kind] of batch) {
        pending.set(id, kind);
        if (kind === 'persistent') hidden.delete(id);
      }
      failed = true;
      ports.failure('Notification dismissal could not be saved.', retry);
      sync();
      return false;
    } finally {
      cancel(timer); if (requestTimer === timer) requestTimer = undefined;
      if (request === controller) request = undefined;
    }
  }
  async function retry() {
    if (disposed || flight.length) return false;
    failed = false;
    const ids = new Set(current.map(n => n.id));
    for (const [id, kind] of pending) if (kind === 'persistent' && ids.has(id)) hidden.add(id);
    sync();
    return flush();
  }
  function hide(n: ToastNotification) {
    if (disposed) return false;
    if (n.toastHiddenAt || hidden.has(n.id)) return true;
    if (!ports.preview && !pending.has(n.id) && !flight.some(([id]) => id === n.id)) {
      // Backpressure keeps offline / failed writes bounded without silently forgetting suppression intent.
      if (pending.size + flight.length >= 200) {
        ports.failure('Notification dismissal could not be saved. Retry pending dismissals first.', retry);
        return false;
      }
      pending.set(n.id, persistent(n) ? 'persistent' : 'normal');
    }
    hidden.add(n.id);
    const timer = timers.get(n.id);
    if (timer !== undefined) cancel(timer);
    timers.delete(n.id);
    sync();
    if (!ports.preview) void flush();
    return true;
  }
  return {
    get visible() { return visible(); },
    present(id: string | undefined, onlyFront = frontOnly) {
      if (disposed || (presented === id && frontOnly === onlyFront)) return;
      presented = id;
      frontOnly = onlyFront;
      sync();
    },
    mount(notifications: ToastNotification[]) {
      if (disposed) return;
      replace(notifications);
      mounted = true;
      sync();
      if (!ports.preview) void flush();
    },
    update(notifications: ToastNotification[]) { if (!disposed) { replace(notifications); sync(); } },
    setForeground(visible: boolean) {
      if (disposed || foreground === visible) return;
      foreground = visible;
      sync();
    },
    pause(id: string, pause: boolean) {
      if (disposed) return;
      if (pause) {
        paused.add(id);
        const timer = timers.get(id);
        if (timer !== undefined) cancel(timer);
        timers.delete(id);
        observed.delete(id);
      } else if (paused.delete(id)) sync();
    },
    dismiss: hide,
    retry,
    dispose() {
      disposed = true; mounted = false; current = []; refreshAgain = false;
      request?.abort(); if (requestTimer !== undefined) cancel(requestTimer); requestTimer = undefined;
      for (const timer of timers.values()) cancel(timer);
      timers.clear(); hidden.clear(); observed.clear(); paused.clear(); levels.clear(); pending.clear(); flight = []; normalFlightIds.clear();
      ports.recovered();
    },
  };
}
