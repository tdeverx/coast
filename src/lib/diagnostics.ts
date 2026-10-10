/** Shared, closed vocabulary: browser input and arbitrary exceptions never become log text. */
export const diagnosticLevels = ['off', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type DiagnosticLevel = (typeof diagnosticLevels)[number];
export const diagnosticEvents = [
  'request.complete',
  'request.start',
  'request.failed',
  'query.timing',
  'provider.complete',
  'provider.start',
  'provider.failed',
  'job.start',
  'job.yield',
  'job.provider-wait',
  'job.complete',
  'job.failed',
  'browser.error',
  'browser.rejection',
  'playback.start',
  'playback.ready',
  'playback.playing',
  'playback.waiting',
  'playback.pause',
  'playback.seek',
  'playback.timing',
  'playback.failed',
  'application.failed',
] as const;
export type DiagnosticEvent = (typeof diagnosticEvents)[number];
export const eventMessages: Record<DiagnosticEvent, string> = {
  'request.complete': 'Request completed.',
  'request.start': 'Request started.',
  'request.failed': 'Request failed.',
  'query.timing': 'Local query phase measured.',
  'provider.complete': 'Provider response received.',
  'provider.start': 'Provider call started.',
  'provider.failed': 'Provider call failed.',
  'job.start': 'Background job started.',
  'job.yield': 'Job released its worker at a committed checkpoint.',
  'job.provider-wait': 'Job waited for provider request capacity.',
  'job.complete': 'Background job completed.',
  'job.failed': 'Background job failed.',
  'browser.error': 'Browser error detected.',
  'browser.rejection': 'Unhandled browser rejection detected.',
  'playback.start': 'Playback preparation started.',
  'playback.ready': 'Playback prepared.',
  'playback.playing': 'Playback playing.',
  'playback.waiting': 'Playback waiting for data.',
  'playback.pause': 'Playback paused.',
  'playback.seek': 'Playback seeking.',
  'playback.timing': 'Playback timing sample.',
  'playback.failed': 'Playback failed.',
  'application.failed': 'Application action failed.',
};
export function enabled(level: DiagnosticLevel, threshold: DiagnosticLevel) {
  return (
    level !== 'off' &&
    threshold !== 'off' &&
    diagnosticLevels.indexOf(level) <= diagnosticLevels.indexOf(threshold)
  );
}
export function correlationId(value?: unknown): string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : randomId();
}
export function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** Only numeric measurements and closed classifications are admitted. No free text, URLs or identity. */
export function safeFields(input: Record<string, unknown> = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: Record<string, number | string | boolean> = {};
  for (const key of [
    'status',
    'durationMs',
    'positionSeconds',
    'readyState',
    'networkState',
    'attempts',
    'code',
    'bufferedSeconds',
    'count',
    'expired',
  ]) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12)
      result[key] = Math.round(value * 100) / 100;
  }
  if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(String(input.method)))
    result.method = String(input.method);
  if (
    ['network', 'timeout', 'http', 'validation', 'unexpected', 'aborted', 'media'].includes(
      String(input.failure)
    )
  )
    result.failure = String(input.failure);
  if (
    [
      'application',
      'playback',
      'providers',
      'settings',
      'admin',
      'media',
      'collection',
      'library',
      'progress',
      'lists',
      'notifications',
      'requests',
      'auth',
      'other',
    ].includes(String(input.operation))
  )
    result.operation = String(input.operation);
  if (
    [
      'retention',
      'connection',
      'identity',
      'checkpoint-read',
      'library-page',
      'item-import',
      'checkpoint-write',
      'reconcile',
      'complete',
      'assessment',
      'card-hydration',
      'streams-module',
      'streams-account',
      'streams-connection',
      'streams-permissions',
      'streams-sessions',
      'streams-recording',
    ].includes(String(input.stage))
  )
    result.stage = String(input.stage);
  if (
    [
      'provider.authentication',
      'provider.permission',
      'provider.item-unavailable',
      'provider.rate-limit',
      'provider.unavailable',
      'provider.invalid-data',
      'provider.interrupted',
      'provider.timeout',
      'action.rejected',
      'jellyfin.incomplete-library-page',
      'jellyfin.cyclic-media-hierarchy',
      'jellyfin.item-missing-show-identity',
      'catalogue.identity-conflict',
      'catalogue.season-missing-show',
      'catalogue.episode-missing-show',
    ].includes(String(input.errorCode))
  )
    result.errorCode = String(input.errorCode);
  if (['jellyfin', 'trakt', 'tmdb', 'seerr', 'igdb', 'steam', 'openlibrary', 'comic-vine'].includes(String(input.provider)))
    result.provider = String(input.provider);
  if (typeof input.stream === 'boolean') result.stream = input.stream;
  // Session and job IDs are random system IDs, not user/provider/media IDs.
  for (const key of ['sessionId', 'actionId', 'accountGeneration']) {
    const value = input[key];
    if (typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)) result[key] = value;
  }
  return result;
}
