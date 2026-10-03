import * as v from 'valibot';
import { AppError } from './errors';

/** Read a bounded JSON object for browser, public API and playback-capability requests. */
export async function readJsonBody(request: Request, maxBytes = 1_048_576, allowEmpty = true): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    throw new AppError(415, 'Send application/json.', 'invalid_content_type');
  const reader = request.body?.getReader();
  if (!reader) {
    if (allowEmpty) return {};
    throw new AppError(400, 'Supply a JSON object.', 'invalid_input');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AppError(413, 'This request is too large.', 'payload_too_large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
    return v.parse(v.record(v.string(), v.unknown()), value);
  } catch { throw new AppError(400, 'Supply a JSON object.', 'invalid_input'); }
}
