import { ProviderHttpError } from '../src/lib/server/security/provider-fetch';
import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { jobFailureMessage, safeDiagnosticErrorCode, validationDiagnostic } from '../src/lib/server/queue';

describe('queue validation diagnostics', () => {
  test('records failing field paths and types without recording provider values', () => {
    let error: unknown;
    try {
      v.parse(
        v.object({ Items: v.array(v.object({ Name: v.number() })) }),
        { Items: [{ Name: 'private title fixture' }] }
      );
    } catch (caught) {
      error = caught;
    }

    const detail = validationDiagnostic(error);
    expect(detail).toEqual([
      { path: 'Items.0.Name', expected: 'number', receivedType: 'string' },
    ]);
    expect(JSON.stringify(detail)).not.toContain('private title fixture');
  });

  test('omits validation details for non-validation errors', () => {
    expect(validationDiagnostic(new Error('request failed'))).toBeUndefined();
  });

  test('maps only known scan errors to safe diagnostic codes', () => {
    expect(safeDiagnosticErrorCode(new Error('Jellyfin returned an incomplete library page.'))).toBe(
      'jellyfin.incomplete-library-page'
    );
    expect(safeDiagnosticErrorCode(new Error('private error details'))).toBeUndefined();
  });
});

test('job rejection messages distinguish authentication, access and absent metadata', () => {
  expect(jobFailureMessage(new ProviderHttpError(401), true)).toContain('Reconnect');
  expect(jobFailureMessage(new ProviderHttpError(403), true)).toContain('permissions');
  expect(jobFailureMessage(new ProviderHttpError(404), true)).toContain('unavailable');
  expect(jobFailureMessage(new ProviderHttpError(429), false)).toContain('cooldown');
});
