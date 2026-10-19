import {
  diagnosticLevels,
  correlationId,
  enabled,
  type DiagnosticEvent,
  type DiagnosticLevel,
  safeFields,
} from '$lib/diagnostics';
export let browserCorrelationId = '';
let level: DiagnosticLevel = 'info';
let sent = 0,
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
    const severity =
      event.endsWith('failed') || event.startsWith('browser.')
        ? 'error'
        : event === 'playback.timing'
          ? 'trace'
          : 'debug';
    if (!enabled(severity, level)) return;
    if (Date.now() - windowStarted > 60_000) {
      sent = 0;
      windowStarted = Date.now();
    }
    if (sent++ >= 50) return;
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
  const controller = new AbortController();
  const onError = () => browserDiagnostic('browser.error', { failure: 'unexpected' });
  const onRejection = () => browserDiagnostic('browser.rejection', { failure: 'unexpected' });
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
