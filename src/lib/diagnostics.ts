import { serviceTraversalKinds } from './providers/tasks';

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
  'browser.image-failed',
  'browser.rejection',
  'browser.request-failed',
  'playback.start',
  'playback.ready',
  'playback.playing',
  'playback.waiting',
  'playback.pause',
  'playback.seek',
  'playback.timing',
  'playback.operation',
  'playback.failed',
  'reading.ready',
  'reading.failed',
  'application.failed',
  'runtime.sample',
  'runtime.operation',
] as const;
export type DiagnosticEvent = (typeof diagnosticEvents)[number];
export const browserDiagnosticLevels = {
  'browser.error': 'error',
  'browser.image-failed': 'warn',
  'browser.rejection': 'error',
  'browser.request-failed': 'warn',
  'playback.failed': 'error',
  'playback.start': 'debug',
  'playback.ready': 'debug',
  'playback.playing': 'info',
  'playback.waiting': 'debug',
  'playback.pause': 'debug',
  'playback.seek': 'debug',
  'playback.timing': 'trace',
} as const satisfies Partial<Record<DiagnosticEvent, DiagnosticLevel>>;
export const networkDiagnosticCodes = [
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH',
  'ConnectionRefused', 'ConnectionReset', 'ConnectionClosed', 'FailedToOpenSocket', 'UnableToConnect',
] as const;
export const systemDiagnosticCodes = [
  ...networkDiagnosticCodes,
  'ERR_POSTGRES_CONNECTION_CLOSED', 'ERR_POSTGRES_CONNECTION_TIMEOUT',
  'ERR_POSTGRES_IDLE_TIMEOUT', 'ERR_POSTGRES_COMMIT_ROLLED_BACK',
  '22P02', '23502', '23503', '23505', '25P02', '40001', '42703', '42P01',
  '53300', '55000', '55P03', '57014', '57P01', '57P02', '57P03',
  'EACCES', 'EDQUOT', 'EIO', 'ENOENT', 'ENOSPC', 'EPERM', 'EROFS',
] as const;
const jobKinds = new Set([
  ...serviceTraversalKinds, 'feature.reconcile', 'benchmark.run', 'webhook.deliver', 'planning.reminder', 'social.checkin-complete',
  'jellyfin.member-policy', 'jellyfin.reconcile', 'jellyfin.user-state', 'jellyfin.scrobble',
  'trakt.checkin', 'trakt.progress', 'trakt.scrobble', 'trakt.list-delete', 'trakt.list-export', 'trakt.export',
  'seerr.manage', 'seerr.request', 'history.remove',
]);
const requestActions = [
  'prepare', 'restore', 'progress', 'player-error', 'stream', 'subtitles', 'trailer', 'share-stream',
  'details', 'details-enhance', 'metadata-refresh', 'insights', 'feedback', 'asset', 'avatar', 'health',
  'reader-open', 'reader-manifest', 'reader-page', 'reader-file', 'heartbeat', 'claim',
] as const;
export type DiagnosticRequestAction = typeof requestActions[number];
export const diagnosticOperations = new Set([
  'application', 'artwork', 'auth', 'admin', 'backup', 'catalogue', 'collection', 'conflicts', 'continue', 'discover',
  'for-you', 'games', 'library', 'lists', 'media', 'music', 'notifications', 'people', 'planning',
  'playback', 'profile', 'progress', 'providers', 'queue', 'ratings', 'reading', 'requests',
  'search', 'session', 'settings', 'sharing', 'social', 'synced', 'tracking', 'up-next', 'webhooks', 'other',
]);
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
  'browser.image-failed': 'An image could not be displayed.',
  'browser.rejection': 'Unhandled browser rejection detected.',
  'browser.request-failed': 'Browser request failed.',
  'playback.start': 'Playback preparation started.',
  'playback.ready': 'Playback prepared.',
  'playback.playing': 'Playback playing.',
  'playback.waiting': 'Playback waiting for data.',
  'playback.pause': 'Playback paused.',
  'playback.seek': 'Playback seeking.',
  'playback.timing': 'Playback timing sample.',
  'playback.operation': 'Playback operation completed.',
  'playback.failed': 'Playback failed.',
  'reading.ready': 'Reading archive ready.',
  'reading.failed': 'Reading operation failed.',
  'application.failed': 'Application action failed.',
  'runtime.sample': 'Runtime resource and concurrency sample.',
  'runtime.operation': 'Runtime operation timing or failure.',
};
export function enabled(level: DiagnosticLevel, threshold: DiagnosticLevel) {
  return (
    level !== 'off' &&
    threshold !== 'off' &&
    diagnosticLevels.indexOf(level) <= diagnosticLevels.indexOf(threshold)
  );
}
export function knownDiagnosticId(value?: unknown): string | undefined {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}
export function correlationId(value?: unknown): string {
  return knownDiagnosticId(value) ?? randomId();
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
    'durationMs', 'providerWaitMs', 'negotiationMs',
    'positionSeconds',
    'readyState',
    'networkState',
    'attempts',
    'code',
    'bufferedSeconds',
    'count',
    'expired',
    'pid', 'uptimeMs', 'rssBytes', 'heapUsedBytes', 'externalBytes', 'cpuUserMs', 'cpuSystemMs',
    'cgroupBytes', 'cgroupLimitBytes', 'cgroupOom', 'cgroupOomKills', 'cgroupAnonBytes', 'cgroupFileBytes',
    'connectionsOpened', 'connectionsClosed', 'connectionFailures', 'operationFailures',
    'reserveInFlight', 'reservationInFlight', 'queueInFlight', 'heartbeatInFlight', 'maintenanceInFlight',
    'reserveBusyMs', 'reservationBusyMs', 'queueBusyMs', 'heartbeatBusyMs', 'maintenanceBusyMs',
    'heartbeatOverlap', 'maintenanceOverlap', 'runtimeEventsDropped',
    'diagnosticPending', 'diagnosticDropped', 'diagnosticFailures',
    'dbAcquireMs', 'dbProbeMs', 'dbActiveAgeMs', 'dbActive', 'dbWaiting',
  ]) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12)
      result[key] = Math.round(value * 100) / 100;
  }
  if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(String(input.method)))
    result.method = String(input.method);
  if (requestActions.includes(input.requestAction as DiagnosticRequestAction)) result.requestAction = String(input.requestAction);
  if (typeof input.jobKind === 'string' && jobKinds.has(input.jobKind)) result.jobKind = input.jobKind;
  if (['runtime', 'script', 'style', 'image', 'media', 'resource', 'promise'].includes(String(input.browserSource)))
    result.browserSource = String(input.browserSource);
  if (['AbortError','TimeoutError','NetworkError','NotAllowedError','TypeError','SyntaxError','RangeError','ReferenceError','SecurityError'].includes(String(input.browserError)))
    result.browserError = String(input.browserError);
  if (input.mediaType === 'video' || input.mediaType === 'audio') result.mediaType = input.mediaType;
  if (['direct', 'hls'].includes(String(input.delivery))) result.delivery = String(input.delivery);
  if (['start', 'reconfigure', 'fallback', 'shared'].includes(String(input.playbackChange))) result.playbackChange = String(input.playbackChange);
  if (['no-library-source', 'no-provider-source', 'selected-version', 'duration', 'device-policy', 'mixed'].includes(String(input.sourceFailure)))
    result.sourceFailure = String(input.sourceFailure);
  if (
    ['network', 'timeout', 'http', 'validation', 'unexpected', 'aborted', 'media', 'local-busy', 'local-queue-timeout'].includes(
      String(input.failure)
    )
  )
    result.failure = String(input.failure);
  if (typeof input.operation === 'string' && diagnosticOperations.has(input.operation)) result.operation = input.operation;
  if (
    [
      'retention',
      'runtime', 'reserve', 'reservation', 'queue', 'heartbeat', 'maintenance',
      'connection', 'database-sample', 'after-change-refresh',
      'avatar-cleanup', 'share-cleanup', 'share-progress', 'reader-manifest',
      'backup-capture', 'backup-retention', 'backup-schedule', 'request-options', 'provider-queue',
      'identity',
      'checkpoint-read',
      'library-page',
      'provider-read', 'provider-write', 'metadata-refresh', 'metadata-read',
      'source-negotiation', 'response-body', 'player', 'crop', 'subtitle-options', 'subtitle-search', 'subtitle-download', 'subtitle-confirmation',
      'item-import',
      'checkpoint-write',
      'reconcile',
      'complete',
      'assessment',
      'card-hydration',
      'progress-seeds', 'continuations', 'progress-membership',
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
      ...systemDiagnosticCodes, 'unknown',
      'provider.identity',
      'provider.permission',
      'provider.item-unavailable',
      'provider.rate-limit',
      'provider.unavailable',
      'provider.invalid-data',
      'provider.interrupted',
      'local.database-deadlock',
      'provider.timeout',
      'local.provider-busy', 'local.provider-queue-timeout',
      'action.rejected', 'local.action-rejected', 'local.feature-disabled',
      'jellyfin.incomplete-library-page',
      'jellyfin.invalid-library-offset',
      'jellyfin.changed-library-page',
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
  if (input.surface === 'public-api' || input.surface === 'share') result.surface = input.surface;
  const relatedRequestId = knownDiagnosticId(input.relatedRequestId);
  if (relatedRequestId) result.relatedRequestId = relatedRequestId;
  if (typeof input.backfill === 'boolean') result.backfill = input.backfill;
  if (typeof input.retryable === 'boolean') result.retryable = input.retryable;
  if (typeof input.failed === 'boolean') result.failed = input.failed;
  if (['start', 'stop'].includes(String(input.phase))) result.phase = String(input.phase);
  if (typeof input.bunVersion === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(input.bunVersion)) result.bunVersion = input.bunVersion;
  // Session and job IDs are random system IDs, not user/provider/media IDs.
  for (const key of ['sessionId', 'actionId', 'accountGeneration']) {
    const value = input[key];
    if (typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)) result[key] = value;
  }
  return result;
}
