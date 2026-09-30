import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin, requireUser } from '$lib/server/auth';
import { diagnosticStore, logDiagnostic } from '$lib/server/diagnostics';
import { safeFields, type DiagnosticEvent } from '$lib/diagnostics';
import { AppError } from '$lib/server/security/errors';
const events: Record<string, 'error' | 'debug' | 'trace'> = {
  'browser.error': 'error',
  'browser.rejection': 'error',
  'playback.failed': 'error',
  'playback.start': 'debug',
  'playback.ready': 'debug',
  'playback.playing': 'debug',
  'playback.waiting': 'debug',
  'playback.pause': 'debug',
  'playback.seek': 'debug',
  'playback.timing': 'trace',
};
export const GET: RequestHandler = async ({ locals, url }) => {
  try {
    requireUser(locals.user);
    if (!url.searchParams.has('download')) return json({ level: diagnosticStore.level });
    requireAdmin(locals.user);
    const rows = await diagnosticStore.recent();
    return new Response(rows.map((row) => JSON.stringify(row)).join('\n'), {
      headers: {
        'content-type': 'application/x-ndjson',
        'content-disposition': 'attachment; filename="coast-diagnostics.jsonl"',
        'cache-control': 'private, no-store',
      },
    });
  } catch (e) {
    if (e instanceof AppError) error(e.status, e.message);
    throw e;
  }
};
// A bounded per-account ingest budget limits both storage churn and forged browser reports.
const budgets = new Map<string, { time: number; count: number }>();
export const POST: RequestHandler = async ({ locals, request }) => {
  try {
    const user = requireUser(locals.user);
    const now = Date.now();
    for (const [key, value] of budgets) if (now - value.time >= 60_000) budgets.delete(key);
    const budget = budgets.get(user.id) ?? { time: now, count: 0 };
    if (budget.count >= 60 || (!budgets.has(user.id) && budgets.size >= 1024))
      return new Response(null, { status: 429 });
    budget.count++;
    budgets.set(user.id, budget);
    if (Number(request.headers.get('content-length')) > 4096) error(413);
    const reader = request.body?.getReader();
    if (!reader) error(400);
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 4096) {
        await reader.cancel();
        error(413);
      }
      chunks.push(chunk.value);
    }
    let input;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      error(400);
    }
    if (!input || !Object.hasOwn(events, input.event)) error(400);
    await logDiagnostic(
      events[input.event],
      input.event as DiagnosticEvent,
      safeFields(input.fields)
    );
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof AppError) error(e.status, e.message);
    throw e;
  }
};
