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

test('stable job remedies do not depend on arbitrary provider error messages', async () => {
  const { jobFailureDetail } = await import('../src/lib/server/queue');
  const { jobRemedy } = await import('../src/lib/ui/queue');
  for (const [status, code, remedy, retryable] of [[401,'provider.authentication','connection',false],[403,'provider.permission','permissions',false],[404,'provider.item-unavailable','metadata',false],[429,'provider.rate-limit','retry',true],[503,'provider.unavailable','retry',true]] as const) {
    const failure = jobFailureDetail(new ProviderHttpError(status), !retryable);
    expect(failure).toEqual({code, remedy, retryable});
    expect(jobRemedy({id:'fixture',kind:'fixture',state:'failed',attempts:1,lastError:'translated message',failure})).toBe(remedy);
  }
  expect(jobFailureDetail(new Error('private provider message'), false).code).not.toContain('Conflicting');
});

test('identity conflicts require mapping review rather than automatic retries', async()=>{
 const {jobFailureDetail}=await import('../src/lib/server/queue');
 expect(jobFailureDetail(new Error('Conflicting provider identities require administrator review.'),true)).toEqual({code:'catalogue.identity-conflict',remedy:'metadata',retryable:false});
});

test('retry backoff is not labelled a service cooldown',async()=>{
  const {jobWaiting,jobServiceWaiting}=await import('../src/lib/ui/queue');
  const retry={id:'retry',kind:'steam.sync',state:'pending',attempts:1,lastError:null,nextAttemptAt:new Date(Date.now()+60000)};
  expect(jobWaiting(retry)).toBe(true);expect(jobServiceWaiting(retry)).toBe(false);
  expect(jobServiceWaiting({...retry,serviceRetryAt:new Date(Date.now()+60000)})).toBe(true);
  expect(jobServiceWaiting({...retry,serviceRetryAt:new Date(Date.now()-1000)})).toBe(false);
});

test('private Steam libraries need permissions rather than repeated retries',async()=>{
  const {AppError}=await import('../src/lib/server/security/errors');
  const {jobFailureDetail}=await import('../src/lib/server/queue');
  const failure=new AppError(409,'private data','steam_private');
  expect(jobFailureDetail(failure,true)).toEqual({code:'provider.permission',remedy:'permissions',retryable:false});
  expect(jobFailureMessage(failure,true)).toContain('Steam privacy');
});
