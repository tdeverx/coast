import {
  browserDiagnosticLevels,
  diagnosticLevels,
  correlationId,
  enabled,
  type DiagnosticEvent,
  type DiagnosticLevel,
  safeFields,
} from '#lib/diagnostics.js';
export let browserCorrelationId = '';
let level: DiagnosticLevel = 'info';
let sent = 0,
  routineSent = 0,
  windowStarted = 0;
export function diagnosticHeaders(): Record<string, string> {
  try {
    browserCorrelationId ||= correlationId();
    return { 'x-coast-correlation-id': browserCorrelationId };
  } catch {
    return {};
  }
}
export function receiveDiagnosticLevel(response: Response) {
  try {
    const value = response.headers.get('x-coast-diagnostic-level');
    if (diagnosticLevels.includes(value as DiagnosticLevel)) level = value as DiagnosticLevel;
  } catch {
    /* Leave the last known level. */
  }
}
export function browserDiagnostic(event: DiagnosticEvent, fields: Record<string, unknown> = {}) {
  try {
    if (!Object.hasOwn(browserDiagnosticLevels, event)) return;
    const severity = browserDiagnosticLevels[event as keyof typeof browserDiagnosticLevels];
    if (!enabled(severity, level)) return;
    if (Date.now() - windowStarted > 60_000) {
      sent = routineSent = 0;
      windowStarted = Date.now();
    }
    // Keep capacity for failures even during sustained playback at Trace.
    if (sent >= 50 || severity !== 'error' && routineSent >= 40) return;
    sent++;
    if (severity !== 'error') routineSent++;
    void fetch('/api/v1/diagnostics', {
      method: 'POST',
      headers: { ...diagnosticHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ event, fields: safeFields(fields) }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* Reporting never interrupts playback. */
  }
}
export function installBrowserDiagnostics() {
  let stopped = false, pending = false;
  let imageWindowStarted = -Infinity;
  const controller = new AbortController();
  const onError = (event: Event) => {
    const tag = event.target instanceof Element ? event.target.tagName : '';
    if (tag === 'IMG') {
      // Cards can repeat the same artwork many times. Reserve the error budget
      // for application failures and emit at most one image warning per minute.
      const now = performance.now();
      if (now - imageWindowStarted < 60_000) return;
      imageWindowStarted = now;
      browserDiagnostic('browser.image-failed', { browserSource: 'image' });
      return;
    }
    const browserSource = tag === 'SCRIPT' ? 'script' : tag === 'LINK' ? 'style'
      : tag === 'VIDEO' || tag === 'AUDIO' ? 'media' : tag ? 'resource' : 'runtime';
    const cause = event instanceof ErrorEvent ? event.error : undefined;
    browserDiagnostic('browser.error', { failure: 'unexpected', browserSource, browserError: cause instanceof Error ? cause.name : undefined });
  };
  const onRejection = (event: PromiseRejectionEvent) => browserDiagnostic('browser.rejection', {
    failure: 'unexpected', browserSource: 'promise', browserError: event.reason instanceof Error ? event.reason.name : undefined,
  });
  window.addEventListener('error', onError, true);
  window.addEventListener('unhandledrejection', onRejection);
  const refresh = () => {
    if (stopped || document.hidden || pending) return;
    pending = true;
    void fetch('/api/v1/diagnostics', { headers: diagnosticHeaders(), signal: controller.signal })
      .then(response => { if (!stopped) receiveDiagnosticLevel(response); })
      .catch(() => {})
      .finally(() => { pending = false; });
  };
  const visible = () => { if (!document.hidden) refresh(); };
  document.addEventListener('visibilitychange', visible);
  refresh();
  const timer = setInterval(refresh, 30_000);
  return () => {
    stopped = true;
    controller.abort();
    clearInterval(timer);
    document.removeEventListener('visibilitychange', visible);
    window.removeEventListener('error', onError, true);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
