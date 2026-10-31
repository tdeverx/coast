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

test('service timeouts have an explicit retry remedy without exposing provider data',async()=>{
  const {jobFailureDetail}=await import('../src/lib/server/queue');
  const {classifyFailure}=await import('../src/lib/server/diagnostics');
  const {safeFields}=await import('../src/lib/diagnostics');
  const error=new DOMException('private service details','TimeoutError');
  expect(classifyFailure(error)).toBe('timeout');
  expect(classifyFailure(new DOMException('cancelled','AbortError'))).toBe('aborted');
  expect(jobFailureDetail(error,false)).toEqual({code:'provider.timeout',remedy:'retry',retryable:true});
  expect(jobFailureMessage(error,false)).toContain('did not respond in time');
  expect(safeFields({provider:'steam',errorCode:'provider.timeout',error})).toEqual({provider:'steam',errorCode:'provider.timeout'});
});

test('every known queue failure code survives storage without private exception details', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { DiagnosticStore } = await import('../src/lib/server/diagnostics');
  const { jobFailureDetail } = await import('../src/lib/server/queue');
  const directory = await mkdtemp(join(tmpdir(), 'coast-queue-codes-'));
  const store = new DiagnosticStore(() => directory);
  let invalid: unknown;
  try { v.parse(v.number(), 'PRIVATE PROVIDER VALUE'); } catch (error) { invalid = error; }
  const cases: [unknown, boolean, string][] = [
    [new Error('Jellyfin returned an incomplete library page.'), false, 'jellyfin.incomplete-library-page'],
    [new Error('Jellyfin returned an unexpected library page offset.'), false, 'jellyfin.invalid-library-offset'],
    [new Error('Jellyfin library changed during pagination.'), false, 'jellyfin.changed-library-page'],
    [new Error('Jellyfin returned a cyclic media hierarchy.'), false, 'jellyfin.cyclic-media-hierarchy'],
    [new Error('Jellyfin returned an item without its show identity.'), false, 'jellyfin.item-missing-show-identity'],
    [new Error('Conflicting provider identities require administrator review.'), true, 'catalogue.identity-conflict'],
    [new Error('A season requires its canonical show.'), true, 'catalogue.season-missing-show'],
    [new Error('An episode requires its canonical show.'), true, 'catalogue.episode-missing-show'],
    [new ProviderHttpError(401), true, 'provider.authentication'],
    [new ProviderHttpError(403), true, 'provider.permission'],
    [new ProviderHttpError(404), true, 'provider.item-unavailable'],
    [new ProviderHttpError(429), false, 'provider.rate-limit'],
    [new ProviderHttpError(503), false, 'provider.unavailable'],
    [invalid, true, 'provider.invalid-data'],
    [new DOMException('PRIVATE EXCEPTION', 'TimeoutError'), false, 'provider.timeout'],
    [new Error('PRIVATE EXCEPTION'), true, 'action.rejected'],
    [new Error('PRIVATE EXCEPTION'), false, 'provider.interrupted'],
    [new Error('PRIVATE SQL', {cause:Object.assign(new Error('PRIVATE PARAMETERS'),{code:'40P01'})}), false, 'local.database-deadlock'],
  ];
  try {
    for (const [error, permanent, code] of cases) {
      const errorCode = safeDiagnosticErrorCode(error) ?? jobFailureDetail(error, permanent).code;
      expect(errorCode).toBe(code);
      await store.write('error', 'job.failed', {errorCode, error, token: 'PRIVATE TOKEN'});
    }
    const rows = await store.recent();
    expect(rows.map(row => row.detail.errorCode).sort()).toEqual(cases.map(row => row[2]).sort());
    expect(JSON.stringify(rows)).not.toContain('PRIVATE');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('database deadlocks retain a local retry remedy through wrapped errors',async()=>{
 const {jobFailureDetail}=await import('../src/lib/server/queue');
 const deadlock=Object.assign(new Error('PRIVATE SQL'),{code:'ERR_POSTGRES_SERVER_ERROR',errno:'40P01'});
 for(const error of [deadlock,new Error('PRIVATE QUERY',{cause:deadlock})]){
  expect(jobFailureMessage(error,false)).toContain('Concurrent database work');
  expect(jobFailureDetail(error,false)).toEqual({code:'local.database-deadlock',remedy:'retry',retryable:true});
 }
 expect(safeDiagnosticErrorCode(Object.assign(new Error('deadlock detected'),{code:'OTHER'}))).toBeUndefined();
 const cyclic=new Error('PRIVATE');
 cyclic.cause=cyclic;
 expect(safeDiagnosticErrorCode(cyclic)).toBeUndefined();
});

test('local provider admission saturation is retryable and does not claim a provider outage',async()=>{
 const {ProviderQueueBusyError}=await import('../src/lib/server/security/request-priority');
 const {jobFailureDetail}=await import('../src/lib/server/queue');
 const error=new ProviderQueueBusyError();
 expect(error).not.toBeInstanceOf(ProviderHttpError);
 expect(jobFailureDetail(error,false)).toEqual({code:'local.provider-busy',remedy:'retry',retryable:true});
 expect(jobFailureMessage(error,false)).toContain('Coast is busy');
 expect(jobFailureMessage(error,false)).not.toContain('cooldown');
});

test('typed permanent denials retain their remedy without relying on exception text',async()=>{
 const {PermanentActionError,jobFailureDetail}=await import('../src/lib/server/queue');
 const {safeFields}=await import('../src/lib/diagnostics');
 for(const [reason,code,remedy] of [['permission','provider.permission','permissions'],['identity','provider.identity','connection'],['invalid-request','action.rejected','metadata']] as const){
  const failure=jobFailureDetail(new PermanentActionError('PRIVATE PROVIDER RESPONSE',reason),true);
  expect(failure).toEqual({code,remedy,retryable:false});
  expect(safeFields({errorCode:code})).toEqual({errorCode:code});
 }
});

test('dynamic record keys and literal schema values never enter durable validation context',()=>{
 let failure:unknown;
 try{v.parse(v.record(v.string(),v.picklist(['PRIVATE_EXPECTED_VALUE'])),{PRIVATE_DYNAMIC_KEY:'PRIVATE_INPUT'});}catch(error){failure=error;}
 const detail=validationDiagnostic(failure);
 expect(detail?.length).toBe(1);
 expect(JSON.stringify(detail)).not.toContain('PRIVATE');
 expect(detail?.[0].expected).toBe('schema');
});
