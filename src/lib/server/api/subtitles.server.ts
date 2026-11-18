import { downloadSubtitle, searchSubtitles, subtitleOptions } from '#lib/playback/subtitles.server.js';
import { withReadCancellation } from '#lib/server/db/read-cancellation.js';
import { classifyFailure, diagnosticErrorCode, logDiagnostic } from '#lib/server/diagnostics/index.js';
import { AppError } from '#lib/server/security/errors.js';
import { ProviderHttpError } from '#lib/server/security/provider-fetch.js';
import { uuid, type ApiContext } from './context.server';

export async function handleSubtitles({ user, path, method, body, url, request }: ApiContext, session: boolean) {
  const target = { id: uuid(path[1]), session };
  const headers = { 'Cache-Control': 'private, no-store' };
  if (method !== 'GET' && method !== 'POST') throw new AppError(405, 'This subtitle action is unavailable.');
  const stage = method === 'GET' ? 'subtitle-options'
    : body && typeof body === 'object' && 'language' in body ? 'subtitle-search' : 'subtitle-download';
  const fields = { operation: session ? 'playback' : 'media', requestAction: 'subtitles', provider: 'jellyfin', stage,
    sessionId: session ? target.id : undefined };
  const started = performance.now();
  try {
    const result = stage === 'subtitle-options'
      ? await withReadCancellation(request.signal, () => subtitleOptions(user, target, url.searchParams, request.signal))
      : stage === 'subtitle-search'
        ? await withReadCancellation(request.signal, () => searchSubtitles(user, target, body, request.signal))
        : await downloadSubtitle(user, target, body);
    const durationMs = performance.now() - started;
    void logDiagnostic(stage === 'subtitle-options' && durationMs < 1000 ? 'debug' : 'info', 'playback.operation', {
      ...fields, durationMs, count: Array.isArray(result) ? result.length : undefined,
    });
    return Response.json(result, { headers });
  } catch (cause) {
    const status = cause instanceof AppError || cause instanceof ProviderHttpError ? cause.status : undefined;
    const failure = classifyFailure(cause);
    const level = failure === 'aborted' ? 'debug' : status && status < 500 ? 'warn' : 'error';
    void logDiagnostic(level, 'playback.failed', {
      ...fields, stage: cause instanceof AppError && cause.code === 'subtitle_unconfirmed' ? 'subtitle-confirmation' : stage,
      status, failure, errorCode: diagnosticErrorCode(cause), durationMs: performance.now() - started,
    });
    throw cause;
  }
}
