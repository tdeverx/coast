import { expect, test } from 'bun:test';
import { moduleUrl } from './fixtures/ui-script';

const boundaryUrl = moduleUrl(`
  export class AppError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  export const events = [];
  export const context = { getStore: () => 'captured-correlation' };
  export const diagnosticRequest = { getStore: () => 'captured-request' };
  export const classifyFailure = () => 'unexpected';
  export const diagnosticErrorCode = error => error.code;
  export const logDiagnostic = (...event) => events.push(event);
  export const readingDeliverySource = async () => ({});
  export const readingLease = () => 'lease';
  export const readingCache = async () => ({
    acquire: async () => ({
      error: Object.assign(new Error('Private filename and disk details'), { code: 'ENOSPC' }),
      controller: new AbortController(),
    }),
    claim: () => () => {},
  });
`);
const source = await Bun.file(new URL('../src/lib/reading/delivery.server.ts', import.meta.url)).text();
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
  .replace(/from ['"][^'"]+['"]/g, `from ${JSON.stringify(boundaryUrl)}`);
const { readingManifest } = await import(moduleUrl(compiled));
const { events } = await import(boundaryUrl);

test('archive failures after successful headers retain the reader stage and request ID', async () => {
  const sessionId = crypto.randomUUID();
  const response = await readingManifest('fixture', sessionId, new Request('https://fixture.invalid/manifest'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ error: 'This reading archive could not be prepared.' });
  expect(events).toEqual([['warn', 'reading.failed', {
    operation: 'reading', stage: 'reader-manifest', sessionId, surface: undefined,
    failure: 'unexpected', status: 422, errorCode: 'ENOSPC', durationMs: expect.any(Number),
  }, 'captured-correlation', 'captured-request']]);
});
