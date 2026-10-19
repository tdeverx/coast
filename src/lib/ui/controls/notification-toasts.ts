export type ToastNotification = {
  id: string;
  title: string;
  body: string | null;
  level: 'silent' | 'normal' | 'persistent';
  readAt: Date | string | null;
  toastHiddenAt: Date | string | null;
  createdAt: Date | string;
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
  now?: () => number;
  delay?: (run: () => void, ms: number) => Timer;
  cancel?: (timer: Timer) => void;
};

/** One viewer's bounded toast window and durable write lifetime. Inbox read state is independent. */
export function createNotificationToasts(ports: Ports) {
  let current: ToastNotification[] = [], mounted = false, disposed = false, failed = false;
  const hidden = new Set<string>(), observed = new Set<string>();
  const timers = new Map<string, Timer>();
  const pending = new Map<string, 'normal' | 'persistent'>();
  let flight: [string, 'normal' | 'persistent'][] = [];
  const normalFlightIds = new Set<string>();
  let request: AbortController | undefined, requestTimer: Timer | undefined;
  let refreshing = false, refreshAgain = false;
  const now = ports.now ?? Date.now, delay = ports.delay ?? setTimeout, cancel = ports.cancel ?? clearTimeout;
  const visible = () => mounted ? current.filter(n => !n.readAt && !n.toastHiddenAt && !hidden.has(n.id) && pending.get(n.id) !== 'normal' && !normalFlightIds.has(n.id) && n.level !== 'silent').slice(0, 3) : [];
  function sync() {
    const ids = new Set(current.map(n => n.id));
    for (const id of hidden) if (!ids.has(id)) hidden.delete(id);
    for (const id of observed) if (!ids.has(id)) observed.delete(id);
    const eligible = new Set(current.filter(n => !n.readAt && !n.toastHiddenAt && !hidden.has(n.id)).map(n => n.id));
    for (const [id, timer] of timers) if (!eligible.has(id)) { cancel(timer); timers.delete(id); }
    for (const n of visible()) if (n.level === 'normal' && !observed.has(n.id)) {
      observed.add(n.id);
      timers.set(n.id, delay(() => { timers.delete(n.id); if (!hide(n)) observed.delete(n.id); }, 7000));
    }
    ports.changed();
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
      for (const [id] of batch) if (ids.has(id)) hidden.add(id);
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
  function hide(n: ToastNotification, submit = true) {
    if (disposed) return false;
    if (n.toastHiddenAt || hidden.has(n.id)) return true;
    if (!ports.preview && !pending.has(n.id) && !flight.some(([id]) => id === n.id)) {
      // Backpressure keeps offline / failed writes bounded without silently forgetting suppression intent.
      if (pending.size + flight.length >= 200) {
        ports.failure('Notification dismissal could not be saved. Retry pending dismissals first.', retry);
        return false;
      }
      pending.set(n.id, n.level === 'persistent' ? 'persistent' : 'normal');
    }
    hidden.add(n.id);
    const timer = timers.get(n.id);
    if (timer !== undefined) cancel(timer);
    timers.delete(n.id);
    if (submit) { sync(); if (!ports.preview) void flush(); }
    return true;
  }
  return {
    get visible() { return visible(); },
    mount(notifications: ToastNotification[]) {
      if (disposed) return;
      current = notifications;
      for (const n of current) if (n.level === 'normal' && !n.readAt && !n.toastHiddenAt && now() - new Date(n.createdAt).getTime() > 30000) hide(n, false);
      mounted = true;
      sync();
      if (!ports.preview) void flush();
    },
    update(notifications: ToastNotification[]) { if (!disposed) { current = notifications; sync(); } },
    dismiss: hide,
    retry,
    dispose() {
      disposed = true; mounted = false; current = []; refreshAgain = false;
      request?.abort(); if (requestTimer !== undefined) cancel(requestTimer); requestTimer = undefined;
      for (const timer of timers.values()) cancel(timer);
      timers.clear(); hidden.clear(); observed.clear(); pending.clear(); flight = []; normalFlightIds.clear();
      ports.recovered();
    },
  };
}
