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
  const onError = () => browserDiagnostic('browser.error', { failure: 'unexpected' });
  const onRejection = () => browserDiagnostic('browser.rejection', { failure: 'unexpected' });
  window.addEventListener('error', onError, true);
  window.addEventListener('unhandledrejection', onRejection);
  const refresh = () => {
    void fetch('/api/v1/diagnostics', { headers: diagnosticHeaders() })
      .then(receiveDiagnosticLevel)
      .catch(() => {});
  };
  refresh();
  const timer = setInterval(refresh, 30_000);
  return () => {
    clearInterval(timer);
    window.removeEventListener('error', onError, true);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
